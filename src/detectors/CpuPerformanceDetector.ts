import { ClientMonitor } from "..";
import type { ClientWindowValues } from "../ClientMonitor";
import type { WindowSlice } from "../utils/SlicedWindow";
import { runsOffCpu } from "../utils/runsOffCpu";
import { Detector } from "./Detector";

export type CpuPerformanceIssuePayload = {
	/**
	 * Time spent inside the video encoders per unit of stats time, summed over every sending
	 * stream that encodes on the CPU. `0.5` is half the interval occupied encoding; because the
	 * streams add, three simulcast layers busy half the time each come to `1.5` rather than
	 * saturating at `1`.
	 */
	encoderUtilization: number;

	/** The same for the video decoders, summed over every receiving stream that decodes on the CPU. */
	decoderUtilization?: number;

	/**
	 * The lower of the two utilizations, or whichever one exists on a client that only sends or
	 * only receives. This is what gets compared against `utilizationThreshold`.
	 */
	minUtilization: number;

	/** How many video streams were left out of each sum for encoding or decoding off the CPU. */
	hardwareAcceleratedEncoders: number;
	hardwareAcceleratedDecoders: number;

	/** The stretch the reading above was taken over, as the window measured it. */
	sustainedForInMs: number;

	/** Filled in when the issue is resolved: the reading that cleared it, and how long it stood. */
	recoveredMinUtilization?: number;
	durationInMs?: number;
}

export type CpuPerformanceDetectorConfig = {
	/**
	 * The utilization `minUtilization` has to reach before this reports anything. Read it as a
	 * usage level: `0.5` means both halves of the pipeline are spending at least half the
	 * detection window inside a codec.
	 */
	utilizationThreshold: number;

	/**
	 * Utilization below which the finding clears. Keep it under `utilizationThreshold` to stop
	 * flapping. The sustain is not here: it is the detection slice, and `clientWindow` is where
	 * its length lives.
	 */
	recoveryThreshold: number;
}

/**
 * Reports the client machine, rather than the network, being why a call looks bad. Use it to tell a
 * saturated CPU apart from a congested link before anyone goes looking at the network.
 *
 * A finding means the device is out of headroom: too many streams for it, a thermal or battery
 * throttle, another application taking the machine, or a software codec on hardware too old to run
 * it. It is a property of the endpoint, so the same user tends to show it on every call.
 *
 * The measurement is **utilization** — codec time per unit of stats time, summed over the video
 * streams, where `0.25` is a quarter of the stretch spent inside a codec. Summed rather than
 * averaged, so three simulcast layers busy half the time each read `1.5`; nothing clamps it at `1`.
 * `encoderUtilization` and `decoderUtilization` combine with `min()` into `minUtilization`, so codec
 * work on one side alone is a busy stream and work on both at once is a busy machine. A client
 * missing one direction is judged on the other.
 *
 * **It reads that over `ClientMonitor.slicedWindow`**, not off a single collection. Utilization
 * swings with whatever the encoder happens to be doing from one collection to the next, and a
 * machine actually out of headroom stays busy across the stretch; reading one collection at a time
 * made a busy moment indistinguishable from a busy machine, and the finding flickered on and off
 * with it. The sustain *is* the detection slice, which is why this detector counts no duration of
 * its own: `clientWindow` is where its length lives.
 *
 * A finding clears when the *recovery* window — the stretch behind the detection window — is also
 * below `recoveryThreshold`, so the machine has to have been quiet across both spans rather than
 * merely the most recent one.
 *
 * The totals come off `PeerConnectionMonitor`, accumulated one collection's delta at a time and
 * summed across connections, rather than read from the streams' own counters. That is what makes a
 * stream appearing or disappearing mid-call a change in what is being measured instead of a step in
 * the total: a layer that joins brings only what it encodes from then on.
 *
 * It is not CPU time: `totalEncodeTime` is elapsed time inside the codec call, so a hardware codec
 * waiting on the GPU would count in full. Streams naming an off-CPU implementation, or flagged
 * `powerEfficient`, are left out as each collection's delta is taken — whether a stream counts is a
 * property of that collection, not of the stretch read back later. Whether there is anything to
 * measure at all is likewise decided on the current collection: a wholly hardware pipeline sets
 * `inputsUnavailable` rather than reading as healthy, which a cumulative total holding its last
 * value could not tell you. A backgrounded tab is not fed to the window at all, since throttled
 * timers stretch the interval and read as an idle machine; the hole that leaves trips the window's
 * own gap guard.
 *
 * Deliberately not gated on `qualityLimitationReason === 'cpu'`: Chrome's precedence is
 * `bandwidth > cpu > none`, so a machine that is both would report `bandwidth` and the gate would
 * close exactly where both problems are real.
 *
 * Raises `cpulimitation`. Emits `cpulimitation`. Config: `cpuPerformanceDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Across both chains — the machine
 *
 */
