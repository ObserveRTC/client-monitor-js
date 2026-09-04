import { Detector } from "./Detector";
import { InboundTrackMonitor, InboundVideoFlowState } from "../monitors/InboundTrackMonitor";

/**
 * The two states that are a finding, derived from the track's own flow state rather
 * than spelled out again — `continuous` is the third of them and the one thing this
 * detector never reports, because a picture arriving properly is not an issue. Written
 * as a subtraction so the two can never drift: adding a state to `InboundVideoFlowState`
 * adds it here, and nothing has to remember to.
 */
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
	/**
	 * How long it had been stopped when the finding was raised, in ms — at least
	 * `frozenAfterInMs`. Not updated as the freeze goes on; `durationInMs` on the
	 * resolved finding is how long it lasted in total.
	 *
	 * Exact where the freeze was watched across collections, which is every freeze
	 * longer than the collecting period. Where one began and ended inside a single
	 * collection the counters give only a total and a count, never the individual
	 * lengths, so this is the mean of them — a floor on the longest, never above it.
	 */
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

/**
 * Discriminated on `state`: the two carry different evidence because they are
 * different findings. A freeze is one event with a length; choppiness is several
 * events over a window, and how much of that window they cost.
 */
export type VideoFlowIssuePayload = FrozenVideoFlow | ChoppyVideoFlow;

