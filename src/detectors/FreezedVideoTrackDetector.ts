import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { ClientIssuePayload } from "../ClientMonitorEvents";

export type FreezedVideoTrackIssuePayload = {
	trackId?: string;
	durationInMs?: number;
}

export type KeyframeStormIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** PLIs sent per second, averaged over the evaluation window. */
	pliRate: number;
	firRate?: number;
	keyFrameRate?: number;
	windowInMs: number;
	durationInMs?: number;
}

export type VideoRecoveryFailedIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** PLIs sent since the recovery attempt started. */
	pliCountSinceStalled: number;
	/** How long the stream has been frozen with keyframes not advancing. */
	stalledForInMs: number;
	freezeCount?: number;
	durationInMs?: number;
}

type WindowEntry = {
	timestamp: number;
	pliCount: number;
	firCount: number;
	keyFramesDecoded: number;
};

/**
 * Frozen Video Track Detector
 *
 * Owns the freeze / repair domain of an inbound video track: it derives the
 * track's freeze state and watches the repair loop — PLI/FIR out, keyframes
 * back in. One detector on purpose: the repair verdicts are judgements *about*
 * the freeze state, so splitting them apart forces one detector to consume
 * another's side effect (and to silently die when that other one is disabled).
 *
 * **Freeze state** (always derived, kept on `inboundRtp.isFreezed`): a freeze
 * starts when `freezeCount` advances and persists until frames are rendered
 * again — `freezeCount` counts freeze *starts*, so the raw delta alone would
 * mark a persistent freeze as over after one tick.
 *
 * **Issues raised:**
 * - `freezed-video-track` (gated by the `videoFreezesDetector` config) —
 *   raised while the track is frozen, resolved with the episode duration when
 *   rendering resumes.
 * - `keyframe-storm` (gated by `videoRecoveryDetector`) — a sustained PLI
 *   rate. Self-reinforcing: keyframes are several times the size of delta
 *   frames, so a burst of them worsens exactly the congestion that provoked
 *   the PLIs.
 * - `video-recovery-failed` (gated by `videoRecoveryDetector`) — PLIs going
 *   out repeatedly, the picture still frozen, and `keyFramesDecoded` *not*
 *   advancing. The valuable one for debugging an SFU: the repair request left
 *   the client and nothing came back, which points at forwarding rather than
 *   at the first-hop network.
 *
 * **Events emitted:** `freezed-video-track`, `keyframe-storm`,
 * `video-recovery-failed`.
 */
export class FreezedVideoTrackDetector implements Detector {
	public static readonly ISSUE_TYPE = 'freezed-video-track';
	public static readonly KEYFRAME_STORM_ISSUE_TYPE = 'keyframe-storm';
	public static readonly RECOVERY_FAILED_ISSUE_TYPE = 'video-recovery-failed';

	public readonly name = 'freezed-video-track-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	/** Hard cap protecting against pathologically fast update rates. */
	private static readonly MAX_WINDOW_ENTRIES = 128;

	private readonly issueKey: string;
	private readonly _stormIssueKey: string;
	private readonly _recoveryIssueKey: string;

	private _lastFreezeCount = 0;
	private _startedFreezeAt?: number;

	private readonly _window: WindowEntry[] = [];
	// running sums over _window, maintained on push/evict
	private _sumPlis = 0;
	private _sumFirs = 0;
	private _sumKeyFrames = 0;

	private _stormOn = false;
	private _stormStartedAt?: number;

	private _recoveryFailedOn = false;
	private _recoveryFailedStartedAt?: number;

