import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

/** Which way the two tracks have drifted apart. */
export type AVDesyncDirection = 'audio-ahead' | 'audio-behind';

export type AVDesyncPlayoutIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** The video track this audio track was compared against. */
	linkedVideoTrackId: string;
	/** Signed skew in milliseconds: positive means audio is ahead of video. */
	playoutDiffInMs: number;
	direction: AVDesyncDirection;
	/** How long the skew stayed past the raise threshold, from stats timestamps. */
	sustainedForInMs: number;
	durationInMs?: number;
}

export type AVDesyncPlayoutDetectorConfig = {
	/**
	 * Raise and resolve thresholds per direction, in ms. Audio ahead is far less forgivable than
	 * audio behind, so each direction gets its own pair.
	 */
	audioAheadRaiseInMs: number;
	audioAheadResolveInMs: number;
	audioBehindRaiseInMs: number;
	audioBehindResolveInMs: number;

	/** Stats time the skew must hold past the raise threshold before opening, in ms. */
	sustainForInMs: number;
}

/**
 * Reports a speaker's voice and their lips coming apart — one participant's audio and video playing
 * out at measurably different points in the sender's timeline. Use it to tell lip-sync drift apart
 * from either track simply being late or stuttering on its own.
 *
 * A finding usually means the two tracks were buffered differently on the way here: one path
 * degraded while the other did not, or the audio buffer grew to cover jitter while video kept
 * rendering. The sign says which is ahead, which is what tells a lagging picture from lagging sound.
 *
 * It subtracts the two tracks' `estimatedPlayoutTimestamp` values, which are both already on the
 * sender's NTP clock and so compare directly. The pairing is the application's to declare through
 * `linkedVideoTrackId`; until it does, the detector measures nothing and says so through
 * `inputsUnavailable`, since a guessed pairing would give a confidently wrong number. Each direction
 * has its own raise and resolve thresholds, and the payload names which one fired.
 *
 * `estimatedPlayoutTimestamp` is thinly implemented and extrapolated between sender reports, so this
 * says nothing about desync that begins during a freeze, and reports `inputsUnavailable` rather than
 * health where the browser omits it.
 *
 * Issue raised: `av-desync`. Monitor event: `av-desync`.
 * Config: `avDesyncPlayoutDetector`.
 *
 * Category: Perceived Quality
 * Layer: Synchronization
 *
 */
export class AVDesyncPlayoutDetector implements Detector {
	public static readonly ISSUE_TYPE = 'av-desync';
	public readonly name = 'av-desync-playout-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _sustainedForInMs = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${AVDesyncPlayoutDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.avDesyncPlayoutDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'audio') return;

		// One side is not playing out, so there is no relationship to measure.
		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			this._sustainedForInMs = 0;

			return this._raised ? this._resolve('track paused') : undefined;
		}

		const diffInMs = this.trackMonitor.linkedVideoPlayoutDiffInMs;

		if (diffInMs === undefined) {
			// No pairing declared, or a timestamp missing — unmeasurable, not in sync.
			this.inputsUnavailable = true;
			this._sustainedForInMs = 0;

			return;
		}

		this.inputsUnavailable = false;

		const raiseAt = 0 < diffInMs
			? this.config.audioAheadRaiseInMs
			: this.config.audioBehindRaiseInMs;
		const resolveAt = 0 < diffInMs
			? this.config.audioAheadResolveInMs
			: this.config.audioBehindResolveInMs;
		const skewInMs = Math.abs(diffInMs);

		if (skewInMs < resolveAt) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('tracks back in sync');

			return;
		}

		// Between the thresholds nothing changes — the band is what stops flapping.
		if (skewInMs < raiseAt) return;

		this._sustainedForInMs += inboundRtp.deltaTime ?? 0;

		if (this._raised) return;
		if (this._sustainedForInMs < this.config.sustainForInMs) return;

		const direction: AVDesyncDirection = 0 < diffInMs ? 'audio-ahead' : 'audio-behind';
		const linkedVideoTrackId = this.trackMonitor.getLinkedVideoTrack()?.track.id;

		if (linkedVideoTrackId === undefined) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('av-desync', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			linkedVideoTrackId,
			playoutDiffInMs: diffInMs,
			direction,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: AVDesyncPlayoutDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				linkedVideoTrackId,
				playoutDiffInMs: diffInMs,
				direction,
				sustainedForInMs: this._sustainedForInMs,
			},
		});
	}

	private _resolve(comment: string) {
		this._raised = false;

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: AVDesyncPlayoutIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as AVDesyncPlayoutIssuePayload),
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
