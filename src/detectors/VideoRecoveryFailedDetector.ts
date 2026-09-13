import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type VideoRecoveryFailedIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Keyframe requests sent since the current unrecovered stretch began. */
	pliCountSinceStalled: number;
	/** How long the picture has been stuck with `keyFramesDecoded` not advancing. */
	stalledForInMs: number;
	freezeCount?: number;
	/** Filled in when the finding closes. */
	durationInMs?: number;
}

export type VideoRecoveryFailedDetectorConfig = {
	/** How long the stall must last before the issue is raised. */
	recoveryFailedThresholdInMs: number;

	/** PLIs that must have been sent during the stall — evidence that repair was asked for. */
	recoveryFailedMinPliCount: number;
}

/**
 * Reports a frozen inbound video where keyframes were requested repeatedly and none arrived. Use it
 * to tell a broken repair loop apart from an ordinary freeze: `video-flow-disrupted` says a viewer
 * is looking at a still picture, this says the mechanism that exists to end it is not working —
 * a different fault with a different owner, somewhere past the first hop.
 *
 * The stall is derived from the raw counters rather than another detector's verdict: frames not
 * rendering *and* `deltaKeyFramesDecoded === 0`. The clock only starts once a PLI has actually gone
 * out, and both the stall duration and the PLI count must clear their thresholds, so the claim
 * always has both halves of its evidence. Time accumulates from each tick's `deltaTime`, so a
 * throttled tab cannot age a stall into an issue.
 *
 * Issue raised: `video-recovery-failed`. Monitor event: `video-recovery-failed`.
 * Config: `videoRecoveryFailedDetector`.
 * Track attribute: `InboundTrackMonitor.failedVideoRecovery`.
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
		if (this.disabled) {
			this.trackMonitor.failedVideoRecovery = undefined;

			return;
		}

		const inboundRtp = this.trackMonitor.getInboundRtp();

		// Nothing to read, or an end that is not watching: no recovery to judge.
		if (!inboundRtp ||
			!this.peerConnection.parent.activeTab ||
			this.trackMonitor.paused ||
			this.trackMonitor.remoteOutboundTrackPaused
		) {
			this.trackMonitor.failedVideoRecovery = undefined;

			return;
		}

		const deltaPli = inboundRtp.deltaPliCount ?? 0;
		const deltaKeyFrames = inboundRtp.deltaKeyFramesDecoded ?? 0;
		// Raw counters, never `frameFlowState`: no picture reaching the renderer and no keyframe to make one.
		const stalled = inboundRtp.deltaFramesRendered === 0 && deltaKeyFrames === 0;

		if (!stalled) {
			this.trackMonitor.failedVideoRecovery = false;
			this._stalled = false;
			this._stalledForInMs = 0;
			this._pliCountSinceStalled = 0;

			if (this._startedAt !== undefined) this._resolve('video recovered');

			return;
		}

		// Stalled, but recovery has not yet had long enough to be called failed.
		this.trackMonitor.failedVideoRecovery = false;

		// The clock only starts once a keyframe has actually been asked for.
		if (deltaPli < 1 && !this._stalled) return;

		if (this._stalled) {
			// Stats time, not wall-clock: a throttled tab must not age a stall into an issue.
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
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.trackMonitor.failedVideoRecovery = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('video-recovery-failed', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			pliCountSinceStalled: this._pliCountSinceStalled,
			stalledForInMs: this._stalledForInMs,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
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
		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: VideoRecoveryFailedIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as VideoRecoveryFailedIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
