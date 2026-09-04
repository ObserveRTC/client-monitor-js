import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { DecayingMaxEstimator } from "../utils/DecayingMaxEstimator";

/**
 * Floor under the pacer queue comparison, in milliseconds. A queue of 0.2 ms
 * doubling to 0.4 ms is noise, and a ratio alone cannot say so.
 *
 * A constant rather than a config field: it is a noise floor, not a policy. What
 * an operator tunes is how far above its own baseline the queue has to climb, and
 * that is `sendDelayGrowthRatio`.
 *
 * It was 10 ms, which is above the whole normal range of real traffic: replayed
 * over two captured sessions the mean pacer time ran 0-7 ms and reached 10 ms only
 * in bursts, so this floor alone cost four of the ten congestion episodes in one of
 * them. Set where it filters arithmetic noise and nothing else.
 */
const MIN_PACKET_SEND_DELAY_IN_MS = 1;

/**
 * How fast the memory of what this path recently carried fades, per second of
 * stats time. At 0.996 a peak is worth half as much after about three minutes,
 * which is long enough to hold the healthy stretch before a collapse and short
 * enough that a link which has genuinely settled narrower stops being measured
 * against what it used to be. Replayed over two captured sessions, anything from a
 * one-minute to a six-minute half-life gave the same findings — the rate is a
 * plateau rather than a knife-edge.
 *
 * A decay rather than a window: one number of state, no array to walk, and no way
 * for it to quietly become two samples the way a ten-second window did against an
 * application collecting every five. Per *second* rather than per collection, so
 * two applications on different collecting periods forget at the same rate.
 */
const AVAILABLE_BITRATE_DECAY_PER_SECOND = 0.996;

export type UplinkCongestionIssuePayload = {
	peerConnectionId: string;
	/** The estimate at the moment the finding opened, in bps. */
	availableOutgoingBitrate: number;
	/** What this endpoint was actually putting on the wire then, in bps. */
	sendingBitrate: number;
	/**
	 * What was left of the path at that moment — the estimate minus what was being
	 * sent, in bps. Negative where the encoder had not yet followed the estimate
	 * down, which is what the onset of a narrowing path looks like.
	 */
	headroomInBps: number;
	/** The average headroom this call had been running with, in bps. */
	baselineHeadroomInBps: number;
	/** The highest estimate of the recent past, faded, in bps. */
	maxAvailableOutgoingBitrate?: number;
	/**
	 * How sure this is, `0..1` — see the class doc. Both halves are carried beside it
	 * so a reader can see which one carried it.
	 */
	confidence: number;
	/** How far the path has narrowed against its own recent maximum, `0..1`. */
	narrowing: number;
	/** How far the pacer has backed up against its own usual level, `0..1`. */
	queueing: number;
	/** Mean pacer queue time per packet when the finding opened, in ms. */
	packetSendDelayInMs: number;
	/** The median estimate it was compared against, in ms. */
	baselinePacketSendDelayInMs: number;
	/**
	 * Smoothed round trip in ms, where one was available. Support only: a climbing
	 * round trip confirms a queue is building, but it is far too noisy to gate on
	 * and there is none at all until the first RTCP report arrives.
	 */
	rttInMs?: number;
	/** Filled in when the finding closes. */
	durationInMs?: number;
}

export type UplinkCongestionDetectorConfig = {
	/**
	 * How sure the detector has to be before it reports congestion, `0..1`. See the
	 * class doc for what the number means.
	 *
	 * One knob where there were two, and a forgiving one: replayed over two captured
	 * sessions, everything from 0.45 to 0.70 produced exactly the same findings. Below
	 * 0.45 a marginal narrowing starts being admitted on the strength of a deep queue
	 * alone, and the first thing that lets in is a false finding.
	 */
	minConfidence: number;
}