export class CpuPerformanceDetector implements Detector {
	public static readonly ISSUE_TYPE = 'cpulimitation';

	public readonly name = 'cpu-performance-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey = CpuPerformanceDetector.ISSUE_TYPE;

	private _startedAlertAt?: number;

	public constructor(
		public readonly clientMonitor: ClientMonitor,
	) {}

	private get config() {
		return this.clientMonitor.config.cpuPerformanceDetector!;
	}

	public update() {
		if (this.disabled) return;

		if (!this.clientMonitor.activeTab) {
			this.inputsUnavailable = false;
			this.clientMonitor.cpuUtilization = undefined;

			return this._standDown('tab in background');
		}

		// No video at all, or none of it running on the CPU. Either way there is no CPU cost
		// visible here — which is not the same as a machine with room to spare. Read from this
		// collection rather than from the window: whether there is anything to measure is a fact
		// about now, where the window's totals are cumulative and would keep their last value.
		const streams = this._videoStreams();

		if (streams.onCpu === 0) {
			this.inputsUnavailable = true;
			this.clientMonitor.cpuUtilization = undefined;

			return this._standDown(0 < streams.hardwareEncoders + streams.hardwareDecoders
				? 'all video is encoded and decoded off the cpu'
				: 'no video is being encoded or decoded');
		}

		const {
			detection: detectionWindow,
			recovery: recoveryWindow,
		} = this.clientMonitor.slicedWindow.slices;

		// Not enough values yet is not a verdict either way, and it is not blindness: the window is
		// filling and will have an answer shortly. The span is checked alongside the count because
		// a window counts values, not time — collections carrying no time between them fill it
		// while measuring nothing, which is a frozen collector rather than a busy machine.
		if (!detectionWindow.isReady || detectionWindow.durationInMs < 1) return;

		const detection = this._utilization(detectionWindow);

		// Streams are running on the CPU but the window could not produce a reading from them, so
		// the detector can no longer support the claim it made. An unsupportable claim must not
		// stand for the rest of the call: a detector able to raise is always able to clear.
		if (detection === undefined) {
			this.inputsUnavailable = true;
			this.clientMonitor.cpuUtilization = undefined;

			return this._standDown('codec time is no longer measurable');
		}

		this.inputsUnavailable = false;

		// Written before the threshold test, so the measurement is there below the bar as well as
		// above it — a machine at 0.7 of its budget is not the same as one nobody measured.
		this.clientMonitor.cpuUtilization = detection.min;

		if (this.config.utilizationThreshold <= detection.min) {
			if (this.clientMonitor.cpuPerformanceAlertOn) return;

			return this._raise({
				encoderUtilization: detection.encoder ?? 0,
				decoderUtilization: detection.decoder,
				minUtilization: detection.min,
				sustainedForInMs: detectionWindow.durationInMs,
				hardwareAcceleratedEncoders: streams.hardwareEncoders,
				hardwareAcceleratedDecoders: streams.hardwareDecoders,
			});
		}

		if (!this.clientMonitor.cpuPerformanceAlertOn) return;

		// Below the bar with a finding open. The machine has to have been quiet for the stretch
		// behind this one as well, which is what keeps a finding standing long enough to be worth
		// reporting rather than clearing on the collection after it was raised. A recovery slice
		// that has not filled yet is not a verdict — the window is filling and will have an answer
		// shortly — so the finding waits rather than being cleared on the detection stretch alone.
		if (!recoveryWindow.isReady) return;

		// Ready but unreadable is the other case, and it must not be able to hold a finding open
		// for ever: a detector that can raise has to be able to clear, so with nothing behind it
		// to consult the detection reading decides on its own.
		const clearing = this._utilization(recoveryWindow) ?? detection;

		if (this.config.recoveryThreshold <= clearing.min) return;

		this._standDown('cpu limitation ended', detection.min);
	}

