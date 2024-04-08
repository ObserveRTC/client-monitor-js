## Javascript library to monitor WebRTC applications

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

-   [Quick Start](#quick-start)
-   [Integrations](#integrations)
    -   [Mediasoup](#mediasoup)
-   [Collected Metrics](#collected-metrics)
    -   [Calculated updates](#calculated-updates)
    -   [PeerConnection Entry](#peerconnection-entry)
    -   [MediaStreamTrack Entry](#mediastreamtrack-entry)
    -   [InboundRTP Entry](#inboundrtp-entry)
    -   [OutboundRTP Entry](#outboundrtp-entry)
-   [Detectors and Issues](#detectors-and-issues)
    -   [Congestion Detector](#congestion-detector)
    -   [Audio Desync Detector](#audio-desync-detector)
    -   [CPU Performance Detector](#cpu-performance-detector)
-   [Configurations](#configurations)
-   [Events](#events)
    -   [CLIENT_JOINED Event](#client_joined-event)
    -   [CLIENT_LEFT Event](#client_left-event)
    -   [Custom Call Event](#custom-call-event)
    -   [Extension Stats Event](#extension-stats-event)
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
const collector = monitor.collectors.addRTCPeerConnection(peerConnection);

monitor.on("stats-collected", () => {
    for (const inboundRtp of monitor.inboundRtps) {
        const trackId = inboundRtp.getTrackId();
        const remoteOutboundRtp = inboundRtp.getRemoteOutboundRtp();
        console.log(trackId, inboundRtp.stats, remoteOutboundRtp.stats);
    }
});
// if you want to stop collecting from the peerConnection, then:
collector.close();
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
const collector = monitor.collectors.addMediasoupDevice(mediasoupDevice);

collector.onclose = () => {
    console.log(`mediasoup collector ${collector.id} is closed`);
}

monitor.on("stats-collected", () => {
    // do your stuff

    // you can close detach mediasoup
    // collector by calling the close
    collector.close();
});
```

**Important Note**: The created collector is hooked to the device's 'newtransport' event and can automatically detect transports created **after** the device has been added. If you create transports before adding the device to the monitor, those previously created transports will not be monitored automatically. You will need to manually add them to the stats collector like this:

```javascript
const myTransport = collector.addTransport(myTransport); // your transport created before the device is added to the monitor
```

## Collected Metrics

Collecting WebRTC Metrics is either done periodically according to the `collectingPeriodInMs` configuration or manually by calling the `monitor.collect()` method. The collected metrics are stored in the `ClientMonitor` instance and assigned to Entries.
Each entry in clientMonitor represents a WebRTC component such as `RTCPeerConnection`, `MediaStreamTrack`, etc. Entries can relate to each other and from one entry you can navigate to a correspondent entry. For example, from an `InboundRTP` entry you can navigate to the correspondent `RemoteOutboundRtp` entry, and reverse. Additionally entries are exposing basic derivatives calculated from the collected metrics.


### Calculated Updates

Calculated updates allow you to observe metrics derived from polled WebRTC stats captured by the library. These calculated updates provide a richer, more nuanced understanding of your application's client-side behavior, offering valuable insights beyond what raw stats metrics can provide.

For example by accessing `storage` you can get the following calculated updates:

```javascript

monitor.on('stats-collected', () => {
    const {
        totalInboundPacketsLost,
        totalInboundPacketsReceived,
        totalOutboundPacketsLost,
        totalOutboundPacketsReceived,
        totalOutboundPacketsSent,
        totalSentAudioBytes,
        totalSentVideoBytes,
        totalReceivedAudioBytes,
        totalReceivedVideoBytes,
        totalDataChannelBytesSent,
        totalDataChannelBytesReceived,
    
        deltaInboundPacketsLost,
        deltaInboundPacketsReceived,
        deltaOutboundPacketsLost,
        deltaOutboundPacketsReceived,
        deltaOutboundPacketsSent,
        deltaSentAudioBytes,
        deltaSentVideoBytes,
        deltaReceivedAudioBytes,
        deltaReceivedVideoBytes,
        deltaDataChannelBytesSent,
        deltaDataChannelBytesReceived,
    
        avgRttInS,
        sendingAudioBitrate,
        sendingVideoBitrate,
        receivingAudioBitrate,
        receivingVideoBitrate,

        highestSeenSendingBitrate,
        highestSeenReceivingBitrate,
        highestSeenAvailableOutgoingBitrate,
        highestSeenAvailableIncomingBitrate,
    } = monitor.storage

    console.log(`Total inbound packets lost: ${totalInboundPacketsLost}`);
    console.log(`Total inbound packets received: ${totalInboundPacketsReceived}`);
    console.log(`Total outbound packets lost: ${totalOutboundPacketsLost}`);
    console.log(`Total outbound packets received: ${totalOutboundPacketsReceived}`);
    console.log(`Total outbound packets sent: ${totalOutboundPacketsSent}`);
    console.log(`Total sent audio bytes: ${totalSentAudioBytes}`);
    console.log(`Total sent video bytes: ${totalSentVideoBytes}`);
    console.log(`Total received audio bytes: ${totalReceivedAudioBytes}`);
    console.log(`Total received video bytes: ${totalReceivedVideoBytes}`);
    console.log(`Total data channel bytes sent: ${totalDataChannelBytesSent}`);
    console.log(`Total data channel bytes received: ${totalDataChannelBytesReceived}`);

    console.log(`Lost Inbound packets since last collecting: ${deltaInboundPacketsLost}`);
    console.log(`Received Inbound packets since last collecting: ${deltaInboundPacketsReceived}`);
    console.log(`Lost Outbound packets since last collecting: ${deltaOutboundPacketsLost}`);
    console.log(`Received Outbound packets since last collecting: ${deltaOutboundPacketsReceived}`);
    console.log(`Sent Outbound packets since last collecting: ${deltaOutboundPacketsSent}`);
    console.log(`Sent audio bytes since last collecting: ${deltaSentAudioBytes}`);
    console.log(`Sent video bytes since last collecting: ${deltaSentVideoBytes}`);
    console.log(`Received audio bytes since last collecting: ${deltaReceivedAudioBytes}`);
    console.log(`Received video bytes since last collecting: ${deltaReceivedVideoBytes}`);
    console.log(`Data channel bytes sent since last collecting: ${deltaDataChannelBytesSent}`);
    console.log(`Data channel bytes received since last collecting: ${deltaDataChannelBytesReceived}`);

    console.log(`Average RTT: ${avgRttInS}`);
    console.log(`Sending audio bitrate: ${sendingAudioBitrate}`);
    console.log(`Sending video bitrate: ${sendingVideoBitrate}`);
    console.log(`Receiving audio bitrate: ${receivingAudioBitrate}`);
    console.log(`Receiving video bitrate: ${receivingVideoBitrate}`);

    console.log(`Highest seen sending bitrate: ${highestSeenSendingBitrate}`);
    console.log(`Highest seen receiving bitrate: ${highestSeenReceivingBitrate}`);
    console.log(`Highest seen available outgoing bitrate: ${highestSeenAvailableOutgoingBitrate}`);
    console.log(`Highest seen available incoming bitrate: ${highestSeenAvailableIncomingBitrate}`);
    
});

```

As mentioned above, the `ClientMonitor` instance stores entries, and each entry has a `stats` property that contains the raw stats collected from the WebRTC API. The `ClientMonitor` also stores calculated updates for each entry, which are derived from the raw stats. These calculated updates are accessible from the `ClientMonitor` instance and are updated every time the `stats-collected` event is emitted.

### PeerConnection Entry

**Accessing Stats**:
```javascript
// from monitor
monitor.peerConnections.forEach(pc => console.log(`PeerConnection: ${pc.statsId}`, pc.stats));

// or from storage
[...monitor.storage.peerConnections()].forEach(pc => console.log(`PeerConnection: ${pc.statsId}`, pc.stats));
```

**Accessing Calculated Updates**:
```javascript

monitor.on('stats-collected', () => {
    for (const pc of monitor.peerConnections) {
        console.log(`Between this and last collecting, the following stats were calculated for PeerConnection`, [
            `Received bytes through data channel ${pc.deltaDataChannelBytesReceived}`,
            `Sent bytes through data channel ${pc.deltaDataChannelBytesSent}`,
            `Received bytes through inbound rtps ${pc.deltaInboundPacketsReceived}`,
            `Sent bytes through outbound rtps ${pc.deltaOutboundPacketsSent}`,
            `Lost packets on inbound rtps ${pc.deltaInboundPacketsReceived}`,
            `Lost packets on outbound rtps ${pc.deltaOutboundPacketsSent}`,
            `Outbound audio bitrate${pc.sendingAudioBitrate}`,
            `Outbound video bitrate${pc.sendingVideoBitrate}`,
            `Inbound audio bitrate${pc.receivingAudioBitrate}`,
            `Inbound video bitrate${pc.receivingVideoBitrate}`,
            `Received bytes on all audio tracks ${pc.deltaReceivedAudioBytes}`,
            `Received bytes on all video tracks ${pc.deltaReceivedVideoBytes}`,
            `Sent bytes on all audio tracks ${pc.deltaSentAudioBytes}`,
            `Sent bytes on all video tracks ${pc.deltaSentVideoBytes}`,
        ].join('\n'));
    }
});
```

**Accessing related entries**:

```javascript
    const pc = monitor.getPeerConnectionStats(peerConnectionId);
    if (pc) {
        [...pc.inboundRtps()].forEach((inboundRtp) => void 0);
        [...pc.outboundRtps()].forEach((outboundRtp) => void 0);

        [...pc.localCandidates()].forEach((localICECandidate) => void 0);
        [...pc.remoteCandidates()].forEach((remoteICECandidate) => void 0);
        [...pc.iceCandidatePairs()].forEach((iceCandidatePair) => void 0);

        [...pc.sctpTransports()].forEach((sctpTransport) => void 0);
        [...pc.transceivers()].forEach((transceiver) => void 0);
        [...pc.senders()].forEach((sender) => void 0);
        [...pc.receivers()].forEach((receiver) => void 0);
        [...pc.transports()].forEach((transport) => void 0);
        [...pc.certificates()].forEach((certificate) => void 0);
        [...pc.iceServers()].forEach((iceServer) => void 0);
        
    }
```

### MediaStreamTrack Entry


**Collected tracks**:
```javascript
monitor.on('stats-collected', () => {
    for (const track of monitor.tracks) {
        console.log(`Track ${track.trackId} is ${track.kind}`);
    }
});
```

**Accessing Calculated Updates**:
```javascript
monitor.on('stats-collected', () => {
    for (const track of monitor.tracks) {
        if (track?.direction === 'outbound') {
            console.log(`Stats belongs to Track ${track.trackId} `);
            console.log(`Lost packets reported by remote endpoint: ${track.remoteLostPackets}`);
            console.log(`Received packets reported by remote endpoint: ${track.remoteReceivedPackets}`);
            console.log(`Sent packets reported by local endpoint: ${track.sentPackets}`);
            console.log(`Sending bitrate ${track.sendingBitrate}`);
            console.log(`Associated sfu stream id: ${track.sfuStreamId}`);
        }

        if (trackStats?.direction === 'inbound') {
            console.log(`Stats belongs to Track ${track.trackId} `);
            console.log(`Lost packets reported by local endpoint: ${track.lostPackets}`);
            console.log(`Received packets reported by local endpoint: ${track.receivedPackets}`);
            console.log(`Received bitrate ${track.receivingBitrate}`);
            console.log(`Associated sfu stream id: ${track.sfuStreamId}`);
            console.log(`Associated sfu sink id: ${track.sfuSinkId}`);
        }
    }
});
```

**Accessing related entries**
```javascript
monitor.on('stats-collected', () => {
    for (const track of monitor.tracks) {
        console.log(`Track ${track.trackId} is ${track.kind}`);
        if (track.direction === 'outbound') {
            [...track.outboundRtps()].forEach(outboundRtp => {
                console.log(`Outbound RTP ${outboundRtp.getSsrc()} has ${outboundRtp.sentPackets} sent packets`);
            });
        }

        if (track.direction === 'inbound') {
            [...track.inboundRtps()].forEach(inboundRtp => {
                console.log(`Inbound RTP ${inboundRtp.getSsrc()} has ${inboundRtp.receivedPackets} received packets`);
            });
        }
    }
});
```

### InboundRTP Entry

**Accessing Stats**:

```javascript
monitor.on('stats-collected', () => {
    for (const inboundRtp of monitor.inboundRtps) {
        console.log(`InboundRtp ${inboundRtp.statsId} collected stats`, inboundRtp.stats);
    }
});
```
**Accessing Calculated Updates**:
```javascript
monitor.on('stats-collected', () => {
    for (const inboundRtp of monitor.inboundRtps) {
        console.log(`InboundRtp ${inboundRtp.getSsrc()} `);
        console.log(`Received packets since last collecting: ${inboundRtp.receivedBytes}`);
        console.log(`Received bitrate since last collecting: ${inboundRtp.receivingBitrate}`);
        console.log(`Received packets since last collecting: ${inboundRtp.receivedPackets}`);
        console.log(`Received frames since last collecting: ${inboundRtp.receivedFrames}`);
        console.log(`Lost packets since last collecting: ${inboundRtp.lostPackets}`);
        console.log(`Average jitter buffer delay since last collecting: ${inboundRtp.avgJitterBufferDelayInMs}`);
        console.log(`Average RTT since last collecting: ${inboundRtp.avgRttInS}s`);

        console.log(`Associated sfu stream id: ${inboundRtp.sfuStreamId}`);
        console.log(`Associated sfu sink id: ${inboundRtp.sfuSinkId}`);
        
    }
});
```

**Accessing related entries**:
```javascript
monitor.on('stats-collected', () => {
    for (const inboundRtp of monitor.inboundRtps) {
        
        console.log(`inbound RTP associated with SSRC ${inboundRtp.getSsrc()} uses codec ${inboundRtp.getCodec()?.stats.mimeType}`);
        console.log(`inbound RTP associated with SSRC ${inboundRtp.getSsrc()} remote endpoint sent ${inboundRtp.getRemoteOutboundRtp()?.stats.packetsSent} packets`);

        inboundRtp.kind ==='audio' && console.log(`inbound RTP associated with SSRC ${inboundRtp.getSsrc()} has played out ${inboundRtp.getAudioPlayout()?.stats.totalSamplesCount} audio samples`);

        const audioPlayout = inboundRtp.getAudioPlayout(); // The AudioPlayoutEntry associated with the inboundRtp
        const peerConnection = inboundRtp.getPeerConnection(); // The PeerConnectionEntry associated with the inboundRtp
        const trackId = inboundRtp.getTrackId(); // The trackId associated with the inboundRtp
    }
})
```

### OutboundRTP Entry

**Accessing Stats**:

```javascript
monitor.on('stats-collected', () => {
    for (const outboundRtp of monitor.outboundRtps) {
        console.log(`OutboundRtp ${outboundRtp.statsId} collected stats`, outboundRtp.stats);
    }
});
```

**Accessing Calculated Updates**:
```javascript
monitor.on('stats-collected', () => {
    for (const outboundRtp of monitor.outboundRtps) {
        console.log(`OutboundRtp ${outboundRtp.getSsrc()} `);
        console.log(`Sent packets since last collecting: ${outboundRtp.sentPackets}`);
        console.log(`Sending bitrate since last collecting: ${outboundRtp.sendingBitrate}`);
        console.log(`Sent bytes since last collecting: ${outboundRtp.sentBytes}`);
        console.log(`Associated sfu stream id: ${outboundRtp.sfuStreamId}`);
    }
});
```

**Accessing related entries**:
```javascript
monitor.on('stats-collected', () => {
    for (const outboundRtp of monitor.outboundRtps) {
        console.log(`outbound RTP associated with SSRC ${outboundRtp.getSsrc()} uses codec ${outboundRtp.getCodec()?.stats.mimeType}`);
        console.log(`outbound RTP associated with SSRC ${outboundRtp.getSsrc()} remote endpoint received ${outboundRtp.getRemoteInboundRtp()?.stats.packetsReceived} packets`);

        const remoteInboundRtp = outboundRtp.getRemoteInboundRtp(); // The RemoteInboundRtpEntry associated with the outboundRtp
        const peerConnection = outboundRtp.getPeerConnection(); // The PeerConnectionEntry associated with the outboundRtp
        const trackId = outboundRtp.getTrackId(); // The trackId associated with the outboundRtp
    }
})
```


## Detectors and Issues

ClientMonitor comes with Detectors detect various issues and anomalies in the collected stats. These detectors are continuously monitoring the stats and set an alert if certain thresholds are hit. You can create detectors and subscribe to alerts of an instantiated client-monitor-js.

For example: 

```javascript
const detector = monitor.createCongestionDetector();

detector.on('congestion', event => {
    console.log('Congestion ', event);
});

// Once the detector is created, you can subscribe to the monitor congestion event

monitor.on('congestion', event => {
   // same as above
});
```

Detector can be created to add issue to the monitor whenever a certain condition is met.
    
```javascript
const detector = monitor.createCongestionDetector({
    createIssueOnDetection: {
        severity: 'major',
        attachments: {
            // various custom data
        },
    },
});
```

Issues can be added through the client monitor instance. For example:

```javascript
monitor.addIssue({
    severity: 'critical',
    description: 'Media device is crashed',
    timestamp: Date.now(),
    attachments: {
        clientId,
        reason,
    },
});
```

The severity of the issue can be one of the following values: `critical`, `major`, `minor`.

As mentioned above, if a detector is created with an option to create an issue on detection, the detector will automatically add an issue to the monitor whenever the condition is met.

Currently the following Detectors are added to ClientMonitor:

### Congestion Detector

```javascript
const detector = monitor.createCongestionDetector({
    createIssueOnDetection: {
        severity: 'major',
        attachments: {
            // various custom data
        },
    }
});

const onCongestion = (event) => {
    console.log('congestion detected on media streaming');
    console.log("Available incoming bitrate before congestion", event.incomingBitrateBeforeCongestion);
    console.log("Available outgoing bitrate before congestion", event.outgoingBitrateBeforeCongestion);
    console.log("Available incoming bitrate after congestion", event.incomingBitrateAfterCongestion);
    console.log("Available outgoing bitrate after congestion", event.outgoingBitrateAfterCongestion);
};

detector.once('close', () => {
    console.log('congestion detector is closed');
    detector.off('congestion', onCongestion);
})
detector.on('congestion', onCongestion);

setTimeout(() => {
    detector.close();
}, 10000);
```

### Audio Desync Detector

```javascript
const detector = monitor.createAudioDesyncDetector({
    createIssueOnDetection: {
        severity: 'major',
        attachments: {
            // various custom data
        },
    }
});

const onDesync = (trackId) => {
    console.log('Audio desync detected on track', trackId);
}

detector.once('close', () => {
    detector.off('desync', onDesync);
});
detector.on('desync', onDesync);

```

### CPU Performance Detector


```javascript

const detector = monitor.createCpuPerformanceIssueDetector({
    createIssueOnDetection: {
        severity: 'major',
        attachments: {
            // various custom data
        },
    }
});

const onStateChanged = (state) => {
   console.log('CPU performance state changed', state);
};

detector.once('close', () => {
    detector.off('statechanged', onStateChanged);
});
detector.on('statechanged', onStateChanged);

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

### Extension Stats Event

You can create an extension state event by calling the `monitor.addExtensionStats()` method. The method takes an object with the following properties:

```javascript
monitor.addExtensionStats({
    type: 'CLIENT_CPU_STATS',
    payload: {
        cpuUsage: 0.5,
        memoryUsage: 0.3,
    }
});
```

As a rule of thumb for when to use `addCustomCallEvent` and `addExtensionStateEvent`:
- Use `addCustomCallEvent` for events that are related to the call itself, such as user clicked a button.
- Use `addExtensionStats` for events that are related to the client's environment, such as CPU usage and collected periodically.


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
