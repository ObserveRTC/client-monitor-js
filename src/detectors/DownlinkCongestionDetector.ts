import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

/**
 * Floor under the buffer comparison, in milliseconds. A buffer sitting at 5 ms and
 * doubling to 10 ms is noise, and a ratio alone cannot say so.
 *
 * A constant rather than a config field: it is a noise floor, not a policy. What an
 * operator tunes is how far above its own baseline a buffer has to climb, and that
 * is `bufferElevationRatio`.
 */
const MIN_BUFFER_DELAY_IN_MS = 100;

/**
 * How much recent stats time the rolling maximum below looks back over. Ten
 * seconds is long enough to hold the healthy stretch that preceded a collapse at
 * any ordinary collecting period, and short enough that the comparison is to the
 * path as it was a moment ago rather than to the best moment of the call.
 */
const RECENT_MAX_WINDOW_IN_MS = 10_000;

export type DownlinkCongestionIssuePayload = {
	peerConnectionId: string;
	/** What was actually arriving when the finding opened, in bps. */
	receivingBitrate: number;
	/** The recent maximum it fell away from, in bps. */
	maxReceivingBitrate: number;
	/** Mean time a video frame spent in the jitter buffer then, in ms. */
	jitterBufferDelayInMs: number;
	/** The pre-episode baseline that was compared against, in ms. */
	baselineJitterBufferDelayInMs: number;
	/**
	 * Mean inbound loss fraction when the finding opened, `0..1`, where one was
	 * measured. Evidence for whoever reads the issue and nothing more: loss is an
	 * onset event that burns out within seconds of an unchanged throttle, so it
	 * neither opens this finding nor keeps it open.
	 */
	fractionLost?: number;
	/** Filled in when the finding closes. */
	durationInMs?: number;
}

export type DownlinkCongestionDetectorConfig = {
	/** Share of its recent maximum the arriving bitrate must fall below, `0..1`. */
	collapseRatio: number;

	/**
	 * How many times its own baseline the per-frame jitter buffer delay must
	 * reach to count as a queue rather than a wobble.
	 */
	bufferElevationRatio: number;
}

/**
 * Reports this endpoint's **receiving** path no longer carrying what is being sent to it: the
 * browser reports the path as bandwidth-limited, less is arriving than was arriving, and frames are
 * queueing in the jitter buffer on the way in. The downlink half of what `CongestionDetector` used to
 * answer for both directions at once — and it has to be built differently, because it cannot read
 * the same signal.
 *
 * **Why there is no estimate to read here.** `availableIncomingBitrate` is specified, and on Chrome
 * it is not merely zero but absent: measured on both nominated pairs of a call with both peers
 * sending, `availableIncomingBitrate=undefined` on each. That is structural rather than a gap
 * somebody will fill. Chrome's congestion control is send-side, so the estimate for your downlink is
 * computed at the far end's sender and never reaches you. A receiver never computes one. The old
 * detector carried it in two payload fields that were permanently zero on the dominant browser. It
 * is used here in no form.
 *
 * **How it decides.** Three things must hold together, and each covers what the others cannot:
 *
 * - `PeerConnectionMonitor.qualityLimitationReason` is `bandwidth` — the browser's own congestion
 *   verdict. Alone it means almost nothing: measured over a throttled run it read `bandwidth` on all
 *   34 collections including all 6 healthy ones, precision 0.53. As one of three it is a filter
 *   rather than a claim, which is the only honest use of a signal that eager.
 * - `receivingBitrate` is below `collapseRatio` of its rolling maximum — less is arriving.
 * - `avgInboundVideoJitterBufferDelayInMs` is at `bufferElevationRatio` of its own pre-episode
 *   baseline and above `MIN_BUFFER_DELAY_IN_MS` — packets are queueing rather than simply not being
 *   sent. This is what separates "the link cannot carry it" from "the sender had less to send": a
 *   static screen share, a muted camera and a dropped simulcast layer all collapse the bitrate with
 *   the buffer perfectly normal.
 *
 * **How it recovers, and why not the way the uplink does.** The uplink closes its finding when the
 * estimate climbs back to a share of what it was, because there *is* an estimate saying what the
 * path now offers. Here there is not, so a threshold on the arriving bitrate would be asking the
 * recovery to be measured against a number nobody can know — a path that settles at half its old
 * capacity has recovered, and would never say so. What can be read is the same verdict that gated
 * the raise: when the browser stops reporting a bandwidth limitation, the episode is over. The
 * eagerness that makes that verdict useless as an anchor is exactly what makes its *absence* worth
 * trusting.
 *
 * **What it borrows, and what that costs.** `qualityLimitationReason` describes this endpoint's
 * encoder, so this detector is reading a sending-side verdict about a receiving-side condition. On a
 * shared last mile — home wifi, a mobile link, a saturated access network — both directions cross
 * the same bottleneck and the verdict is about the link they share. Where they do not share one, an
 * SFU with an asymmetric problem or a relay congested in one direction only, the gate can be shut
 * while the downlink is genuinely congested and this detector will stay quiet. And a connection that
 * sends nothing has no verdict at all: a receive-only viewer, an audio-only sender (the field "must
 * not exist for audio") and every browser that does not implement it set `inputsUnavailable` rather
 * than reading as a healthy path.
 *
 * **The neighbour to keep it honest against.** `JitterBufferStressDetector` also reads a jitter
 * buffer under strain. It is audio, per track, and reports what the listener hears; this is video,
 * per connection, reports capacity, and counts the buffer only alongside a bitrate collapse and the
 * browser's verdict. Two detectors firing on the same episode from different evidence is worth
 * something; two firing because one is an echo of the other is not.
 *
 * **What it deliberately does not claim.** Not that the far end is at fault rather than the path —
 * it names neither. Not that the far end's sender is being throttled: that is the far end's own
 * `uplink-congestion` to raise, on evidence this endpoint cannot see. Not that the picture is
 * degraded, which is `InboundVideoFlowStateDetector`'s subject. And nothing at all about a stream
 * that has stopped emitting frames altogether — that is a stall rather than a narrow path.
 *
 * Issue raised: `downlink-congestion`. Monitor events: `downlink-congestion`, and `congestion`
 * with `direction: 'downlink'` — see `UplinkCongestionDetector`. Connection attribute:
 * `PeerConnectionMonitor.downlinkCongested`, and `congested` for either direction.
 * Config: `downlinkCongestionDetector`.
 *
 * Category: Transport Quality
 * Layer: Capacity
 *
 */