	/**
	 * Codec time over the stretch the slice spans, for each direction, and the lower of the two.
	 *
	 * The denominator is the slice's own wall clock rather than a sum of per-stream intervals, so
	 * the summed-across-streams scale survives: three simulcast layers each busy half the stretch
	 * read `1.5`, where dividing by their combined interval would have averaged them back to `0.5`.
	 * Nothing clamps it at `1`.
	 *
	 * `undefined` when neither direction produced a delta — the window says it could not see, which
	 * is what keeps a receive-only client from reading as an idle encoder and a hardware pipeline
	 * from reading as an idle machine. A direction that is `null` on its own simply does not
	 * participate in the `min`.
	 */
	private _utilization(
		slice: WindowSlice<ClientWindowValues>,
	): { encoder?: number, decoder?: number, min: number } | undefined {
		if (slice.durationInMs < 1) return undefined;

		const perUnitTime = (delta: number | null) => delta === null
			? undefined
			: delta / slice.durationInMs;

		const encoder = perUnitTime(slice.deltaTotalVideoEncodeTimeInMs);
		const decoder = perUnitTime(slice.deltaTotalVideoDecodeTimeInMs);

		if (encoder === undefined && decoder === undefined) return undefined;

		// The lower of the two, and whichever one exists when the client only sends or only
		// receives: codec work on one side alone is a busy stream, on both at once a busy machine.
		const min = encoder === undefined
			? decoder as number
			: decoder === undefined
				? encoder
				: Math.min(encoder, decoder);

		return { encoder, decoder, min };
	}

	/**
	 * What the video pipeline looks like on this collection: how many streams have codec work
	 * landing on the CPU, and how many were left out because it lands somewhere else.
	 *
	 * A description of the pipeline right now, not a measurement over a stretch — which is what
	 * makes it the right thing to decide blindness on. A stream counts as on-CPU as soon as it is
	 * present and software, whether or not it reported codec time this collection.
	 */
	private _videoStreams() {
		let onCpu = 0;
		let hardwareEncoders = 0;
		let hardwareDecoders = 0;

		for (const outboundRtp of this.clientMonitor.outboundRtps) {
			if (outboundRtp.kind !== 'video') continue;

			if (runsOffCpu(outboundRtp.encoderImplementation, outboundRtp.powerEfficientEncoder)) ++hardwareEncoders;
			else ++onCpu;
		}
		for (const inboundRtp of this.clientMonitor.inboundRtps) {
			if (inboundRtp.kind !== 'video') continue;

			if (runsOffCpu(inboundRtp.decoderImplementation, inboundRtp.powerEfficientDecoder)) ++hardwareDecoders;
			else ++onCpu;
		}

		return { onCpu, hardwareEncoders, hardwareDecoders };
	}

	private _raise(payload: CpuPerformanceIssuePayload) {
		this._startedAlertAt = Date.now();
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.clientMonitor.cpuPerformanceAlertOn = true;

		this.clientMonitor.emit('cpulimitation', {
			clientMonitor: this.clientMonitor,
		});

		this.clientMonitor.activeIssues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: CpuPerformanceDetector.ISSUE_TYPE,
			payload,
		});
	}

	/**
	 * Closes any open alert. Guarded, because this is a healthy machine's resting state.
	 *
	 * `recoveredMinUtilization` is the reading that cleared the finding, carried into the resolve
	 * payload beside the one that raised it — so whoever reads the pair can see the improvement
	 * rather than only that something stopped.
	 */
	private _standDown(comment: string, recoveredMinUtilization?: number) {
		if (!this.clientMonitor.cpuPerformanceAlertOn) return;

		this.clientMonitor.cpuPerformanceAlertOn = false;

		this.clientMonitor.activeIssues.resolve({
			key: this.issueKey,
			comment,
			payload: {
				recoveredMinUtilization,
				durationInMs: this._startedAlertAt ? Date.now() - this._startedAlertAt : undefined,
			},
			resolvedAt: Date.now(),
		});

		this._startedAlertAt = undefined;
	}
}
