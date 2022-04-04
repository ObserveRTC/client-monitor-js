ObserveRTC Client Integration Core Library
---

# !!! UNDER DEVELOPMENT, NO STABLE VERSION IS AVAILABLE AT THE MOMENT! !!!

@observertc/client-observer-js is a client side library for observertc integration.

Table of Contents:
 * [Quick Start](#quick-start)
   - [Collect WebRTC Stats](#collect-webrtc-stats)
   - [Sample and Send](#sample-and-send)
 * [Schema](#schema)
 * [API docs](#api-docs)
 * [Schema](#schema)
 * [Configurations](#configurations)
 * [License](#license)

## Qucik Start

Install it from [npm](https://www.npmjs.com/package/@observertc/client-observer-js) package repository.

```
npm i @observertc/client-observer-js
```

### Collect WebRTC Stats

```javascript
import { ClientObserver } from "@observertc/client-observer-js";
// see full config in Configuration section
const config = {
    collectingPeriodInMs: 5000,
};
const observer = ClientObserver.create(config);
observer.addStatsCollector({
    id: "collectorId",
    getStats: () => peerConnection.getStats(),
});
observer.events.onStatsCollected(() => {
    for (const transport of observer.stats.transports()) {
        /// use the transport
        console.log(transport.stats.packetsSent);
    }
})
```
The above example collect stats in every 5s.
When stats are collected and stored it emits an event to notify the 
application.

You can navigate through related stats:

```javascript
    // list outbound RTP stats
    for (const outboundRtp of observer.stats.outboundRtps()) {
        // get the remote inbound RTP stats belongs to the actual outbound RTP
        const remoteInboundRtp = outboundRtp.getRemoteInboundRtp();
        console.log(outboundRtp.stats, remoteInboundRtp.stats);
    }
```
The example above shows how to get the remote inbound rtp stats related to the outbound rtp stats.

With `stats` you accessing to the [StatsStorage](https://observertc.github.io/client-observer-js/interfaces/StatsReader.html). StatsStorage provided entries can be used to navigate from stats type to another.

![Entry Navigations](docs/navigation.png)

### Sample and Send

UNDER DEVELOPMENT

## API docs

https://observertc.github.io/client-observer-js/modules/ClientObserver.html

## Schema

The schema used to send samples can be found [here](https://www.npmjs.com/package/@observertc/schemas#Samples).

## Configurations

```javascript
const config = {
    /**
     * By setting it, the observer calls the added statsCollectors periodically
     * and pulls the stats.
     * 
     * DEFAULT: undefined
     */
    collectingPeriodInMs: 5000,
    /**
     * By setting it, the observer make samples periodically.
     * 
     * DEFAULT: undefined
     */
    samplingPeriodInMs: 10000,

    /**
     * By setting it stats items and entries are deleted if they are not updated.
     * 
     * DEFAULT: undefined
     */
    statsExpirationTimeInMs: 60000,

    /**
     * Collector Component related configurations
     * 
     * DEFAULT: configured by the observer
     */
    collectors: {
        /**
         * Sets the adapter adapt different browser type and version 
         * provided stats.
         * 
         * DEFAULT: configured by the observer
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
         * NOTE: if this value has not been set clients which are in the same room will not be matched at the observer
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

## License

Apache-2.0