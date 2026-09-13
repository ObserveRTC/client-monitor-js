import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { DecayingMaxEstimator } from "../utils/DecayingMaxEstimator";
import { FrugalQuantileEstimator } from "../utils/FrugalQuantileEstimator";

/** Noise floor: a 2ms buffer doubling to 4ms is arithmetic, not congestion. */
const MIN_JITTER_BUFFER_DELAY_IN_MS = 10;

/** Half-life of the recent-maximum memory, ~3 minutes. Per second, not per collection. */
const RECEIVING_BITRATE_DECAY_PER_SECOND = 0.996;

/**
 * How much the maximum's decay is multiplied by while an episode is still recent: this the
 * moment the episode closes, easing back to 1 across the window below. A path rarely gives
 * back all of what an episode took, and without it a second dip arriving inside that window
 * is scored against a capacity the path no longer reaches.
 */
const POST_EPISODE_DECAY_BOOST = 0.85;
const POST_EPISODE_FADE_WINDOW_IN_MS = 30_000;

/** Share of `minSeverity` the severity must fall under before an open finding closes. */
const RESOLVE_SEVERITY_FRACTION = 0.5;

export type DownlinkCongestionIssuePayload = {
	peerConnectionId: string;

	/**
	 * The two witnesses, each a fraction in `0..1` where `0` is healthy. `undershoot` of
	 * 0.75 means a quarter of what was recently arriving is arriving now; `bufferBloating`
	 * of 1 means frames are waiting at least four times their usual.
	 */
	undershoot: number;
	bufferBloating: number;

	/** How deep the trouble is, `0..1` — the geometric mean of the two witnesses. */
	severity: number;

	/** The measurements the ratios were taken from, in their own units. */
	receivingBitrate: number;
	recentMaxReceivingBitrate: number;
	avgJitterBufferDelayInMs: number;
	estimatedMedianJitterBufferDelayInMs: number;

	/** Filled in when the finding closes. */
	durationInMs?: number;
}

export type DownlinkCongestionDetectorConfig = {
	/** How deep the trouble has to be before reporting it, `0..1`. */
	minSeverity: number;

	/**
	 * Where `bufferBloating` reaches the top of its scale, as a multiple of the connection's own
	 * median jitter buffer delay. The library default is `4`: frames waiting four times their
	 * usual score `1`, and twice the median scores a third of the way up.
	 *
	 * A bloating buffer runs orders of magnitude past this, so the scale tops out early by
	 * design and the rest of the severity is carried by the undershoot. Raise it on a connection
	 * whose buffer is naturally variable; values at or below `1` make any excess score `1`.
	 */
	bufferBloatingSaturatesAt: number;
}