	/** When the current "frozen and no keyframe" stretch began. */
	private _stalledSince?: number;
	private _pliCountSinceStalled = 0;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${FreezedVideoTrackDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
		this._stormIssueKey = `${FreezedVideoTrackDetector.KEYFRAME_STORM_ISSUE_TYPE}-track-${trackMonitor.track.id}`;
		this._recoveryIssueKey = `${FreezedVideoTrackDetector.RECOVERY_FAILED_ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp) return;

		const config = this.peerConnection.parent.config;
		const wasFrozen = inboundRtp.isFreezed === true;
		const freezeCount = inboundRtp.freezeCount ?? 0;
		const newFreezes = Math.max(0, freezeCount - this._lastFreezeCount);

		this._lastFreezeCount = freezeCount;

		// frozen until frames render again — freezeCount counts freeze *starts*,
		// so its delta alone would end a persistent freeze after one tick
		const frozen = 0 < newFreezes || (wasFrozen && inboundRtp.deltaFramesRendered === 0);

		inboundRtp.isFreezed = frozen;

		if (config.videoFreezesDetector) {
			this._checkFreeze(wasFrozen, frozen, inboundRtp.trackIdentifier);
		}

		const recoveryConfig = config.videoRecoveryDetector;

		if (recoveryConfig) {
			this._updateWindow(recoveryConfig, inboundRtp);
			this._checkRecoveryFailed(
				recoveryConfig,
				frozen,
				inboundRtp.deltaPliCount ?? 0,
				inboundRtp.deltaKeyFramesDecoded ?? 0,
				inboundRtp.freezeCount,
			);
		}
	}

	private _checkFreeze(wasFrozen: boolean, frozen: boolean, trackId?: string) {
		if (!wasFrozen && frozen) {
			const clientMonitor = this.peerConnection.parent;

			clientMonitor.emit('freezed-video-track', {
				clientMonitor,
				trackMonitor: this.trackMonitor,
			});

			this._startedFreezeAt = Date.now();

			clientMonitor.raiseIssue<FreezedVideoTrackIssuePayload>(this.issueKey, {
				includeInSample: this.includeIssueInSample,
				type: FreezedVideoTrackDetector.ISSUE_TYPE,
				payload: { trackId },
			});
		} else if (wasFrozen && !frozen) {
			this._resolve(this.issueKey, 'video freeze ended', this._startedFreezeAt);
			this._startedFreezeAt = undefined;
		}
	}

	private _updateWindow(
		config: { windowInMs: number, pliRateAlertOn: number, pliRateAlertOff: number },
		inboundRtp: { deltaPliCount?: number, deltaFirCount?: number, deltaKeyFramesDecoded?: number },
	) {
		const now = Date.now();
		const pliCount = inboundRtp.deltaPliCount ?? 0;
		const firCount = inboundRtp.deltaFirCount ?? 0;
		const keyFramesDecoded = inboundRtp.deltaKeyFramesDecoded ?? 0;

		this._window.push({ timestamp: now, pliCount, firCount, keyFramesDecoded });
		this._sumPlis += pliCount;
		this._sumFirs += firCount;
		this._sumKeyFrames += keyFramesDecoded;

		for (
			let oldest = this._window[0];
			oldest && (oldest.timestamp < now - config.windowInMs || FreezedVideoTrackDetector.MAX_WINDOW_ENTRIES < this._window.length);
			oldest = this._window[0]
		) {
			this._sumPlis -= oldest.pliCount;
			this._sumFirs -= oldest.firCount;
			this._sumKeyFrames -= oldest.keyFramesDecoded;
			this._window.shift();
		}

		this._checkKeyframeStorm(config, now);
	}

	private _checkKeyframeStorm(
		config: { windowInMs: number, pliRateAlertOn: number, pliRateAlertOff: number },
		now: number,
	) {
		const oldestEntry = this._window[0];

		if (!oldestEntry) return;

		const spanInSec = Math.max(1000, now - oldestEntry.timestamp) / 1000;
		const pliRate = this._sumPlis / spanInSec;

		if (this._stormOn) {
			if (pliRate < config.pliRateAlertOff) {
				this._stormOn = false;
				this._resolve(this._stormIssueKey, 'keyframe storm subsided', this._stormStartedAt);
				this._stormStartedAt = undefined;
			}

			return;
		}

		if (pliRate <= config.pliRateAlertOn) return;
		// not enough of the window has elapsed to trust the rate
		if (now - oldestEntry.timestamp < config.windowInMs / 2) return;

		this._stormOn = true;
		this._stormStartedAt = now;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('keyframe-storm', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			pliRate,
		});

		clientMonitor.raiseIssue<KeyframeStormIssuePayload>(this._stormIssueKey, {
				includeInSample: this.includeIssueInSample,
			type: FreezedVideoTrackDetector.KEYFRAME_STORM_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				pliRate,
				firRate: this._sumFirs / spanInSec,
				keyFrameRate: this._sumKeyFrames / spanInSec,
				windowInMs: config.windowInMs,
			},
		});
	}

	private _checkRecoveryFailed(
		config: { recoveryFailedThresholdInMs: number, recoveryFailedMinPliCount: number },
		frozen: boolean,
		deltaPli: number,
		deltaKeyFrames: number,
		freezeCount?: number,
	) {
		// a keyframe arrived, or the picture is moving again: the repair worked
		if (!frozen || 0 < deltaKeyFrames) {
			this._stalledSince = undefined;
			this._pliCountSinceStalled = 0;

			if (this._recoveryFailedOn) {
				this._recoveryFailedOn = false;
				this._resolve(this._recoveryIssueKey, 'video recovered', this._recoveryFailedStartedAt);
				this._recoveryFailedStartedAt = undefined;
			}

			return;
		}

		// a freeze with no PLI sent is a different problem — only start the
		// clock once we have actually asked for a keyframe
		if (deltaPli < 1 && this._stalledSince === undefined) return;

		const now = Date.now();

		this._stalledSince ??= now;
		this._pliCountSinceStalled += deltaPli;

		if (this._recoveryFailedOn) return;

		const stalledForInMs = now - this._stalledSince;

		if (stalledForInMs < config.recoveryFailedThresholdInMs) return;
		if (this._pliCountSinceStalled < config.recoveryFailedMinPliCount) return;

		this._recoveryFailedOn = true;
		this._recoveryFailedStartedAt = now;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('video-recovery-failed', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			pliCountSinceStalled: this._pliCountSinceStalled,
			stalledForInMs,
		});

		clientMonitor.raiseIssue<VideoRecoveryFailedIssuePayload>(this._recoveryIssueKey, {
				includeInSample: this.includeIssueInSample,
			type: FreezedVideoTrackDetector.RECOVERY_FAILED_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				pliCountSinceStalled: this._pliCountSinceStalled,
				stalledForInMs,
				freezeCount,
			},
		});
	}

	private _resolve(issueKey: string, comment: string, startedAt?: number) {
		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(issueKey);
		let payload: ClientIssuePayload | undefined;

		if (issue) {
			payload = {
				...issue.payload,
				durationInMs: startedAt ? Date.now() - startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue(issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});
	}
}
