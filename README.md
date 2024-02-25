## Javascript library to monitor WebRTC applications

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

-   [Quick Start](#quick-start)
-   [Integrations](#integrations)
    -   [Mediasoup](#mediasoup)
-   [Calculated updates](#calculated-updates)
-   [Detectors and Alerts](#detectors-and-alerts)
    -   [Audio Desync Detector](#audio-desync-detector)
    -   [CPU Performance Detector](#cpu-performance-detector)
-   [Configurations](#configurations)
-   [Events](#events)
-   [Sampling](#sampling)
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
or
```
yarn add @observertc/client-monitor-js
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
    for (const inboundRtp of monitor.inboundRtps) {
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

**Important Note**: The created collector is hooked to the device's 'newtransport' event and can automatically detect transports created **after** the device has been added. If you create transports before adding the device to the monitor, those previously created transports will not be monitored automatically. You will need to manually add them to the stats collector like this:

```javascript
const myTransport = mediasoupStatsCollector.addTransport(myTransport); // your transport created before the device is added to the monitor
```

## Calculated Updates

Calculated updates allow you to observe metrics derived from polled WebRTC stats captured by the library. These calculated updates provide a richer, more nuanced understanding of your application's client-side behavior, offering valuable insights beyond what raw stats metrics can provide.

### Storage Updates

```javascript
import { createClientMonitor } from 'client-monitor-js';

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.on('stats-collected', () => {
    const storage = monitor.storage;
    console.log('average RTT in seconds', storage.avgRttInS);
    console.log('Sending audio bitrate', storage.sendingAudioBitrate);
    console.log('Sending video bitrate', storage.sendingVideoBitrate);
    console.log('Receiving audio bitrate', storage.receivingAudioBitrate);
    console.log('Receiving video bitrate', storage.receivingVideoBitrate);
});
```

### PeerConnection Updates

```javascript
import { createClientMonitor } from "client-monitor-js";

// Create a ClientMonitor instance
const monitor = createClientMonitor({
    collectingPeriodInMs: 2000,
});

monitor.on("stats-collected", () => {
    for (const peerConnection of monitor.peerConnections) {
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

monitor.on("stats-collected", () => {
    for (const inboundRtp of monitor.inboundRtps) {
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

monitor.on("stats-collected", () => {
    for (const outboundRtp of monitor.outboundRtps) {
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
     * if the value is less or equal than 0
     *
     * DEFAULT: 1
     */
    samplingTick: 1,
};
```

## Events

In the context of our monitoring library, events play a crucial role in enabling real-time insights and interactions. These events are emitted by the monitor to signal various occurrences, such as the creation of a peer connection, media track, or ICE connections. Below, we detail the events detected by the monitor.
 * `CLIENT_JOINED`: A client has joined
 * `CLIENT_LEFT`: A client has left
 * `PEER_CONNECTION_OPENED`: A peer connection is opened
 * `PEER_CONNECTION_CLOSED`: A peer connection is closed
 * `MEDIA_TRACK_ADDED`: A media track is added
 * `MEDIA_TRACK_REMOVED`: A media track is removed
 * `MEDIA_TRACK_MUTED`: A media track is muted
 * `MEDIA_TRACK_UNMUTED`: A media track is unmuted
 * `ICE_GATHERING_STATE_CHANGED`: The ICE gathering state has changed
 * `PEER_CONNECTION_STATE_CHANGED`: The peer connection state has changed
 * `ICE_CONNECTION_STATE_CHANGED`: The ICE connection state has changed
 * `DATA_CHANNEL_OPEN`: A data channel is opened
 * `DATA_CHANNEL_CLOSED`: A data channel is closed
 * `DATA_CHANNEL_ERROR`: A data channel error occurred

For Mediasoup integration the following events are detected:
 * `PRODUCER_ADDED`: A producer is added
 * `PRODUCER_REMOVED`: A producer is removed
 * `PRODUCER_PAUSED`: A producer is paused
 * `PRODUCER_RESUMED`: A producer is resumed
 * `CONSUMER_ADDED`: A consumer is added
 * `CONSUMER_REMOVED`: A consumer is removed
 * `CONSUMER_PAUSED`: A consumer is paused
 * `CONSUMER_RESUMED`: A consumer is resumed
 * `DATA_PRODUCER_ADDED`: A data producer is added
 * `DATA_PRODUCER_REMOVED`: A data producer is removed
 * `DATA_CONSUMER_ADDED`: A data consumer is added
 * `DATA_CONSUMER_REMOVED`: A data consumer is removed

### CLIENT_JOINED Event

A client event is automatically generated when the first sample is created, and 
the joined timestamp is set to the time of the monitor creation. However, you can
manually set the event by calling the `monitor.join()` method. 

**Important Note**: The `monitor.join()` method is called only once, and in case of manual setup it should be called before the first sample is created.

```javascript
monitor.join({
    timestamp: Date.now(),
});
```

### CLIENT_LEFT Event

A client event is automatically generated when the monitor is closed, and the left timestamp is set to the time of the monitor closing. However, you can manually set the event by calling the `monitor.leave()` method.

**Important Note**: The `monitor.leave()` method is called only once, and in case of manual setup it should be called before the monitor is closed.

```javascript
monitor.leave({
    timestamp: Date.now(),
});
```


### Custom Call Event

You can create a custom event by calling the `monitor.addCustomCallEvent()` method. The method takes an object with the following properties:

```javascript
monitor.addCustomCallEvent({
    name: 'MY CUSTOM EVENT', // mandatory

    message: 'my custom message', // optional;
    attachments: JSON.stringify({
        value: 'my custom value',
    }), // optional
	timestamp: Date.now(), // optional
	value: `simple string value`, // optional
	peerConnectionId: 'peer-connection-id', // optional;
	mediaTrackId: 'media-track-id', // optional;
	
});
```

### Extension State Event

You can create an extension state event by calling the `monitor.addExtensionStateEvent()` method. The method takes an object with the following properties:

```javascript
monitor.addExtensionStateEvent({
    type: 'CLIENT_CPU_STATS',
    payload: {
        cpuUsage: 0.5,
        memoryUsage: 0.3,
    }
});
```

As a rule of thumb for when to use `addCustomCallEvent` and `addExtensionStateEvent`:
- Use `addCustomCallEvent` for events that are related to the call itself, such as user clicked a button.
- Use `addExtensionStateEvent` for events that are related to the periodic stats collection, such as CPU usage, memory usage, etc.


## Sampling

The monitor generates samples by invoking the `monitor.sample()` method. The monitor will automatically call the `sample()` method unless `samplingTick` is set to a value less than or equal to 0. The ClientMonitor creates a `ClientSample`, a compound object that contains all observed stats and created events. The ClientSample object is emitted, and an event listener can listen to it by subscribing to the `sample-created` event:

```javascript
monitor.on('sample-created', ({
    clientSample,
    elapsedSinceLastSampleInMs,
}) => {
    console.log('The created client sample is:', clientSample);
    console.log('Elapsed time in milliseconds since the last sample was created:', elapsedSinceLastSampleInMs);
})
```

The ClientSample can be forwarded to a backend service, where the samples can be further processed (e.g., saved into a database or used for anomaly detection). To facilitate this, we have developed the [observer-js](https://github.com/ObserveRTC/observer-js) library, which you can use to process the samples.



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
