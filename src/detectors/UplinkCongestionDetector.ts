import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { DecayingMaxEstimator } from "../utils/DecayingMaxEstimator";
import { FrugalQuantileEstimator } from "../utils/FrugalQuantileEstimator";

/** Noise floor: a 0.2ms queue doubling to 0.4ms is arithmetic, not congestion. */
const MIN_PACKET_SEND_DELAY_IN_MS = 1;

/** Half-life of the recent-maximum memory, ~3 minutes. Per second, not per collection. */
const AVAILABLE_BITRATE_DECAY_PER_SECOND = 0.996;

/**
 * How much the maximum's decay is multiplied by while an episode is still recent: this the
 * moment the episode closes, easing back to 1 across the window below. A path rarely gives
 * back all of what an episode took, and without it a second dip arriving inside that window
 * is scored against a capacity the path no longer reaches.
 */
const POST_EPISODE_DECAY_BOOST = 0.85;
const POST_EPISODE_FADE_WINDOW_IN_MS = 30_000;


export type UplinkCongestionIssuePayload = {
	peerConnectionId: string;

	/**
	 * The two witnesses, each a fraction in `0..1` where `0` is healthy. `undershoot`
	 * of 0.75 means the path is carrying a quarter of what it recently did;
	 * `pacerBloating` of 1 means the pacer is at least four times its usual depth.
	 */
	undershoot: number;
	pacerBloating: number;

	/** How deep the trouble is, `0..1` — the geometric mean of the two witnesses. */
	severity: number;

	/** The measurements the ratios were taken from, in their own units. */
	availableOutgoingBitrate: number;
	recentMaxAvailableBitrate: number;
	sendingBitrate: number;
	avgPacketSendDelayInMs: number;
	estimatedMedianPacketSendDelayInMs: number;

	/** Filled in when the finding closes. */
	durationInMs?: number;
}

export type UplinkCongestionDetectorConfig = {
	/** How deep the trouble has to be before reporting it, `0..1`. */
	minSeverity: number;

	/**
	 * Where `pacerBloating` reaches the top of its scale, as a multiple of the connection's own
	 * median pacer delay. The library default is `4`: a pacer sitting at four times its usual
	 * depth scores `1`, and one at twice the median scores a third of the way up.
	 *
	 * Raise it to make the witness harder to satisfy on a connection whose pacer is naturally
	 * spiky; lower it to make a mild bloat count for more. Values at or below `1` make any
	 * excess over the median score `1` outright.
	 */
	pacerBloatingSaturatesAt: number;
}