export type InboundVideoFlowStateDetectorConfig = {
	/**
	 * How long one uninterrupted freeze has to last before the picture counts as frozen
	 * rather than choppy, in ms.
	 *
	 * The single number the whole detector turns on: stutter and freeze are not two
	 * phenomena, they are the same interruption on either side of a duration.
	 */
	frozenAfterInMs: number;

	/**
	 * How many freezes inside `observationWindowInMs` make the picture choppy.
	 *
	 * **Two is a floor**, and lower values are raised to it: the specification counts
	 * one freeze per contiguous stop however long it lasts, so two is the least that can
	 * only mean the picture resumed and stopped again.
	 */
	minFreezeCountForChoppy: number;

	/** The recent window freezes are counted over, in ms of stats time. */
	observationWindowInMs: number;

	/**
	 * How long the picture must go without a single freeze before a choppy finding
	 * closes, in ms of stats time. A frozen one ignores this — it closes the moment
	 * frames render again, because that is exactly when the freeze is over.
	 */
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
 * for long (`frozen`). Two mutually exclusive states with one configured duration between them,
 * because stutter and a freeze are the same event — the picture stopped — differing only in how
 * long it stayed stopped. It replaces `ChoppyVideoDetector` and `FrozenVideoTrackDetector`, which
 * split that one question in two and could both fire on the same interruption.
 *
 * **What it is good for.** Answering "is this person actually watching moving video right now",
 * which is the complaint behind most "you're breaking up" reports and the thing no single stat
 * says on its own. It is a statement about the picture the viewer sees, not about the network —
 * pair it with the transport detectors to get from symptom to cause.
 *
 * **How it decides.** Two windows over the stream's own `deltaTime`, never wall clock:
 * `observationWindowInMs` holds what the verdict is made from, and freezes that age out of it fall
 * into a retention window spanning `continuousDurationInMs`, which decides only whether the
 * picture has been clean long enough to close a choppy finding. Both keep running totals, so a
 * collection costs one push and a few additions rather than a walk. Frozen wins over choppy
 * wherever both would fit, and closes the moment frames render again; choppy needs the whole
 * retention window clean, since a quiet gap between stutters is not the end of them.
 *
 * Screen shares are excluded — a slide deck sits still and jumps, which is every interruption this
 * counts and none of them a fault — as are paused tracks and a backgrounded tab, where the picture
 * is not being watched and so is not being judged.
 *
 * **Where to see the result.** Three places, all saying the same thing:
 * - `InboundTrackMonitor.frameFlowState` — `continuous` | `choppy` | `frozen`, moving with the
 *   findings below rather than with each collection, and `undefined` while the detector is not
 *   judging at all. Read it to render a badge.
 * - The `video-flow-disrupted` issue and monitor event, carrying how bad and for how long.
 * - `DefaultScoreCalculator`, which penalises a frozen picture by reading that same state — so
 *   disabling this detector also stops the score noticing freezes.
 *
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
	 * Stats time spent *watching*, and the clock every window here is measured on.
	 *
	 * Deliberately not `InboundRtpMonitor.statsClockTime`, which the capacity
	 * detectors age their windows on: that one advances through every collection,
	 * and this one stops on the ones where a counter this detector needs was not
	 * reported. A window in stats time that counted blind collections would age a
	 * freeze out of the record on the strength of time nobody observed.
	 */
	private _detectorClockTimeInMs = 0;
	private _watching = false;
	/**
	 * How long the picture has been stopped for right now, measured across the
	 * collections that rendered nothing. Zero whenever frames are arriving.
	 */
	private _frozenForInMs = 0;
	/**
	 * What the verdict is made from: the last `observationWindowInMs` of collections,
	 * with the totals kept in step on every push and shift so no verdict walks the list.
	 */
	private _issueObservationWindow: ObservedItem[] = [];
	private _observationFreezeCount = 0;
	private _observationFrozenInMs = 0;
	private _observationSpanInMs = 0;
	/**
	 * Where collections go when they age out of the observation window — too old to
	 * count towards a finding, still recent enough that a freeze in them means the
	 * picture has not yet been continuous for `continuousDurationInMs`.
	 */
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

		// All four are load-bearing: the count says how many times the picture stopped,
		// the duration how long in total, the frames whether it is stopped right now,
		// and the span is the clock every window here is measured on.
		if (
			statsDeltaTimeInMs === undefined ||
			freezes === undefined ||
			frozenSec === undefined ||
			renderedFrames === undefined
		) {
			this.inputsUnavailable = true;

			// Not a quiet interval — the clock does not advance through what could not
			// be read, so a window in stats time only counts time we were looking.
			return;
		}

		this.inputsUnavailable = false;

		// The only assignment here that is not a raise or a resolve, and it is what
		// keeps `undefined` meaning "no answer": without it a healthy track and one
		// nobody is watching would read the same. Once, on the collection this detector
		// starts judging — after that the state moves only when a finding opens or closes.
		if (!this._watching) {
			this.trackMonitor.frameFlowState = 'continuous';
			this._watching = true;
		}
		this._detectorClockTimeInMs += statsDeltaTimeInMs;

		// The picture is stopped right now: nothing at all rendered in this collection.
		// Measured, not inferred, and the only route that can see a stop while it is
		// still happening.
		if (renderedFrames === 0) {
			this._frozenForInMs += statsDeltaTimeInMs;

			if (this.config.frozenAfterInMs <= this._frozenForInMs) {
				this._raise({ state: 'frozen', observedFrozenTimeInMs: this._frozenForInMs });
			}

			return;
		}

		// Frames are arriving again, so whatever was stopped has ended. Its measured
		// length is deliberately not carried into the judgement below: a stop long
		// enough to matter has already raised while it was happening, and one that has
		// not is by definition under the threshold.
		this._frozenForInMs = 0;

		// A freeze this detector was already reporting is over the moment frames render,
		// which is now — and this collection is not judged at all. Where the stop was
		// watched across collections its whole length is credited to this one, since
		// neither counter moves while the picture is stopped, so judging it would
		// re-raise the freeze that just ended or re-read it as stutter. Where the stop
		// completed inside an earlier collection this one is simply the recovery, and a
		// picture coming back is not evidence of anything. Either way a stop is not
		// stutter, which is the confusion the merge exists to remove.
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

		// A floor on the longest single freeze in this window. The maximum of a set is
		// never below its mean, so a mean at the threshold proves one freeze reached it;
		// a mean below proves nothing either way, and the detector claims only what it
		// can prove. Freezes longer than a collection are caught above, by measurement
		// rather than by inference.
		const longestFreezeInMs = 0 < observedFreezeCount ? observedFrozenInMs / observedFreezeCount : 0;

		if (this.config.frozenAfterInMs <= longestFreezeInMs) {
			return this._raise({ state: 'frozen', observedFrozenTimeInMs: longestFreezeInMs });
		}

		if (observedFreezeCount < this.minFreezeCount) {
			// Continuous only once *both* windows are clean: under the floor is not the
			// same as clean, and the retained collections are exactly the stretch that
			// has to stay clean for `continuousDurationInMs` before a stutter is over.
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
		// The two states are mutually exclusive, so becoming the other one closes the
		// first rather than stacking a second finding on the same track.
		if (this._state === payload.state) return;
		if (this._state !== undefined) this._resolve(`the picture is ${payload.state} instead`);

		// After that resolve, never before: it says the picture is continuous, which is
		// true of the finding it closes and not of the one opening here. Whatever this
		// detector claims, the track says the same thing, and setting it here rather
		// than at each call site is what keeps the two from drifting apart.
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

		clientMonitor.raiseIssue<VideoFlowIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: InboundVideoFlowStateDetector.ISSUE_TYPE,
			payload: full,
		});
	}

	/**
	 * Forgets everything and closes any open finding. Guarded on having watched
	 * something, because the paths that call this are the resting state for a whole
	 * class of tracks — a screen share, a paused track — which would otherwise
	 * re-empty the record list on every collection for the life of the call.
	 */
	private _standDown(comment: string) {
		this.inputsUnavailable = false;

		if (this._watching) {
			this._watching = false;
			this._detectorClockTimeInMs = 0;
			this._frozenForInMs = 0;
			this._resetObservations();

			if (this._state !== undefined) this._resolve(comment);
		}

		// Last, and after any resolve above: that one says the picture is continuous,
		// and it is not — nobody is looking. A backgrounded tab renders nothing, which
		// is the browser's doing rather than a media problem, so the honest answer is
		// that there is no answer.
		this.trackMonitor.frameFlowState = undefined;
	}

	private _resolve(comment: string) {
		this._state = undefined;

		// The other half of the pair with `_raise`: a finding closing is the picture
		// being continuous again. `_standDown` overrides this to `undefined` afterwards,
		// because there the finding closes for want of anything to judge.
		this.trackMonitor.frameFlowState = 'continuous';

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		clientMonitor.resolveIssue<VideoFlowIssuePayload>(this._issueKey, {
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

	/**
	 * Folds one collection in and ages the windows on, keeping every total in step.
	 * Each collection is touched a fixed number of times whatever the windows hold, so
	 * this costs the same on the thousandth collection as on the first.
	 */
	private _updateObservations(item: ObservedItem) {
		this._issueObservationWindow.push(item);

		this._observationFreezeCount += item.freezes;
		this._observationFrozenInMs += item.frozenInMs;
		this._observationSpanInMs += item.spanInMs;

		// Demoted rather than dropped: out of the verdict, into the stretch that still
		// has to stay clean. Both bounds are exclusive of the boundary collection, so a
		// window equal to the collecting period holds exactly one collection.
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
