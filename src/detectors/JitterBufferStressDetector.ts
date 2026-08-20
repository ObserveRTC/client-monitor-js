import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type JitterBufferStressIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** What NetEQ is currently aiming for, in milliseconds. */
	targetDelayInMs: number;
	/** What it actually added per emitted sample, in milliseconds. */
	actualDelayInMs?: number;
	/** Share of samples stretched or compressed to keep up, in `0..1`. */
	timeStretchRate: number;
	consecutiveTicks: number;
	durationInMs?: number;
}

/**
 * Jitter Buffer Stress Detector
 *
 * The complement to `AudioConcealmentDetector`: it separates "network jitter
 * absorbed cleanly" from "the jitter buffer ballooned, adding latency and
 * stretching audio to cope".
 *
 * **Why both conditions are required:** a high target delay on its own is not a
 * problem — it means NetEQ is *succeeding*, buying latency to hide jitter, and
 * the user hears nothing wrong. Time stretching on its own is ordinary clock
 * drift correction. It is the two together that mean the buffer is fighting the
 * network and losing, which is what the user actually hears.
 *
 * **Detection logic:**
 * - `jitterBufferTargetDelayInMs` above `targetDelayThresholdInMs`, **and**
 * - `timeStretchRate` above `timeStretchThreshold`,
 * - sustained for `minConsecutiveTicks` collections, so one noisy tick cannot
 *   raise an issue.
 *
 * **Issues created:**
 * - Type: `audio-jitter-buffer-stress`
 */
export class JitterBufferStressDetector implements Detector {
	public static readonly ISSUE_TYPE = 'audio-jitter-buffer-stress';
	public readonly name = 'jitter-buffer-stress-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;
	private _consecutiveTicks = 0;
	private _alertOn = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${JitterBufferStressDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.jitterBufferStressDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'audio') return;
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			this._consecutiveTicks = 0;

			return this._alertOn ? this._clear('remote track paused') : undefined;
		}

		const targetDelayInMs = inboundRtp.jitterBufferTargetDelayInMs;
		const timeStretchRate = inboundRtp.timeStretchRate;

		// half the evidence is worse than none
		if (targetDelayInMs === undefined || timeStretchRate === undefined) return;

		const stressed = this.config.targetDelayThresholdInMs < targetDelayInMs &&
			this.config.timeStretchThreshold < timeStretchRate;

		if (!stressed) {
			this._consecutiveTicks = 0;

			if (this._alertOn) {
				this._clear('jitter buffer recovered');
			}

			return;
		}

		this._consecutiveTicks += 1;

		if (this._alertOn) return;
		if (this._consecutiveTicks < this.config.minConsecutiveTicks) return;

		this._alertOn = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('audio-jitter-buffer-stress', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			targetDelayInMs,
			timeStretchRate,
		});

		clientMonitor.raiseIssue<JitterBufferStressIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
			type: JitterBufferStressDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				targetDelayInMs,
				actualDelayInMs: inboundRtp.avgJitterBufferDelayInMs,
				timeStretchRate,
				consecutiveTicks: this._consecutiveTicks,
			},
		});
	}

	private _clear(comment: string) {
		this._alertOn = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: JitterBufferStressIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as JitterBufferStressIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<JitterBufferStressIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
