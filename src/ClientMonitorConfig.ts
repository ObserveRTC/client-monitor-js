
export type ClientMonitorConfig = {
    /**
     * By setting this, the observer calls the added statsCollectors periodically
     * and pulls the stats.
     *
     * DEFAULT: 2000
     */
    collectingPeriodInMs: number;

    
    samplingPeriodInMs?: number;

    /**
     * If true, the monitor integrate the navigator.mediaDevices (patch the getUserMedia and subscribe to ondevicechange event)
     *
     * DEFAULT: false
     */
    integrateNavigatorMediaDevices?: boolean | MediaDevices;

    /**
     * If true the monitor generate the CLIENT_JOINED event when the monitor created.
     *
     * DEFAULT: false
     */
    addClientJointEventOnCreated: boolean;

    /**
     * If true the monitor generate the CLIENT_LEFT event when the monitor closed.
     *
     * DEFAULT: false
     */
    addClientLeftEventOnClose: boolean;


    videoFreezesDetector: {
        disabled?: boolean,
    }

    stuckedInboundTrackDetector: {
        disabled?: boolean,
        thresholdInMs: number,
    }

    audioDesyncDetector: {
        disabled?: boolean,
        /**
         * The fractional threshold used to determine if the audio desynchronization
         * correction is considered significant or not.
         * It represents the minimum required ratio of corrected samples to total samples.
         * For example, a value of 0.1 means that if the corrected samples ratio
         * exceeds 0.1, it will be considered a significant audio desynchronization issue.
         */
        fractionalCorrectionAlertOnThreshold: number;
        /**
         * The fractional threshold used to determine if the audio desynchronization
         * correction is considered negligible and the alert should be turned off.
         * It represents the maximum allowed ratio of corrected samples to total samples.
         * For example, a value of 0.05 means that if the corrected samples ratio
         * falls below 0.05, the audio desynchronization alert will be turned off.
         */
        fractionalCorrectionAlertOffThreshold: number;
    }

    congestionDetector: {
        disabled?: boolean,
        sensitivity: 'low' | 'medium' | 'high',
    }

    cpuPerformanceDetector: {
        disabled?: boolean,
        fpsVolatilityThresholds: {
            lowWatermark: number,
            highWatermark: number,
        },
        durationOfCollectingStatsThreshold: {
            lowWatermark: number,
            highWatermark: number,
        }
    }

    longPcConnectionEstablishmentDetector: {
        disabled?: boolean,
        thresholdInMs: number,
    }

};
