/* eslint-disable @typescript-eslint/no-explicit-any */
import { SilentAudioSourceDetector } from "../../src/detectors/SilentAudioSourceDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	silenceThresholdInMs: 30000,
	silenceRmsThreshold: 0.001,
};

function setup(kind = 'audio') {
	const trackMonitor = new MockOutboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.silentAudioSourceDetector = { ...CONFIG };

	const detector = new SilentAudioSourceDetector(trackMonitor as any);

	return {
		detector,
		trackMonitor,
		clientMonitor,
		/**
		 * One collection. `rmsAudioLevel` and `deltaSamplesDuration` are what `MediaSourceMonitor`
		 * derives from a pair of reports — pass them as the browser would leave them, including
		 * `undefined` for a field it did not report. Samples default to keeping up with the clock.
		 */
		tick(source: {
			rmsAudioLevel?: number,
			deltaSamplesDuration?: number,
			deltaTime?: number,
		}) {
			const deltaTime = source.deltaTime ?? 10000;
			const deltaSamplesDuration = 'deltaSamplesDuration' in source
				? source.deltaSamplesDuration
				: deltaTime / 1000;

			trackMonitor.setMediaSource({ ...source, deltaTime, deltaSamplesDuration });
			detector.update();
		},
		/** The verdict the track carries for applications to poll. */
		verdict() { return (trackMonitor as any).silentAudioSource; },
		openIssue() { return clientMonitor.issueOfType('silent-audio-source'); },
	};
}