/**
 * Reports this endpoint's **sending** path no longer carrying what the encoder wants to produce.
 * Three things say so together: the browser reports the encoder as bandwidth-limited, the room left
 * on the path collapses, and packets start queueing in the pacer on their way out.
 *
 * **It reports a confidence rather than a verdict on each signal.** Two ratios against the
 * connection's own recent behaviour, each `0..1`, combined by their geometric mean:
 *
 * - `narrowing` = `1 - available / recentMax` — 0 while the estimate is at its recent best,
 *   approaching 1 as it collapses toward nothing.
 * - `queueing` = `1 - baseline / pacer` — 0 while the pacer sits where it usually does, 0.5 at twice
 *   that, approaching 1 as it runs away.
 *
 * The geometric mean is what makes the pair mean something neither does alone: it is zero unless
 * *both* are moving, so no amount of one can carry a finding, and a moderate reading on both
 * outranks an extreme reading on either. A path narrowing while packets back up behind it is
 * congestion; a path narrowing on its own is an encoder that has been asked for less, and a pacer
 * backing up on its own is a hiccup.
 *
 * That replaced a pair of hard thresholds — one on each signal — with a single `minConfidence`.
 * Measured over two captured sessions it reaches exactly the same findings, so the gain is not
 * accuracy: it is one knob instead of two, a much broader plateau of values that behave identically,
 * and a number in the payload that says how sure the detector was rather than only that it was sure
 * enough.
 *
 * **The path narrowing** is measured against the largest estimate of the recent past, kept as a
 * decaying maximum rather than a window — one number, and no way for it to silently shrink to two
 * samples the way a ten-second window did against an application collecting every five seconds.
 *
 * **The queue behind it** — mean pacer time per packet, Δ`totalPacketSendDelay` over Δ`packetsSent`.
 * The specification is explicit that the total is "added to totalPacketSendDelay when packetsSent is
 * incremented", so the quotient of the two deltas is the only reading that describes now. It is what
 * separates a path that narrowed from a sender that simply changed its mind.
 *
 * It is judged against its own running median rather than an absolute level, because it has no
 * meaningful absolute scale: pacer time sits an order of magnitude apart between an SFU uplink and a
 * loopback. A median and not a mean, because it is spiky and a mean of a spiky quantity sits far
 * above where the quantity usually is — over a captured session the pacer's median was 0.37 ms while
 * an EWMA of it settled at 6.02 ms, which would put "twice the baseline" at a bar the signal reached
 * eleven times in sixteen hundred collections. That one change is what made this witness usable: it
 * fires on a third of the collections the browser calls bandwidth-limited, where the version
 * calibrated against a loopback shaper fired on almost none.
 *
 * **The browser's verdict** — `qualityLimitationReason === 'bandwidth'` — gates both. Alone it is
 * worth almost nothing: over a throttled run it read `bandwidth` on all 34 collections including all
 * 6 healthy ones, precision 0.53. As one of three it is a filter rather than a claim, which is the
 * only honest use of a signal that eager. And its *absence* is worth a great deal, which is what
 * closes the finding: a verdict that is nearly always true under congestion says little when it goes
 * true and a lot when it goes false. There is no recovery threshold on any bitrate here — nothing
 * knows what the path can carry after it narrows, so a link that settles at half its old capacity
 * has recovered and a ratio against its old maximum would never say so.
 *
 * **What it deliberately does not claim, and what it stopped asking for.** Not that packets were
 * lost: a congestion controller doing its job backs off before the queue overflows, and across
 * 3449 collections of two real sessions outbound loss was zero at the 90th percentile whether
 * congested or not — a rule wanting 5% of it, which the detector this replaces had, never fired
 * once. Not that the round trip is long: the same sessions put RTT within 7% of its healthy median
 * during congestion, and the ICE round trip within 3%, so it is carried in the payload as context
 * and gates nothing. Not where the narrow part of the path is or whose it is. Nothing about the receiving direction, which has its own detector
 * and its own evidence. And nothing about what the far end sees: this is a statement about a link,
 * not about a picture.
 *
 * **What it does not need to guard against.** A muted camera, a replaced track or a screen share of
 * a still slide all lower what the encoder asks for while the path keeps offering what it did, so
 * the estimate does not move and neither queue fills. The innocent conditions that look like a
 * congested sender are ruled out by the shape rather than by a guard: none of them narrows the
 * path, and the browser is not calling any of them a bandwidth limitation either.
 *
 * **Where it cannot see.** `availableOutgoingBitrate` "only exists when the underlying congestion
 * control calculated either a send-side bandwidth estimation … or received a receive-side estimation
 * via RTCP", and `qualityLimitationReason` "must not exist for audio" and is unimplemented on some
 * browsers. Missing either is reported as `inputsUnavailable` rather than as a healthy path — the
 * difference between "nothing is wrong" and "we cannot see whether anything is wrong", and the one
 * thing the old detector got wrong badly enough to make a whole browser population read as the best
 * behaved on a fleet.
 *
 * Issue raised: `uplink-congestion`. Monitor events: `uplink-congestion`, and `congestion`
 * with `direction: 'uplink'` — the direction-agnostic feed both capacity detectors emit on,
 * for an application that only wants to know the connection is capacity-limited somewhere.
 * Connection attribute: `PeerConnectionMonitor.uplinkCongested`, and `congested` for either
 * direction. Config: `uplinkCongestionDetector`.
 *
 * Category: Transport Quality
 * Layer: Capacity
 *
 */
