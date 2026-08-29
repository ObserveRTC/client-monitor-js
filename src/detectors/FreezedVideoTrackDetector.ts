import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import type { InboundRtpMonitor } from "../monitors/InboundRtpMonitor";
import { ClientIssuePayload } from "../ClientMonitorEvents";

export type FreezedVideoTrackIssuePayload = {
	trackId?: string;
	durationInMs?: number;
}

/** `pliRate` is PLIs sent per second, averaged over `windowInMs` — the rolling window, not the episode. */
export type KeyframeStormIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	pliRate: number;
	windowInMs: number;
	durationInMs?: number;
}

/**
 * `pliCountSinceStalled` is how many keyframe requests went out since the current unrecovered
 * stretch began, and `stalledForInMs` how long the picture has been frozen with `keyFramesDecoded`
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

type WindowEntry = {
	timestamp: number;
	pliCount: number;
};

/**
 * Owns the freeze and repair domain of an inbound video track: it derives the track's freeze state
 * and watches the repair loop around it — PLIs out, keyframes back in. One detector on purpose,
 * because the repair verdicts are judgements *about* the freeze state, so splitting them apart would
 * force one detector to consume another's side effect and to die silently when that one is disabled.
 *
 * Freeze state is always derived and published on `inboundRtp.isFreezed`. A freeze starts when
 * `freezeCount` advances and persists until frames are rendered again: `freezeCount` counts freeze
 * *starts*, so its delta alone would declare a persistent freeze over after one tick, which is why
 * staying frozen additionally requires `deltaFramesRendered === 0`.
 *
 * Three findings come out of it. `freezed-video-track` tracks the episode itself, resolved with its
 * duration when rendering resumes. `keyframe-storm` reports a sustained PLI rate over a rolling
 * window; it is worth its own issue because the loop is self-reinforcing — keyframes are several
 * times the size of delta frames, so a burst of them worsens exactly the congestion that provoked
 * the PLIs — and the rate is only trusted once half a window of history exists, while the resolve
 * path deliberately has no such floor. `video-recovery-failed` is the valuable one for debugging an
 * SFU: PLIs going out repeatedly, the picture still frozen, and `keyFramesDecoded` *not* advancing —
 * the repair request left the client and nothing came back, which points at forwarding rather than
 * at the first-hop network. Its clock only starts once a keyframe has actually been asked for, since
 * a freeze with no PLI is a different problem.
 *
 * A backgrounded tab, a paused consumer and a paused remote sender all stand the detector down, and
 * the stand-down swallows the monotonic counter rather than skipping the tick, so the quiet period
 * is not replayed as freezes on the way back — a throttled tab does not render, and its freeze
 * accounting is the browser's doing, not a media problem.
 *
 * Issues raised: `freezed-video-track` (gated by `videoFreezesDetector`), `keyframe-storm` and
 * `video-recovery-failed` (both gated by `videoRecoveryDetector`). Monitor events:
 * `freezed-video-track`, `keyframe-storm`, `video-recovery-failed`. Config: `videoFreezesDetector`
 * and `videoRecoveryDetector`.
 */
export class FreezedVideoTrackDetector implements Detector {
	public static readonly ISSUE_TYPE = 'freezed-video-track';
	public static readonly KEYFRAME_STORM_ISSUE_TYPE = 'keyframe-storm';
	public static readonly RECOVERY_FAILED_ISSUE_TYPE = 'video-recovery-failed';

	public readonly name = 'freezed-video-track-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;
	private readonly _stormIssueKey: string;
	private readonly _recoveryIssueKey: string;

	private _lastFreezeCount = 0;
	private _startedFreezeAt?: number;

	private readonly _window: WindowEntry[] = [];
	private _sumPlis = 0;

	private _stormStartedAt?: number;

	private _recoveryFailedStartedAt?: number;

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

	/** Swallows the monotonic counter rather than skipping the tick, so the stand-down period is not replayed as freezes on the way back. */
	private _standDown(inboundRtp: InboundRtpMonitor, comment: string): void {
		this._lastFreezeCount = inboundRtp.freezeCount ?? 0;

		if (!inboundRtp.isFreezed) return;

		inboundRtp.isFreezed = false;
		this._resolve(this.issueKey, comment, this._startedFreezeAt);
		this._startedFreezeAt = undefined;
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp) return;

		if (!this.peerConnection.parent.activeTab) {
			return this._standDown(inboundRtp, 'tab in background');
		}

		if (this.trackMonitor.paused) {
			return this._standDown(inboundRtp, 'consumer paused');
		}
		if (this.trackMonitor.remoteOutboundTrackPaused) {
			return this._standDown(inboundRtp, 'remote track paused');
		}

		const config = this.peerConnection.parent.config;
		const wasFrozen = inboundRtp.isFreezed === true;
		const freezeCount = inboundRtp.freezeCount ?? 0;
		const newFreezes = Math.max(0, freezeCount - this._lastFreezeCount);

		this._lastFreezeCount = freezeCount;

		// `freezeCount` counts freeze *starts*, so its delta alone would end a persistent freeze after one
		// tick; staying frozen needs `deltaFramesRendered === 0` as well.
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

		this._window.push({ timestamp: now, pliCount });
		this._sumPlis += pliCount;

		for (
			let oldest = this._window[0];
			oldest && oldest.timestamp < now - config.windowInMs;
			oldest = this._window[0]
		) {
			this._sumPlis -= oldest.pliCount;
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

		const spanInSec = (now - oldestEntry.timestamp) / 1000;

		if (spanInSec <= 0) return;

		const pliRate = this._sumPlis / spanInSec;

		if (this._stormStartedAt !== undefined) {
			if (pliRate < config.pliRateAlertOff) {
				this._resolve(this._stormIssueKey, 'keyframe storm subsided', this._stormStartedAt);
				this._stormStartedAt = undefined;
			}

			return;
		}

		if (pliRate <= config.pliRateAlertOn) return;
		// half a window of history before the rate is trusted; the resolve path deliberately has no such floor.
		if (now - oldestEntry.timestamp < config.windowInMs / 2) return;

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
		if (!frozen || 0 < deltaKeyFrames) {
			this._stalledSince = undefined;
			this._pliCountSinceStalled = 0;

			if (this._recoveryFailedStartedAt !== undefined) {
				this._resolve(this._recoveryIssueKey, 'video recovered', this._recoveryFailedStartedAt);
				this._recoveryFailedStartedAt = undefined;
			}

			return;
		}

		// The clock only starts once a keyframe has actually been asked for; a freeze with no PLI is a different problem.
		if (deltaPli < 1 && this._stalledSince === undefined) return;

		const now = Date.now();

		this._stalledSince ??= now;
		this._pliCountSinceStalled += deltaPli;

		if (this._recoveryFailedStartedAt !== undefined) return;

		const stalledForInMs = now - this._stalledSince;

		if (stalledForInMs < config.recoveryFailedThresholdInMs) return;
		if (this._pliCountSinceStalled < config.recoveryFailedMinPliCount) return;

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
