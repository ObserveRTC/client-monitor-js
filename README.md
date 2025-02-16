## Javascript library to monitor WebRTC applications

@observertc/client-monitor-js is a client side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and to integrate your app to observertc components.

Table of Contents:

-   [Quick Start](#quick-start)
-   [Integrations](#integrations)
-   [Developer Manual](#developer-manual)
-   [NPM package](#npm-package)
-   [Getting Involved](#getting-involved)
-   [License](#license)

## Quick Start

Install it from [npm](https://www.npmjs.com/package/@observertc/client-monitor-js) package repository.

```
npm i @observertc/client-monitor-js
```

or

```
yarn add @observertc/client-monitor-js
```

Add `@observertc/client-monitor-js` to your webapp.

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";
const monitor = new ClientMonitor();

monitor.addSource(peerConnection);

monitor.on("stats-collected", (event) => {
    const { clientMonitor } = event;

    console.log(`Sending audio bitrate: ${clientMonitor.sendingAudioBitrate}`);
    console.log(`Sending video bitrate: ${clientMonitor.sendingVideoBitrate}`);
    console.log(`Receiving audio bitrate: ${clientMonitor.receivingAudioBitrate}`);
    console.log(`Receiving video bitrate: ${clientMonitor.receivingVideoBitrate}`);
});

```

The above example do as follows:

1. Create a client monitor, which collect stats periodically (by default in every 2s)
2. Adds a source collect stats from a peer connection
3. Register an event handler called after stats are collected and metrics are updated

## Integrations

### Mediasoup

```javascript
import { createClientMonitor } from "@observertc/client-monitor-js";
import mediasoup from "mediaousp-client";

const mediasoupDevice = new mediasoup.Device();
const monitor = new ClientMonitor();

monitor.addSource(mediasoupDevice);
```

**Important Note**: The created collector is hooked to the device's 'newtransport' event and can automatically detect transports created **after** the device has been added. If you create transports before adding the device to the monitor, those previously created transports will not be monitored automatically. You will need to manually add them to the stats collector like this:

```javascript
const myTransport = monitor.addSource(myTransport); // your transport created before the device is added to the monitor
```

## Developer Manual

For detailed information on how to use the library, please refer to the [Developer documentation](developer-manual.md).

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
