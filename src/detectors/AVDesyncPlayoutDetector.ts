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
	 * Milliseconds of audio *ahead* of video at or above which the issue is
	 * raised. The two directions have separate thresholds because they are not
	 * equally objectionable: in the physical world sound always arrives after
	 * light, so a viewer forgives audio lagging far more readily than audio
	 * leading. ITU-R BT.1359-1 puts the acceptability limit at roughly +90ms
	 * ahead against −185ms behind, which is where these defaults come from.
	 */
	audioAheadRaiseInMs: number;

	/** Milliseconds ahead below which the issue resolves — BT.1359-1's detectability limit. */
	audioAheadResolveInMs: number;

	/** Milliseconds of audio *behind* video (as a magnitude) at or above which the issue is raised. */
	audioBehindRaiseInMs: number;

	/** Milliseconds behind (as a magnitude) below which the issue resolves. */
	audioBehindResolveInMs: number;

	/**
	 * How long (ms of stats time) the skew must stay past the raise threshold
	 * before the issue opens. `estimatedPlayoutTimestamp` is extrapolated between
	 * RTCP sender reports, which arrive around every five seconds, so the first
	 * readings after a track starts can move sharply before the RTP-to-NTP
	 * mapping settles. This is what stops that transient becoming an issue.
	 */
	sustainForInMs: number;
}

/**
 * Reports a speaker's voice and their lips coming apart — the two tracks of one participant playing
 * out at measurably different points in the sender's timeline.
 *
 * This is the only detector in the library that compares two streams. Everything else judges one
 * object against a threshold; lip sync is by definition a relationship, and cannot be inferred from
 * either track alone. The measurement is the difference between the two tracks'
 * `estimatedPlayoutTimestamp` values, which the specification defines for exactly this purpose and
 * even writes the subtraction out: both values are already expressed on the *sender's* NTP clock,
 * because each has consumed the RTP-to-NTP mapping carried in that sender's RTCP sender reports, so
 * they subtract directly and no third quantity is needed to relate them.
 *
 * **Which video track.** The library cannot know which video track belongs with which audio track —
 * an SFU hands over independent streams, and `MediaStream` grouping is not reliably preserved across
 * topologies. So the pairing is the application's to declare, through the inbound track context's
 * `linkedVideoTrackId`. Until it is declared this detector measures nothing and says so through
 * `inputsUnavailable`; a wrong pairing would produce a confidently wrong number, and guessing was
 * the worse failure.
 *
 * **The two directions are not symmetric.** Sound arrives after light in the physical world, so a
 * viewer is markedly more tolerant of audio lagging than of audio leading — ITU-R BT.1359-1 puts
 * the acceptability limit near +90ms ahead against −185ms behind. Thresholding the absolute skew
 * against one number would be either too strict on lag or too lax on lead, so each direction gets
 * its own raise and resolve threshold, and the payload names which one fired.
 *
 * What replaced what, and why: until 4.10.0 this slot held a detector reading
 * `insertedSamplesForDeceleration` and `removedSamplesForAcceleration` — NetEQ's accelerate and
 * preemptive-expand counters. Those measure the jitter buffer time-stretching audio to track its
 * target delay, which is not synchronisation at all, and the coupling that does exist runs the other
 * way: when sync logic detects drift it *raises* NetEQ's target delay, and NetEQ decelerates to
 * reach it. The old detector therefore fired on the correction rather than the fault. That signal is
 * still read, correctly labelled, by `JitterBufferStressDetector`.
 *
 * **Known limitation, and it is a large one.** `estimatedPlayoutTimestamp` is thinly implemented:
 * Firefox populates it, Chrome declares it but only when A/V sync is enabled internally, and Safari
 * does not. Where it is absent this detector reports `inputsUnavailable` rather than silence, which
 * is the point of that flag — a fleet dashboard must be able to tell "in sync" from "cannot see".
 * The spec also extrapolates the timestamp between sender reports, so a frozen renderer can keep
 * reporting smooth playout; this detector will not catch desync that begins during a freeze.
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

		// Nothing is playing out on one side or the other, so there is no
		// relationship to measure. The accumulator is discarded rather than drained.
		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			this._sustainedForInMs = 0;

			return this._raised ? this._resolve('track paused') : undefined;
		}

		const diffInMs = this.trackMonitor.linkedVideoPlayoutDiffInMs;

		if (diffInMs === undefined) {
			// No linked video track declared, or one of the two playout timestamps
			// is missing. Either way the comparison could not be made, which is not
			// the same as the tracks being in sync.
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

		// Between the two thresholds nothing changes: an open issue stays open and a
		// closed one stays closed. That band is what stops a call sitting on the
		// limit from flapping.
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

		clientMonitor.raiseIssue<AVDesyncPlayoutIssuePayload>(this.issueKey, {
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

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: AVDesyncPlayoutIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as AVDesyncPlayoutIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<AVDesyncPlayoutIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
