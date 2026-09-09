import { ClientMonitor } from "..";
import { Detector } from "./Detector";

/**
 * Markers of an implementation that does its work off the CPU, matched case-insensitively as
 * substrings of `encoderImplementation` / `decoderImplementation`.
 *
 * `accelerator` is the broad one and carries most of the weight: every hardware path Chromium
 * exposes is named for the accelerator behind it — `MediaFoundationVideoEncodeAccelerator`,
 * `VaapiVideoDecodeAccelerator`, `V4L2VideoEncodeAccelerator`, and so on. The rest catch vendor
 * and platform names that do not follow that convention, plus Chromium's older generic
 * `ExternalEncoder` / `ExternalDecoder`.
 *
 * These strings are free-form and vendor-specific, so this list is a blocklist rather than proof:
 * an unrecognised hardware implementation still counts as CPU work. `powerEfficient*` is checked
 * alongside it to cover what the names miss.
 */
const OFF_CPU_IMPLEMENTATION_MARKERS = [
	'accelerator',
	'external',
	'hardware',
	'mediacodec',
	'mediafoundation',
	'videotoolbox',
	'vaapi',
	'nvenc',
	'nvdec',
	'quicksync',
	'omx',
];

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

	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type CpuPerformanceDetectorConfig = {
	/**
	 * The utilization `minUtilization` has to reach before this reports anything. Read it as a
	 * usage level: `0.15` means both halves of the pipeline are spending at least 15% of the
	 * interval inside a codec.
	 */
	utilizationThreshold: number;
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
 * streams, where `0.25` is a quarter of the interval spent inside a codec. Summed rather than
 * averaged, so three simulcast layers busy half the time each read `1.5`; nothing clamps it at `1`.
 * `encoderUtilization` and `decoderUtilization` combine with `min()` into `minUtilization`, so codec
 * work on one side alone is a busy stream and work on both at once is a busy machine. A client
 * missing one direction is judged on the other.
 *
 * It is not CPU time: `totalEncodeTime` is elapsed time inside the codec call, so a hardware codec
 * waiting on the GPU would count in full. Streams naming an off-CPU implementation, or flagged
 * `powerEfficient`, are left out of the sums — a wholly hardware pipeline yields no clue and sets
 * `inputsUnavailable` rather than reading as healthy. A backgrounded tab is not judged at all,
 * since throttled timers stretch the interval and read as an idle machine.
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

		const encoder = this._utilization(
			this.clientMonitor.outboundRtps,
			(rtp) => rtp.deltaEncodeTime,
			(rtp) => rtp.encoderImplementation,
			(rtp) => rtp.powerEfficientEncoder,
		);
		const decoder = this._utilization(
			this.clientMonitor.inboundRtps,
			(rtp) => rtp.deltaTotalDecodeTime,
			(rtp) => rtp.decoderImplementation,
			(rtp) => rtp.powerEfficientDecoder,
		);

		// No video at all, or none of it running on the CPU. Either way there is no CPU cost
		// visible here — which is not the same as a machine with room to spare.
		if (encoder.utilization === undefined && decoder.utilization === undefined) {
			this.inputsUnavailable = true;
			this.clientMonitor.cpuUtilization = undefined;

			return this._standDown(encoder.hardwareAccelerated + decoder.hardwareAccelerated > 0
				? 'all video is encoded and decoded off the cpu'
				: 'no video is being encoded or decoded');
		}

		this.inputsUnavailable = false;

		// The lower of the two, and whichever one exists when the client only sends or only receives.
		const minUtilization = encoder.utilization === undefined
			? decoder.utilization as number
			: decoder.utilization === undefined
				? encoder.utilization
				: Math.min(encoder.utilization, decoder.utilization);

		// Written before the threshold test, so the measurement is there below the bar as well as
		// above it — a machine at 0.7 of its budget is not the same as one nobody measured.
		this.clientMonitor.cpuUtilization = minUtilization;

		if (minUtilization < this.config.utilizationThreshold) {
			return this._standDown('cpu limitation ended');
		}

		if (this.clientMonitor.cpuPerformanceAlertOn) return;

		this._raise({
			encoderUtilization: encoder.utilization ?? 0,
			decoderUtilization: decoder.utilization,
			minUtilization,
			hardwareAcceleratedEncoders: encoder.hardwareAccelerated,
			hardwareAcceleratedDecoders: decoder.hardwareAccelerated,
		});
	}

	/**
	 * Codec time over elapsed time, summed over the video streams that ran on the CPU and reported
	 * both. The sum is across streams on purpose: three simulcast layers each at a fifth of wall
	 * time cost the machine the same as one stream at three fifths, so this is unbounded above
	 * rather than capped at `1`.
	 *
	 * This is also why there is no separate per-frame encode budget check: encode time per frame
	 * over `1000/fps` cancels the frame count and leaves exactly this ratio. Across 4797 captured
	 * collections the two agreed to machine precision once the frame rate came from the
	 * `framesEncoded` counter; the only daylight was smoothing in `framesPerSecond`, off by more
	 * than 20% on 0.4% of them. Reading the counters directly skips that field.
	 *
	 * `utilization` is `undefined` when no stream contributed, which is what keeps a receive-only
	 * client from reading as an idle encoder, and a hardware pipeline from reading as an idle
	 * machine. `hardwareAccelerated` counts what was skipped for that second reason, so the two
	 * cases stay tellable apart.
	 */
	private _utilization<T extends { kind: string, deltaTime?: number }>(
		rtps: T[],
		codecTimeInSec: (rtp: T) => number | undefined,
		implementation: (rtp: T) => string | undefined,
		powerEfficient: (rtp: T) => boolean | undefined,
	): { utilization?: number, hardwareAccelerated: number } {
		let utilization: number | undefined;
		let hardwareAccelerated = 0;

		for (const rtp of rtps) {
			if (rtp.kind !== 'video') continue;

			const codecTime = codecTimeInSec(rtp);
			const elapsedInMs = rtp.deltaTime;

			if (codecTime === undefined || elapsedInMs === undefined || elapsedInMs <= 0) continue;

			// Counted before the skip, so a hardware stream that reported real work is
			// distinguishable from one that reported nothing.
			if (this._runsOffCpu(implementation(rtp), powerEfficient(rtp))) {
				++hardwareAccelerated;

				continue;
			}

			utilization = (utilization ?? 0) + (codecTime * 1000) / elapsedInMs;
		}

		return { utilization, hardwareAccelerated };
	}

	/**
	 * Whether this stream's codec work lands somewhere other than the CPU, and so says nothing
	 * about CPU performance. Two independent tests, either of which is enough: the implementation
	 * name, and the browser's own power-efficiency hint.
	 *
	 * A stream that reports neither is treated as CPU work. That is the deliberate direction to
	 * fail in — an unknown implementation keeps contributing evidence, where the opposite default
	 * would silence the detector on every browser whose naming we have not catalogued.
	 */
	private _runsOffCpu(implementation?: string, powerEfficient?: boolean): boolean {
		if (powerEfficient === true) return true;
		if (implementation === undefined) return false;

		const name = implementation.toLowerCase();

		return OFF_CPU_IMPLEMENTATION_MARKERS.some((marker) => name.includes(marker));
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

	/** Closes any open alert. Guarded, because this is a healthy machine's resting state. */
	private _standDown(comment: string) {
		if (!this.clientMonitor.cpuPerformanceAlertOn) return;

		this.clientMonitor.cpuPerformanceAlertOn = false;
		this._resolve(comment);
	}

	private _resolve(comment?: string) {
		const issue = this.clientMonitor.activeIssues.get(this.issueKey);
		let payload: CpuPerformanceIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as CpuPerformanceIssuePayload),
				durationInMs: this._startedAlertAt ? Date.now() - this._startedAlertAt : undefined,
			};
		}

		this.clientMonitor.activeIssues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAlertAt = undefined;
	}
}
