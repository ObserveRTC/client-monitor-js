/* eslint-disable @typescript-eslint/no-explicit-any */
import {
	DEFAULT_LOOPBACK_AUDIO_INPUT_LABEL_PATTERNS,
	LoopbackAudioInputDetector,
} from "../../src/detectors/LoopbackAudioInputDetector";
import { Detectors } from "../../src/detectors/Detectors";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

function setup(label: string, options: { kind?: string, labelPatterns?: string[] } = {}) {
	const trackMonitor = new MockOutboundTrackMonitor(options.kind ?? 'audio');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;
	const registry = new Detectors();

	trackMonitor.track.label = label;
	trackMonitor.track.setSettings({ deviceId: 'dev-1', echoCancellation: true });
	(trackMonitor as any).detectors = registry;
	clientMonitor.config.loopbackAudioInputDetector = {
		labelPatterns: options.labelPatterns ?? [ ...DEFAULT_LOOPBACK_AUDIO_INPUT_LABEL_PATTERNS ],
	};
	(clientMonitor as any).logger = { warn: jest.fn() };

	const detector = new LoopbackAudioInputDetector(trackMonitor as any);

	registry.add(detector);

	return {
		detector,
		registry,
		trackMonitor,
		clientMonitor,
		/** One collection, driven through the track's registry as the real monitor drives it. */
		tick() { registry.update(); },
		registered() { return registry.has(detector.name); },
		verdict() { return (trackMonitor as any).loopbackAudioInput; },
		openIssue() { return clientMonitor.issueOfType('loopback-audio-input'); },
	};
}

describe('LoopbackAudioInputDetector', () => {
	describe('the labels it flags by default', () => {
		it.each([
			// The captured call: Firefox on Linux, PulseAudio monitor of the laptop's output.
			'Monitor of Built-in Audio Analog Stereo',
			'Monitor of Family 17h/19h HD Audio Controller Speaker + Headphones',
			'Stereo Mix (Realtek(R) Audio)',
			'What U Hear (Sound Blaster Z)',
			'Wave Out Mix (IDT High Definition Audio CODEC)',
		])('%s', (label) => {
			const h = setup(label);

			h.tick();

			expect(h.verdict()).toBe(true);
			expect(h.openIssue()?.payload).toMatchObject({
				trackId: h.trackMonitor.track.id,
				deviceLabel: label,
				deviceId: 'dev-1',
				echoCancellation: true,
			});
		});
	});

	describe('the labels it leaves alone', () => {
		it.each([
			'Built-in Audio Analog Stereo',
			'MacBook Pro Microphone (Built-in)',
			'Default - Microphone Array (Realtek(R) Audio)',
			'Shure MV7',
			// Virtual cables are routinely used to carry a processed microphone; opt-in only.
			'BlackHole 2ch (Virtual)',
			'CABLE Output (VB-Audio Virtual Cable)',
			// "Monitor of" only counts as a prefix, not anywhere in the name.
			'Studio Monitor of Doom USB Mic',
		])('%s', (label) => {
			const h = setup(label);

			h.tick();

			expect(h.verdict()).toBe(false);
			expect(h.openIssue()).toBeUndefined();
		});
	});

	/**
	 * A track's label never changes, so the first verdict is the last: the detector takes itself
	 * out of the registry and costs nothing on every later collection.
	 */
	describe('judging each track once', () => {
		it.each([
			[ 'a loopback device', 'Monitor of Built-in Audio Analog Stereo', true ],
			[ 'a microphone', 'Shure MV7', false ],
		])('removes itself after judging %s', (_, label, verdict) => {
			const h = setup(label);
			const update = jest.spyOn(h.detector, 'update');

			h.tick();
			h.tick();
			h.tick();

			expect(update).toHaveBeenCalledTimes(1);
			expect(h.registered()).toBe(false);
			expect(h.verdict()).toBe(verdict);
			expect(h.clientMonitor.raisedIssues.filter((i) => i.type === 'loopback-audio-input')).toHaveLength(verdict ? 1 : 0);
		});

		it('keeps the finding open after it is gone, muted or not: the device did not change', () => {
			const h = setup('Monitor of Built-in Audio Analog Stereo');

			h.tick();
			h.trackMonitor.track.muted = true;
			h.trackMonitor.paused = true;
			h.tick();

			expect(h.verdict()).toBe(true);
			expect(h.clientMonitor.activeIssues.size).toBe(1);
		});

		it('leaves resolution to the track teardown, which resolves everything the track raised', () => {
			const h = setup('Monitor of Built-in Audio Analog Stereo');

			h.tick();
			h.trackMonitor.issues.resolveAll('the track stopped being reported');

			expect(h.clientMonitor.activeIssues.size).toBe(0);
		});

		it('looks again on the next collection while the browser has not revealed the label', () => {
			const h = setup('');

			h.tick();

			expect(h.verdict()).toBeUndefined();
			expect(h.registered()).toBe(true);

			h.trackMonitor.track.label = 'Monitor of Built-in Audio Analog Stereo';
			h.tick();

			expect(h.verdict()).toBe(true);
			expect(h.registered()).toBe(false);
		});
	});

	describe('the tracks it does not judge, and stops looking at', () => {
		it('screen-share audio, where capturing the output is the point', () => {
			const h = setup('Monitor of Built-in Audio Analog Stereo');

			h.trackMonitor.isScreenShare = true;
			h.tick();

			expect(h.verdict()).toBeUndefined();
			expect(h.openIssue()).toBeUndefined();
			expect(h.registered()).toBe(false);
		});

		it('a track already ended at the first look', () => {
			const h = setup('Monitor of Built-in Audio Analog Stereo');

			h.trackMonitor.track.readyState = 'ended';
			h.tick();

			expect(h.verdict()).toBeUndefined();
			expect(h.registered()).toBe(false);
		});

		it('video tracks', () => {
			const h = setup('Monitor of Built-in Audio Analog Stereo', { kind: 'video' });

			h.tick();

			expect(h.verdict()).toBeUndefined();
			expect(h.openIssue()).toBeUndefined();
			expect(h.registered()).toBe(false);
		});
	});

	it('uses configured patterns, and skips an invalid one with a warning', () => {
		const h = setup('BlackHole 2ch', { labelPatterns: [ '(', '^BlackHole\\b' ] });

		h.tick();

		expect(h.openIssue()?.payload).toMatchObject({ matchedPattern: '^BlackHole\\b' });
		expect((h.clientMonitor as any).logger.warn).toHaveBeenCalledTimes(1);
	});

	it('blanks the verdict when disabled', () => {
		const h = setup('Monitor of Built-in Audio Analog Stereo');

		h.detector.disabled = true;
		h.detector.update();

		expect(h.verdict()).toBeUndefined();
		expect(h.registered()).toBe(true);
	});
});