/**
 * Reports this endpoint's **receiving** path running out of room — the cause behind a far end
 * that pixelates and stalls while their camera and their encoder are both fine. Use it to tell
 * "this user's download is the problem" apart from the sender, the decoder, or a track nobody
 * is sending on.
 *
 * A finding means this user's own download ran short: a contended home link, a weak wireless
 * signal, a shaper. It explains why *every* remote participant looks bad to them at once, which is
 * what separates it from one sender having trouble.
 *
 * **There is no bandwidth estimate on a receiver.** `availableIncomingBitrate` is specified but
 * absent on Chrome, whose congestion control is send-side: the estimate for a downlink is computed
 * at the far end's sender and never reaches the receiver. So the verdict is built from two
 * witnesses, each a fraction of this connection's own normal:
 *
 * - `undershoot` — how far the arriving bitrate has fallen below the highest it recently
 *   reached.
 * - `bufferBloating` — how far the per-frame jitter buffer delay sits above its own running
 *   median, with `bufferBloatingSaturatesAt` times the median as the top of the scale, `4`
 *   by default.
 *
 * Their geometric mean rides on the finding as `severity` in `0..1`, opening at `minSeverity` and
 * closing under half of it. Being a geometric mean, a witness at its healthy level takes the
 * severity to zero, which is what separates a path out of room from **a far end asked for less** —
 * a muted camera, a dropped simulcast layer, a still screen share, each undershooting with the
 * buffer flat.
 *
 * Recovery rests on no bitrate threshold, because nothing at a receiver knows what the path can
 * carry now; the recent maximum decays instead, so a link that settles at half its former bandwidth
 * is judged against what it now has. It reads no `qualityLimitationReason`, which describes this
 * endpoint's *encoder* and would leave a receive-only connection permanently blind. Where there is
 * no inbound video, or no frame left the buffer, it says so rather than reading as healthy.
 *
 * Issue raised: `downlink-congestion`. Monitor events: `downlink-congestion`, and `congestion`
 * with `direction: 'downlink'`. Connection attribute: `PeerConnectionMonitor.downlinkCongested`.
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

	/**
	 * The two baselines each witness is measured against — how they are fed is at the call
	 * site in `update()`.
	 */
	public readonly recentMaxReceivingBitrateEstimator = new DecayingMaxEstimator(RECEIVING_BITRATE_DECAY_PER_SECOND);
	public readonly medianJitterBufferDelayEstimator = new FrugalQuantileEstimator(0.5);

	private readonly _issueKey: string;
	private _raised = false;

	/** When the last episode closed, while the faster fade that follows it is still running. */
	private _boostedDecayAt?: number;

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

		// No inbound video, no buffer witness — judged on half the evidence is not judged.
		if (!this.peerConnection.hasInboundVideo) {
			return this._standDown('no inbound video on this connection');
		}

		const avgJitterBufferDelayInMs = this.peerConnection.avgInboundVideoJitterBufferDelayInMs;

		// Missing counters, or no frame left the buffer — a stall, not a path out of room.
		// Blind, not healthy.
		if (avgJitterBufferDelayInMs === undefined) {
			this.inputsUnavailable = true;
			this.peerConnection.downlinkVideoCongestionSeverity = undefined;

			return;
		}

		this.inputsUnavailable = false;

		const receivingBitrate = this.peerConnection.receivingBitrate;
		const recentMaxReceivingBitrate = this.recentMaxReceivingBitrateEstimator.estimate;
		const estimatedMedianJitterBufferDelayInMs = this.medianJitterBufferDelayEstimator.estimate;

		this._easePostEpisodeDecay();

		// Fed after the reads above, so a collection cannot move the baseline it is judged
		// against. The maximum takes every collection, an open episode included: a congested
		// sample is lower so it cannot inflate it, and feeding it is the only way it fades.
		this.recentMaxReceivingBitrateEstimator.update(receivingBitrate, this.peerConnection.deltaTime ?? 0);

		// The median takes only collections with no finding open, or a sustained bloat would
		// drag it up and talk the episode out of existence.
		if (!this._raised) this.medianJitterBufferDelayEstimator.update(avgJitterBufferDelayInMs);

		// One observation is enough for both baselines: the maximum starts as that sample and
		// the quantile as its own estimate, so a witness reads 0 rather than wrong.
		if (
			recentMaxReceivingBitrate === undefined ||
			estimatedMedianJitterBufferDelayInMs === undefined ||
			recentMaxReceivingBitrate <= 0
		) {
			return this._standDown('not enough history to judge congestion');
		}

		// Checked rather than defaulted: an absent scale makes the bloating `NaN`, and every
		// comparison below reads false against `NaN` — the finding would raise on everything.
		if (this.config.bufferBloatingSaturatesAt === undefined) return;

		// Clamped: a rising bitrate can overtake a maximum seeded from lower samples.
		const undershoot = Math.max(0, 1 - (receivingBitrate / recentMaxReceivingBitrate));

		const bufferBaselineInMs = Math.max(estimatedMedianJitterBufferDelayInMs, MIN_JITTER_BUFFER_DELAY_IN_MS);
		// Never zero, so a `saturatesAt` of 1 or less saturates on any excess instead of dividing by it.
		const bufferBloatingSpan = Math.max(this.config.bufferBloatingSaturatesAt - 1, Number.EPSILON);
		const bufferBloating = Math.min(1, Math.max(0,
			(avgJitterBufferDelayInMs - bufferBaselineInMs) / (bufferBaselineInMs * bufferBloatingSpan),
		));

		// Geometric mean: a witness at its healthy level takes the whole thing to zero.
		const severity = Math.sqrt(undershoot * bufferBloating);

		this.peerConnection.downlinkVideoCongestionSeverity = severity;

		if (this._raised) {
			if (!(severity >= this.config.minSeverity * RESOLVE_SEVERITY_FRACTION)) {
				this._resolve('the undershoot and the buffer bloating have both eased');
			}

			return;
		}

		// Written to fail closed: `severity < undefined` is false, and would raise on everything.
		// Checked rather than compared against: `severity < undefined` is false, so a bare
		// comparison would raise on every collection where the config arrived without it. The
		// resolve above is left as a `>=` negation on purpose — with no threshold it reads true
		// and closes the finding, which is the safe direction for a verdict that cannot be made.
		if (this.config.minSeverity === undefined) return;
		if (severity < this.config.minSeverity) return;

		this._raise({
			peerConnectionId: this.peerConnection.peerConnectionId,
			undershoot,
			bufferBloating,
			severity,
			receivingBitrate,
			recentMaxReceivingBitrate,
			avgJitterBufferDelayInMs,
			estimatedMedianJitterBufferDelayInMs,
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

			return this.recentMaxReceivingBitrateEstimator.updateDecayRate(RECEIVING_BITRATE_DECAY_PER_SECOND);
		}

		const fadedBack = sinceResolveInMs / POST_EPISODE_FADE_WINDOW_IN_MS;
		const boost = POST_EPISODE_DECAY_BOOST + ((1 - POST_EPISODE_DECAY_BOOST) * fadedBack);

		this.recentMaxReceivingBitrateEstimator.updateDecayRate(RECEIVING_BITRATE_DECAY_PER_SECOND * boost);
	}

	private _raise(payload: DownlinkCongestionIssuePayload) {
		this._raised = true;
		this._raisedAt = Date.now();
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.peerConnection.downlinkCongested = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('downlink-congestion', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			...payload,
		});

		// The same finding again on the direction-agnostic feed. One issue, two deliveries.

		this.peerConnection.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: DownlinkCongestionDetector.ISSUE_TYPE,
			payload,
		});
	}

	/** Closes any open finding. Guarded, because this is every audio-only connection's resting state. */
	private _standDown(comment: string) {
		this.inputsUnavailable = false;
		this.peerConnection.downlinkVideoCongestionSeverity = undefined;

		if (this._raised) this._resolve(comment);
	}

	private _resolve(comment: string) {
		this._raised = false;
		this._boostedDecayAt = this.peerConnection.statsClockTime;
		this.peerConnection.downlinkCongested = false;

		const issue = this.peerConnection.issues.get(this._issueKey);

		this.peerConnection.issues.resolve({
			key: this._issueKey,
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
