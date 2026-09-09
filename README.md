# @observertc/client-monitor-js

**JavaScript library to monitor WebRTC applications**

@observertc/client-monitor-js is a client-side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and integrate your app with ObserveRTC components.

[![npm version](https://badge.fury.io/js/@observertc%2Fclient-monitor-js.svg)](https://badge.fury.io/js/@observertc%2Fclient-monitor-js)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Integrations](#integrations)
- [Configuration](#configuration)
- [ClientMonitor](#clientmonitor)
- [Detectors](#detectors)
- [Score Calculation](#score-calculation)
- [Stats, Sampling and Adapters](#stats-sampling-and-adapters)
- [Events and Issues](#events-and-issues)
- [Derived Metrics](#derived-metrics)
- [Schema Reference](#schema-reference)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)
- [FAQ](#faq)
- [Reference documents](#reference-documents)
- [NPM Package](#npm-package)
- [Schemas](#schemas)
- [Getting Involved](#getting-involved)
- [License](#license)

## Installation

```bash
npm install @observertc/client-monitor-js
```

or

```bash
yarn add @observertc/client-monitor-js
```

### Release candidates

Every push to `develop` publishes a release candidate as `X.Y.Z-rc.<N>`, where `N` increases with every build. Depend on the **`next` dist-tag** to track them:

```jsonc
// package.json
"dependencies": {
    "@observertc/client-monitor-js": "next"
}
```

`next` always points at the newest RC across all version lines, so this dependency never has to be edited when the line bumps from `4.7.x` to `4.8.x`. Per-line tags (`develop-470-rc`, `develop-460-rc`, ...) are still maintained if you want to stay on one line.

**Do not use a caret range to track RCs** — it cannot work, for two separate reasons rooted in how semver ranges treat prereleases:

- `"^4.6.0"` resolves to the stable `4.6.0` and silently excludes every RC. A range with no prerelease in it never matches prerelease versions.
- `"^4.7.1-rc.5"` does match RCs, but only of `4.7.1` — it will never see `4.8.1-rc.N`, so it stops updating the moment the line bumps.

Historically RCs were published as `X.Y.Z-<git-sha>.0`. Semver compares prerelease identifiers as ASCII strings and git SHAs have no chronological order, so the "highest" RC of that scheme was effectively random — a caret range on one of them resolved to an arbitrary older build and never moved. Those versions are still published and untouched, but they are superseded: any `rc.N` sorts above all of them.

## Quick Start

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

// Create a monitor with default configuration
const monitor = new ClientMonitor({
    clientId: "my-client-id",
    callId: "my-call-id",
    collectingPeriodInMs: 2000,
    samplingPeriodInMs: 4000,
});

// Add a peer connection to monitor
monitor.addSource(peerConnection);

// Listen for samples
monitor.on("sample-created", (sample) => {
    console.log("Sample created:", sample);
    // Send sample to your analytics backend
});

// Listen for issues
monitor.on("issue", (issue) => {
    console.log("Issue detected:", issue);
});

// Close when done
monitor.close();
```

## Integrations

### RTCPeerConnection Integration

Direct integration with native WebRTC PeerConnections:

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const peerConnection = new RTCPeerConnection();
const monitor = new ClientMonitor();

// Add the peer connection for monitoring
monitor.addSource(peerConnection);
```

### Mediasoup Integration

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";
import mediasoup from "mediasoup-client";

const device = new mediasoup.Device();
const monitor = new ClientMonitor();

// Monitor the mediasoup device
monitor.addSource(device);

// The monitor will automatically detect new transports created after adding the device
const transport = device.createSendTransport(/* ... */);

// For transports created before adding the device, add them manually:
monitor.addSource(transport);
```

**Important**: When adding a mediasoup device, the monitor automatically hooks into the `newtransport` event to detect newly created transports. However, transports created before adding the device must be added manually.

### Logger Integration

Customize logging behavior by providing your own logger to `ClientMonitor`.
The same logger instance is propagated to source and monitor internals.
Log messages include module prefixes such as `[ClientMonitor]:` and `[Sources]:`.
If no logger is provided, the default logger logs `warn` and `error` to console and treats `trace`/`debug`/`info` as no-op.

#### Basic Custom Logger

```javascript
import { ClientMonitor, Logger } from "@observertc/client-monitor-js";

const customLogger: Logger = {
    trace: (...args) => console.trace(...args),
    debug: (...args) => console.debug(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
};

const monitor = new ClientMonitor({
    logger: customLogger,
});
```

#### Production Logger Adapter

Map your existing app logger to the `Logger` interface:

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";
import pino from "pino";

const appLogger = pino({ level: "info" });

const monitor = new ClientMonitor({
    logger: {
        trace: (...args) => appLogger.trace(...args),
        debug: (...args) => appLogger.debug(...args),
        info: (...args) => appLogger.info(...args),
        warn: (...args) => appLogger.warn(...args),
        error: (...args) => appLogger.error(...args),
    },
});
```

#### Disable Logging

```javascript
const noop = () => {};

const monitor = new ClientMonitor({
    logger: {
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
    },
});
```

## Configuration

```typescript
const monitor = new ClientMonitor({
    clientId: 'unique-client-id',
    callId: 'unique-call-id',
    collectingPeriodInMs: 2000,
    samplingPeriodInMs: 4000,
});
```

Everything else is optional and has a default. Detector blocks follow one rule:

- **Omit the key** (or pass `undefined`) → defaults applied.
- **Pass an object** → detector enabled with your overrides.
- **Pass `null`** → the detector is not constructed at all.

Each block is named after its detector and is read by nothing else, so switching
one off never silences a neighbour.

> **[docs/CONFIGURATION.md](./docs/CONFIGURATION.md)** is the full reference —
> every key, every field, and every default, grouped as in `ClientMonitorConfig`.

## ClientMonitor

The `ClientMonitor` is the main class that orchestrates WebRTC monitoring, statistics collection, and anomaly detection.

### Core Features

-   **Multi-source monitoring**: Supports RTCPeerConnection, mediasoup devices and transports
-   **Automatic stats collection**: Periodically collects WebRTC statistics
-   **Real-time anomaly detection**: Built-in detectors for common issues
-   **Performance scoring**: Calculates quality scores for connections and tracks
-   **Event generation**: Emits events for WebRTC state changes and issues
-   **Sampling**: Creates periodic snapshots of the client state

### Public Methods

#### Core Methods

-   **`addSource(source: RTCPeerConnection | MediasoupDevice | MediasoupTransport)`**: Adds a source for monitoring
-   **`close()`**: Closes the monitor and stops all monitoring activities
-   **`collect()`**: Manually collects stats from all monitored sources
-   **`createSample()`**: Creates a client sample with current state

#### Configuration Methods

-   **`setCollectingPeriod(periodInMs: number)`**: Updates the stats collection interval
-   **`setSamplingPeriod(periodInMs: number)`**: Updates the sampling interval
-   **`setScore(score: number, reasons?: Record<string, number>)`**: Manually sets the client score

#### Event & Issue Methods

-   **`addEvent(event: ClientEvent)`**: Adds an immutable client event.
-   **`addIssue({ type, payload?, timestamp? })`**: Adds a one-shot issue (fire-and-forget). Emits `'issue'` and buffers into the next sample but never enters the active store and cannot be resolved. Use this for incidents with no "ended" condition (e.g. `USER_MEDIA_ERROR`).
-   **`raiseIssue(key, { type, payload?, timestamp? })`**: Creates or refreshes a stateful, resolvable issue keyed by `key`. Re-raising with the same key updates the entry in place and emits `'issue-updated'`. See the [Events and Issues](#events-and-issues) section for the full lifecycle.
-   **`resolveIssue(key, { comment?, payload?, resolvedAt? })`**: Resolves a stateful issue by its key. `payload`, when supplied, overwrites the active payload — that's how built-in detectors enrich the resolution record with `durationInMs`. Emits `'issue-resolved'`.
-   **`getActiveIssuesByType(type?)`**: Snapshot of currently active stateful issues, optionally filtered by `type`.
-   **`isIssueActive(key)`**: `true` when a stateful issue with the given `key` is active.
-   **`addMetaData(metaData: ClientMetaData)`**: Adds metadata.
-   **`addExtensionStats(stats: ExtensionStat)`**: Adds custom extension stats.

#### Utility Methods

-   **`getTrackMonitor(trackId: string)`**: Retrieves a track monitor by ID
-   **`watchMediaDevices()`**: Integrates with navigator.mediaDevices
-   **`fetchUserAgentData()`**: Fetches browser user agent information

### Properties

-   **`score`**: Current client performance score (0.0-5.0)
-   **`scoreReasons`**: Detailed score calculation reasons
-   **`closed`**: Whether the monitor is closed
-   **`config`**: Current configuration
-   **`detectors`**: Detector management instance
-   **`peerConnections`**: Array of monitored peer connections
-   **`tracks`**: Array of monitored tracks
-   **`activeIssues`**: `Map<string, RaisedClientIssue>` keyed by issue `key` — currently active stateful issues. Read-only by convention; use `getActiveIssuesByType` / `isIssueActive` instead of touching this directly.

## Detectors

A detector watches one thing, decides one question, and raises **one issue type**.
46 of them ship. Each reads a config block named after itself — the detector's own
`name` in camelCase — so any one can be tuned or switched off on its own:

```javascript
new ClientMonitor({
    pixelatedVideoDetector: { threshold: 0.03 },  // tune it
    codecChangeDetector: null,                    // or remove it entirely
});
```

Omit a key for defaults, pass `null` to not construct the detector at all. Every
built-in detector also exposes a `disabled` flag you can flip at runtime.

Three rules hold across all of them:

- **Duration is stats time, never wall clock.** Windows are aged on the gaps
  between stats reports, so a throttled tab cannot age a condition into an issue.
- **A detector that cannot see its inputs says so.** It sets `inputsUnavailable`
  rather than reading as healthy — the difference between "nothing is wrong" and
  "nothing was observed".
- **Detectors do not read each other's verdicts.** They observe; they do not
  consume conclusions.

> **[docs/DETECTORS.md](./docs/DETECTORS.md)** is the full reference — every
> detector, what it reads, what it refuses to claim, and how to tune it. Connection
> and transport detectors are in
> [docs/CONNECTION_DETECTORS.md](./docs/CONNECTION_DETECTORS.md).

### The full list

**Connectivity** — [full reference](./docs/CONNECTIVITY_DETECTORS.md)

| Detector | Raises | Config key |
|---|---|---|
| `DtlsHandshakeFailedDetector` | `dtls-handshake-failed` | `dtlsHandshakeFailedDetector` |
| `DtlsHandshakeStalledDetector` | `dtls-handshake-stalled` | `dtlsHandshakeStalledDetector` |
| `IceConnectionFailedDetector` | `ice-connection-failed` | `iceConnectionFailedDetector` |
| `IceDisconnectedDetector` | `ice-disconnected` | `iceDisconnectedDetector` |
| `IceEstablishmentFailedDetector` | `ice-establishment-failed` | `iceEstablishmentFailedDetector` |
| `IcePathEstablishmentDetector` | *(event only)* | `icePathEstablishmentDetector` |
| `IceReachabilityDetector` | `no-available-ice-candidate` | `iceReachabilityDetector` |
| `IceTransportStalledDetector` | `ice-transport-stalled` | `iceTransportStalledDetector` |
| `UnstableIcePathDetector` | `unstable-ice-path` | `unstableIcePathDetector` |

**Transport Quality** — [full reference](./docs/TRANSPORT_QUALITY_DETECTORS.md)

| Detector | Raises | Config key |
|---|---|---|
| `BlockedInboundMediaDetector` | `blocked-inbound-media-transport` | `blockedInboundMediaDetector` |
| `BlockedOutboundMediaDetector` | `blocked-outbound-media-transport` | `blockedOutboundMediaDetector` |
| `BlockedStunRequestsDetector` | `blocked-stun-requests` | `blockedStunRequestsDetector` |
| `CongestionDetector` | `congestion` | `congestionDetector` |
| `DownlinkCongestionDetector` | `downlink-congestion` | `downlinkCongestionDetector` |
| `TransportDelayDetector` | `transport-delay-degraded` | `transportDelayDetector` |
| `TransportLossDetector` | `transport-loss-sustained` | `transportLossDetector` |
| `UplinkCongestionDetector` | `uplink-congestion` | `uplinkCongestionDetector` |

**Pipeline Disruption** — [full reference](./docs/PIPELINE_DISRUPTION_DETECTORS.md)

| Detector | Raises | Config key |
|---|---|---|
| `CaptureSourceLostDetector` | `capture-source-lost` | `captureSourceLostDetector` |
| `CpuPerformanceDetector` | `cpulimitation` | `cpuPerformanceDetector` |
| `DecoderBottleneckDetector` | `decoder-bottleneck` | `decoderBottleneckDetector` |
| `DecoderPerformanceDetector` | `video-decoder-overloaded` | `decoderPerformanceDetector` |
| `DryInboundTrackDetector` | `dry-inbound-track` | `dryInboundTrackDetector` |
| `DryOutboundTrackDetector` | `dry-outbound-track` | `dryOutboundTrackDetector` |
| `EncoderBottleneckDetector` | `encoder-bottleneck` | `encoderBottleneckDetector` |
| `FrameAssemblyStalledDetector` | `frame-assembly-stalled` | `frameAssemblyStalledDetector` |
| `PlayoutDiscrepancyDetector` | `inbound-video-playout-discrepancy` | `playoutDiscrepancyDetector` |
| `RtpSenderStalledDetector` | `rtp-sender-stalled` | `rtpSenderStalledDetector` |
| `SilentAudioSourceDetector` | `silent-audio-source` | `silentAudioSourceDetector` |
| `StuckDecoderDetector` | `stuck-decoder` | `stuckDecoderDetector` |
| `TransportDemuxStalledDetector` | `transport-demux-stalled` | `transportDemuxStalledDetector` |
| `VideoCaptureBottleneckDetector` | `video-capture-bottleneck` | `videoCaptureBottleneckDetector` |
| `VideoRecoveryFailedDetector` | `video-recovery-failed` | `videoRecoveryFailedDetector` |

**Perceived Quality** — [full reference](./docs/PERCEIVED_QUALITY_DETECTORS.md)

| Detector | Raises | Config key |
|---|---|---|
| `AVDesyncPlayoutDetector` | `av-desync` | `avDesyncPlayoutDetector` |
| `AudioPlayoutSynthesisDetector` | `synthesized-audio` | `audioPlayoutSynthesisDetector` |
| `InboundVideoFlowStateDetector` | `video-flow-disrupted` | `inboundVideoFlowStateDetector` |
| `InventedSpeechDetector` | `invented-speech` | `inventedSpeechDetector` |
| `JitterBufferStressDetector` | `audio-jitter-buffer-stress` | `jitterBufferStressDetector` |
| `PixelatedVideoDetector` | `pixelated-video` | `pixelatedVideoDetector` |

**Telemetry** — [full reference](./docs/TELEMETRY_DETECTORS.md)

| Detector | Raises | Config key |
|---|---|---|
| `CaptureTrackMutedDetector` | *(event only)* | `captureTrackMutedDetector` |
| `CodecChangeDetector` | *(event only)* | `codecChangeDetector` |
| `IceRestartDetector` | *(event only)* | `iceRestartDetector` |
| `IceRestartRecommendationDetector` | *(event only)* | `iceRestartRecommendationDetector` |
| `IceTraversalDetector` | *(event only)* | `iceTraversalDetector` |
| `SimulcastLayerDetector` | *(event only)* | `simulcastLayerDetector` |
| `StatsGapDetector` | *(event only)* | `statsGapDetector` |
| `VideoResolutionChangeDetector` | *(event only)* | `videoResolutionChangeDetector` |

Detectors are grouped above by **detection shape**, which is how the library
decides what belongs where; the reference docs group them by **subject**, which is
how you look one up from a symptom. [The taxonomy explains
why](./docs/DETECTOR_TAXONOMY.md) the two do not line up one-to-one.

## Score Calculation

Every monitor is scored 0.0–5.0, where 4.0 and above is good and 1.0 is bad.

**The score is a reading of the open issues, and nothing else.** Each monitor
starts at 5.0 and is reduced by the findings its own detectors raised. Nothing
re-derives a threshold from raw stats, so a fault is judged in one place and the
score can never disagree with the issue list an operator is looking at.

How a fault counts follows from its category, which `ISSUE_SCORING` decides per
issue type:

| Category | Effect | Why |
|---|---|---|
| Connectivity | Scores the connection **zero** | Nothing riding on an unusable path can be good |
| Pipeline disruption | **Caps** the score | Two stopped pipelines are not twice as stopped |
| Perceived quality | **Subtracts** from the track | Two quality faults really are worse than one |
| Transport quality | **Subtracts** from the connection | It already scales into every track riding on it |

```typescript
monitor.on('score', ({ clientScore, currentReasons }) => {
    ui.setCallQuality(clientScore);       // 0.0 - 5.0, undefined until it settles
    console.log('what cost the score:', currentReasons);
});
```

`ISSUE_SCORING` is exported and mutable — retuning what a fault costs is an edit to
a table, and `unscoredIssueTypes()` reports any issue type no rule covers.

> **[docs/SCORE_CALCULATIONS.md](./docs/SCORE_CALCULATIONS.md)** is the full
> reference — the weight of every issue type, the five-dimension client score, the
> smoothing window, and how a blocky picture is priced by the size it is shown at.

## Stats, Sampling and Adapters

`getStats()` is polled every `collectingPeriodInMs`, normalised toward the W3C
spec by a per-browser adapter, and folded into the monitor tree. Every
`samplingPeriodInMs` the accumulated state is turned into a `ClientSample` for a
server to consume.

```typescript
const monitor = new ClientMonitor({ collectingPeriodInMs: 2000, samplingPeriodInMs: 4000 });

monitor.on('sample-created', ({ clientSample }) => transport.send(clientSample));
```

Adapters normalise, monitors derive, detectors threshold. An adapter never invents
a measurement: where a browser reports nothing, the field stays absent and
whatever reads it says so.

> **[docs/STATS_PIPELINE.md](./docs/STATS_PIPELINE.md)** is the full reference —
> the collection loop, the monitor tree, every adapter's per-browser fixes, and the
> sampling format.

## Events and Issues

Two channels, on purpose.

**Issues** are conditions with a lifetime. One opens, stays open while it holds,
and resolves — `'issue'` and `'issue-resolved'` fire at those two moments, and
`clientMonitor.activeIssues` is what is open right now. Every issue carries a
typed payload; narrow on `issue.type` to reach it.

**Events** are notifications. They fire when something happens and carry no
lifetime — `'stats-collected'`, `'sample-created'`, `'ice-path-changed'`,
`'codec-changed'`.

```typescript
monitor.on('issue', (issue) => {
    if (issue.type === 'uplink-congestion') sender.capBitrate(issue.payload.availableOutgoingBitrate * 0.8);
});

monitor.on('issue-resolved', (issue) => {
    console.log(issue.type, 'lasted', issue.payload.durationInMs, 'ms');
});
```

Issues raised by detectors are buffered into the `ClientSample` so a server sees
the same findings. Set a detector's `includeIssueInSample = false` to keep it local.

> **[docs/EVENTS_AND_ISSUES.md](./docs/EVENTS_AND_ISSUES.md)** is the full
> reference — every event, every issue type with its raise and resolve conditions
> and payload type, the monitor-level event feeds, and custom issues.

## Derived Metrics

The monitors compute the facts; the detectors hold the opinions about them. Every
derived value is a property of the stats — a bitrate, a mean, a delta — and is
published whether or not any detector reads it.

```typescript
const pc = monitor.peerConnections[0];

pc.sendingBitrate;              // bps, summed over what is actually being sent
pc.avgRttInSec;                 // RTCP round trip where it exists, ICE otherwise
pc.avgInboundJitterInMs;        // mean over the streams that received packets
pc.statsClockTime;              // ms of observed stats time, the clock every window uses
```

Three conventions worth knowing: a value the browser did not report is
`undefined` rather than `0`; means exclude streams that carried nothing this tick
rather than counting them as healthy; and every duration is stats time.

> **[docs/DERIVED_METRICS.md](./docs/DERIVED_METRICS.md)** is the full reference —
> every derived field on every monitor, with what it is computed from.

## Schema Reference

### ClientSample

The main sample structure containing complete client state:

```typescript
type ClientSample = {
    timestamp: number;
    clientId?: string;
    callId?: string;
    score?: number;
    scoreReasons?: string;
    attachments?: Record<string, unknown>;
    peerConnections?: PeerConnectionSample[];
    clientEvents?: ClientEvent[];
    clientIssues?: ClientIssue[];
    clientMetaItems?: ClientMetaData[];
    extensionStats?: ExtensionStat[];
};
```

### PeerConnectionSample

Per-peer-connection statistics:

```typescript
type PeerConnectionSample = {
    peerConnectionId: string;
    score?: number;
    scoreReasons?: string;
    attachments?: Record<string, unknown>;
    inboundTracks?: InboundTrackSample[];
    outboundTracks?: OutboundTrackSample[];
    codecs?: CodecStats[];
    inboundRtps?: InboundRtpStats[];
    outboundRtps?: OutboundRtpStats[];
    remoteInboundRtps?: RemoteInboundRtpStats[];
    remoteOutboundRtps?: RemoteOutboundRtpStats[];
    mediaSources?: MediaSourceStats[];
    mediaPlayouts?: MediaPlayoutStats[];
    dataChannels?: DataChannelStats[];
    iceTransports?: IceTransportStats[];
    iceCandidates?: IceCandidateStats[];
    iceCandidatePairs?: IceCandidatePairStats[];
    certificates?: CertificateStats[];
};
```

### Stats Types

All stats types include standard WebRTC fields plus:

-   `timestamp`: When the stats were collected
-   `id`: Unique identifier
-   `attachments`: Additional data for sampling

**Key Stats Types:**

-   `InboundRtpStats`: Receiving stream statistics
-   `OutboundRtpStats`: Sending stream statistics
-   `IceCandidatePairStats`: ICE candidate pair information
-   `CodecStats`: Codec configuration
-   `MediaSourceStats`: Local media source stats

## Examples

> **[docs/EXAMPLES.md](./docs/EXAMPLES.md)** — end-to-end integrations, reacting to
> issues, adaptive bitrate, sending samples to a server, and custom detectors.

## Troubleshooting

### Common Issues

#### High Memory Usage

```javascript
// Limit stored scores history
monitor.scoreCalculator.constructor.lastNScoresMaxLength = 5;

// Disable unnecessary detectors at runtime — the flag lives on the detector
// instance, not on its config entry.
for (const pc of monitor.mappedPeerConnections.values()) {
    for (const track of pc.mappedInboundTracks.values()) {
        track.detectors.disable('av-desync-playout-detector');
    }
}

// Reduce collection frequency
monitor.setCollectingPeriod(5000);
```

#### Missing Statistics

```javascript
// Check if source is properly added
console.log("Peer connections:", monitor.peerConnections.length);

// Verify stats collection
monitor.on("stats-collected", ({ collectedStats }) => {
    console.log("Collected stats from PCs:", collectedStats.length);
});

// Check for adaptation issues
monitor.statsAdapters.add((stats) => {
    console.log("Raw stats count:", stats.length);
    return stats;
});
```

#### Browser Compatibility

```javascript
// Check browser support
if (!window.RTCPeerConnection) {
    console.error("WebRTC not supported");
}

// Handle browser-specific issues
monitor.on("stats-collected", ({ collectedStats }) => {
    if (collectedStats.length === 0) {
        console.warn("No stats collected - possible browser issue");
    }
});
```

### Debug Information

Enable full debug logging:

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const monitor = new ClientMonitor({
    logger: {
        trace: (...args) => console.trace(...args),
        debug: (...args) => console.debug(...args),
        info: (...args) => console.info(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
    },
});
```

### Performance Optimization

```javascript
// Optimize for large numbers of tracks
const monitor = new ClientMonitor({
    collectingPeriodInMs: 3000, // Reduce frequency
    samplingPeriodInMs: 10000, // Less frequent sampling

    // Never construct these detectors at all: `null`, not `{ disabled: true }`.
    // The config entry decides whether the class exists; `disabled` is a runtime
    // flag on the instance.
    cpuPerformanceDetector: null,
    avDesyncPlayoutDetector: null,
});

// Manual garbage collection
setInterval(() => {
    // Clear old data periodically
    monitor.scoreCalculator.totalReasons = {};
}, 60000);
```

## API Reference

### Types

```typescript
// Configuration
type ClientMonitorConfig = {
    /* one entry per detector, `<ClassName>Config | null`, plus the basics */
};

// Each detector's config type is exported alongside its class, declared in the
// detector's own file:
type StuckDecoderDetectorConfig = {
    /* ... */
};

// Core types
type ClientSample = {
    /* ... */
};
type ClientEvent = { type: string; payload?: any; timestamp: number };
type ClientIssue = { type: string; payload?: any; timestamp: number };

// Monitor types
class InboundTrackMonitor {
    /* ... */
}
class OutboundTrackMonitor {
    /* ... */
}
class PeerConnectionMonitor {
    /* ... */
}

// Detector interface
interface Detector {
    readonly name: string;
    disabled?: boolean;
    includeIssueInSample?: boolean;
    update(): void;
}
```

### Events

```typescript
interface ClientMonitorEvents {
    "sample-created": (sample: ClientSample) => void;
    "stats-collected": (data: {
        durationOfCollectingStatsInMs: number;
        collectedStats: [string, RTCStats[]][];
    }) => void;
    score: (data: { clientScore: number; currentReasons: Record<string, number> }) => void;
    issue: (issue: ClientIssue) => void;
    congestion: (data: CongestionEventPayload) => void;
    close: () => void;
    // ... detector-specific events
}
```

## FAQ

### Q: How often should I collect statistics?

**A**: The default 2-second interval (2000ms) works well for most applications. For real-time applications or debugging, you might use 1 second. For low-bandwidth situations, 5 seconds is acceptable.

### Q: What's the difference between collectingPeriod and samplingPeriod?

**A**:

-   `collectingPeriod`: How often to collect WebRTC stats from browser APIs
-   `samplingPeriod`: How often to create complete client samples (includes events, issues, metadata)

### Q: How do I reduce bandwidth usage?

**A**:

1. Increase sampling period
2. Use a delta codec (@observertc/samples-protobuf-codec or @observertc/samples-json-codec)
3. Filter samples before sending
4. Disable unnecessary detectors

### Q: Can I use this with React Native?

**A**: The library is designed for web browsers with WebRTC support. For React Native, you'd need WebRTC polyfills and may encounter platform-specific issues.

### Q: How do I handle multiple peer connections?

**A**: Just add each peer connection as a source:

```javascript
const pc1 = new RTCPeerConnection();
const pc2 = new RTCPeerConnection();

monitor.addSource(pc1);
monitor.addSource(pc2);
```

### Q: What happens when a peer connection is closed?

**A**: The monitor automatically cleans up associated resources and emits appropriate events. You don't need to manually remove closed connections.

### Q: How accurate are the quality scores?

**A**: Scores are based on standard WebRTC metrics and industry best practices. They provide good relative quality assessment but should be calibrated based on your specific use case and user feedback.

### Q: Can I customize which events are included in samples?

**A**: Yes, you can filter events before sampling or add custom logic in event handlers to control what gets included.

### Q: How do I monitor screen sharing vs camera streams differently?

**A**: Use the `attachments` property to tag tracks:

```javascript
// When adding a screen share track
trackMonitor.attachments = { mediaType: "screen-share" };
```

### Q: What's the performance impact of monitoring?

**A**: The library is designed to be lightweight. Typical overhead is <1% CPU usage. The main cost is the periodic `getStats()` calls, which is why the collection period is configurable.

## Reference documents

This README is the guide. The reference documents under `docs/` carry the depth,
and each one is written to be read on its own.

**By subject** — what you reach for from a symptom:

| Document | What it covers |
|---|---|
| [MONITOR_API.md](./docs/MONITOR_API.md) | The application-facing API: reaching a monitor, walking the stats graph, extension stats, custom issues, declared context |
| [DETECTORS.md](./docs/DETECTORS.md) | Every detector on tracks and media: audio, video, track activity, the send side, plus custom detectors and session replay |
| [CONNECTION_DETECTORS.md](./docs/CONNECTION_DETECTORS.md) | Every detector on a peer connection, its ICE transports and the client as a whole |
| [CONFIGURATION.md](./docs/CONFIGURATION.md) | Every config key and field, with defaults |
| [EVENTS_AND_ISSUES.md](./docs/EVENTS_AND_ISSUES.md) | Every event and issue type, with raise and resolve conditions and payload types |
| [DERIVED_METRICS.md](./docs/DERIVED_METRICS.md) | Every derived value on every monitor, and what it is computed from |
| [STATS_PIPELINE.md](./docs/STATS_PIPELINE.md) | The collection loop, the monitor tree, the per-browser adapters and the sampling format |
| [SCORE_CALCULATIONS.md](./docs/SCORE_CALCULATIONS.md) | Every score weight, the five-dimension client score, smoothing and tuning |
| [EXAMPLES.md](./docs/EXAMPLES.md) | End-to-end integrations and worked patterns |

**By detection shape** — how the library decides what belongs where:

| Document | What it covers |
|---|---|
| [DETECTOR_TAXONOMY.md](./docs/DETECTOR_TAXONOMY.md) | The five categories, the rules that sort a detector into one, and a complete index of all 46 classes |
| [CONNECTIVITY_DETECTORS.md](./docs/CONNECTIVITY_DETECTORS.md) | The layers a connection climbs, and the restart telemetry beside them |
| [TRANSPORT_QUALITY_DETECTORS.md](./docs/TRANSPORT_QUALITY_DETECTORS.md) | Capacity, delay and delivery on a path that already works |
| [PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md) | The send and receive media chains, and the boundary each detector watches |
| [PERCEIVED_QUALITY_DETECTORS.md](./docs/PERCEIVED_QUALITY_DETECTORS.md) | What the participant actually sees and hears, and the proxies used to judge it |
| [TELEMETRY_DETECTORS.md](./docs/TELEMETRY_DETECTORS.md) | The facts describing a session, and why none of them raises an issue |
| [DETECTOR_SANITY_CHECK.md](./docs/DETECTOR_SANITY_CHECK.md) | The working method behind the detector pass — how a detector is proposed, checked and tested |

## NPM Package

https://www.npmjs.com/package/@observertc/client-monitor-js

## Schemas

Schema definitions are available at https://github.com/observertc/schemas

## Getting Involved

Client-monitor is made with the intention to provide an open-source monitoring solution for WebRTC developers. If you are interested in getting involved, please read our [contribution guidelines](CONTRIBUTING.md).

## License

Apache-2.0
