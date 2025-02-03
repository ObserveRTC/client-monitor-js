import { MediaPlayoutMonitor } from "../monitors/MediaPlayoutMonitor";
import { Detector } from "./Detector";


export class SynthesizedSamplesDetector implements Detector {
    public readonly name = 'synthesized-samples-detector';
    
    public constructor(
        public readonly mediaPlayout: MediaPlayoutMonitor,
    ) {
    }

    private _evented = false;

    private get peerConnection() {
        return this.mediaPlayout.getPeerConnection();
    }

    private get config() {
        return this.peerConnection.parent.config.syntheticSamplesDetector;
    }

    public update() {
        if (this.config.disabled) return;
        if (this.mediaPlayout.deltaSynthesizedSamplesDuration <= this.config.minSynthesizedSamplesDuration) {
            return this._evented = false;
        }


        const clientMonitor = this.peerConnection.parent;

        clientMonitor.emit('synthesized-samples', {
            mediaPlayoutMonitor: this.mediaPlayout,
            clientMonitor: clientMonitor,
        });

        this._evented = true;
    }
}