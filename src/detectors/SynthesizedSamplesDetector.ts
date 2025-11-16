import { MediaPlayoutMonitor } from "../monitors/MediaPlayoutMonitor";
import { Detector } from "./Detector";

/**
 * Synthesized Samples Detector
 * 
 * Detects when audio playout contains synthesized (artificially generated) samples.
 * Synthesized samples are typically inserted by the audio subsystem when there's
 * insufficient audio data due to network issues, jitter, or packet loss, helping
 * maintain continuous audio playback.
 * 
 * **Detection Logic:**
 * - Monitors `deltaSynthesizedSamplesDuration` from media playout statistics
 * - Triggers when synthesized sample duration exceeds configured minimum threshold
 * - Indicates potential audio quality degradation due to missing audio data
 * 
 * **Configuration Options:**
 * - `disabled`: Boolean to enable/disable the detector
 * - `createIssue`: Whether to create ClientIssue when synthesized samples are detected
 * - `minSynthesizedSamplesDuration`: Minimum duration threshold to trigger detection
 * 
 * **Events Emitted:**
 * - `synthesized-audio`: Emitted when synthesized samples exceed threshold
 * 
 * **Issues Created:**
 * - Type: `synthesized-audio`
 * - Payload: `{ deltaSynthesizedSamplesDuration }`
 * 
 * @example
 * ```typescript
 * // Configuration
 * const config = {
 *   syntheticSamplesDetector: {
 *     disabled: false,
 *     createIssue: true,
 *     minSynthesizedSamplesDuration: 100 // milliseconds
 *   }
 * };
 * 
 * // Listen for synthesized audio events
 * monitor.on('synthesized-audio', ({ mediaPlayoutMonitor, deltaSynthesizedSamplesDuration }) => {
 *   console.log('Synthesized audio detected:', deltaSynthesizedSamplesDuration, 'ms');
 * });
 * ```
 */
export class SynthesizedSamplesDetector implements Detector {
    /** Unique identifier for this detector type */
    public readonly name = 'synthesized-samples-detector';
    
    /**
     * Creates a new SynthesizedSamplesDetector instance
     * @param mediaPlayout - The media playout monitor to analyze for synthesized samples
     */
    public constructor(
        public readonly mediaPlayout: MediaPlayoutMonitor,
    ) {
    }

    /** Gets the peer connection monitor that owns this media playout */
    private get peerConnection() {
        return this.mediaPlayout.getPeerConnection();
    }

    /** Gets the detector configuration from the client monitor */
    private get config() {
        return this.peerConnection.parent.config.syntheticSamplesDetector;
    }

    /**
     * Updates the detector state and checks for synthesized audio samples
     * 
     * This method monitors the duration of synthesized samples in the audio playout
     * and triggers detection when the duration exceeds the configured threshold.
     * 
     * **Processing Steps:**
     * 1. Skip if detector is disabled
     * 2. Check if synthesized samples duration exceeds minimum threshold
     * 3. Emit event and create issue when threshold is exceeded
     * 4. Provides insight into audio quality degradation
     */
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
            }, false);
        }
    }
}