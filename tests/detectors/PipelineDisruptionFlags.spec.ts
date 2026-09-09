import * as fs from 'fs';
import * as path from 'path';

const DETECTOR_DIR = path.join(__dirname, '../../src/detectors');

/**
 * Every detector in the Pipeline Disruption category and the flag it owns. A detector added to
 * that category without an entry here fails the first test below, which is the point: the flag is
 * part of the category's contract, not an optional extra, and the cost of forgetting one is an
 * application that silently reads `undefined` forever and calls it healthy.
 */
const FLAGS: Record<string, string> = {
	CaptureSourceLostDetector: 'lostCaptureSource',
	DecoderBottleneckDetector: 'degradedFrameSupply',
	DecoderPerformanceDetector: 'overloadedDecoder',
	DryInboundTrackDetector: 'dry',
	DryOutboundTrackDetector: 'dry',
	EncoderBottleneckDetector: 'degradedEncodingPerformance',
	FrameAssemblyStalledDetector: 'stalledFrameAssembly',
	PlayoutDiscrepancyDetector: 'playoutDiscrepancy',
	RtpSenderStalledDetector: 'stalledRtpSender',
	SilentAudioSourceDetector: 'silentAudioSource',
	VideoCaptureBottleneckDetector: 'degradedVideoCapture',
	StuckDecoderDetector: 'stuckedDecoder',
	TransportDemuxStalledDetector: 'stalledTransportDemux',
	VideoRecoveryFailedDetector: 'failedVideoRecovery',
};

/**
 * In the category, deliberately outside the contract. `CpuPerformanceDetector` predates it with a
 * plain `boolean` on `ClientMonitor`, `cpuPerformanceAlertOn`, which is public API; giving it the
 * tri-state would rename a field and start returning `undefined` to code that never expects it.
 * Listed rather than filtered out silently, so the exemption is a decision and not a gap.
 */
const EXEMPT = [ 'CpuPerformanceDetector' ];

const read = (name: string) => fs.readFileSync(path.join(DETECTOR_DIR, `${name}.ts`), 'utf8');

const classDoc = (source: string) => {
	const match = /(\/\*\*(?:[^*]|\*(?!\/))*\*\/)\s*export class/.exec(source);

	return match?.[1] ?? '';
};

const pipelineDisruptionDetectors = () => fs.readdirSync(DETECTOR_DIR)
	.filter((file) => file.endsWith('.ts') && file !== 'Detector.ts' && file !== 'Detectors.ts')
	.map((file) => file.replace(/\.ts$/, ''))
	.filter((name) => classDoc(read(name)).includes('Category: Pipeline Disruption'))
	.filter((name) => !EXEMPT.includes(name));

/**
 * A source-level contract test rather than a behavioural one. Each detector's own spec covers what
 * its flag does tick by tick; this covers the thing no single spec can — that the category as a
 * whole stays consistent as detectors are added, renamed or recategorised.
 */
describe('the pipeline disruption flag contract', () => {
	it('has exactly one flag registered per detector in the category', () => {
		expect(pipelineDisruptionDetectors().sort()).toEqual(Object.keys(FLAGS).sort());
	});

	// If this starts failing, the exemption was resolved and the note above should go with it.
	it('still has cpuPerformanceAlertOn as the one exemption', () => {
		expect(EXEMPT).toEqual([ 'CpuPerformanceDetector' ]);
		expect(read('CpuPerformanceDetector')).toContain('cpuPerformanceAlertOn');
	});

	describe.each(Object.entries(FLAGS))('%s', (detector, flag) => {
		const source = read(detector);

		/**
		 * The path most easily forgotten: a detector switched off mid-call would otherwise leave
		 * whatever verdict it last wrote standing forever, and a stale `true` is worse than no
		 * answer — nothing would ever clear it.
		 */
		it('blanks the flag on the disabled path', () => {
			expect(source).toMatch(
				new RegExp(String.raw`if \(this\.disabled\) \{\s*\n\s*this\.\w+\.${flag} = undefined;`),
			);
		});

		/**
		 * Three indirections are legitimate and each is spelled out here rather than waved through
		 * by a loose pattern: a `verdict` parameter, where several exit paths share one clear
		 * helper; a ternary, where a connection-level flag folds together several streams; and a
		 * stand-down helper's `options.<flag>`, where the option is declared `<flag>?: false` so
		 * the type pins the assignment to `false` or `undefined` and nothing else. Anything else
		 * assigning the flag has to say `true`, `false` or `undefined` outright.
		 */
		it('can reach all three states', () => {
			const assignments = [ ...source.matchAll(new RegExp(String.raw`\.${flag}\s*=\s*([^;]+);`, 'g')) ]
				.map((match) => match[1].trim());

			const optionsField = `options.${flag}`;
			const viaHelper = assignments.includes('verdict');
			const viaTernary = assignments.some((value) => value.includes('?') && value.includes(':'));
			// The `?: false` declaration is what makes this readable at a glance: an option that
			// could hold `true` would let a stand-down raise a finding, so the type forbids it.
			const viaOptions = assignments.includes(optionsField) &&
				new RegExp(String.raw`${flag}\?\s*:\s*false`).test(source);
			const reaches = (value: string) =>
				assignments.includes(value) ||
				viaHelper ||
				(viaOptions && value !== 'true') ||
				assignments.some((a) => a.includes('?') && new RegExp(String.raw`\b${value}\b`).test(a));

			expect(assignments.length).toBeGreaterThan(0);
			expect(reaches('true')).toBe(true);
			expect(reaches('false')).toBe(true);
			expect(reaches('undefined')).toBe(true);

			// One of the three indirections is fine; a flag assigned only from some other variable
			// is not, because nothing then pins which of the three states it can actually produce.
			for (const value of assignments) {
				const known = [ 'true', 'false', 'undefined', 'verdict' ].includes(value);

				expect(
					known ||
					(viaTernary && value.includes('?')) ||
					(viaOptions && value === optionsField),
				).toBe(true);
			}
		});

		it('names the flag in its class docstring, so the attribute is discoverable', () => {
			expect(classDoc(source)).toContain(`.${flag}\``);
		});
	});
});
