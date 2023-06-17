Javascript library to monitor WebRTC applications
---

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

 * [Quick Start](#quick-start)
 * [Integrations](#integrations)
    - [Mediasoup](#mediasoup)
 * [Alerts and Detectors](#alerts)
 * [Calculated updates](#calculated-updates)
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
});
// if you want to stop collecting from the peerConnection, then:
statsCollector.close();
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

## Calculated Updates

The Calculated Updates lets you observer metrics derived from the polled webrtc stats  captured by the library. These calculated updates provide a richer, more nuanced understanding of your application's client-side behavior, offering valuable insights beyond what raw stats metrics can give you.

### Storage Updates

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on('stats-collected', () => {
    const updates = storage.updates;
    console.log('average RTT in seconds', updates.avgRttInS);
    console.log('Sending audio bitrate', updates.sendingAudioBitrate);
    console.log('Sending video bitrate', updates.sendingVideoBitrate);
    console.log('Receiving audio bitrate', updates.receivingAudioBitrate);
    console.log('Receiving video bitrate', updates.receivingVideoBitrate);

```

### PeerConnection Updates

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on('stats-collected', () => {
    for (const peerConnection of storage.peerConnections()) {
        const updates = peerConnection.updates;
        console.log('average RTT in seconds', updates.avgRttInS);
        console.log('Sending audio bitrate on PC', updates.sendingAudioBitrate);
        console.log('Sending video bitrate on PC', updates.sendingVideoBitrate);
        console.log('Receiving audio bitrate on PC', updates.receivingAudioBitrate);
        console.log('Receiving video bitrate on PC', updates.receivingVideoBitrate);
    }
});

```

### Inbound RTP stats updates

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on('stats-collected', () => {
    for (const inboundRtp of storage.inboundRtps()) {

        console.log('mean opinion score for inbound-rtp', inboundRtp.meanOpinionScore);

        const updates = inboundRtp.updates;
        console.log('receiving bitrate', updates.receivingBitrate);
        console.log('lost packets since last stats-collected', updates.lostPackets);
        console.log('received packets since last stats-collected', updates.receivedPackets);
        console.log('decoded frames since last stats-collected', updates.decodedFrames);

        console.log('full list of calculations changed since last stats-collected ', updates);
    }
});

```

### Outbound RTP stats updates

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on('stats-collected', () => {
    for (const outboundRtp of storage.outboundRtps()) {

        console.log('stability score outbound-rtp', outboundRtp.stabilityScore);

        const updates = outboundRtp.updates;
        console.log('sending bitrate', updates.sendingBitrate);
        console.log('sent packets since last stats-collected', updates.sentPackets);
        
        const remoteInboundRtp = outboundRtp.getRemoteInboundRtp();
        console.log('Received packets on remote inbound-rtp belongs to this outbound-rtp', remoteInboundRtp?.updates.receivedPackets);
    }
});

```



## Alerts and Detectors

Alerts and detectors provide events of tracking and responding to anomalies or performance issues based on the polled stats. Detectors are components that continuously monitor for specific conditions in the polled stats, and set an alert if certain thresholds are hit. You can subscribe to alerts of an instantiated client-monitor-js and configure detectors via initial configurations.


To configure the Congestion Detector according to your specific requirements, please refer to the [Configuration](#configuration)  section for further guidance.


List of built-in alerts:
 * `stability-score-alert`: triggered whenever an outbound network is considered to be instable based on the calculated stability score
 * `mean-opinion-score-alert`: triggered when a calculated MoS score for an inbound-rtp is lower than the configured threshold
 * `audio-desync-alert`: triggered when for an audio track several acceleration and deceleration is detected in a short amount of time indicating that the controlling system tries compensate discrepancies. 
 * `cpu-performance-alert`: triggered whenever a browser detects quality limitation becasue of CPU, or the number of decoded frames per sec hit a certain threshold

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.on('alerts-changed', (alerts) => {

    const stabilityAlert = alerts['stability-score-alert'];
    if (stabilityAlert === 'on') {
        console.log('Network condition for sending media is instable');
    } else if (stabilityAlert === 'off') {
        console.log('Network condition for sending media is considered to be stable again');
    }

    const meanOpionionScoreAlert = alerts['mean-opinion-score-alert'];
    if (meanOpionionScoreAlert === 'on') {
        console.log('Mean opinion score for received media is considered to be low');
    } else if (meanOpionionScoreAlert === 'off') {
        console.log('Mean opinion score for received media is normalized');
    }

    const audioDesyncAlert = alerts['audio-desync-alert'];
    if (audioDesyncAlert === 'on') {
        console.log('Audio is desynced from video');
    } else if (meanOpionionScoreAlert === 'off') {
        console.log('Audio is synced back');
    }
});
```


### Outbound Stability Detector

Outbound Stability Detector is based on a score calculated for each outbound tracks 
giving a normalized value between `0.0..1.0` indicate how reliable the network 
for transmitting media. The score consideres RTT fluctuations, and packet losses in it's calculation

### Mean Opinion Score Detector

For each inbound-rtp a MoS is calculated, which is a value between `0.0..5.0` indicate the quality of the rendered media.


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
     * Configuration for the CpuIssueDetector function.
     * 
     * Default configuration below
     */
    cpuIssueDetector: {
        /**
         * Specifies whether the CPU issue detector is enabled or not.
         */
        enabled: true;
        /**
         * The fractional threshold used to determine if the incoming frames
         * dropped fraction is considered significant or not.
         * It represents the maximum allowed ratio of dropped frames to received frames.
         * For example, a value of 0.1 means that if the dropped frames fraction
         * exceeds 0.1, it will be considered a significant issue.
         */
        droppedIncomingFramesFractionAlertOn: 0.5;
        /**
         * The fractional threshold used to determine if the incoming frames
         * dropped fraction is considered negligible and the alert should be turned off.
         * It represents the maximum allowed ratio of dropped frames to received frames.
         * For example, a value of 0.05 means that if the dropped frames fraction
         * falls below 0.05, the CPU issue alert will be turned off.
         */
        droppedIncomingFramesFractionAlertOff: 0.8;
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
        enabled: true;
        /**
         * The fractional threshold used to determine if the audio desynchronization
         * correction is considered significant or not.
         * It represents the minimum required ratio of corrected samples to total samples.
         * For example, a value of 0.1 means that if the corrected samples ratio
         * exceeds 0.1, it will be considered a significant audio desynchronization issue.
         */
        fractionalCorrectionAlertOnThreshold: 0.1;
        /**
         * The fractional threshold used to determine if the audio desynchronization
         * correction is considered negligible and the alert should be turned off.
         * It represents the maximum allowed ratio of corrected samples to total samples.
         * For example, a value of 0.05 means that if the corrected samples ratio
         * falls below 0.05, the audio desynchronization alert will be turned off.
         */
        fractionalCorrectionAlertOffThreshold: 0.2;
    },
    lowStabilityScoreDetector: {
        /**
         * Boolean indicating whether the detector is enabled or not
         */
        enabled: true;
        /**
         * The threshold at which an alert is turned on
         */
        alertOnThreshold: 0.8;
        /**
         * The threshold at which an alert is turned off
         */
        alertOffThreshold: 0.9;
    },
    lowMosDetector: {
        /**
         * Specifies whether the Low Mean Opinion Score detector is enabled or not.
         */
        enabled: true;
        /**
         * The threshold value for triggering a Low Mean Opinion Score alert.
         * If the mean opinion score (MOS) falls below this value, an alert will be triggered.
         */
        alertOnThreshold: 3.0;
        /**
         * The threshold value for turning off the Low Mean Opinion Score alert.
         * If the mean opinion score (MOS) rises above this value, the alert will be turned off.
         */
        alertOffThreshold: 4.0;
    }
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