describe('SilentAudioSourceDetector', () => {
	describe('the finding', () => {
		it('raises only after the silence has lasted the threshold', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0 });
			h.tick({ rmsAudioLevel: 0 });
			expect(h.openIssue()).toBeUndefined();

			h.tick({ rmsAudioLevel: 0 });

			expect(h.openIssue()?.payload.silentForInMs).toBe(30000);
		});

		it('measures the silence in stats time, not in ticks', () => {
			// One collection that covered a minute of stats time is a minute of silence, however
			// few times update() happened to run.
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 60000 });

			expect(h.openIssue()?.payload.silentForInMs).toBe(60000);
		});

		it('resolves as soon as audio appears', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			expect(h.clientMonitor.activeIssues.size).toBe(1);

			h.tick({ rmsAudioLevel: 0.05, deltaTime: 1000 });

			expect(h.clientMonitor.activeIssues.size).toBe(0);
		});

		it('restarts the clock after audio comes back, so a later silence is judged on its own', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 20000 });
			h.tick({ rmsAudioLevel: 0.05, deltaTime: 1000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 20000 });

			// 40s of silence in total, but only 20s since the last sound.
			expect(h.openIssue()).toBeUndefined();
		});

		it('can raise again after a resolution', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			h.tick({ rmsAudioLevel: 0.05, deltaTime: 1000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });

			expect(h.clientMonitor.activeIssues.size).toBe(1);
			expect(h.verdict()).toBe(true);
		});
	});

	/**
	 * The half no application could see before: `silentAudioSource` is what a call UI polls, and
	 * it has to agree with the issue registry on every tick, not only on the tick that raised.
	 */
	describe('the verdict', () => {
		it('stays true for as long as the finding is open', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			expect(h.verdict()).toBe(true);

			h.tick({ rmsAudioLevel: 0, deltaTime: 5000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 5000 });

			expect(h.verdict()).toBe(true);
			expect(h.clientMonitor.activeIssues.size).toBe(1);
		});

		it('is false while the source is quiet but not yet for long enough', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 5000 });

			// Judged, and found not to be a fault — which is not the same as unjudged.
			expect(h.verdict()).toBe(false);
			expect(h.openIssue()).toBeUndefined();
		});

		it('is false once audio is heard again', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			h.tick({ rmsAudioLevel: 0.05, deltaTime: 1000 });

			expect(h.verdict()).toBe(false);
		});

		it('is undefined on a video track, which it cannot judge', () => {
			const h = setup('video');

			h.tick({ rmsAudioLevel: 0, deltaTime: 60000 });

			expect(h.verdict()).toBeUndefined();
			expect(h.openIssue()).toBeUndefined();
		});

		it('is blanked when the detector is switched off mid-call', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			expect(h.verdict()).toBe(true);

			h.detector.disabled = true;
			h.tick({ rmsAudioLevel: 0, deltaTime: 5000 });

			expect(h.verdict()).toBeUndefined();
		});

		it('never reads undefined while a finding is open', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });

			// The measurement goes away mid-finding: the detector may stop claiming a fault, but it
			// must not leave the registry saying "faulty" while the verdict says "unjudged".
			h.tick({ deltaSamplesDuration: undefined, deltaTime: 5000 });

			expect(h.verdict()).toBeUndefined();
			expect(h.clientMonitor.activeIssues.size).toBe(0);
		});
	});

	/**
	 * Three silences the stats can tell apart, and the detector records which one it saw rather
	 * than reporting all of them as the same fault.
	 */
	describe('what kind of silence it was', () => {
		it('calls exact zeros digital silence', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });

			expect(h.openIssue()?.payload.silenceKind).toBe('digital-silence');
		});

		it('calls a real but inaudible signal below-threshold', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0.0001, deltaTime: 31000 });

			expect(h.openIssue()?.payload.silenceKind).toBe('below-threshold');
			expect(h.openIssue()?.payload.rmsAudioLevel).toBe(0.0001);
		});

		it('calls a frozen sample clock no-samples, and treats it as a fault', () => {
			const h = setup();

			// A live, unmuted track that handed over no audio at all has a stalled capture
			// pipeline. That is a stronger finding than silence, not a reason to stand down.
			h.tick({ deltaSamplesDuration: 0, deltaTime: 31000 });

			expect(h.openIssue()?.payload.silenceKind).toBe('no-samples');
			expect(h.verdict()).toBe(true);
		});

		it('treats the noise floor of a working microphone as audio', () => {
			const h = setup();

			// A quiet room through a live microphone still sits several times over the threshold.
			h.tick({ rmsAudioLevel: CONFIG.silenceRmsThreshold * 3, deltaTime: 60000 });

			expect(h.openIssue()).toBeUndefined();
			expect(h.verdict()).toBe(false);
		});

		it('counts a level exactly at the threshold as silent', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: CONFIG.silenceRmsThreshold, deltaTime: 31000 });

			expect(h.openIssue()).toBeDefined();
		});
	});

	describe('the payload', () => {
		it('keeps the measured stretch current while the finding stays open', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			expect(h.openIssue()?.payload.silentForInMs).toBe(31000);

			h.tick({ rmsAudioLevel: 0, deltaTime: 10000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 10000 });

			// Not frozen at whatever the raise happened to measure.
			expect(h.openIssue()?.payload.silentForInMs).toBe(51000);
		});

		it('carries how much audio was actually delivered over that stretch', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });

			// The source kept up: 31s of stats time, 31s of samples.
			expect(h.openIssue()?.payload.capturedForInMs).toBe(31000);
		});

		it('shows a stalled pipeline as a gap between the two durations', () => {
			const h = setup();

			h.tick({ deltaSamplesDuration: 0, deltaTime: 31000 });

			const payload = h.openIssue()?.payload as Record<string, number>;

			// 31s of silence carrying no audio at all is a different fault from 31s of quiet room.
			expect(payload.silentForInMs).toBe(31000);
			expect(payload.capturedForInMs).toBe(0);
		});

		it('identifies the track and the device it was capturing from', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });

			const payload = h.openIssue()?.payload as Record<string, unknown>;

			expect(payload.peerConnectionId).toBe('pc-1');
			expect(payload.trackId).toBe(h.trackMonitor.track.id);
			expect(payload.deviceLabel).toBeDefined();
		});

		it('carries the whole episode into the resolution', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 20000 });
			h.tick({ rmsAudioLevel: 0.05, deltaTime: 1000 });

			const resolved = h.clientMonitor.resolvedIssues.at(-1) as any;

			// The registry merges, so the updates made while it was open are what the resolution
			// reports — the full 51s, not the 31s the raise saw.
			expect(resolved.comment).toBe('audio detected');
			expect(resolved.payload.silentForInMs).toBe(51000);
			expect(resolved.payload.silenceKind).toBe('digital-silence');
		});
	});

	describe('standing down', () => {
		// A muted microphone is silent on purpose; that is a mute, not a failure.
		it('does not report a muted track as silent', () => {
			const h = setup();

			h.trackMonitor.track.muted = true;
			h.tick({ rmsAudioLevel: 0, deltaTime: 60000 });

			expect(h.openIssue()).toBeUndefined();
			expect(h.verdict()).toBeUndefined();
		});

		it('does not report a paused sender as silent', () => {
			const h = setup();

			h.trackMonitor.paused = true;
			h.tick({ rmsAudioLevel: 0, deltaTime: 60000 });

			expect(h.openIssue()).toBeUndefined();
			expect(h.verdict()).toBeUndefined();
		});

		it('makes no judgement when the browser reports no sample clock', () => {
			const h = setup();

			h.tick({ deltaSamplesDuration: undefined, deltaTime: 60000 });

			expect(h.openIssue()).toBeUndefined();
			expect(h.verdict()).toBeUndefined();
		});

		it('makes no judgement when samples arrive with no energy alongside them', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: undefined, deltaTime: 60000 });

			expect(h.openIssue()).toBeUndefined();
			expect(h.verdict()).toBeUndefined();
		});

		it('resolves an open finding when the sender is paused, saying why', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			h.trackMonitor.paused = true;
			h.tick({ rmsAudioLevel: 0, deltaTime: 5000 });

			expect(h.clientMonitor.activeIssues.size).toBe(0);
			expect((h.clientMonitor.resolvedIssues.at(-1) as any).comment).toBe('sender paused');
		});

		it('restarts the clock after a stand-down', () => {
			const h = setup();

			h.tick({ rmsAudioLevel: 0, deltaTime: 20000 });
			h.trackMonitor.track.muted = true;
			h.tick({ rmsAudioLevel: 0, deltaTime: 20000 });
			h.trackMonitor.track.muted = false;
			h.tick({ rmsAudioLevel: 0, deltaTime: 20000 });

			// The stretch before the mute is not evidence about the stretch after it.
			expect(h.openIssue()).toBeUndefined();
		});
	});

	describe('the event', () => {
		it('fires once, when the finding opens', () => {
			const h = setup();
			const fired: unknown[] = [];

			h.clientMonitor.on('silent-audio-source', (event: unknown) => fired.push(event));

			h.tick({ rmsAudioLevel: 0, deltaTime: 31000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 10000 });
			h.tick({ rmsAudioLevel: 0, deltaTime: 10000 });

			expect(fired).toHaveLength(1);
		});
	});
});