/**
 * Reports this endpoint's **sending** path running out of room — the cause behind collapsing
 * outgoing resolution and the far end saying you are breaking up. Use it to tell "this user's
 * upload is the problem" apart from a decoder, a camera or the far end's own link.
 *
 * A finding means the path itself ran short, not the endpoints: an uplink shared with something
 * else, a wireless link that degraded, a shaper or a cellular cell that narrowed. It is about this
 * user's own upload, so it explains why *everyone else* sees them badly while their own preview
 * looks perfect.
 *
 * The browser reporting the encoder bandwidth limited decides *whether* this is congestion.
 * Two witnesses decide how deep it is, each a fraction of this connection's own normal:
 *
 * - `undershoot` — how far the bandwidth estimate has fallen below the highest it recently
 *   reached.
 * - `pacerBloating` — how far pacer time per packet sits above its own running median, with
 *   `pacerBloatingSaturatesAt` times the median as the top of the scale, `4` by default.
 *
 * Their geometric mean rides on the finding as `severity` in `0..1`, opening at `minSeverity`.
 * Being a geometric mean, a witness at its healthy level takes the severity to zero: a narrowing
 * path with the pacer empty is an encoder asked for less, and a filling pacer on an unchanged path
 * is a hiccup. Where the browser reports no estimate or no verdict it sets `inputsUnavailable`
 * rather than reading as healthy.
 *
 * Issue raised: `uplink-congestion`. Monitor events: `uplink-congestion`, and `congestion` with
 * `direction: 'uplink'`. Connection attribute: `PeerConnectionMonitor.uplinkCongested`.
 * Config: `uplinkCongestionDetector`.
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

	/**
	 * The two baselines each witness is measured against — how they are fed is at the call
	 * site in `update()`.
	 */
	public readonly recentMaxAvailableBitrateEstimator = new DecayingMaxEstimator(AVAILABLE_BITRATE_DECAY_PER_SECOND);
	public readonly medianPacketSendDelayEstimator = new FrugalQuantileEstimator(0.5);

	private readonly _issueKey: string;
	private _raised = false;

	/** When the last episode closed, while the faster fade that follows it is still running. */
	private _boostedDecayAt?: number;


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

		const sendingBitrate = this.peerConnection.sendingBitrate;

		// No sending path to judge — a receive-only connection lives here permanently.
		if (sendingBitrate <= 0) {
			return this._standDown('nothing is being sent over this connection');
		}

		const availableOutgoingBitrate = this.peerConnection.totalAvailableOutgoingBitrate;
		const avgPacketSendDelayInMs = this.peerConnection.avgPacketSendDelayInMs;
		const qualityLimitationReason = this.peerConnection.qualityLimitationReason;

		// No estimate or no verdict. Blind, not healthy.
		if (
			availableOutgoingBitrate === undefined ||
			avgPacketSendDelayInMs === undefined ||
			qualityLimitationReason === undefined
		) {
			this.inputsUnavailable = true;
			this.peerConnection.uplinkVideoCongestionSeverity = undefined;

			return;
		}

		this.inputsUnavailable = false;

		const recentMaxAvailableBitrate = this.recentMaxAvailableBitrateEstimator.estimate;
		const estimatedMedianPacketSendDelayInMs = this.medianPacketSendDelayEstimator.estimate;

		this._easePostEpisodeDecay();

		// Fed after the reads above, so a collection cannot move the baseline it is judged
		// against. The maximum takes every collection, an open episode included: a congested
		// sample is lower so it cannot inflate it, and feeding it is the only way it fades.
		this.recentMaxAvailableBitrateEstimator.update(availableOutgoingBitrate, this.peerConnection.deltaTime ?? 0);

		// The median takes only collections with no finding open, or a sustained bloat would
		// drag it up and talk the episode out of existence.
		if (!this._raised) this.medianPacketSendDelayEstimator.update(avgPacketSendDelayInMs);

		// The verdict decides whether this is congestion; the witnesses below decide how deep.
		// It is also the only thing that closes an open finding.
		if (qualityLimitationReason !== 'bandwidth') {
			return this._standDown('the browser no longer reports the encoder as bandwidth limited');
		}

		// One observation is enough for both baselines: the maximum starts as that sample and
		// the quantile as its own estimate, so a witness reads 0 rather than wrong.
		if (
			recentMaxAvailableBitrate === undefined ||
			estimatedMedianPacketSendDelayInMs === undefined ||
			recentMaxAvailableBitrate <= 0 ||
			availableOutgoingBitrate <= 0
		) {
			return this._standDown('not enough history to judge congestion');
		}

		// Checked rather than defaulted: an absent scale makes the bloating `NaN`, and every
		// comparison below reads false against `NaN` — the finding would raise on everything.
		if (this.config.pacerBloatingSaturatesAt === undefined) return;

		// Clamped: a rising estimate can overtake a maximum seeded from lower samples.
		const undershoot = Math.max(0, 1 - (availableOutgoingBitrate / recentMaxAvailableBitrate));
		const pacerBaselineInMs = Math.max(estimatedMedianPacketSendDelayInMs, MIN_PACKET_SEND_DELAY_IN_MS);
		// Never zero, so a `saturatesAt` of 1 or less saturates on any excess instead of dividing by it.
		const pacerBloatingSpan = Math.max(this.config.pacerBloatingSaturatesAt - 1, Number.EPSILON);
		const pacerBloating = Math.min(1, Math.max(0,
			(avgPacketSendDelayInMs - pacerBaselineInMs) / (pacerBaselineInMs * pacerBloatingSpan),
		));

		// Geometric mean: a witness at its healthy level takes the whole thing to zero.
		const severity = Math.sqrt(undershoot * pacerBloating);

		// Kept current on every judged collection, an open episode included, so an application
		// reading it sees the trouble deepening rather than the value that opened the finding.
		this.peerConnection.uplinkVideoCongestionSeverity = severity;

		// An open finding is not raised again; it closes on the verdict above.
		if (this._raised) return;

		// Checked rather than compared against: `severity < undefined` is false, so a bare
		// comparison would raise on every collection where the config arrived without it.
		if (this.config.minSeverity === undefined) return;
		if (severity < this.config.minSeverity) return;

		this._raise({
			peerConnectionId: this.peerConnection.peerConnectionId,
			undershoot,
			pacerBloating,
			severity,
			availableOutgoingBitrate,
			recentMaxAvailableBitrate,
			sendingBitrate,
			avgPacketSendDelayInMs,
			estimatedMedianPacketSendDelayInMs,
		});
	}

	/**
	 * Moves the maximum's decay along the post-episode window: fastest the moment the episode
	 * closed, easing back to the ordinary rate across the window, and back to it outright once
	 * past. Does nothing when no episode is recent.
	 */
	private _easePostEpisodeDecay() {
		if (this._boostedDecayAt === undefined) return;

		const sinceResolveInMs = this.peerConnection.statsClockTime - this._boostedDecayAt;

		if (POST_EPISODE_FADE_WINDOW_IN_MS <= sinceResolveInMs) {
			this._boostedDecayAt = undefined;

			return this.recentMaxAvailableBitrateEstimator.updateDecayRate(AVAILABLE_BITRATE_DECAY_PER_SECOND);
		}

		const fadedBack = sinceResolveInMs / POST_EPISODE_FADE_WINDOW_IN_MS;
		const boost = POST_EPISODE_DECAY_BOOST + ((1 - POST_EPISODE_DECAY_BOOST) * fadedBack);

		this.recentMaxAvailableBitrateEstimator.updateDecayRate(AVAILABLE_BITRATE_DECAY_PER_SECOND * boost);
	}

	private _raise(payload: UplinkCongestionIssuePayload) {
		this._raised = true;
		this._raisedAt = Date.now();
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.peerConnection.uplinkCongested = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('uplink-congestion', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		// The same finding again on the direction-agnostic feed. One issue, two deliveries.

		this.peerConnection.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: UplinkCongestionDetector.ISSUE_TYPE,
			payload,
		});
	}

	/** Closes any open finding. Guarded, because this is every receive-only connection's resting state. */
	private _standDown(comment: string) {
		this.inputsUnavailable = false;
		this.peerConnection.uplinkVideoCongestionSeverity = undefined;

		if (this._raised) this._resolve(comment);
	}

	private _resolve(comment: string) {
		this._raised = false;
		this._boostedDecayAt = this.peerConnection.statsClockTime;
		this.peerConnection.uplinkCongested = false;

		const issue = this.peerConnection.issues.get(this._issueKey);

		this.peerConnection.issues.resolve({
			key: this._issueKey,
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
