import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

/** Which round trip a reading came from: they span different paths and are never blended. */
export type TransportDelayRttSource = 'rtcp' | 'ice';

export type TransportDelayIssuePayload = {
	peerConnectionId: string;
	/** Mean round trip in milliseconds over the detection window, at the moment the issue was raised. */
	rttInMs: number;
	/**
	 * Which measurement `rttInMs` came from. `rtcp` is the media round trip, out to the far
	 * endpoint; `ice` is the connectivity-check round trip, which in an SFU topology reaches only
	 * the SFU. A reading that changes source mid-call is describing a different path, not a
	 * changed one.
	 */
	rttSource: TransportDelayRttSource;
	/** The stretch of stats time `rttInMs` is the mean over. */
	sustainedForInMs: number;
	durationInMs?: number;
}

export type TransportDelayDetectorConfig = {
	/** Mean round trip (ms) at or above which the path counts as slow. */
	thresholdInMs: number;

	/** Round trip (ms) below which the issue resolves. Keep it under `thresholdInMs` to stop flapping. */
	recoveryThresholdInMs: number;
}

/**
 * Reports a network path that works but takes too long — the round trip high enough, for long
 * enough, that conversation becomes turn-taking. Use it to tell a slow path (a long route, a relay
 * on the wrong continent) apart from a congested one: the congestion detectors answer "is the path
 * out of room", a different fault with a different fix. Both can be true at once, and none of them
 * reads the others.
 *
 * **It reads the mean round trip over `PeerConnectionMonitor.detectionRecoveryWindow`**, which is
 * `totalRoundTripTime` divided by the number of measurements that produced it, across a span the
 * window states in milliseconds. That is deliberately not the EWMA this detector used to read: an
 * EWMA at a fixed smoothing factor has a memory set by how often stats are collected — roughly a
 * minute at a five-second period, under half that at two — so the same configuration meant
 * different things in different deployments. The window's span is the same everywhere, which is
 * also why the detector no longer counts a `durationInMs` of its own: the sustain *is* the
 * detection window, and `peerConnectionDetectionRecoveryWindow` is where its length now lives.
 *
 * **RTCP is preferred over ICE, per reading rather than once per call.** RTCP measures out to the
 * far endpoint and ICE only as far as the peer this connection talks to, so they answer different
 * questions and are never averaged together. The preference is re-decided from the window each
 * time: an RTCP total that stops advancing produces no reading at all and the detector falls back,
 * where reading a latched `rtcpRttInSec` would have kept thresholding a number that had stopped
 * moving while reporting that it could see. The source travels with the issue as `rttSource`.
 *
 * A finding clears when the *recovery* window — the stretch behind the detection window — also
 * reads below `recoveryThresholdInMs`, so a path has to have been good for both spans, not merely
 * for the most recent one.
 *
 * RTT to an SFU is a half-path measurement, so this is evidence about *this endpoint's* path and is
 * not end-to-end latency.
 *
 * Issue raised: `transport-delay-degraded`. Monitor event: `transport-delay-degraded`.
 * Config: `transportDelayDetector`.
 *
 * Category: Transport Quality
 * Layer: Delay
 *
 */
export class TransportDelayDetector implements Detector {
	public static readonly ISSUE_TYPE = 'transport-delay-degraded';
	public readonly name = 'transport-delay-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		this.issueKey = `${TransportDelayDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.transportDelayDetector!;
	}

	public update() {
		if (this.disabled) return;

		const window = this.peerConnection.detectionRecoveryWindow;

		// Not enough values yet is not a verdict either way, and it is not blindness: the window is
		// filling and will have an answer shortly. The span is checked alongside the count because
		// a window counts values, not time — ten collections carrying no stats time between them
		// fill it while measuring nothing, which is a frozen collector rather than a slow path.
		if (!window.detectionWindowIsReady || window.detectionDurationInMs < 1) return;

		const detection = this._readRtt(window.detectionDelta);

		if (detection === undefined) {
			this.inputsUnavailable = true;

			// Nothing readable anywhere in the detection window — not one missed collection, since
			// the window spans several — so the detector can no longer support the claim it made.
			// An unsupportable claim must not stand for the rest of the call: same rule as the
			// recovery window below, that a detector able to raise is always able to clear.
			if (this._raised) this._resolve('round trip no longer measurable');

			return;
		}

		this.inputsUnavailable = false;

		if (this.config.thresholdInMs <= detection.rttInMs) {
			return this._raise(detection, window.detectionDurationInMs);
		}

		if (!this._raised) return;

		// Below the raise threshold with a finding open: the recovery window is corroboration, not
		// a gate. A path has to have been good for the stretch behind this one as well *when that
		// stretch can be read* — but a window that cannot produce a reading must never be able to
		// hold a finding open for ever. A detector that can raise has to be able to clear, so with
		// nothing behind it to consult the detection reading decides on its own.
		const recovery = window.recoveryWindowIsReady
			? this._readRtt(window.recoveryDelta)
			: undefined;
		const clearing = recovery ?? detection;

		if (this.config.recoveryThresholdInMs <= clearing.rttInMs) return;

		this._resolve('round trip recovered');
	}

	/**
	 * The mean round trip across one window's deltas, or `undefined` when neither measurement
	 * moved far enough to produce one.
	 *
	 * A count delta of zero is the case that matters: the totals are still being reported, but no
	 * new measurement landed in this window, so dividing would resurrect the last mean instead of
	 * saying there is nothing new to read.
	 */
	private _readRtt(deltas: {
		totalRtcpRoundTripTimeInMs: number | null;
		totalRtcpRoundTripMeasurements: number | null;
		totalIceRoundTripTimeInMs: number | null;
		totalIceResponsesReceived: number | null;
	}): { rttInMs: number, source: TransportDelayRttSource } | undefined {
		const mean = (
			timeInMs: number | null,
			count: number | null,
			source: TransportDelayRttSource,
		) => timeInMs !== null && count !== null && 0 < count
			? { rttInMs: timeInMs / count, source }
			: undefined;


		return mean(deltas.totalRtcpRoundTripTimeInMs, deltas.totalRtcpRoundTripMeasurements, 'rtcp')
			?? mean(deltas.totalIceRoundTripTimeInMs, deltas.totalIceResponsesReceived, 'ice');
	}

	private _raise(
		reading: { rttInMs: number, source: TransportDelayRttSource },
		windowInMs: number,
	) {
		const payload: TransportDelayIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			rttInMs: reading.rttInMs,
			rttSource: reading.source,
			sustainedForInMs: windowInMs,
		};

		// Already open: refresh the measurement rather than raising a second time, so the payload
		// an operator reads is the current round trip and not the one that opened the episode.
		if (this._raised) {
			return void this.peerConnection.issues.update({
				key: this.issueKey,
				payload,
			});
		}

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('transport-delay-degraded', {
			clientMonitor,
			peerConnectionMonitor: this.peerConnection,
			rttInMs: reading.rttInMs,
		});

		this.peerConnection.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: TransportDelayDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment: string) {
		this._raised = false;

		const issue = this.peerConnection.issues.get(this.issueKey);
		let payload: TransportDelayIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as TransportDelayIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		this.peerConnection.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