export class DownlinkCongestionDetector implements Detector {
	public static readonly ISSUE_TYPE = 'downlink-congestion';
	public readonly name = 'downlink-congestion-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly _issueKey: string;
	private _raised = false;
	/**
	 * The last `RECENT_MAX_WINDOW_IN_MS` of the arriving bitrate, kept here rather than on the
	 * connection because nothing else has a use for it: it is the yardstick this
	 * detector measures a collapse with, not a fact about the stream.
	 */
	private _receivingBitrateWindow: { at: number, value: number }[] = [];

	/**
	 * The buffer delay this episode is judged against — the smoothed level from the
	 * last collection with nothing to report. Held rather than re-read, because an
	 * EWMA already climbing under a deepening buffer would raise the bar the episode
	 * has to clear.
	 */
	private _baselineBufferDelayInMs?: number;
	/** Wall clock, and only for the resolved finding's `durationInMs`. */
	private _raisedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this._issueKey = `${DownlinkCongestionDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.downlinkCongestionDetector!;
	}

	public update() {
		if (this.disabled) return;

		// Fed and aged first, so the yardstick keeps tracking whatever this tick
		// decides — including the collections a finding is already open across.
		const recentMax = this._trackRecentMax(this.peerConnection.receivingBitrate);

		// No inbound video on this connection: the buffer evidence this detector
		// rests on does not exist, and an audio-only connection is not judged rather
		// than judged on part of the evidence.
		if (!this.peerConnection.hasInboundVideo) {
			return this._standDown('no inbound video on this connection');
		}

		const qualityLimitationReason = this.peerConnection.qualityLimitationReason;

		// No verdict to read: a receive-only connection, an audio-only sender, a
		// browser that does not implement the field. Blind, not healthy — and this
		// detector is blind more often than its uplink twin, because it borrows a
		// signal about the sending direction to judge the receiving one.
		if (qualityLimitationReason === undefined) {
			this.inputsUnavailable = true;

			return;
		}

		const jitterBufferDelayInMs = this.peerConnection.avgInboundVideoJitterBufferDelayInMs;

		// Either the browser does not report the buffer counters, or no frame left
		// the buffer at all this collection. The second is a stalled stream rather
		// than a narrow path, and neither is something to judge from.
		if (jitterBufferDelayInMs === undefined) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		const bandwidthLimited = qualityLimitationReason === 'bandwidth';

		// While a finding is open there is one question, and the arriving bitrate
		// cannot answer it: nothing here knows what the path can carry now, so a
		// threshold on it would ask a link that settled at half its old capacity to
		// prove a recovery it has already made. The browser dropping the limitation
		// is the one recovery signal that is actually a measurement.
		if (this._raised) {
			if (!bandwidthLimited) {
				this._resolve('the browser no longer reports the path as bandwidth limited');
			}

			return;
		}

		const baselineBufferDelayInMs = this._baselineBufferDelayInMs;
		const receivingBitrate = this.peerConnection.receivingBitrate;
		const collapsed = recentMax !== undefined && receivingBitrate < recentMax * this.config.collapseRatio;
		const queueBuiltUp = baselineBufferDelayInMs !== undefined &&
			MIN_BUFFER_DELAY_IN_MS <= jitterBufferDelayInMs &&
			baselineBufferDelayInMs * this.config.bufferElevationRatio <= jitterBufferDelayInMs;

		if (!bandwidthLimited || !collapsed || !queueBuiltUp) {
			// The baseline follows the buffer only while there is nothing to report, so
			// what a raise compares against is the level from before the episode.
			this._baselineBufferDelayInMs = this.peerConnection.ewmaInboundVideoJitterBufferDelayInMs;

			return;
		}

		this._raise({
			peerConnectionId: this.peerConnection.peerConnectionId,
			receivingBitrate,
			maxReceivingBitrate: recentMax as number,
			jitterBufferDelayInMs,
			baselineJitterBufferDelayInMs: baselineBufferDelayInMs,
			fractionLost: this.peerConnection.avgInboundFractionLost,
		});
	}

	private _raise(payload: DownlinkCongestionIssuePayload) {
		this._raised = true;
		this._raisedAt = Date.now();
		this.peerConnection.downlinkCongested = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('downlink-congestion', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		// And again on the direction-agnostic feed — see `UplinkCongestionDetector`.
		// A connection congested both ways fires it twice, once per direction, which
		// is two independent verdicts rather than one restated.
		clientMonitor.emit('congestion', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			direction: 'downlink',
			...payload,
		});

		clientMonitor.raiseIssue<DownlinkCongestionIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: DownlinkCongestionDetector.ISSUE_TYPE,
			payload,
		});
	}


	/**
	 * Folds this collection's arriving bitrate into the window and returns the maximum over
	 * what is left in it. `undefined` until the window holds two observations,
	 * because the maximum of a single sample is that sample rather than a maximum —
	 * which is also what keeps a call's first collections, where the bitrate is
	 * still ramping up, from being judged.
	 *
	 * The window ages on every collection whatever else the tick does, so it is
	 * never older than it looks, and it ages on `PeerConnectionMonitor.statsClockTime` —
	 * the connection's own accumulated stats time — so a late or skipped collection
	 * widens it by what that cost rather than by one nominal period. The clock is
	 * the monitor's because it is a fact about the connection; the window over it is
	 * this detector's because it is a yardstick for a judgement.
	 */
	private _trackRecentMax(value?: number) {
		const now = this.peerConnection.statsClockTime;

		if (value !== undefined) {
			this._receivingBitrateWindow.push({ at: now, value });
		}

		const from = now - RECENT_MAX_WINDOW_IN_MS;

		while (0 < this._receivingBitrateWindow.length && this._receivingBitrateWindow[0]!.at < from) {
			this._receivingBitrateWindow.shift();
		}

		// Belt and braces here, unlike on the uplink: the buffer baseline is only set
		// on a collection that has already been judged, so this detector cannot reach
		// a verdict on the first one anyway. It stays because it is what a rolling
		// maximum means, and because the two capacity detectors are meant to read the
		// same way.
		if (this._receivingBitrateWindow.length < 2) return undefined;

		return this._receivingBitrateWindow.reduce((max, item) => Math.max(max, item.value), 0);
	}

	/** Forgets the episode and closes any open finding. */
	private _standDown(comment: string) {
		this.inputsUnavailable = false;
		this._baselineBufferDelayInMs = undefined;

		if (this._raised) this._resolve(comment);
	}

	private _resolve(comment: string) {
		this._raised = false;
		// Let the baseline pick the buffer up again from where it now is: the
		// episode is over, and the level it settles at afterwards is the one the
		// next episode has to stand out from.
		this._baselineBufferDelayInMs = this.peerConnection.ewmaInboundVideoJitterBufferDelayInMs;
		this.peerConnection.downlinkCongested = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		clientMonitor.resolveIssue<DownlinkCongestionIssuePayload>(this._issueKey, {
			comment,
			payload: issue
				? {
					...(issue.payload as DownlinkCongestionIssuePayload),
					durationInMs: this._raisedAt === undefined ? undefined : Date.now() - this._raisedAt,
				}
				: undefined,
			resolvedAt: Date.now(),
		});

		this._raisedAt = undefined;
	}
}
