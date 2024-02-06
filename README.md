## Javascript library to monitor WebRTC applications

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

-   [Quick Start](#quick-start)
-   [Integrations](#integrations)
    -   [Mediasoup](#mediasoup)
-   [Detectors and Alerts](#detectors-and-alerts)
    -   [Audio Desync Detector](#audio-desync-detector)
    -   [CPU Performance Detector](#cpu-performance-detector)
-   [Calculated updates](#calculated-updates)
-   [Configurations](#configurations)
-   [NPM package](#npm-package)
-   [API docs](#api-docs)
-   [Schemas](#schemas)
-   [Getting Involved](#getting-involved)
-   [License](#license)

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

monitor.on("stats-collected", () => {
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

1.  create a client monitor, which collect stats every 5s
2.  setup a stats collector from a peer connection
3.  register an event called after stats are collected
4.  print out the inbound rtps and then close the stats collector we registered in step 3.

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

monitor.on("stats-collected", () => {
    // do your stuff

    // you can close detach mediasoup
    // collector by calling the close
    mediasoupStatsCollector.close();
});
```

**Important Note**: The created collector is hooked on the device 'newtransport' event,
and can detect transports automatically when they are created after the device is added.
If you create transports before you add the device to the monitor,  
transports you created before will not be monitored automatically, you need to add them
to the statscollector, like this:

```javascript
const myTransport = mediasoupStatsCollector.addTransport(myTransport); // your transport created before the device is added to the monitor
```

## Calculated Updates

The Calculated Updates lets you observer metrics derived from the polled webrtc stats captured by the library. These calculated updates provide a richer, more nuanced understanding of your application's client-side behavior, offering valuable insights beyond what raw stats metrics can give you.

### Storage Updates

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on('stats-collected', () => {
    console.log('average RTT in seconds', storage.avgRttInS);
    console.log('Sending audio bitrate', storage.sendingAudioBitrate);
    console.log('Sending video bitrate', storage.sendingVideoBitrate);
    console.log('Receiving audio bitrate', storage.receivingAudioBitrate);
    console.log('Receiving video bitrate', storage.receivingVideoBitrate);

```

### PeerConnection Updates

```javascript
import { createClientMonitor } from "client-monitor-js";

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on("stats-collected", () => {
    for (const peerConnection of storage.peerConnections()) {
        console.log("average RTT in seconds", peerConnection.avgRttInS);
        console.log("Sending audio bitrate on PC", peerConnection.sendingAudioBitrate);
        console.log("Sending video bitrate on PC", peerConnection.sendingVideoBitrate);
        console.log("Receiving audio bitrate on PC", peerConnection.receivingAudioBitrate);
        console.log("Receiving video bitrate on PC", peerConnection.receivingVideoBitrate);
    }
});
```

### Inbound RTP stats updates

```javascript
import { createClientMonitor } from "client-monitor-js";

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on("stats-collected", () => {
    for (const inboundRtp of storage.inboundRtps()) {
        console.log("mean opinion score for inbound-rtp", inboundRtp.score);

        console.log("receiving bitrate", inboundRtp.receivingBitrate);
        console.log("lost packets since last stats-collected", inboundRtp.lostPackets);
        console.log("received packets since last stats-collected", inboundRtp.receivedPackets);
        console.log("decoded frames since last stats-collected", inboundRtp.decodedFrames);
    }
});
```

### Outbound RTP stats updates

```javascript
import { createClientMonitor } from "client-monitor-js";

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

const storage = monitor.storage;
monitor.on("stats-collected", () => {
    for (const outboundRtp of storage.outboundRtps()) {
        console.log("stability score outbound-rtp", outboundRtp.score);

        console.log("sending bitrate", outboundRtp.sendingBitrate);
        console.log("sent packets since last stats-collected", outboundRtp.sentPackets);

        const remoteInboundRtp = outboundRtp.getRemoteInboundRtp();
        console.log(
            "Received packets on remote inbound-rtp belongs to this outbound-rtp",
            remoteInboundRtp?.receivedPackets
        );
    }
});
```

## Detectors and Alerts

Detectors and alerts provide events of tracking and responding to anomalies or performance issues based on the polled stats. Detectors are components that continuously monitor for specific conditions in the polled stats, and set an alert if certain thresholds are hit. You can subscribe to alerts of an instantiated client-monitor-js and configure detectors via initial configurations.

List of built-in alerts:

-   `audio-desync-alert`: triggered when for an audio track several acceleration and deceleration is detected in a short amount of time indicating that the controlling system tries compensate discrepancies.
-   `cpu-performance-alert`: triggered whenever a browser detects quality limitation becasue of CPU, or the number of decoded frames per sec hit a certain threshold

### Audio Desync Detector

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.detectors.addAudioDesyncDetector({
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
});

monitor.on('audio-desync-alert', (alertState) => {
    if (alertState === 'on') {
        console.log('Audio is desynced from video');
    } else if (alertState === 'off') {
        console.log('Audio is synced back');
    }
});
```

### CPU Performance Detector

```javascript
monitor.detectors.addCpuPerformanceDetector({
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
})


monitor.on('cpu-performance-alert', alertState => {
    if (alertState === 'on') {
        console.log('CPU performance problem is detected');
    } else if (alertState === 'off') {
        console.log('CPU performance problem is gone');
    }
})
```

## Configurations

```javascript
const config = {
    /**
     * By setting it, the monitor calls the added statsCollectors periodically
     * and pulls the stats.
     *
     * DEFAULT: 5000
     */
    collectingPeriodInMs: 5000,

    /**
     * By setting this, the observer makes samples after n number or collected stats.
     *
     * For example if the value is 10, the observer makes a sample after 10 collected stats (in every 10 collectingPeriodInMs).
     *
     * DEFAULT: 1
     */
    samplingTick: 1,
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
