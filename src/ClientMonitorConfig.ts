
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
