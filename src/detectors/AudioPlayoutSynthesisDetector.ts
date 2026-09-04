import { MediaPlayoutMonitor } from "../monitors/MediaPlayoutMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

export type AudioPlayoutSynthesisDetectorConfig = {
    /**
     * Flag to indicate if the synthesized samples detector should create an
     * event and add it to the monitor.
     *
     * DEFAULT: true
     */
    createEvent?: boolean

    /**
     * The minimum duration (in milliseconds) for synthesized samples to be
     * considered significant and trigger an alert.
     */
    minSynthesizedSamplesDuration: number;
}

/**
 * Watches audio playout for synthesized samples — the concealment audio the browser
 * generates when the jitter buffer has nothing real left to play. It is audio
 * degradation as the listener actually experiences it: robotic, warbling or stretched
 * speech, the audible consequence of loss, jitter or a stream arriving too late.
 *
 * The signal is worth watching precisely because nothing upstream reports it as a
 * failure. Concealment is the audio stack succeeding at its job of keeping playback
 * continuous, so packet-level statistics can look unremarkable while the listener
 * hears something wrong; the synthesized duration is the only counter that measures
 * what was substituted for the audio that never arrived.
 *
 * **It is not `InventedSpeechDetector`, and the difference is scope.** This one binds
 * to a `MediaPlayoutMonitor` and reads `RTCAudioPlayoutStats.synthesizedSamplesDuration`
 * — the audio playout object, which is one output device mixing every inbound stream
 * feeding it. `InventedSpeechDetector` binds to a single `inbound-rtp` and reads that
 * one stream's concealment counters, net of the silent concealment nobody can hear.
 * So this detector answers "how much of what came out of the speaker was fabricated",
 * across the whole call, and the other answers "is this particular talker's audio being
 * invented badly enough to matter". They co-fire when one bad stream dominates the mix,
 * and diverge when several streams each conceal a little. Until 4.10.0 this class was
 * called `SynthesizedSamplesDetector`, which read as a synonym for the other and
 * invited exactly the merge that would lose the distinction.
 *
 * This detector raises no issue and keeps no episode state — no start, no end, no
 * duration. Each tick is judged entirely on its own: if
 * `deltaSynthesizedSamplesDuration` exceeds `minSynthesizedSamplesDuration` it
 * reports, otherwise it stays quiet. With the shipped default of `0` that means it
 * reports on every tick that synthesized anything at all, so a consumer that wants
 * only materially degraded audio should raise the threshold or aggregate downstream.
 *
 * Raises no issue.
 * Monitor event: `synthesized-audio`; client event `EXCESSIVE_SYNTHESIZED_AUDIO`
 * when `createEvent` is left on.
 * Config: `audioPlayoutSynthesisDetector`.
 *
 * Category: Perceived Quality
 * Layer: Audio — naturalness
 *
 */
export class AudioPlayoutSynthesisDetector implements Detector {
    public readonly name = 'audio-playout-synthesis-detector';
    public disabled = false;

    public constructor(
        public readonly mediaPlayout: MediaPlayoutMonitor,
    ) {
    }

    private get peerConnection() {
        return this.mediaPlayout.getPeerConnection();
    }

    private get config() {
        return this.peerConnection.parent.config.audioPlayoutSynthesisDetector!;
    }

    public update() {
        if (this.disabled) return;
        if (this.mediaPlayout.deltaSynthesizedSamplesDuration <= this.config.minSynthesizedSamplesDuration) {
            return;
        }
        const clientMonitor = this.peerConnection.parent;

        clientMonitor.emit('synthesized-audio', {
            mediaPlayoutMonitor: this.mediaPlayout,
            clientMonitor: clientMonitor,
        });

        if (this.config.createEvent === false) return;

        clientMonitor.addEvent({
            type: ClientEventTypes.EXCESSIVE_SYNTHESIZED_AUDIO,
            payload: {
                deltaSynthesizedSamplesDuration: this.mediaPlayout.deltaSynthesizedSamplesDuration,
            }
        });
    }
}