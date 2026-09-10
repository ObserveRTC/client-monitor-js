import { Detector } from "./Detector";
import { InboundTrackMonitor, InboundVideoFlowState } from "../monitors/InboundTrackMonitor";

/** The flow states that are a finding. Written as a subtraction so the two can never drift. */
export type VideoFlowIssueState = Exclude<InboundVideoFlowState, 'continuous'>;

type VideoFlowIssueBase = {
	peerConnectionId: string;
	trackId: string;
	/** How long the finding was open. Set when it resolves. */
	durationInMs?: number;
}

/** The picture stopped and stayed stopped. */
export type FrozenVideoFlow = VideoFlowIssueBase & {
	state: 'frozen';
	/** How long it had been stopped when the finding was raised, in ms. A floor, never above the truth. */
	observedFrozenTimeInMs: number;
}

/** The picture kept coming back and kept being interrupted. */
export type ChoppyVideoFlow = VideoFlowIssueBase & {
	state: 'choppy';
	/** Freezes counted across the detection window — at least `minFreezeCountForChoppy`. */
	freezeCount: number;
	/** The stretch they were counted over, in ms of stats time. */
	windowInMs: number;
	/** Share of that stretch the picture was stopped, `0..1`. */
	frozenRatio: number;
}

/** Discriminated on `state`: a freeze is one event with a length, choppiness several over a window. */
export type VideoFlowIssuePayload = FrozenVideoFlow | ChoppyVideoFlow;

export type InboundVideoFlowStateDetectorConfig = {
	/** How long one uninterrupted freeze must last to count as frozen rather than choppy, in ms. */
	frozenAfterInMs: number;

	/** Freezes across the detection window that make the picture choppy. Floored at two. */
	minFreezeCountForChoppy: number;
}

/**
 * Reports an inbound picture that stopped moving: repeatedly and briefly (`choppy`), or once and
 * for long (`frozen`). Use it to answer "is this person watching moving video right now" — the
 * complaint behind most "you're breaking up" reports, and one no single stat answers.
 *
 * **The evidence is `InboundTrackMonitor.detectionRecoveryWindow`**, the same window every other
 * detector on the track reads, so this one keeps no history of its own. `totalFramesRendered`,
 * `totalFreezeCount` and `totalFreezesDurationInMs` are differenced across the detection window to
 * make the verdict, and across the recovery window behind it to decide when a choppy finding may
 * close. That replaces two private windows and a private clock, and it is what fixed the
 * sensitivity: an isolated freeze inside a multi-collection window no longer fills it, where
 * previously every freeze past `frozenAfterInMs` opened a finding that the next rendered frame
 * closed. On one captured call that produced eleven findings on a track that was moving 95% of the
 * time.
 *
 * The window is the sustain, so how much evidence a verdict rests on is set by
 * `inboundTrackDetectionRecoveryWindow`, not here — a wider window is a slower, surer detector, and
 * `windowInMs` on the payload always says which stretch a given finding was measured over.
 *
 * `frozen` is **nothing rendered across the whole detection window**, which is a stronger claim
 * than one empty collection and takes as long to make as the window spans. A freeze that has
 * already ended is classified by its mean length: a mean at `frozenAfterInMs` proves one freeze
 * reached it, since a maximum is never below a mean. `choppy` is `minFreezeCountForChoppy` freezes
 * or more across the window with frames still arriving.
 *
 * The two states are mutually exclusive and one becoming the other closes the first: they are
 * different experiences with different causes, and a viewer whose stutter turned into a stop has a
 * new problem rather than a continuing one.
 *
 * `frozen` usually means delivery stopped or the decoder wedged; `choppy` usually means frames are
 * arriving late or in bursts. Both are what the viewer actually sees, so they are the right thing to
 * count when asking how a call went.
 *
 * It describes the picture, not the network — pair it with the transport detectors for a cause.
 * Paused tracks, a backgrounded tab and screen shares are not judged at all; note that a received
 * track is only known to be a screen share if the application declared it through `setContext`.
 *
 * Track attribute: `InboundTrackMonitor.frameFlowState`, also read by `DefaultScoreCalculator`.
 * Issue raised: `video-flow-disrupted`. Monitor event: `video-flow-disrupted`.
 * Config: `inboundVideoFlowStateDetector`.
 *
 * Category: Perceived Quality
 * Layer: Visual — continuity
 *
 */
