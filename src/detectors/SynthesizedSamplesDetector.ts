import { MediaPlayoutMonitor } from "../monitors/MediaPlayoutMonitor";
import { Detector } from "./Detector";


export class SynthesizedSamplesDetector implements Detector {
    public readonly name = 'synthesized-samples-detector';
    
    public constructor(
        public readonly mediaPlayout: MediaPlayoutMonitor,
    ) {
    }

    private get peerConnection() {
        return this.mediaPlayout.getPeerConnection();
    }

    private get config() {
        return this.peerConnection.parent.config.syntheticSamplesDetector;
    }

    public update() {
        if (this.config.disabled) return;
        if (this.mediaPlayout.deltaSynthesizedSamplesDuration <= this.config.minSynthesizedSamplesDuration) {
            return;
        }


        const clientMonitor = this.peerConnection.parent;

        clientMonitor.emit('synthesized-audio', {
            mediaPlayoutMonitor: this.mediaPlayout,
            clientMonitor: clientMonitor,
        });

        if (this.config.createIssue) {
            clientMonitor.addIssue({
                type: 'synthesized-audio',
                payload: {
                    // trackId: this.mediaPlayout.
                    deltaSynthesizedSamplesDuration: this.mediaPlayout.deltaSynthesizedSamplesDuration,
                }
            });
        }
    }
}