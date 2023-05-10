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
