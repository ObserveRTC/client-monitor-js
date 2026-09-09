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
	/** Freezes counted in the window — at least `minFreezeCountForChoppy`. */
	freezeCount: number;
	/** The window they were counted over, in ms of stats time. */
	windowInMs: number;
	/** Share of that window the picture was stopped, `0..1`. */
	frozenRatio: number;
}

/** Discriminated on `state`: a freeze is one event with a length, choppiness several over a window. */
export type VideoFlowIssuePayload = FrozenVideoFlow | ChoppyVideoFlow;

export type InboundVideoFlowStateDetectorConfig = {
	/** How long one uninterrupted freeze must last to count as frozen rather than choppy, in ms. */
	frozenAfterInMs: number;

	/** Freezes inside `observationWindowInMs` that make the picture choppy. Floored at two. */
	minFreezeCountForChoppy: number;

	/** The recent window freezes are counted over, in ms of stats time. */
	observationWindowInMs: number;

	/** Freeze-free time before a choppy finding closes, in ms of stats time. A frozen one ignores this. */
	continuousDurationInMs: number;
}

type ObservedItem = {
	at: number,
	spanInMs: number,
	freezes: number,
	frozenInMs: number,
}

/**
 * Reports an inbound picture that stopped moving: repeatedly and briefly (`choppy`), or once and
 * for long (`frozen`). Use it to answer "is this person watching moving video right now" — the
 * complaint behind most "you're breaking up" reports, and one no single stat answers.
 *
 * Two mutually exclusive states with one configured duration between them, judged over two windows
 * on the stream's own `deltaTime`: `observationWindowInMs` makes the verdict, and a retention
 * window spanning `continuousDurationInMs` decides only when a choppy finding may close. Frozen
 * wins wherever both would fit, and closes the moment frames render again.
 *
 * `frozen` usually means delivery stopped or the decoder wedged; `choppy` usually means frames are
 * arriving late or in bursts. Both are what the viewer actually sees, so they are the right thing to
 * count when asking how a call went.
 *
 * It describes the picture, not the network — pair it with the transport detectors for a cause.
 * Screen shares, paused tracks and a backgrounded tab are not judged at all.
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
	/**
	 * Stats time spent *watching*, and the clock every window here is measured on. Not
	 * `statsClockTime`, which advances through collections where a needed counter was missing.
	 */
	private _detectorClockTimeInMs = 0;
	private _watching = false;
	/** How long the picture has been stopped right now. Zero whenever frames are arriving. */
	private _frozenForInMs = 0;
	/** The last `observationWindowInMs` of collections, with totals kept in step so no verdict walks the list. */
	private _issueObservationWindow: ObservedItem[] = [];
	private _observationFreezeCount = 0;
	private _observationFrozenInMs = 0;
	private _observationSpanInMs = 0;
	/** Aged out of the verdict, still recent enough to block a choppy finding from closing. */
	private _issueRetentionWindow: ObservedItem[] = [];
	private _retentionFreezeCount = 0;
	private _retentionFrozenInMs = 0;
	private _retentionSpanInMs = 0;

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

		const statsDeltaTimeInMs = inboundRtp.deltaTime;
		const freezes = inboundRtp.deltaFreezeCount;
		const frozenSec = inboundRtp.deltaTotalFreezesDuration;
		const renderedFrames = inboundRtp.deltaFramesRendered ?? inboundRtp.deltaFramesDecoded;

		// All four are load-bearing; missing any of them makes this collection unjudgeable.
		if (
			statsDeltaTimeInMs === undefined ||
			freezes === undefined ||
			frozenSec === undefined ||
			renderedFrames === undefined
		) {
			this.inputsUnavailable = true;

			// The clock deliberately does not advance: windows must only count observed time.
			return;
		}

		this.inputsUnavailable = false;

		// Once, when judging starts, so `undefined` keeps meaning "no answer" rather than "healthy".
		if (!this._watching) {
			this.trackMonitor.frameFlowState = 'continuous';
			this._watching = true;
		}
		this._detectorClockTimeInMs += statsDeltaTimeInMs;

		// Nothing rendered: the only route that sees a stop while it is still happening.
		if (renderedFrames === 0) {
			this._frozenForInMs += statsDeltaTimeInMs;

			if (this.config.frozenAfterInMs <= this._frozenForInMs) {
				this._raise({ state: 'frozen', observedFrozenTimeInMs: this._frozenForInMs });
			}

			return;
		}

		this._frozenForInMs = 0;

		// A recovery collection is credited the whole stop, so judging it would re-raise
		// the freeze that just ended or misread it as stutter. Close instead, unjudged.
		if (this._state === 'frozen') {
			this._resetObservations();

			return this._resolve('the picture is moving again');
		}

		this._updateObservations({
			at: this._detectorClockTimeInMs,
			spanInMs: statsDeltaTimeInMs,
			freezes,
			frozenInMs: frozenSec * 1000,
		});

		const observedFreezeCount = this._observationFreezeCount;
		const observedFrozenInMs = this._observationFrozenInMs;
		const observedWindowInMs = this._observationSpanInMs;

		// A floor on the longest freeze here: a max is never below its mean, so a mean at
		// the threshold proves one freeze reached it.
		const longestFreezeInMs = 0 < observedFreezeCount ? observedFrozenInMs / observedFreezeCount : 0;

		if (this.config.frozenAfterInMs <= longestFreezeInMs) {
			return this._raise({ state: 'frozen', observedFrozenTimeInMs: longestFreezeInMs });
		}

		if (observedFreezeCount < this.minFreezeCount) {
			// Both windows must be clean: under the floor is not the same as clean.
			if (this._state === 'choppy' && observedFreezeCount === 0 && this._retentionFreezeCount === 0) {
				this._resolve('the picture has been continuous since');
			}

			return;
		}

		this._raise({
			state: 'choppy',
			freezeCount: observedFreezeCount,
			windowInMs: observedWindowInMs,
			frozenRatio: 0 < observedWindowInMs ? observedFrozenInMs / observedWindowInMs : 0,
		});
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
			this._detectorClockTimeInMs = 0;
			this._frozenForInMs = 0;
			this._resetObservations();

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

	/** Folds one collection in and ages both windows on, keeping every running total in step. */
	private _updateObservations(item: ObservedItem) {
		this._issueObservationWindow.push(item);

		this._observationFreezeCount += item.freezes;
		this._observationFrozenInMs += item.frozenInMs;
		this._observationSpanInMs += item.spanInMs;

		// Demoted rather than dropped: out of the verdict, into the stretch that must stay clean.
		const observeFrom = this._detectorClockTimeInMs - this.config.observationWindowInMs;

		while (0 < this._issueObservationWindow.length) {
			const oldest = this._issueObservationWindow[0]!;

			if (observeFrom < oldest.at) break;

			this._issueObservationWindow.shift();
			this._observationFreezeCount -= oldest.freezes;
			this._observationFrozenInMs -= oldest.frozenInMs;
			this._observationSpanInMs -= oldest.spanInMs;

			this._issueRetentionWindow.push(oldest);
			this._retentionFreezeCount += oldest.freezes;
			this._retentionFrozenInMs += oldest.frozenInMs;
			this._retentionSpanInMs += oldest.spanInMs;
		}

		const retainFrom = this._detectorClockTimeInMs - this.config.continuousDurationInMs;

		while (0 < this._issueRetentionWindow.length) {
			const oldest = this._issueRetentionWindow[0]!;

			if (retainFrom < oldest.at) break;

			this._issueRetentionWindow.shift();
			this._retentionFreezeCount -= oldest.freezes;
			this._retentionFrozenInMs -= oldest.frozenInMs;
			this._retentionSpanInMs -= oldest.spanInMs;
		}
	}

	private _resetObservations() {
		this._issueObservationWindow = [];
		this._observationFreezeCount = 0;
		this._observationFrozenInMs = 0;
		this._observationSpanInMs = 0;

		this._issueRetentionWindow = [];
		this._retentionFreezeCount = 0;
		this._retentionFrozenInMs = 0;
		this._retentionSpanInMs = 0;
	}
}