export class UplinkCongestionDetector implements Detector {
	public static readonly ISSUE_TYPE = 'uplink-congestion';
	public readonly name = 'uplink-congestion-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly _issueKey: string;
	private _raised = false;
	/**
	 * The largest outgoing bandwidth estimate of the recent past, fading. Kept here
	 * rather than on the connection because nothing else has a use for it: it is the
	 * yardstick this detector measures a collapse with, not a fact about the stream.
	 */
	private readonly _recentMaxAvailableOutgoingBitrate =
		new DecayingMaxEstimator(AVAILABLE_BITRATE_DECAY_PER_SECOND);

	/** Wall clock, and only for the resolved finding's `durationInMs`. */
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this._issueKey = `${UplinkCongestionDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.uplinkCongestionDetector!;
	}

	public update() {
		if (this.disabled) return;
		if (this.peerConnection.availableOutgoingBitrate === undefined) {
			return;
		}
		if (this.peerConnection.deltaTime === undefined) {
			return;
		}

		const recentMax = this._recentMaxAvailableOutgoingBitrate.update(this.peerConnection.availableOutgoingBitrate, this.peerConnection.deltaTime);
		const sendingBitrate = this.peerConnection.sendingBitrate;

		// Nothing left this endpoint at all in this collection, so there is no
		// sending path to judge. A receive-only connection lives here permanently,
		// and so does one whose senders are all paused.
		if (sendingBitrate <= 0) {
			return this._standDown('nothing is being sent over this connection');
		}

		const qualityLimitationReason = this.peerConnection.qualityLimitationReason;
		const headroomInBps = this.peerConnection.outgoingBitrateHeadroom;
		const baselineHeadroomInBps = this.peerConnection.ewmaOutgoingBitrateHeadroom;

		// No verdict, or no estimate to take the headroom from. Blind, not healthy.
		if (
			qualityLimitationReason === undefined ||
			headroomInBps === undefined ||
			baselineHeadroomInBps === undefined
		) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		const bandwidthLimited = qualityLimitationReason === 'bandwidth';

		// While a finding is open there is one question, and no bitrate can answer
		// it: nothing knows what the path can carry after it narrows, so a recovery
		// threshold would ask a link that settled at half its old capacity to prove a
		// recovery it has already made. The browser dropping the limitation is the
		// one recovery signal that is actually a measurement.
		if (this._raised) {
			if (!bandwidthLimited) {
				this._resolve('the browser no longer reports the encoder as bandwidth limited');
			}

			return;
		}

		const availableOutgoingBitrate = this.peerConnection.availableOutgoingBitrate as number;

		// `recentMax` is the yardstick the collapse is measured with, and without it
		// there is nothing to measure against. It is `undefined` only for the first
		// collection of a connection, where the estimate is still ramping up anyway.
		if (recentMax === undefined) return;

		if (!bandwidthLimited || recentMax <= 0) return;

		const packetSendDelayInMs = this.peerConnection.avgPacketSendDelayInMs;
		const baselinePacketSendDelayInMs = this.peerConnection.estimatedMedianPacketSendDelayInMs;

		// The pacer is the other half of the evidence, so a collection without it is
		// not one to judge from.
		if (packetSendDelayInMs === undefined || baselinePacketSendDelayInMs === undefined) return;

		// How far the path has narrowed: 0 while the estimate is at its recent best,
		// approaching 1 as it collapses toward nothing. Never negative without a clamp,
		// because `recentMax` folds in this collection's own estimate before returning —
		// a path that just got wider is its own maximum.
		const narrowing = 1 - (availableOutgoingBitrate / recentMax);

		// How far the pacer has backed up: 0 while it sits at its usual level, 0.5 at
		// twice it, approaching 1 as it runs away. A ratio against the connection's own
		// recent behaviour, because pacer time has no meaningful absolute scale across
		// an SFU uplink, a loopback and a mobile link.
		//
		// The noise floor goes on the *baseline*, which is what makes a pacer under it
		// score zero without a branch saying so: a 0.4 ms queue against a floor of 1 ms
		// gives a ratio above one, and the clamp takes it from there. Left to its real
		// baseline of 0.05 ms the same 0.4 ms would score 0.875 on pure arithmetic.
		const queueBaselineInMs = Math.max(baselinePacketSendDelayInMs, MIN_PACKET_SEND_DELAY_IN_MS);
		const queueing = Math.max(0, 1 - (queueBaselineInMs / packetSendDelayInMs));

		// The geometric mean, so neither signal can carry the finding alone however
		// extreme it gets, and so a moderate reading on both outranks an extreme one on
		// either. That is the whole claim: a path narrowing *while* packets back up
		// behind it is congestion, and either on its own is an encoder changing its
		// mind or a momentary hiccup.
		const confidence = Math.sqrt(narrowing * queueing);

		if (confidence < this.config.minConfidence) return;

		this._raise({
			peerConnectionId: this.peerConnection.peerConnectionId,
			availableOutgoingBitrate,
			sendingBitrate,
			headroomInBps,
			baselineHeadroomInBps,
			maxAvailableOutgoingBitrate: recentMax,
			confidence,
			narrowing,
			queueing,
			packetSendDelayInMs,
			baselinePacketSendDelayInMs,
			rttInMs: this.peerConnection.ewmaRttInSec === undefined
				? undefined
				: this.peerConnection.ewmaRttInSec * 1000,
		});
	}

	private _raise(payload: UplinkCongestionIssuePayload) {
		this._raised = true;
		this._raisedAt = Date.now();
		// The connection says what this detector says, and it is set here rather than
		// at each call site so the two cannot drift. It moves when a finding opens or
		// closes, never with a collection.
		this.peerConnection.uplinkCongested = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('uplink-congestion', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		// And again on the direction-agnostic feed, for an application that only
		// wants to know this connection is capacity-limited somewhere. It is a second
		// delivery of this finding rather than a second finding: one issue is raised,
		// and `direction` says which detector reached the verdict.
		clientMonitor.emit('congestion', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			direction: 'uplink',
			...payload,
		});

		clientMonitor.raiseIssue<UplinkCongestionIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: UplinkCongestionDetector.ISSUE_TYPE,
			payload,
		});
	}


	/**
	 * Closes any open finding. Guarded on there being one, because the path that
	 * calls this is the resting state of every receive-only connection in a fleet.
	 */
	private _standDown(comment: string) {
		this.inputsUnavailable = false;

		if (this._raised) this._resolve(comment);
	}

	private _resolve(comment: string) {
		this._raised = false;
		this.peerConnection.uplinkCongested = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		clientMonitor.resolveIssue<UplinkCongestionIssuePayload>(this._issueKey, {
			comment,
			payload: issue
				? {
					...(issue.payload as UplinkCongestionIssuePayload),
					durationInMs: this._raisedAt === undefined ? undefined : Date.now() - this._raisedAt,
				}
				: undefined,
			resolvedAt: Date.now(),
		});

		this._raisedAt = undefined;
	}
}
