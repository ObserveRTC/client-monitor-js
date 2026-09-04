import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { ClientIssuePayload } from "../ClientMonitorEvents";

/**
 * `pliCountSinceStalled` is how many keyframe requests went out since the current unrecovered
 * stretch began, and `stalledForInMs` how long the picture has been stuck with `keyFramesDecoded`
 * not advancing — the two together are the finding: repair was asked for repeatedly and nothing came
 * back.
 */
export type VideoRecoveryFailedIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	pliCountSinceStalled: number;
	stalledForInMs: number;
	freezeCount?: number;
	durationInMs?: number;
}

export type VideoRecoveryFailedDetectorConfig = {
	/**
	 * How long the picture must stay frozen with keyframes not advancing
	 * before `video-recovery-failed` is raised.
	 */
	recoveryFailedThresholdInMs: number;

	/**
	 * PLIs that must have been sent during the stall — the issue's claim is
	 * "we asked and nothing came back", so it requires evidence of asking.
	 */
	recoveryFailedMinPliCount: number;
}

/**
 * Reports the failure that is worth waking an SFU operator for: keyframes were requested, repeatedly,
 * over a sustained stretch, and none arrived. `video-flow-disrupted` says a viewer is looking at a
 * still picture; this says the repair mechanism that exists to end it is not working, which is a
 * different fault with a different owner. A freeze that repairs itself in a second is a lossy first
 * hop; a freeze where PLI after PLI leaves the client and `keyFramesDecoded` never moves points past
 * the first hop — at forwarding, at a consumer wired to a producer that is gone, at an encoder on the
 * far side that stopped producing keyframes.
 *
 * The stall condition is derived here from the raw counters, deliberately not from
 * `frameFlowState`: that state is `InboundVideoFlowStateDetector`'s conclusion, and a detector whose
 * verdict depends on another detector's output dies silently the moment that one is disabled, and
 * inherits its judgement calls besides. What this detector actually needs is narrower than "frozen"
 * anyway — frames not rendering *and* `deltaKeyFramesDecoded === 0`, which is the precise statement
 * that the repair did not land. `deltaFramesRendered` missing from the stats counts as rendering: a
 * claim that frames are not arriving needs the counter that says so, not its absence.
 *
 * The clock only starts once a keyframe has actually been asked for. A frozen picture with no PLI in
 * sight is a real problem, but it is a different one — nothing was requested, so nothing failed to
 * come back — and it belongs to the freeze and decoder detectors. Both the stall clock and the PLI
 * count are compared against `recoveryFailedThresholdInMs` and `recoveryFailedMinPliCount`, so the
 * issue's claim ("we asked and nothing came back") always has both halves of its evidence.
 *
 * The clock accumulates each tick's `deltaTime` rather than wall-clock elapsed, so it measures media
 * time: a throttled or backgrounded tab whose collections stall does not silently age a stall into an
 * issue. Backgrounded tabs and paused tracks stand the detector down for the tick without resetting
 * the counters — the stall neither advances nor is forgotten while nobody is watching.
 *
 * Issue raised: `video-recovery-failed`. Monitor event: `video-recovery-failed`.
 * Config: `videoRecoveryFailedDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Beside the receive chain — the repair loop
 *
 */
export class VideoRecoveryFailedDetector implements Detector {
	public static readonly ISSUE_TYPE = 'video-recovery-failed';

	public readonly name = 'video-recovery-failed-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;

	private _stalled = false;
	private _stalledForInMs = 0;
	private _pliCountSinceStalled = 0;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${VideoRecoveryFailedDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.videoRecoveryFailedDetector!;
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

		const deltaPli = inboundRtp.deltaPliCount ?? 0;
		const deltaKeyFrames = inboundRtp.deltaKeyFramesDecoded ?? 0;
		// Derived from the raw counters, never from `frameFlowState`: no picture is
		// reaching the renderer and no keyframe landed to make one, which is the
		// exact shape of a repair that did not arrive.
		const stalled = inboundRtp.deltaFramesRendered === 0 && deltaKeyFrames === 0;

		if (!stalled) {
			this._stalled = false;
			this._stalledForInMs = 0;
			this._pliCountSinceStalled = 0;

			if (this._startedAt !== undefined) this._resolve('video recovered');

			return;
		}

		// The clock only starts once a keyframe has actually been asked for; a stall with no PLI is a different problem.
		if (deltaPli < 1 && !this._stalled) return;

		if (this._stalled) {
			// stats time, not wall-clock: a throttled tab must not age a stall into an issue
			this._stalledForInMs += inboundRtp.deltaTime ?? 0;
		} else {
			this._stalled = true;
			this._stalledForInMs = 0;
		}

		this._pliCountSinceStalled += deltaPli;

		if (this._startedAt !== undefined) return;
		if (this._stalledForInMs < this.config.recoveryFailedThresholdInMs) return;
		if (this._pliCountSinceStalled < this.config.recoveryFailedMinPliCount) return;

		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('video-recovery-failed', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			pliCountSinceStalled: this._pliCountSinceStalled,
			stalledForInMs: this._stalledForInMs,
		});

		clientMonitor.raiseIssue<VideoRecoveryFailedIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: VideoRecoveryFailedDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				pliCountSinceStalled: this._pliCountSinceStalled,
				stalledForInMs: this._stalledForInMs,
				freezeCount: inboundRtp.freezeCount,
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
