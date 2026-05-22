import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type FreezedVideoTrackIssuePayload = {
	trackId?: string;
	durationInMs?: number;
}

/**
 * Frozen Video Track Detector
 * 
 * Detects when inbound video tracks experience frame freezes by monitoring
 * the `freezeCount` statistic from WebRTC inbound RTP statistics. Frame freezes
 * occur when video playback stalls due to missing, corrupted, or delayed frames.
 * 
 * **Detection Logic:**
 * - Monitors `freezeCount` from inbound RTP statistics
 * - Compares current freeze count with previous value to detect new freezes
 * - Sets `isFreezed` flag when new freeze events are detected
 * - Emits events on freeze state transitions (started/stopped)
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * 
 * **Events Emitted:**
 * - `freezed-video-track`: Emitted when video frame freeze is detected
 * 
 * **Issues Created:**
 * - Type: `freezed-video-track`
 * - Payload: `{ trackId }`
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   videoFreezesDetector: {
 *     disabled: false,
 *   }
 * };
 * 
 * // Listen for video freeze events
 * monitor.on('freezed-video-track', ({ trackMonitor }) => {
 *   console.log('Video freeze detected on track:', trackMonitor.track.id);
 * });
 * ```
 */
export class FreezedVideoTrackDetector implements Detector {
	public static readonly ISSUE_TYPE = 'freezed-video-track';
	/** Unique identifier for this detector type */
	public readonly name = 'freezed-video-track-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	
	private readonly issueKey: string;

	/** Timestamp when the current freeze episode started. */
	private _startedFreezeAt?: number;

	/**
	 * Creates a new FreezedVideoTrackDetector instance
	 * @param trackMonitor - The inbound track monitor to analyze for video freezes
	 */
	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${FreezedVideoTrackDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	/** Gets the peer connection monitor that owns this track */
	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Previous freeze count for delta calculation */
	private _lastFreezeCount = 0;

	/**
	 * Updates the detector state and checks for video frame freezes
	 * 
	 * This method monitors changes in the freeze count to detect when video
	 * frames have stopped updating, indicating a freeze condition.
	 * 
	 * **Processing Steps:**
	 * 1. Gets current inbound RTP statistics and freeze count
	 * 2. Calculates delta from previous freeze count
	 * 3. Updates freeze state based on whether new freezes occurred
	 * 4. Emits events and creates issues on freeze state transitions
	 * 5. Updates tracking variables for next iteration
	 */
	public update() {
		if (this.disabled) return;
		const inboundRtp = this.trackMonitor.getInboundRtp();
		if (!inboundRtp || !inboundRtp.freezeCount) {
			return;
		}

		const wasFreezed = inboundRtp.isFreezed;
		const clientMonitor = this.peerConnection.parent;

		inboundRtp.isFreezed = 0 < Math.max(0, inboundRtp.freezeCount - this._lastFreezeCount);
		this._lastFreezeCount = inboundRtp.freezeCount;

		if (!wasFreezed && inboundRtp.isFreezed) {
			clientMonitor.emit('freezed-video-track', {
				clientMonitor: this.peerConnection.parent,
				trackMonitor: this.trackMonitor,
			});

			this._raise({
				trackId: inboundRtp.trackIdentifier,
			});

		} else if (wasFreezed && !inboundRtp.isFreezed) {
			this._resolve('video freeze ended');
		}
	}

	private _raise(payload: FreezedVideoTrackIssuePayload) {
		this._startedFreezeAt = Date.now();

		this.peerConnection.parent.raiseIssue<FreezedVideoTrackIssuePayload>(this.issueKey, {
			type: FreezedVideoTrackDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: FreezedVideoTrackIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as FreezedVideoTrackIssuePayload),
				durationInMs: this._startedFreezeAt ? Date.now() - this._startedFreezeAt : undefined,
			};
		}

		clientMonitor.resolveIssue<FreezedVideoTrackIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedFreezeAt = undefined;
	}
}
