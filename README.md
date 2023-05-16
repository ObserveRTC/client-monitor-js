Javascript library to monitor WebRTC applications
---

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

 * [Quick Start](#quick-start)
 * [Integrations](#integrations)
    - [Mediasoup](#mediasoup)
 * [Configurations](#configurations)
 * [NPM package](#npm-package)
 * [API docs](#api-docs)
 * [Schemas](#schemas)
 * [Getting Involved](#getting-involved)
 * [License](#license)

## Qucik Start

Install it from [npm](https://www.npmjs.com/package/@observertc/client-monitor-js) package repository.

```
npm i @observertc/client-monitor-js
```

Add `@observertc/client-monitor-js` to your WebRTC app.

```javascript
import { createClientMonitor } from "@observertc/client-monitor-js";
// see full config in Configuration section
const config = {
    collectingPeriodInMs: 5000,
};
const monitor = createClientMonitor(config);
const statsCollector = monitor.collectors.collectFromRTCPeerConnection(peerConnection);

monitor.on('stats-collected', () => {
    const storage = monitor.storage;
    for (const inboundRtp of storage.inboundRtps()) {
        const trackId = inboundRtp.getTrackId();
        const remoteOutboundRtp = inboundRtp.getRemoteOutboundRtp();
        console.log(trackId, inboundRtp.stats, remoteOutboundRtp.stats);
    }
    statsCollector.close();
})
```

The above example do as follows:
 1. create a client monitor, which collect stats every 5s
 2. setup a stats collector from a peer connection
 3. register an event called after stats are collected
 4. print out the inbound rtps and then close the stats collector we registered in step 3.


## Integrations

### Mediasoup

```javascript
import { createClientMonitor } from "@observertc/client-monitor-js";
import mediasoup from "mediaousp-client";

const mediasoupDevice = new mediasoup.Device();
const config = {
    collectingPeriodInMs: 5000,
};
const monitor = createClientMonitor(config);
const mediasoupStatsCollector = monitor.collectors.collectFromMediasoupDevice(mediasoupDevice);

monitor.events.onStatsCollected(() => {
    // do your stuff

    // you can close detach mediasoup 
    // collector by calling the close
    mediasoupStatsCollector.close();
})
```

**Important Note**: The created collector is hooked on the device 'newtransport' event, 
and can detect transports automatically when they are created after the device is added.
If you create transports before you add the device to the monitor,  
transports you created before will not be monitored automatically, you need to add them 
to the statscollector, like this:

```javascript
const myTransport = // your transport created before the device is added to the monitor
mediasoupStatsCollector.addTransport(myTransport)
```

## Detectors

The Detectors module for client-monitor-js provides a collection of detector functions that can be used to monitor and detect various issues and events in a real-time communication system. 

### Audio Desynchronization Detector

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.on('audio-desync-detected', ({ trackIds }) => {
    console.warn(`Audio Desync detected on tracks`, trackIds);
});
```

The example demonstrates how to use the Audio Desynchronization Detector in the client-monitor-js library. It creates a ClientMonitor instance with the default configuration and listens for the audio-desync-detected event. When the event is triggered, a warning message is logged, indicating the tracks that are experiencing audio desynchronization.

To customize the configuration of the Audio Desynchronization Detector, refer to the [Configuratio](#configuration) section for further instructions.


## CPU Issue Detector

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.on('cpu-issue-detected', ({ inboundTrackIds, outboundTrackIds }) => {
    console.warn('CPU issue detected:');
    console.warn('Inbound Track IDs:', inboundTrackIds);
    console.warn('Outbound Track IDs:', outboundTrackIds);
});

```

The above example demonstrates how to use the CPU Issue Detector in the client-monitor-js library. It creates a ClientMonitor instance with the default configuration and listens for the cpu-issue event. When the event is triggered, a warning message is logged, displaying the inbound and outbound track IDs that are experiencing CPU-related issues.

You can adjust the [Configuratio](#configuration)  of the CPU Issue 

## Congestion Detector

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.on('congestion-detected', ({ trackIds }) => {
    console.warn('Congestion detected on tracks:', trackIds);
});

```

The example above demonstrates the usage of the Congestion Detector in the client-monitor-js library. It creates a ClientMonitor instance with the default configuration and listens for the congestion-detected event. When congestion is detected on any tracks, a warning message is logged, indicating the track IDs affected by congestion.

To configure the Congestion Detector according to your specific requirements, please refer to the [Configuratio](#configuration)  section for further guidance.

## Configurations

```javascript
const config = {
    /**
     * By setting it, the monitor calls the added statsCollectors periodically
     * and pulls the stats.
     * 
     * DEFAULT: undefined
     */
    collectingPeriodInMs: 5000,
    /**
     * By setting it, the monitor make samples periodically.
     * 
     * DEFAULT: undefined
     */
    samplingPeriodInMs: 10000,

    /**
     * By setting it, the monitor sends the samples periodically.
     * 
     * DEFAULT: undefined
     */
    sendingPeriodInMs: 10000,

    /**
     * By enabling this option, the monitor automatically generates events
     * when a peer connection added to the collector undergoes a change in connection state or when a track on it is added or removed.
     *
     * If this option is set to true, the samples created by the monitor will include the generated events. However, if
     * no sample is created, events will accumulate indefinitely within the monitor. It is recommended to set this option to true
     * if you want to create a sample with events.
     *
     * DEFAULT: false
     */
    createCallEvents: false,

    /**
     * Collector Component related configurations
     * 
     * DEFAULT: configured by the monitor
     */
    collectors: {
        /**
         * Sets the adapter adapt different browser type and version 
         * provided stats.
         * 
         * DEFAULT: configured by the monitor
         */
        adapter: {
            /**
             * the type of the browser, e.g.: chrome, firefox, safari
             * 
             * DEFAULT: configured by the collector
             */
            browserType: "chrome",
            /**
             * the version of the browser, e.g.: 97.xx.xxxxx
             * 
             * DEFAULT: configured by the collector
             */
            browserVersion: "97.1111.111",
        },
    },

    /**
     * Configuration for the samples accumulator to balance the transfer the size of the Samples 
     * prepared to be sent to the server
     * 
     */
    accumulator: {
        /**
         * Sets the maximum number of client sample allowed to be in one Sample
         * 
         * DEFAULT: 100
         */
        maxClientSamples: 100,

        /**
         * Sets the maximum number of Samples the accumulator can hold
         * 
         * DEFAULT: 10
         */
        maxSamples: 10,

        /**
         * Forward a Sample to the server even if it is empty
         * 
         * DEFAULT: false
         */
        forwardIfEmpty: false
    }

     /**
     * Configuration for the CpuIssueDetector function.
     * 
     * Default configuration below
     */
    cpuIssueDetector: {
        /**
         * Specifies whether the dropped frames detector is enabled or not.
         */
        enabled: true,
        /**
         * The fractional threshold used to determine if the incoming frames
         * dropped fraction is considered significant or not.
         * It represents the maximum allowed ratio of dropped frames to received frames.
         * For example, a value of 0.1 means that if the dropped frames fraction
         * exceeds 0.1, it will be considered a significant issue.
         */
        incomingFramesDroppedFractionalThreshold: 0.1,
    },
    /**
     * Configuration for the AudioDesyncDetector function.
     * 
     * Default configuration below
     */
    audioDesyncDetector: {
        /**
         * Specifies whether the audio desynchronization detector is enabled or not.
         */
        enabled: true,
        /**
         * The fractional threshold used to determine if the audio desynchronization
         * correction is considered significant or not.
         * It represents the minimum required ratio of corrected samples to total samples.
         * For example, a value of 0.1 means that if the corrected samples ratio
         * exceeds 0.1, it will be considered a significant audio desynchronization issue.
         */
        fractionalCorrectionThreshold: 0.1,
    },
    /**
     * Configuration for the CongestionDetector function.
     * 
     * Default configuration below
     */
    congestionDetector: {
        /**
         * Specifies whether the congestion detector is enabled or not.
         */
        enabled: true,
        /**
         * The minimum deviation threshold for Round-Trip Time (RTT) in milliseconds.
         * A higher value indicates a higher threshold for detecting congestion based on RTT deviation.
         */
        minRTTDeviationThresholdInMs: 50,

        /**
         * The minimum duration threshold in milliseconds.
         * If congestion is detected, this is the minimum duration before a reevaluation takes place.
         */
        minDurationThresholdInMs: 2000,

        /**
         * The deviation fold threshold. 
         * This value is used as a multiplier with the standard deviation to compare against the deviation in RTT.
         */
        deviationFoldThreshold: 3.0,

        /**
         * The fraction loss threshold for packet loss.
         * If the fraction of packets lost is greater than this threshold, it is considered as congestion.
         */
        fractionLossThreshold: 0.2,

        /**
         * The window for measuring the RTT in milliseconds.
         */
        measurementsWindowInMs: 30000,

        /**
         * The minimum length of measurements in milliseconds. 
         * This determines the minimum duration for which measurements should be taken before considering them for congestion detection.
         */
        minMeasurementsLengthInMs: 10000;
    },
};
```

## NPM package

https://www.npmjs.com/package/@observertc/client-monitor-js

## API docs

https://observertc.org/docs/api/client-monitor-js-v2/

## Schemas

https://github.com/observertc/schemas


## Getting Involved

Client-monitor is made with the intention to provide an open-source monitoring solution for 
WebRTC developers. If you are interested in getting involved 
please read our [contribution](CONTRIBUTING.md) guideline.

## License

Apache-2.0