export class InboundVideoFlowStateDetector implements Detector {
	public static readonly ISSUE_TYPE = 'video-flow-disrupted';
	public readonly name = 'inbound-video-flow-state-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly _issueKey: string;
	private _watching = false;
	/**
	 * Collections judged since this detector last stood down.
	 *
	 * The window is the track's, not this detector's, and it keeps being fed through a pause, a
	 * screen share and a backgrounded tab — every other detector on the track needs it to. So a
	 * window that is *full* is not necessarily full of collections this detector was looking at,
	 * and reading it on the first collection back would judge the stretch it deliberately skipped:
	 * a pause renders no frames, and would come back as a freeze. Counting what has been judged is
	 * what keeps a stand-down from being replayed as a fault.
	 */
	private _judgedCollections = 0;
	private _state?: InboundVideoFlowState;
	/** Wall clock, and only for the resolved issue's `durationInMs`. */
	private _raisedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this._issueKey = `${InboundVideoFlowStateDetector.ISSUE_TYPE}-pc-${this.peerConnection.peerConnectionId}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.inboundVideoFlowStateDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Floored at two: one freeze is one freeze, never stutter. */
	private get minFreezeCount() {
		return Math.max(2, this.config.minFreezeCountForChoppy);
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') {
			return this._standDown('the video stream is gone');
		}

		if (
			this.trackMonitor.paused ||
			this.trackMonitor.remoteOutboundTrackPaused ||
			this.trackMonitor.isScreenShare ||
			!this.peerConnection.parent.activeTab
		) {
			return this._standDown('not judging playback right now');
		}

		const window = this.trackMonitor.detectionRecoveryWindow;
		const renderedFrames = window.detectionDelta.totalFramesRendered
			?? window.detectionDelta.totalFramesDecoded;
		const freezes = window.detectionDelta.totalFreezeCount;
		const frozenInMs = window.detectionDelta.totalFreezesDurationInMs;
		const windowInMs = window.detectionDurationInMs;

		// All three are load-bearing; missing any of them makes this stretch unjudgeable.
		if (renderedFrames === null || freezes === null || frozenInMs === null) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		// A window still filling is not a verdict, and a window spanning no stats time measures
		// nothing however many values it holds.
		if (!window.detectionWindowIsReady || windowInMs < 1) return;

		// Once, when judging starts, so `undefined` keeps meaning "no answer" rather than "healthy".
		if (!this._watching) {
			this.trackMonitor.frameFlowState = 'continuous';
			this._watching = true;
		}

		this._judgedCollections += 1;

		// The window may be full of collections this detector was not looking at; see the field.
		if (this._judgedCollections < window.config.numberOfDetectionSamples) return;

		// Nothing rendered across the whole window: the picture is stopped, and has been for as
		// long as the window spans.
		if (renderedFrames === 0) {
			if (this.config.frozenAfterInMs <= windowInMs) {
				this._raise({
					state: 'frozen',
					observedFrozenTimeInMs: Math.max(frozenInMs, windowInMs),
				});
			}

			return;
		}

		// The picture is moving again, which ends a stop the moment it happens.
		if (this._state === 'frozen') {
			return this._resolve('the picture is moving again');
		}

		// A floor on the longest freeze here: a max is never below its mean, so a mean at the
		// threshold proves one freeze reached it.
		const longestFreezeInMs = 0 < freezes ? frozenInMs / freezes : 0;

		if (this.config.frozenAfterInMs <= longestFreezeInMs) {
			return this._raise({ state: 'frozen', observedFrozenTimeInMs: longestFreezeInMs });
		}

		if (this.minFreezeCount <= freezes) {
			return this._raise({
				state: 'choppy',
				freezeCount: freezes,
				windowInMs,
				frozenRatio: frozenInMs / windowInMs,
			});
		}

		if (this._state !== 'choppy') return;

		// Under the floor is not the same as clean, and the stretch behind this one has to be
		// clean too before a stutter is called over.
		if (0 < freezes) return;
		if (!window.recoveryWindowIsReady) return;

		const recoveryFreezes = window.recoveryDelta.totalFreezeCount;

		// No reading behind this one to corroborate with: the detection half decides alone rather
		// than holding a finding open on evidence that does not exist.
		if (recoveryFreezes !== null && 0 < recoveryFreezes) return;

		this._resolve('the picture has been continuous since');
	}

	private _raise(
		payload:
			| Omit<FrozenVideoFlow, 'peerConnectionId' | 'trackId'>
			| Omit<ChoppyVideoFlow, 'peerConnectionId' | 'trackId'>,
	) {
		// Mutually exclusive states: becoming the other closes the first rather than stacking.
		if (this._state === payload.state) return;
		if (this._state !== undefined) this._resolve(`the picture is ${payload.state} instead`);

		// After that resolve, never before — it sets the state back to `continuous`.
		this.trackMonitor.frameFlowState = payload.state;
		this._state = payload.state;
		this._raisedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;
		const full: VideoFlowIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			trackId: this.trackMonitor.track.id,
			...payload,
		};

		clientMonitor.emit('video-flow-disrupted', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			...full,
		});

		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: InboundVideoFlowStateDetector.ISSUE_TYPE,
			payload: full,
		});
	}

	/** Forgets everything and closes any open finding. Guarded — this is a resting state for many tracks. */
	private _standDown(comment: string) {
		this.inputsUnavailable = false;

		if (this._watching) {
			this._watching = false;
			this._judgedCollections = 0;

			if (this._state !== undefined) this._resolve(comment);
		}

		// Last, overriding the `continuous` any resolve above set: nobody is looking, so there is no answer.
		this.trackMonitor.frameFlowState = undefined;
	}

	private _resolve(comment: string) {
		this._state = undefined;

		this.trackMonitor.frameFlowState = 'continuous';

		const issue = this.trackMonitor.issues.get(this._issueKey);

		this.trackMonitor.issues.resolve({
			key: this._issueKey,
			comment,
			payload: issue
				? {
					...(issue.payload as VideoFlowIssuePayload),
					durationInMs: this._raisedAt === undefined ? undefined : Date.now() - this._raisedAt,
				}
				: undefined,
			resolvedAt: Date.now(),
		});

		this._raisedAt = undefined;
	}
}
