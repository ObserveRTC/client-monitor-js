import { MediaPlayoutMonitor } from "../monitors/MediaPlayoutMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

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
 * Config: `syntheticSamplesDetector`.
 */
export class SynthesizedSamplesDetector implements Detector {
    public readonly name = 'synthesized-samples-detector';
    public disabled = false;

    public constructor(
        public readonly mediaPlayout: MediaPlayoutMonitor,
    ) {
    }

    private get peerConnection() {
        return this.mediaPlayout.getPeerConnection();
    }

    private get config() {
        return this.peerConnection.parent.config.syntheticSamplesDetector!;
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