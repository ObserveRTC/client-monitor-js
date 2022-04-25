Javascript library to monitor WebRTC applications
---

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

 * [Quick Start](#quick-start)
 * [Client Monitor Storage](#client-monitor-storage)
 * [Connect to Observer](#connect-to-observer)
 * [Configurations](#configurations)
 * [Examples](#examples)
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

Use it in your WebRTC application. 

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";
// see full config in Configuration section
const config = {
    collectingPeriodInMs: 5000,
};
const monitor = ClientMonitor.create(config);
monitor.addStatsCollector({
    id: "collectorId",
    getStats: () => peerConnection.getStats(),
});

monitor.events.onStatsCollected(() => {
    const storage = monitor.storage;
    for (const inboundRtp of storage.inboundRtps()) {
        const trackId = inboundRtp.getTrackId();
        const remoteOutboundRtp = inboundRtp.getRemoteOutboundRtp();
        console.log(trackId, inboundRtp.stats, remoteOutboundRtp.stats);
    }
})
```

The above example collect stats in every 5s. 
When stats are collected the inboundRtp entries are iterated.
The stats of the inboound-rtp, its corresponded trackId and remote outbound stats are logged.


## Client Monitor Storage

Client Monitor collects [WebRTCStats](https://www.w3.org/TR/webrtc-stats/). The collected stats can be accessed through entries the client monitor storage provides.

![Storage Navigations](figures/navigation.png)

Entries:

 * [inbound-rtp](#inbound-rtp-entries)
 * [outbound-rtp](#outbound-rtp-entries)
 * [remote-inbound-rtp](#remote-inbound-rtp-entries)
 * [remote-outbound-rtp](#remote-outbound-rtp-entries)
 * [media-source](#media-source-entries)
 * [contributing-source](#contributing-source-entries)
 * [data-channel](#data-channel-entries)
 * [transceiver](#transceiver-entries)
 * [sender](#sender-entries)
 * [receiver](#receiver-entries)
 * [transport](#transport-entries)
 * [sctp-transport](#sctp-transport-entries)
 * [ice-candidate-pair](#ice-candidate-pair-entries)
 * [local-candidate](#local-candidate-entries)
 * [remote-candidate](#remote-candidate-entries)
 * [certificate](#certificate-entries)
 * [ice-server](#ice-server-entries)
 * [peer-connection](#peer-connection-entries)

### inbound-rtp entries
```javascript
const storage = monitor.storage;

for (const inboundRtp of storage.inboundRtps()) {
    const receiver = inboundRtp.getReceiver();
    const trackId = inboundRtp.getTrackId();
    const ssrc = inboundRtp.getSsrc();
    const remoteOutboundRtp = inboundRtp.getRemoteOutboundRtp();
    const peerConnection = inboundRtp.getPeerConnection();
    const transport = inboundRtp.getTransport();
    const codec = inboundRtp.getCodec();

    console.log(trackId, ssrc, 
        inboundRtp.stats, 
        remoteOutboundRtp.stats, 
        receiver.stats,
        peerConnection.stats,
        transport.stats,
        codec.stats
    );
}
```

### outbound-rtp entries

```javascript
const storage = monitor.storage;

for (const outboundRtp of storage.outboundRtps()) {
    const sender = outboundRtp.getSender();
    const trackId = outboundRtp.getTrackId();
    const ssrc = outboundRtp.getSsrc();
    const remoteInboundRtp = outboundRtp.getRemoteInboundRtp();
    const peerConnection = outboundRtp.getPeerConnection();
    const transport = outboundRtp.getTransport();
    const mediaSource = outboundRtp.getMediaSource();

    console.log(trackId, ssrc, 
        outboundRtp.stats, 
        remoteInboundRtp.stats, 
        sender.stats,
        peerConnection.stats,
        transport.stats,
        mediaSource.stats
    );
}
```

### remote-inbound-rtp entries

```javascript
const storage = monitor.storage;

for (const remoteInboundRtp of storage.remoteInboundRtps()) {
    const ssrc = remoteInboundRtp.getSsrc();
    const outboundRtp = remoteInboundRtp.getOutboundRtp();
    const peerConnection = remoteInboundRtp.getPeerConnection();

    console.log(ssrc, 
        remoteInboundRtp.stats, 
        outboundRtp.stats, 
        peerConnection.stats
    );
}
```

### remote-outbound-rtp entries

```javascript
const storage = monitor.storage;

for (const remoteOutboundRtp of storage.remoteOutboundRtps()) {
    const ssrc = remoteOutboundRtp.getSsrc();
    const inboundRtp = remoteOutboundRtp.getInboundRtp();
    const peerConnection = remoteOutboundRtp.getPeerConnection();

    console.log(ssrc, 
        remoteOutboundRtp.stats, 
        inboundRtp.stats, 
        peerConnection.stats
    );
}
```

### media-sources entries

```javascript
const storage = monitor.storage;

for (const mediaSource of storage.mediaSources()) {
    const peerConnection = mediaSource.getPeerConnection();

    console.log( 
        mediaSource.stats, 
        peerConnection.stats
    );
}
```

### contributing-source entries

```javascript
const storage = monitor.storage;

for (const cssrc of storage.contributingSources()) {
    const peerConnection = cssrc.getPeerConnection();

    console.log( 
        cssrc.stats, 
        peerConnection.stats
    );
}
```

### data-channel entries

```javascript
const storage = monitor.storage;

for (const dataChannel of storage.dataChannels()) {
    const peerConnection = dataChannel.getPeerConnection();

    console.log( 
        dataChannel.stats, 
        peerConnection.stats
    );
}
```

### transceiver entries

```javascript
const storage = monitor.storage;

for (const transceiver of storage.transceivers()) {
    const receiver = transceiver.getReceiver();
    const sender = transceiver.getSender();
    const peerConnection = transceiver.getPeerConnection();

    console.log( 
        transceiver.stats, 
        receiver.stats,
        sender.stats,
        peerConnection.stats
    );
}
```


### sender entries

```javascript
const storage = monitor.storage;

for (const sender of storage.senders()) {
    const mediaSource = sender.getMediaSource();
    const peerConnection = sender.getPeerConnection();

    console.log( 
        sender.stats,
        mediaSource.stats,
        peerConnection.stats
    );
}
```


### receiver entries

```javascript
const storage = monitor.storage;

for (const receiver of storage.receivers()) {
    const peerConnection = receiver.getPeerConnection();

    console.log( 
        receiver.stats,
        peerConnection.stats
    );
}
```

### transport entries

```javascript
const storage = monitor.storage;

for (const transport of storage.transports()) {
    const contributingTransport = transport.getRtcpTransport();
    const selectedIceCandidatePair = transport.getSelectedIceCandidatePair();
    const localCandidate = transport.getLocalCertificate();
    const remoteCandidate = transport.getRemoteCertificate();
    const peerConnection = transport.getPeerConnection();

    console.log( 
        transport.stats,
        contributingTransport?.stats,
        selectedIceCandidatePair?.stats,
        localCandidate?.stats,
        remoteCandidate?.stats,
        remoteCandidate?.stats
    );
}
```

### sctp transport entries

```javascript
const storage = monitor.storage;

for (const sctpTransport of storage.sctpTransports()) {
    const transport = sctpTransport.getTransport();
    const peerConnection = sctpTransport.getPeerConnection();

    console.log( 
        sctpTransport.stats,
        transport?.stats,
        peerConnection?.stats,
    );
}
```


### ice candidate pair entries

```javascript
const storage = monitor.storage;

for (const iceCandidatePair of storage.iceCandidatePairs()) {
    const transport = iceCandidatePair.getTransport();
    const localCandidate = iceCandidatePair.getLocalCandidate();
    const remoteCandidate = iceCandidatePair.getRemoteCandidate();
    const peerConnection = iceCandidatePair.getPeerConnection();

    console.log( 
        iceCandidatePair.stats,
        transport?.stats,
        localCandidate?.stats,
        remoteCandidate?.stats,
        peerConnection?.stats,
    );
}
```

### local ice candidate entries

```javascript
const storage = monitor.storage;

for (const localCandidate of storage.localCandidates()) {
    const transport = localCandidate.getTransport();
    const peerConnection = localCandidate.getPeerConnection();

    console.log( 
        localCandidate.stats,
        peerConnection?.stats,
    );
}
```

### remote ice candidate entries

```javascript
const storage = monitor.storage;

for (const remoteCandidate of storage.remoteCandidates()) {
    const transport = remoteCandidate.getTransport();
    const peerConnection = remoteCandidate.getPeerConnection();

    console.log( 
        remoteCandidate.stats,
        peerConnection?.stats,
    );
}
```

### certificate entries

```javascript
const storage = monitor.storage;

for (const certificate of storage.certificates()) {
    const peerConnection = certificate.getPeerConnection();

    console.log( 
        certificate.stats,
        peerConnection?.stats,
    );
}
```

### ice server entries

```javascript
const storage = monitor.storage;

for (const iceServer of storage.iceServers()) {
    const peerConnection = iceServer.getPeerConnection();

    console.log( 
        iceServer.stats,
        peerConnection?.stats,
    );
}
```

### peer connection entries

```javascript
const storage = monitor.storage;

for (const peerConnection of storage.peerConnections()) {

    for (const codec of peerConnection.getCodecs()) 
        console.log(
            `peerConnection(${peerConnection.id}).codec(${codec.id}).stats: `, 
            codec.stats
        );

    for (const inboundRtp of peerConnection.inboundRtps()) 
        console.log(
            `peerConnection(${peerConnection.id}).inboundRtp(${inboundRtp.id}).stats: `, 
            inboundRtp.stats
        );

    for (const outboundRtp of peerConnection.outboundRtps()) 
        console.log(
            `peerConnection(${peerConnection.id}).outboundRtp(${outboundRtp.id}).stats: `, 
            outboundRtp.stats
        );

    for (const remoteInboundRtp of peerConnection.remoteInboundRtps()) 
        console.log(
            `peerConnection(${peerConnection.id}).remoteInboundRtp(${remoteInboundRtp.id}).stats: `, 
            remoteInboundRtp.stats
        );

    for (const remoteOutboundRtp of peerConnection.remoteOutboundRtps()) 
        console.log(
            `peerConnection(${peerConnection.id}).remoteOutboundRtp(${remoteOutboundRtp.id}).stats: `, 
            remoteOutboundRtp.stats
        );

    for (const mediaSource of peerConnection.mediaSources()) 
        console.log(
            `peerConnection(${peerConnection.id}).mediaSource(${mediaSource.id}).stats: `, 
            mediaSource.stats
        );

    for (const cssrc of peerConnection.contributingSources()) 
        console.log(
            `peerConnection(${peerConnection.id}).cssrc(${cssrc.id}).stats: `, 
            cssrc.stats
        );

    for (const dataChannel of peerConnection.dataChannels()) 
        console.log(
            `peerConnection(${peerConnection.id}).dataChannel(${dataChannel.id}).stats: `, 
            dataChannel.stats
        );

    for (const transceiver of peerConnection.transceivers()) 
        console.log(
            `peerConnection(${peerConnection.id}).transceiver(${transceiver.id}).stats: `, 
            transceiver.stats
        );

    for (const sender of peerConnection.senders()) 
        console.log(
            `peerConnection(${peerConnection.id}).sender(${sender.id}).stats: `, 
            sender.stats
        );

    for (const receiver of peerConnection.receivers()) 
        console.log(
            `peerConnection(${peerConnection.id}).receiver(${receiver.id}).stats: `, 
            receiver.stats
        );

    for (const transport of peerConnection.transports()) 
        console.log(
            `peerConnection(${peerConnection.id}).transport(${transport.id}).stats: `, 
            transport.stats
        );

    for (const sctpTransport of peerConnection.sctpTransports()) 
        console.log(
            `peerConnection(${peerConnection.id}).sctpTransport(${sctpTransport.id}).stats: `, 
            sctpTransport.stats
        );

    for (const iceCandidate of peerConnection.iceCandidatePairs()) 
        console.log(
            `peerConnection(${peerConnection.id}).iceCandidate(${iceCandidate.id}).stats: `, 
            iceCandidate.stats
        );

    for (const localCandidate of peerConnection.localCandidates()) 
        console.log(
            `peerConnection(${peerConnection.id}).localCandidate(${localCandidate.id}).stats: `, 
            localCandidate.stats
        );

    for (const remoteCandidate of peerConnection.remoteCandidates()) 
        console.log(
            `peerConnection(${peerConnection.id}).remoteCandidate(${remoteCandidate.id}).stats: `, 
            remoteCandidate.stats
        );

    for (const certificate of peerConnection.certificates()) 
        console.log(
            `peerConnection(${peerConnection.id}).certificate(${certificate.id}).stats: `, 
            certificate.stats
        );

    for (const iceServer of peerConnection.iceServers()) 
        console.log(
            `peerConnection(${peerConnection.id}).iceServer(${iceServer.id}).stats: `, 
            iceServer.stats
        );

    console.log(`peerConnection(${peerConnection.id}) trackIds:`, 
            Array.from(peerConnection.trackIds())
        );
}
```

## Connect to Observer

The client-monitor can be connected to an [Observer](https://github.com/ObserveRTC/observer).

```javascript
import { ClientMontior } from "@observertc/client-monitor-js";
// see full config in Configuration section
const config = {
    collectingPeriodInMs: 5000,
    samplingPeriodInMs: 10000,
    sendingPeriodInMs: 15000,
    sampler: {
        roomId: "testRoom",
    },
    sender: {
        websocket: {
            urls: ["ws://localhost:7080/samples/myServiceId/myMediaUnitId"]
        }
    }
};
const monitor = ClientMontior.create(config);
monitor.addStatsCollector({
    id: "collectorId",
    getStats: () => peerConnection.getStats(),
});
```

The stats are collected in every 5s, but samples are only made in every 10s. Samples are sent to the observer in every 15s.


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
     * By setting it stats items and entries are deleted if they are not updated.
     * 
     * DEFAULT: undefined
     */
    statsExpirationTimeInMs: 60000,

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
     * Sampling Component Related configurations
     * 
     */
    sampler: {
        /**
         * The identifier of the room the clients are in.
         * 
         * If server side componet is used to collect the samples, this parameter is the critical to provide to match clients being in the same room.
         * 
         * DEFAULT: a generated unique value
         * 
         * NOTE: if this value has not been set clients which are in the same room will not be matched at the monitor
         */
        roomId: "testRoom",

        /**
         * The identifier of the client. If it is not provided, then it a UUID is generated. If it is provided it must be a valid UUID.
         * 
         * DEFAULT: a generated unique value
         */
        clientId: "clientId",

        /**
         * the identifier of the call between clients in the same room. If not given then the server side assigns one. If it is given it must be a valid UUID.
         * 
         * DEFAULT: undefined
         */
        callId: "callId",
        /**
         * The userId of the client appeared to other users.
         * 
         * DEFAULT: undefined
         */
        userId: "testUser",

        /**
         * Indicate if the sampler only sample stats updated since the last sampling.
         * 
         * DEFAULT: true
         */
        incrementalSampling: true,
    },
    /**
     * Configure the sender component.
     */
    sender: {
        /**
         * Configure the format used to transport samples or receieve 
         * feedback from the server.
         * 
         * Possible values: json, protobuf
         * 
         * DEFAULT: json
         * 
         */
        format: "json",
         /**
         * Websocket configuration to transport the samples
         */
        websocket: {
            /**
             * Target urls in a priority order. If the Websocket has not succeeded for the first,
             * it tries with the second. If no more url left the connection is failed
             * 
             */
            urls: ["ws://localhost:7080/samples/myServiceId/myMediaUnitId"],
            /**
             * The maximum number of retries to connect to a server before,
             * tha connection failed is stated.
             * 
             * DEFAULT: 3
             */
            maxRetries: 1,
        }
    }
};
```

## Examples

 * [Calculate video tracks Fps](#calculate-video-tracks-fps)
 * [Collect RTT measurements for Peer Connections](#collect-rtt-measurements-for-peer-connections)

### Calculate video tracks Fps

Assuming you have a configured and running monitor and a collector you added to poll the stats from
peer connection, here is an example to calculate the frame per sec for tracks.

```javascript
const monitor = //.. defined above
monitor.onStatsCollected(() => {
    const now = Date.now();
    for (const inboundRtp of monitor.storage.inboundRtps()) {
        const trackId = inboundRtp.getTrackId();
        const SSRC = inboundRtp.getSsrc();
        const traceId = `${trackId}-${SSRC}`;
        // lets extract what we need from the stats for inboundRtp: https://www.w3.org/TR/webrtc-stats/#inboundrtpstats-dict*
        const { framesReceived, kind } = inboundRtp.stats;
        if (kind !== "video") continue;
        const trace = traces.get(traceId);
        if (!trace) {
            traces.set(traceId, {
                framesReceived,
                timestamp: now,
            });
            continue;
        }
        const elapsedTimeInS = (now - trace.timestamp) / 1000;
        const fps = (framesReceived - trace.framesReceived) / elapsedTimeInS;
        const peerConnectionId = inboundRtp.getPeerConnection()?.id;
        trace.framesReceived = framesReceived;
        trace.timestamp = now;

        console.log(`On peerConnection: ${peerConnectionId}, track ${trackId}, SSRC: ${SSRC} the FPS is ${fps}`);
    }
});
```

### Collect RTT measurements for peer connections

```javascript
const monitor = //.. defined above
monitor.onStatsCollected(() => {
    const RTTs = new Map();
    for (const outboundRtp of monitor.storage.outboundRtps()) {
        const remoteInboundRtp = outboundRtp.getRemoteInboundRtp();
        const { roundTripTime } = remoteInboundRtp.stats;
        const peerConnectionId = outboundRtp.getPeerConnection()?.collectorId;
        let measurements = results.get(peerConnectionId);
        if (!measurements) {
            measurements = [];
            RTTs.set(peerConnectionId, measurements);
        }
        measurements.push(roundTripTime);
    }
    // here you have the RTT measurements groupped by peer connections
    console.log(Array.from(RTTs.entries()));
});
```

## NPM package

https://www.npmjs.com/package/@observertc/client-monitor-js

## API docs

https://observertc.github.io/client-monitor-js/modules/ClientMonitor.html

## Schemas

https://github.com/observertc/schemas


## Getting Involved

Client-monitor is made with the intention to provide an open-source monitoring solution for 
WebRTC developers. We develop new features and maintaining the current 
product with the help of the community. If you are interested in getting involved 
please read our [contribution](CONTRIBUTING.md) guideline.

## License

Apache-2.0