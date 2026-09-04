import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

export type TransportJitterIssuePayload = {
	peerConnectionId: string;
	/** Mean inter-arrival jitter in milliseconds at the moment the issue was raised. */
	jitterInMs: number;
	/** How long jitter stayed above the threshold before raising, from stats timestamps. */
	sustainedForInMs: number;
	durationInMs?: number;
}

export type TransportJitterDetectorConfig = {
	/** Mean inter-arrival jitter (ms) at or above which delivery counts as unstable. */
	thresholdInMs: number;

	/** Jitter (ms) below which the issue resolves. Keep it under `thresholdInMs`. */
	recoveryThresholdInMs: number;

	/** How long (ms of stats time) jitter must stay high before raising. */
	durationInMs: number;
}

/**
 * Reports a path whose packets arrive, but not evenly — bursty delivery that forces the receiver to
 * buffer more than it should. Capacity is fine, loss may be zero; what is wrong is the timing.
 *
 * Inter-arrival jitter was, until this detector, the only transport signal in the library that no
 * detector read at all: `DefaultScoreCalculator` deducted points for it and nothing else ever looked.
 *
 * The distinction worth keeping clear is against `JitterBufferStressDetector`. That one measures the
 * *jitter buffer* straining — deep target delay plus audible time-stretching — which is a perceived
 * symptom on one track. This measures the network delivering unevenly, which is its cause and lives
 * on the path. They will frequently co-fire, and that co-firing is informative precisely because
 * neither consults the other: cause and symptom confirmed independently is evidence, whereas a
 * symptom detector that only fires when a cause detector already fired is just an echo.
 *
 * A single reordered burst can spike the browser's jitter estimate, so nothing is raised until the
 * mean has stayed above `thresholdInMs` for `durationInMs` of stats time.
 *
 * Issue raised: `transport-delivery-unstable`. Monitor event: `transport-delivery-unstable`.
 * Config: `transportJitterDetector`.
 *
 * Category: Transport Quality
 * Layer: Delivery stability
 *
 */
export class TransportJitterDetector implements Detector {
	public static readonly ISSUE_TYPE = 'transport-delivery-unstable';
	public readonly name = 'transport-jitter-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _sustainedForInMs = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this.issueKey = `${TransportJitterDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.transportJitterDetector!;
	}

	public update() {
		if (this.disabled) return;

		const jitterInMs = this.peerConnection.avgInboundJitterInMs;

		if (jitterInMs === undefined) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		if (jitterInMs < this.config.recoveryThresholdInMs) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('delivery timing recovered');

			return;
		}

		if (jitterInMs < this.config.thresholdInMs) return;

		this._sustainedForInMs += this.peerConnection.deltaTime ?? 0;

		if (this._raised) return;
		if (this._sustainedForInMs < this.config.durationInMs) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('transport-delivery-unstable', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			jitterInMs,
		});

		clientMonitor.raiseIssue<TransportJitterIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: TransportJitterDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				jitterInMs,
				sustainedForInMs: this._sustainedForInMs,
			},
		});
	}

	private _resolve(comment: string) {
		this._raised = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: TransportJitterIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as TransportJitterIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<TransportJitterIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
