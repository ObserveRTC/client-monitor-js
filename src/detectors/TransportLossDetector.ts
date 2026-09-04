import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

export type TransportLossIssuePayload = {
	peerConnectionId: string;
	/** Mean interval loss fraction (`0..1`) at the moment the issue was raised. */
	fractionLost: number;
	/** Which direction the loss was measured in. */
	direction: 'inbound' | 'outbound';
	/** How long loss stayed above the threshold before raising, from stats timestamps. */
	sustainedForInMs: number;
	durationInMs?: number;
}

export type TransportLossDetectorConfig = {
	/** Mean interval loss fraction (`0..1`) at or above which loss counts as material. */
	threshold: number;

	/** Loss fraction below which the issue resolves. Keep it under `threshold`. */
	recoveryThreshold: number;

	/** How long (ms of stats time) loss must stay high before raising. */
	durationInMs: number;
}

/**
 * Reports a path that is persistently dropping a material share of what is sent over it. The path is
 * up, the path is stable, and packets are simply not all arriving.
 *
 * Loss has always been visible to this library, but only ever as somebody else's qualifier: it gates
 * the retired `CongestionDetector`'s low-sensitivity mode and stands `DecoderPerformanceDetector` down so it
 * does not blame a decoder for a network fault. Neither of those makes a claim *about the loss*, so
 * nothing could raise it, resolve it, or count it. That is what this adds.
 *
 * It is not congestion. Congestion is the sender being told to slow down and backing off; loss is
 * packets vanishing whether or not anyone backed off. A well-behaved congestion controller produces
 * a congested path with very little loss, and a lossy wireless link produces loss with no congestion
 * signal at all. Both can be true at once, and both detectors decide independently.
 *
 * Both directions are watched with one threshold, and whichever is worse is reported — one issue
 * type, with the direction in the payload. `deltaPacketsReceived` gating on the monitor side means
 * streams that carried nothing this tick are excluded from the mean rather than counted as healthy;
 * without that, a call with eight muted tracks and one bleeding one looks fine.
 *
 * Issue raised: `transport-loss-sustained`. Monitor event: `transport-loss-sustained`.
 * Config: `transportLossDetector`.
 *
 * Category: Transport Quality
 * Layer: Delivery reliability
 *
 */
export class TransportLossDetector implements Detector {
	public static readonly ISSUE_TYPE = 'transport-loss-sustained';
	public readonly name = 'transport-loss-detector';
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
		this.issueKey = `${TransportLossDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.transportLossDetector!;
	}

	public update() {
		if (this.disabled) return;

		const inbound = this.peerConnection.avgInboundFractionLost;
		const outbound = this.peerConnection.avgOutboundFractionLost;

		if (inbound === undefined && outbound === undefined) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		// Whichever direction is worse is the one worth reporting; a path losing
		// packets one way is a problem regardless of which way that is.
		const direction: 'inbound' | 'outbound' = (outbound ?? -1) > (inbound ?? -1) ? 'outbound' : 'inbound';
		const fractionLost = Math.max(inbound ?? 0, outbound ?? 0);

		if (fractionLost < this.config.recoveryThreshold) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('loss recovered');

			return;
		}

		if (fractionLost < this.config.threshold) return;

		this._sustainedForInMs += this.peerConnection.deltaTime ?? 0;

		if (this._raised) return;
		if (this._sustainedForInMs < this.config.durationInMs) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('transport-loss-sustained', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			fractionLost,
			direction,
		});

		clientMonitor.raiseIssue<TransportLossIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: TransportLossDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				fractionLost,
				direction,
				sustainedForInMs: this._sustainedForInMs,
			},
		});
	}

	private _resolve(comment: string) {
		this._raised = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: TransportLossIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as TransportLossIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<TransportLossIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
