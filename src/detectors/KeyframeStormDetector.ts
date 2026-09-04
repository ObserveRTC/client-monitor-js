import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { ClientIssuePayload } from "../ClientMonitorEvents";

/** `pliRate` is PLIs sent per second, averaged over `windowInMs` — the rolling window, not the episode. */
export type KeyframeStormIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	pliRate: number;
	windowInMs: number;
	durationInMs?: number;
}

type WindowEntry = {
	/** Where in the detector's own accumulated stats clock this interval ended. */
	atInMs: number;
	pliCount: number;
};

export type KeyframeStormDetectorConfig = {
	/**
	 * Sliding window over which PLI/FIR/keyframe rates are averaged. A wider
	 * window is steadier and slower to react; a narrower one is the reverse.
	 */
	windowInMs: number;

	/** PLIs per second above which a keyframe storm is raised. */
	pliRateAlertOn: number;

	/** PLIs per second below which the storm resolves (hysteresis). */
	pliRateAlertOff: number;
}

/**
 * Reports that a receiver is asking for keyframes far faster than a healthy stream ever needs to —
 * `pliRate` sustained above `pliRateAlertOn` over a rolling window. A picture loss indication goes out
 * whenever the decoder cannot continue from what it has, so an occasional one is ordinary; a stream of
 * them says every repair attempt is itself being lost or arriving unusable.
 *
 * It is worth an issue of its own because the loop is self-reinforcing rather than merely symptomatic.
 * A keyframe is several times the size of a delta frame, so a burst of keyframe requests puts a burst
 * of large frames on a link that was already dropping packets — the request made to fix the picture
 * worsens exactly the congestion that provoked it. Left running, a call can sit in this state
 * indefinitely at full bitrate and never show a moving picture.
 *
 * The rate is measured over a window the detector accumulates itself from each tick's `deltaTime`,
 * never from wall-clock elapsed: a stats collection that ran late or a tab that was throttled would
 * otherwise stretch the denominator and hide a storm that the media clock says is still raging. The
 * window is the detector's one collection; `_sumPlis` is kept alongside it so the rate costs no walk.
 *
 * Raising needs half a window of history behind it — a rate computed over one short interval is a
 * count, not a rate, and two PLIs in 200ms would clear any sensible threshold. The resolve path
 * deliberately has no such floor: once the issue is open, the first honest reading below
 * `pliRateAlertOff` should close it, and the gap between the two thresholds is what stops a stream
 * hovering at the limit from flapping the issue open and shut.
 *
 * Nothing is judged while the tab is in the background or either end of the track is paused: a
 * renderer that is not running is not evidence about the network. The window is left untouched across
 * such a tick rather than reset, so the accumulated clock stands still and the history on the far side
 * of the pause is still a fair window.
 *
 * Issue raised: `keyframe-storm`. Monitor event: `keyframe-storm`. Config: `keyframeStormDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Beside the receive chain — the repair loop
 *
 */
export class KeyframeStormDetector implements Detector {
	public static readonly ISSUE_TYPE = 'keyframe-storm';

	public readonly name = 'keyframe-storm-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;

	private readonly _window: WindowEntry[] = [];
	private _sumPlis = 0;
	private _clockInMs = 0;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${KeyframeStormDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.keyframeStormDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp) return;
		if (!this.peerConnection.parent.activeTab) return;
		if (this.trackMonitor.paused) return;
		if (this.trackMonitor.remoteOutboundTrackPaused) return;

		const config = this.config;
		const pliCount = inboundRtp.deltaPliCount ?? 0;

		// The clock is the stats timestamps accumulated, so a late collection
		// widens the window by exactly as much media time as it covered.
		this._clockInMs += inboundRtp.deltaTime ?? 0;
		this._window.push({ atInMs: this._clockInMs, pliCount });
		this._sumPlis += pliCount;

		for (
			let oldest = this._window[0];
			oldest && oldest.atInMs < this._clockInMs - config.windowInMs;
			oldest = this._window[0]
		) {
			this._sumPlis -= oldest.pliCount;
			this._window.shift();
		}

		const oldestEntry = this._window[0];

		if (!oldestEntry) return;

		const spanInMs = this._clockInMs - oldestEntry.atInMs;

		if (spanInMs <= 0) return;

		const pliRate = this._sumPlis / (spanInMs / 1000);

		if (this._startedAt !== undefined) {
			if (pliRate < config.pliRateAlertOff) this._resolve('keyframe storm subsided');

			return;
		}

		if (pliRate <= config.pliRateAlertOn) return;
		// half a window of history before the rate is trusted; the resolve path deliberately has no such floor.
		if (spanInMs < config.windowInMs / 2) return;

		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('keyframe-storm', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			pliRate,
		});

		clientMonitor.raiseIssue<KeyframeStormIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: KeyframeStormDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				pliRate,
				windowInMs: config.windowInMs,
			},
		});
	}

	private _resolve(comment: string) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: ClientIssuePayload | undefined;

		if (issue) {
			payload = {
				...issue.payload,
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
