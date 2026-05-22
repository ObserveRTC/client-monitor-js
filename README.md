# @observertc/client-monitor-js

**JavaScript library to monitor WebRTC applications**

@observertc/client-monitor-js is a client-side library to monitor [WebRTCStats](https://www.w3.org/TR/webrtc-stats/) and integrate your app with ObserveRTC components.

[![npm version](https://badge.fury.io/js/@observertc%2Fclient-monitor-js.svg)](https://badge.fury.io/js/@observertc%2Fclient-monitor-js)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Integrations](#integrations)
4. [Configuration](#configuration)
5. [ClientMonitor](#clientmonitor)
6. [Detectors](#detectors)
7. [Score Calculation](#score-calculation)
8. [Collecting and Adapting Stats](#collecting-and-adapting-stats)
9. [Sampling](#sampling)
10. [Events and Issues](#events-and-issues)
11. [WebRTC Stats Monitors](#webrtc-stats-monitors)
12. [Stats Adapters](#stats-adapters)
13. [Derived Metrics](#derived-metrics)
14. [Schema Reference](#schema-reference)
15. [Examples](#examples)
16. [Troubleshooting](#troubleshooting)
17. [API Reference](#api-reference)
18. [FAQ](#faq)

## Installation

```bash
npm install @observertc/client-monitor-js
```

or

```bash
yarn add @observertc/client-monitor-js
```

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

The `ClientMonitor` accepts a comprehensive configuration object. All configuration options are optional except when specifically noted:

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const monitor = new ClientMonitor({
    // Basic configuration (all optional)
    clientId: "unique-client-id",
    callId: "unique-call-id",
    collectingPeriodInMs: 2000, // Default: 2000ms
    samplingPeriodInMs: 4000, // Optional, no default

    // Integration settings (optional with defaults)
    integrateNavigatorMediaDevices: true, // Default: true
    addClientJointEventOnCreated: true, // Default: true
    addClientLeftEventOnClose: true, // Default: true
    bufferingEventsForSamples: false, // Default: false

    // Detector configurations (all optional).
    //
    //   • Omit the key (or pass `undefined`) → defaults applied.
    //   • Pass `null`                         → detector is NOT constructed at all.
    //   • Pass an object                      → detector enabled with your overrides.
    //
    // After construction, every built-in detector also exposes a public `disabled`
    // boolean flag — flip it at runtime to silence the detector without removing it.
    audioDesyncDetector: {
        fractionalCorrectionAlertOnThreshold: 0.1,
        fractionalCorrectionAlertOffThreshold: 0.05,
    },

    congestionDetector: {
        sensitivity: "medium", // 'low', 'medium', 'high'
    },

    cpuPerformanceDetector: {
        fpsVolatilityThresholds: {
            lowWatermark: 0.1,
            highWatermark: 0.3,
        },
        durationOfCollectingStatsThreshold: {
            lowWatermark: 5000,
            highWatermark: 10000,
        },
    },

    dryInboundTrackDetector: { thresholdInMs: 5000 },
    dryOutboundTrackDetector: { thresholdInMs: 5000 },
    videoFreezesDetector: {},
    playoutDiscrepancyDetector: {
        lowSkewThreshold: 2,
        highSkewThreshold: 5,
    },
    syntheticSamplesDetector: {
        minSynthesizedSamplesDuration: 1000,
    },
    longPcConnectionEstablishmentDetector: {
        thresholdInMs: 5000,
    },

    // To outright disable a detector at construction time, pass `null`:
    //   freezedVideoDetector: null,
    //   playoutDiscrepancyDetector: null,

    // Application data (optional)
    appData: {
        userId: "user-123",
        roomId: "room-456",
    },
});
```

**Important**: You can create a monitor with minimal configuration or even no configuration at all:

```javascript
// Minimal configuration
const monitor = new ClientMonitor({
    clientId: "my-client",
    collectingPeriodInMs: 1000,
});

// No configuration (uses all defaults)
const monitor = new ClientMonitor();
```

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

Detectors are specialized components that monitor for specific anomalies and issues in WebRTC connections. Each detector focuses on a particular aspect of the connection quality.

### Built-in Detectors

#### AudioDesyncDetector

Detects audio synchronization issues by monitoring sample corrections.

**Triggers on:**

-   Audio acceleration/deceleration corrections exceed thresholds
-   Indicates audio-video sync problems

**Configuration:**

```javascript
audioDesyncDetector: {
    fractionalCorrectionAlertOnThreshold: 0.1,  // 10% correction rate triggers alert
    fractionalCorrectionAlertOffThreshold: 0.05, // 5% correction rate clears alert
}
```

#### CongestionDetector

Monitors network congestion by analyzing available bandwidth vs. usage.

**Triggers on:**

-   Available bandwidth falls below sending/receiving bitrates
-   Network congestion conditions

**Configuration:**

```javascript
congestionDetector: {
    sensitivity: 'medium', // 'low', 'medium', 'high'
}
```

#### CpuPerformanceDetector

Detects CPU performance issues affecting media processing.

**Triggers on:**

-   FPS volatility exceeds thresholds
-   Stats collection takes too long (indicating CPU stress)

**Configuration:**

```javascript
cpuPerformanceDetector: {
    fpsVolatilityThresholds: {
        lowWatermark: 0.1,
        highWatermark: 0.3,
    },
    durationOfCollectingStatsThreshold: {
        lowWatermark: 5000,
        highWatermark: 10000,
    },
}
```

#### DryInboundTrackDetector

Detects inbound tracks that stop receiving data.

**Triggers on:**

-   Inbound track receives no data for specified duration
-   Track stalling or connection issues

**Configuration:**

```javascript
dryInboundTrackDetector: {
    thresholdInMs: 5000,
}
```

#### DryOutboundTrackDetector

Detects outbound tracks that stop sending data.

**Triggers on:**

-   Outbound track sends no data for specified duration
-   Local media issues or encoding problems

**Configuration:**

```javascript
dryOutboundTrackDetector: {
    thresholdInMs: 5000,
}
```

#### FreezedVideoTrackDetector

Detects frozen video tracks.

**Triggers on:**

-   Video frames stop updating
-   Video freeze conditions

**Configuration:**

```javascript
videoFreezesDetector: {
}
```

#### PlayoutDiscrepancyDetector

Detects discrepancies between received and rendered frames.

**Triggers on:**

-   Frame skew exceeds thresholds
-   Video playout buffer issues

**Configuration:**

```javascript
playoutDiscrepancyDetector: {
    lowSkewThreshold: 2,
    highSkewThreshold: 5,
}
```

#### SynthesizedSamplesDetector

Detects when audio playout synthesizes samples due to missing data.

**Triggers on:**

-   Synthesized audio samples exceed duration threshold
-   Audio gaps requiring interpolation

**Configuration:**

```javascript
syntheticSamplesDetector: {
    minSynthesizedSamplesDuration: 1000,
}
```

#### LongPcConnectionEstablishmentDetector

Detects slow peer connection establishment.

**Triggers on:**

-   Peer connection takes too long to establish
-   Connection setup issues

**Configuration:**

```javascript
longPcConnectionEstablishmentDetector: {
    thresholdInMs: 5000,
}
```

### Custom Detectors

Create custom detectors by implementing the `Detector` interface:

```typescript
import { Detector, ClientMonitor } from "@observertc/client-monitor-js";

class CustomDetector implements Detector {
    public readonly name = 'custom-detector';
    /** Optional kill-switch honored by both `Detectors.update()` and this method. */
    public disabled = false;

    constructor(private monitor: ClientMonitor) {}

    public update() {
        if (this.disabled) return;
        if (this.detectCustomCondition()) {
            this.monitor.raiseIssue('custom-detector-singleton', {
                type: 'custom-issue',
                payload: { reason: 'Custom condition detected' },
            });
        }
    }

    private detectCustomCondition(): boolean {
        // Your detection logic here
        return false;
    }
}

// Attach
const detector = new CustomDetector(monitor);
monitor.detectors.add(detector);

// Inspect
monitor.detectors.has('custom-detector');                 // true
monitor.detectors.getByName('custom-detector');           // the instance
monitor.detectors.listOfNames;                            // ['cpu-performance-detector', 'custom-detector', ...]

// Runtime toggle
monitor.detectors.disable('custom-detector');             // detector stays attached but its update() is skipped
monitor.detectors.enable('custom-detector');

// Detach
monitor.detectors.remove(detector);
```

See [Controlling which detectors run](#controlling-which-detectors-run) for the full set of registry helpers.

## Score Calculation

The scoring system provides quantitative quality assessment ranging from 0.0 (worst) to 5.0 (best). The library includes a `DefaultScoreCalculator` implementation and allows custom score calculators via the `ScoreCalculator` interface.

### ScoreCalculator Interface

```typescript
interface ScoreCalculator {
    update(): void;
    encodeClientScoreReasons?<T extends Record<string, number>>(reasons?: T): string;
    encodePeerConnectionScoreReasons?<T extends Record<string, number>>(reasons?: T): string;
    encodeInboundAudioScoreReasons?<T extends Record<string, number>>(reasons?: T): string;
    encodeInboundVideoScoreReasons?<T extends Record<string, number>>(reasons?: T): string;
    encodeOutboundAudioScoreReasons?<T extends Record<string, number>>(reasons?: T): string;
    encodeOutboundVideoScoreReasons?<T extends Record<string, number>>(reasons?: T): string;
}
```

### DefaultScoreCalculator Implementation

The default implementation calculates scores using a hierarchical weighted average approach:

#### Score Hierarchy

The client score is calculated as a weighted average of:

1. **Peer Connection Stability Scores** (based on RTT and packet loss)
2. **Track Quality Scores** (inbound/outbound audio/video tracks)

#### Client Score Calculation

```
Client Score = Σ(PC_Score × PC_Weight) / Σ(PC_Weight)

Where PC_Score = Track_Score_Avg × PC_Stability_Score
```

#### Peer Connection Stability Score

Based on Round Trip Time (RTT) and packet loss:

**RTT Penalties:**

-   High RTT (150-300ms): -1.0 point
-   Very High RTT (>300ms): -2.0 points

**Packet Loss Penalties:**

-   1-5% loss: -1.0 point
-   5-20% loss: -2.0 points
-   > 20% loss: -5.0 points

#### Track Score Calculations

**Inbound Audio Track Score:**

-   Based on normalized bitrate and packet loss
-   Uses logarithmic bitrate normalization
-   Exponential decay for packet loss impact

```javascript
normalizedBitrate = log10(max(bitrate, MIN_AUDIO_BITRATE) / MIN_AUDIO_BITRATE) / NORMALIZATION_FACTOR;
lossPenalty = exp(-packetLoss / 2);
score = min(MAX_SCORE, 5 * normalizedBitrate * lossPenalty);
```

**Inbound Video Track Score:**

-   FPS volatility penalties
-   Dropped frames penalties
-   Frame corruption penalties

**Outbound Audio Track Score:**

-   Similar to inbound, using sending bitrate
-   Remote packet loss consideration

**Outbound Video Track Score:**

-   Bitrate deviation from target penalties
-   CPU limitation penalties
-   Bitrate volatility penalties
-   If `track.contentHint === 'screen'`, bitrate deviation and volatility penalties are skipped to better fit screen-share traffic patterns

### Score Reasons

Each score calculation includes detailed reasons for penalties:

```javascript
monitor.on("score", (event) => {
    console.log("Client Score:", event.clientScore);
    console.log("Score Reasons:", event.scoreReasons);
    // Example reasons:
    // {
    //   "high-rtt": 1.0,
    //   "high-packetloss": 2.0,
    //   "cpu-limitation": 2.0,
    //   "dropped-video-frames": 1.0
    // }
});
```

### Custom Score Calculator

Implement your own scoring logic by implementing the `ScoreCalculator` interface:

```javascript
import { ScoreCalculator } from "@observertc/client-monitor-js";

class CustomScoreCalculator {
    constructor(clientMonitor) {
        this.clientMonitor = clientMonitor;
    }

    update() {
        // Calculate peer connection scores
        for (const pcMonitor of this.clientMonitor.peerConnections) {
            this.calculatePeerConnectionScore(pcMonitor);
        }

        // Calculate track scores
        for (const track of this.clientMonitor.tracks) {
            this.calculateTrackScore(track);
        }

        // Calculate final client score
        this.calculateClientScore();
    }

    calculatePeerConnectionScore(pcMonitor) {
        const rttMs = (pcMonitor.avgRttInSec ?? 0) * 1000;
        const fractionLost = pcMonitor.inboundRtps.reduce((acc, rtp) => acc + (rtp.fractionLost ?? 0), 0);

        let score = 5.0;
        const reasons = {};

        // Custom RTT penalties
        if (rttMs > 200) {
            score -= 1.5;
            reasons["custom-high-rtt"] = 1.5;
        }

        // Custom packet loss penalties
        if (fractionLost > 0.02) {
            score -= 2.0;
            reasons["custom-packet-loss"] = 2.0;
        }

        pcMonitor.calculatedStabilityScore.value = Math.max(0, score);
        pcMonitor.calculatedStabilityScore.reasons = reasons;
    }

    calculateTrackScore(trackMonitor) {
        let score = 5.0;
        const reasons = {};

        if (trackMonitor.direction === "inbound" && trackMonitor.kind === "video") {
            // Custom video quality scoring
            const fps = trackMonitor.ewmaFps ?? 0;
            if (fps < 15) {
                score -= 2.0;
                reasons["low-fps"] = 2.0;
            }
        }

        trackMonitor.calculatedScore.value = Math.max(0, score);
        trackMonitor.calculatedScore.reasons = reasons;
    }

    calculateClientScore() {
        let totalScore = 0;
        let totalWeight = 0;
        const combinedReasons = {};

        for (const pcMonitor of this.clientMonitor.peerConnections) {
            if (pcMonitor.calculatedStabilityScore.value !== undefined) {
                totalScore += pcMonitor.calculatedStabilityScore.value;
                totalWeight += 1;

                // Combine reasons
                Object.assign(combinedReasons, pcMonitor.calculatedStabilityScore.reasons || {});
            }
        }

        const clientScore = totalWeight > 0 ? totalScore / totalWeight : 5.0;
        this.clientMonitor.setScore(clientScore, combinedReasons);
    }

    // Optional: Custom encoding for reasons
    encodeClientScoreReasons(reasons) {
        return JSON.stringify(reasons || {});
    }
}

// Apply custom calculator
const monitor = new ClientMonitor();
monitor.scoreCalculator = new CustomScoreCalculator(monitor);
```

## Collecting and Adapting Stats

The monitor collects WebRTC statistics periodically and adapts them for consistent processing across different browsers and integrations.

### Stats Collection Process

1. **Collection Trigger**: Timer-based collection every `collectingPeriodInMs`
2. **Raw Stats Retrieval**: Calls `getStats()` on peer connections
3. **Stats Adaptation**: Applies browser-specific adaptations
4. **Monitor Updates**: Updates all relevant monitor objects
5. **Detector Updates**: Runs all attached detectors
6. **Score Calculation**: Updates performance scores

### Stats Adapters

Stats adapters handle browser-specific differences and integration requirements:

#### Browser Adaptations

-   **Firefox**: Handles track identifier format differences
-   **Chrome/Safari**: Handles various stats format variations
-   **Mediasoup**: Filters probator tracks and adapts mediasoup-specific stats

#### Custom Stats Adapters

Add custom adaptation logic:

```javascript
monitor.statsAdapters.add((stats) => {
    // Custom adaptation logic
    return stats.map((stat) => {
        if (stat.type === "inbound-rtp" && stat.trackIdentifier) {
            // Custom track identifier handling
            stat.trackIdentifier = stat.trackIdentifier.replace(/[{}]/g, "");
        }
        return stat;
    });
});
```

### Extension Stats Providers

Extension stats providers allow you to inject custom application-specific statistics into the monitoring pipeline. These providers are called during each stats collection cycle and can return either synchronous or asynchronous results.

**What are Extension Stats?**

Extension stats are custom key-value pairs that you define to track application-specific metrics alongside WebRTC statistics. They are included in every sample created by the monitor and allow you to correlate WebRTC quality metrics with your own application data.

**Adding Extension Stats Providers:**

```javascript
// Synchronous provider
monitor.extensionStatsProviders.add(() => ({
    type: "my-custom-metric",
    payload: {
        fps: currentFps,
        bandwidth: availableBandwidth,
        userEngagement: engagementScore,
    },
}));

// Asynchronous provider
monitor.extensionStatsProviders.add(async () => {
    const cpuUsage = await getCpuUsageMetrics();
    return {
        type: "system-metrics",
        payload: {
            cpu: cpuUsage,
            memory: performance.memory?.usedJSHeapSize || 0,
        },
    };
});
```

**Provider Characteristics:**

-   **Type**: Each provider must return an object with a `type` field (string identifier)
-   **Payload**: Optional custom data object containing your metrics
-   **Timing**: Providers are called during every stats collection cycle
-   **Async Support**: Providers can be async and return promises
-   **Error Handling**: Errors in providers are logged but don't stop the monitoring process

**Sample Integration:**

Extension stats are automatically included in every created sample:

```javascript
monitor.on("sample-created", (sample) => {
    // sample.extensionStats contains all extension stats
    // Example output:
    // [
    //   { type: "my-custom-metric", payload: { fps: 30, bandwidth: 5000, ... } },
    //   { type: "system-metrics", payload: { cpu: 45, memory: 52428800 } }
    // ]
    console.log("Extension stats:", sample.extensionStats);
});
```

### Available WebRTC Stats

The monitor collects and processes all standard WebRTC statistics:

#### RTP Statistics

-   **Inbound RTP**: Receiving stream statistics
-   **Outbound RTP**: Sending stream statistics
-   **Remote Inbound RTP**: Remote peer's receiving statistics
-   **Remote Outbound RTP**: Remote peer's sending statistics

#### Connection Statistics

-   **ICE Candidate**: ICE candidate information
-   **ICE Candidate Pair**: ICE candidate pair statistics
-   **ICE Transport**: ICE transport layer statistics
-   **Certificate**: Security certificate information

#### Media Statistics

-   **Codec**: Codec configuration and usage
-   **Media Source**: Local media source statistics
-   **Media Playout**: Audio playout statistics
-   **Data Channel**: Data channel statistics

## Sampling

Sampling creates periodic snapshots (`ClientSample`) containing the complete state of the monitored client.

### Sample Structure

A `ClientSample` includes:

-   **Client metadata**: clientId, callId, timestamp, score
-   **Peer connection samples**: All monitored peer connections
-   **Events**: Client events since last sample
-   **Issues**: Detected issues since last sample
-   **Extension stats**: Custom application statistics

### Automatic Sampling

Enable automatic sampling by setting `samplingPeriodInMs`:

```javascript
const monitor = new ClientMonitor({
    collectingPeriodInMs: 2000,
    samplingPeriodInMs: 4000, // Create sample every 4 seconds
});

monitor.on("sample-created", (sample) => {
    console.log("Sample created:", sample);
    // Send to analytics backend
    sendToAnalytics(sample);
});
```

### Manual Sampling

Create samples on demand:

```javascript
const monitor = new ClientMonitor({
    collectingPeriodInMs: 2000,
    bufferingEventsForSamples: true, // Required for manual sampling
});

// Create sample manually
const sample = monitor.createSample();
if (sample) {
    console.log("Manual sample:", sample);
}
```

### Sample Compression

For efficient data transmission and storage, ObserveRTC provides dedicated compression packages for `ClientSample` objects:

**@observertc/samples-encoder** - Compresses ClientSample objects for transmission:

```javascript
import { SamplesEncoder } from "@observertc/samples-encoder";

const encoder = new SamplesEncoder();
const sample = monitor.createSample();

// Encode the sample for efficient transmission
const encodedSample = encoder.encode(sample);

// Send compressed data over the network
fetch("/api/samples", {
    method: "POST",
    headers: {
        "Content-Type": "application/octet-stream",
    },
    body: encodedSample,
});
```

**@observertc/samples-decoder** - Decompresses received ClientSample objects:

```javascript
import { SamplesDecoder } from "@observertc/samples-decoder";

const decoder = new SamplesDecoder();

// Receive compressed sample data
const compressedData = await response.arrayBuffer();

// Decode back to ClientSample object
const decodedSample = decoder.decode(compressedData);

// Process the restored sample
console.log("Decoded sample:", decodedSample);
```

**Benefits of Using Compression:**

-   **Reduced Bandwidth**: Compressed samples require significantly less network bandwidth
-   **Faster Transmission**: Smaller payloads improve upload/download times
-   **Storage Efficiency**: Compressed samples consume less storage space
-   **Schema Consistency**: Ensures proper serialization/deserialization of all ClientSample fields

**Installation:**

```bash
# For encoding (client-side)
npm install @observertc/samples-encoder

# For decoding (server-side)
npm install @observertc/samples-decoder

# Both packages (if needed)
npm install @observertc/samples-encoder @observertc/samples-decoder
```

**Integration with ObserveRTC Stack:**
These compression packages are part of the broader ObserveRTC ecosystem and are designed to work seamlessly with:

-   Client Monitor (sample generation)
-   Observer Service (sample processing)
-   Schema definitions (data consistency)

The compression format maintains full compatibility with the ObserveRTC schema definitions and can be used with any transport mechanism (WebSocket, HTTP REST, etc.).

## Events and Issues

`ClientMonitor` emits two different categories of notification: **issues**, which describe a problem state, and **events**, which describe a thing that happened. The two have different lifecycles and different APIs — picking the right one for your use case is the key to keeping your alerting code sane.

### Issues vs Events at a glance

|  | Issue | Event |
|---|---|---|
| Represents | An ongoing or one-shot condition (network congestion, dry track, …) | A discrete thing that happened (peer joined, ICE candidate found, …) |
| Lifecycle | Can be **raised**, **updated**, **resolved** | Immutable record |
| Resolution | Yes (for the stateful flavor) | No |
| API | `addIssue` / `raiseIssue` / `resolveIssue` | `addEvent` |
| Sample buffer | `sample.clientIssues[]` | `sample.clientEvents[]` |
| Emitted events on `monitor.on(...)` | `'issue'`, `'issue-updated'`, `'issue-resolved'` | `'client-event'` |

The rest of this section drills into the issue lifecycle; events are a thin wrapper around `addEvent` and need no further explanation.

### Two flavors of issue

`ClientMonitor` distinguishes a **one-shot issue** (fire-and-forget) from a **raised issue** (stateful, resolvable). Pick the flavor that matches your situation:

| Flavor | Method | Has `key` | Enters `activeIssues` | Can be resolved | Typical use |
|---|---|---|---|---|---|
| One-shot | `addIssue({ type, payload?, timestamp? })` | no | no | no | A logged event-like incident with no "ended" condition — `USER_MEDIA_ERROR`, a one-off SDK warning, a one-time alert you want included in the next sample. |
| Stateful | `raiseIssue(key, { type, payload?, timestamp? })` | **yes (required)** | yes | yes (`resolveIssue(key, …)`) | Anything with a start and an end: congestion, CPU pressure, audio desync, video freeze, dry track. The detectors that ship with the library all use this flavor. |

You're always free to choose either. The library only insists that *if* you want to resolve later, you must have raised with a `key`.

### In-memory types

Both flavors share `type` and `payload`. The stateful flavor adds the identity (`key`) and timestamps:

```ts
type ClientIssuePayload = Record<string, unknown> | boolean | string | number;

// What addIssue produces.
type AddedClientIssue<T = ClientIssuePayload> = {
    type: string;
    payload?: T;
    timestamp: number;
};

// What raiseIssue produces.
type RaisedClientIssue<T = ClientIssuePayload> = {
    type: string;
    key: string;           // globally unique handle within this monitor
    payload?: T;
    raisedAt: number;
    updatedAt: number;     // bumped on every re-raise of the same key
};

// Discriminated union over the two flavors.
type ClientIssue<T = ClientIssuePayload> = AddedClientIssue<T> | RaisedClientIssue<T>;

// What 'issue-resolved' delivers.
type ResolvedClientIssue<T = ClientIssuePayload> = RaisedClientIssue<T> & {
    resolvedAt: number;
    comment?: string;
};
```

Narrow between the two by checking for `'key' in issue` — that's the discriminant.

> **Wire format**: `ClientSample.clientIssues[]` ships a stripped shape: `{ type, payload?: string (JSON-stringified), timestamp }`. The richer in-memory `id`-less, key-bearing object is a runtime concern; the server schema is unchanged.

### Lifecycle: the events you can listen to

```ts
monitor.on('issue',          (issue: ClientIssue)         => /* … */);  // raised or added
monitor.on('issue-updated',  (issue: RaisedClientIssue)   => /* … */);  // re-raise of an active key
monitor.on('issue-resolved', (issue: ResolvedClientIssue) => /* … */);
```

| Step | When it fires | What's delivered |
|---|---|---|
| `raiseIssue('x', { type: 't', payload: … })` for an **unknown** `x` | New stateful issue created and stored in `activeIssues` | `'issue'` event with the new `RaisedClientIssue` |
| `raiseIssue('x', …)` for an **already-active** `x` | Existing entry's payload + `updatedAt` are refreshed in place; no duplicate | `'issue-updated'` event |
| `addIssue({ type, payload })` | New one-shot issue created; **not** added to `activeIssues` | `'issue'` event |
| `resolveIssue('x', { comment?, payload?, resolvedAt? })` | Active entry removed from `activeIssues`; optional `payload` overwrites the stored one (used by detectors to add `durationInMs`) | `'issue-resolved'` event |
| `monitor.close()` | All still-active issues auto-resolve | `'issue-resolved'` for each, with `comment: 'monitor closed before issue could be resolved'` |

### Public API on `ClientMonitor`

```ts
// One-shot, never enters activeIssues, cannot be resolved.
addIssue<T>(input: { type: string; payload?: T; timestamp?: number }): AddedClientIssue<T> | undefined;

// Stateful: enters activeIssues under `key`. Re-raising with the same key updates in place.
raiseIssue<T>(key: string, input: { type: string; payload?: T; timestamp?: number }): RaisedClientIssue<T> | undefined;

// Resolves a stateful issue by key. `input.payload`, when provided, overwrites the stored payload
// — that's how built-in detectors enrich the resolved record with `durationInMs`.
resolveIssue<T>(key: string, input: { comment?: string; payload?: T; resolvedAt?: number }): ResolvedClientIssue | undefined;

// Snapshot helpers.
getActiveIssuesByType(type?: string): RaisedClientIssue[];
isIssueActive(key: string): boolean;

// Public Map<key, RaisedClientIssue> — readable, mutable but should not be touched directly.
readonly activeIssues: Map<string, RaisedClientIssue>;
```

### The built-in detector issues

The library ships seven detectors. Each one raises its own stateful issue with a typed payload, emits a detector-specific named event on entry, and resolves the issue when the condition clears — enriching the resolved payload with `durationInMs`.

| `type` | Raised when | Resolved when | Detector-specific event | Payload shape |
|---|---|---|---|---|
| `audio-desync` | Audio sample-correction fraction crosses the on-threshold | Correction fraction falls below the off-threshold | `'audio-desync-track'` | `AudioDesyncIssuePayload` |
| `congestion` | Per-PC bandwidth limitation + sensitivity-specific corroborator | Bandwidth limitation clears | `'congestion'` | `CongestionIssuePayload` |
| `cpulimitation` | CPU-tagged outbound RTP / stats-collection slowness / FPS volatility | Indicators normalize | `'cpulimitation'` | `CpuPerformanceIssuePayload` |
| `dry-inbound-track` | Inbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-inbound-track'` | `DryInboundTrackIssuePayload` |
| `dry-outbound-track` | Outbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-outbound-track'` | `DryOutboundTrackIssuePayload` |
| `freezed-video-track` | `freezeCount` increases | No new freezes for one tick | `'freezed-video-track'` | `FreezedVideoTrackIssuePayload` |
| `inbound-video-playout-discrepancy` | `framesReceived - framesRendered > highSkewThreshold` | Skew drops below `lowSkewThreshold` | `'inbound-video-playout-discrepancy'` | `PlayoutDiscrepancyIssuePayload` |

The per-detector payload types are exported from the package root. The resolved-side payload is always the raise-time payload plus `durationInMs` (and, for some, refreshed metrics).

### Type-safe handling: the `ClientMonitorIssue` discriminated union

Listeners on `'issue'` / `'issue-updated'` / `'issue-resolved'` receive the generic `ClientIssue` / `RaisedClientIssue` / `ResolvedClientIssue`. To get full payload typing for the built-in detector issues, cast to the discriminated unions exported from the package:

```ts
import {
    ClientMonitor,
    ClientMonitorIssue,
    ClientMonitorResolvedIssue,
    isClientMonitorIssue,
} from '@observertc/client-monitor-js';

const monitor = new ClientMonitor({ /* … */ });

monitor.on('issue', (issue) => {
    if (!isClientMonitorIssue(issue)) {
        // Custom / app-raised issue → handle as RaisedClientIssue<unknown>
        return;
    }

    switch (issue.type) {
        case 'congestion':
            // issue.payload is CongestionIssuePayload
            console.log('congestion on PC', issue.payload.peerConnectionId,
                'avail in', issue.payload.availableIncomingBitrate);
            break;

        case 'cpulimitation':
            // issue.payload is CpuPerformanceIssuePayload
            console.warn('cpu pressure');
            break;

        case 'audio-desync':
            // issue.payload is AudioDesyncIssuePayload
            console.log('audio desync on track', issue.payload.trackId);
            break;

        case 'freezed-video-track':
            console.log('freeze on track', issue.payload.trackId);
            break;

        case 'dry-inbound-track':
        case 'dry-outbound-track':
            console.log('dry track', issue.payload.trackId,
                'duration', issue.payload.duration);
            break;

        case 'inbound-video-playout-discrepancy':
            console.log('playout discrepancy on track', issue.payload.trackId,
                'skew', issue.payload.frameSkew);
            break;
    }
});

monitor.on('issue-resolved', (resolved) => {
    const own = resolved as ClientMonitorResolvedIssue;
    switch (own.type) {
        case 'audio-desync':
            console.log(`Audio desync on ${own.payload.trackId} lasted ${own.payload.durationInMs}ms`);
            break;
        case 'congestion':
            console.log(`Congestion on ${own.payload.peerConnectionId} lasted ${own.payload.durationInMs}ms`);
            break;
        // …
    }
});
```

Three helpers are available:

-   `ClientMonitorIssue` — discriminated union of every raised issue produced by the bundled detectors.
-   `ClientMonitorResolvedIssue` — same, for `'issue-resolved'`.
-   `isClientMonitorIssue(issue)` / `isClientMonitorResolvedIssue(issue)` — type guards that return `true` only for the seven built-in `type` values.

### Managing active stateful issues

```ts
// All active issues across all detectors:
const all = monitor.getActiveIssuesByType();

// Active issues of one type:
const congestionIssues = monitor.getActiveIssuesByType('congestion');
for (const issue of congestionIssues) {
    if (issue.payload?.availableIncomingBitrate < 200_000) {
        ui.showLowBandwidthWarning(issue.key);
    }
}

// Is a specific issue active?
if (monitor.isIssueActive('congestion-pc-pc-123')) { /* … */ }

// Iterate the raw map (advanced — prefer the helpers):
for (const [key, issue] of monitor.activeIssues) {
    console.log(key, issue.type, issue.payload);
}
```

### Raising your own custom issues

You can raise issues from app code or your own custom detector. Pick a `key` that's unique per logical incident — the detector convention is `${type}-${scope}` (e.g. `congestion-pc-${peerConnectionId}`, `audio-desync-track-${trackId}`).

```ts
// Start: a meeting-quality watchdog notices a participant's input mic is muted unexpectedly
monitor.raiseIssue(`unexpected-mute-${participantId}`, {
    type: 'unexpected-mute',
    payload: {
        participantId,
        sinceUtc: new Date().toISOString(),
    },
});

// Refresh while still ongoing (e.g. with updated metadata):
monitor.raiseIssue(`unexpected-mute-${participantId}`, {
    type: 'unexpected-mute',
    payload: {
        participantId,
        sinceUtc: knownStart,
        framesSpoken: 0,
    },
});
// → emits 'issue-updated', not 'issue'

// End: the participant unmuted, attach how long it lasted
monitor.resolveIssue(`unexpected-mute-${participantId}`, {
    comment: 'participant unmuted',
    payload: {
        participantId,
        sinceUtc: knownStart,
        durationInMs: Date.now() - mutedAtMs,
    },
    resolvedAt: Date.now(),
});
```

For a one-shot incident with no "ended" condition (a `getUserMedia` failure, a click-to-call timeout, …), use `addIssue`:

```ts
monitor.addIssue({
    type: 'USER_MEDIA_ERROR',
    payload: { error: `${err}` },
});
// Never enters activeIssues, can't be resolved, but is emitted as 'issue'
// and buffered into the next ClientSample.
```

### Custom detector example

A custom detector follows the same pattern the built-ins use: own a `key`, expose a `public disabled` flag, raise on entry, resolve on exit, enrich the resolved payload with duration.

```ts
import {
    Detector,
    ClientMonitor,
    InboundTrackMonitor,
} from '@observertc/client-monitor-js';

interface MicMutedIssuePayload {
    participantId: string;
    expected: boolean;
    durationInMs?: number;
}

class UnexpectedMicMuteDetector implements Detector {
    public readonly name = 'unexpected-mic-mute-detector';
    public disabled = false;

    private readonly issueKey: string;
    private _startedAt?: number;

    constructor(
        private readonly track: InboundTrackMonitor,
        private readonly participantId: string,
        private readonly clientMonitor: ClientMonitor,
    ) {
        this.issueKey = `unexpected-mic-mute-track-${track.track.id}`;
    }

    update() {
        if (this.disabled) return;

        const wantsAudio = !this.track.track.muted;
        const isReceivingAudio = (this.track.getInboundRtp()?.deltaBytesReceived ?? 0) > 0;
        const isMisbehaving = wantsAudio && !isReceivingAudio;

        if (isMisbehaving && !this.clientMonitor.isIssueActive(this.issueKey)) {
            this._startedAt = Date.now();
            this.clientMonitor.raiseIssue<MicMutedIssuePayload>(this.issueKey, {
                type: 'unexpected-mic-mute',
                payload: { participantId: this.participantId, expected: false },
            });
        } else if (!isMisbehaving && this.clientMonitor.isIssueActive(this.issueKey)) {
            const active = this.clientMonitor.activeIssues.get(this.issueKey);
            this.clientMonitor.resolveIssue<MicMutedIssuePayload>(this.issueKey, {
                comment: 'mic unmuted',
                payload: {
                    ...(active?.payload as MicMutedIssuePayload),
                    durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
                },
            });
            this._startedAt = undefined;
        }
    }
}
```

Three things to notice:

1. `disabled` is a public field — applications flip it at runtime to silence the detector.
2. `Detectors.update()` skips detectors with `disabled === true`, and the in-method `if (this.disabled) return;` makes direct invocations behave the same.
3. The detector is the source of truth for `_startedAt`; the resolved payload carries the duration so consumers don't have to track it themselves.

### Controlling which detectors run

Each detector entry in `ClientMonitorConfig` is now `Type | null`:

```ts
new ClientMonitor({
    // null → don't even construct this detector. No memory, no update() ticks.
    congestionDetector: null,

    // undefined / omitted → use defaults (this is the existing behavior).

    // Object → enable with overrides.
    audioDesyncDetector: {
        fractionalCorrectionAlertOnThreshold: 0.2,
        fractionalCorrectionAlertOffThreshold: 0.1,
    },
});
```

Already running and want to flip a detector on/off without restarting the monitor? Every built-in detector exposes a `public disabled = false` field, and every layer's `detectors` registry exposes ergonomic helpers for finding and toggling them.

`Detectors` (the registry attached as `monitor.detectors`, `peerConnectionMonitor.detectors`, `inboundTrackMonitor.detectors`, `outboundTrackMonitor.detectors`, `mediaPlayoutMonitor.detectors`) offers:

```ts
// Inspection
detectors.size;                         // number of attached detectors
detectors.listOfNames;                  // string[] of every detector.name
detectors.has(name);                    // is a detector with that name attached?
detectors.getByName(name);              // Detector | undefined
detectors.getByName<CpuPerformanceDetector>('cpu-performance-detector');
detectors.find(pred);                   // first match
detectors.filter(pred);                 // all matches
for (const d of detectors) { /* … */ }  // iterate

// Mutation
detectors.add(detector);                // append a custom detector
detectors.remove(detector);             // detach an instance
detectors.clear();                      // detach all

// Runtime toggle
detectors.disable(name);                // sets detector.disabled = true (returns true if found)
detectors.enable(name);                 // sets detector.disabled = false
detectors.isEnabled(name);              // attached AND not disabled
detectors.disableAll();                 // silence every attached detector
detectors.enableAll();                  // re-enable every attached detector
```

Common patterns:

```ts
// Kill one specific detector instance-wide.
monitor.detectors.disable('cpu-performance-detector');

// Silence congestion alerts across every existing PeerConnection.
for (const pc of monitor.mappedPeerConnections.values()) {
    pc.detectors.disable('congestion-detector');
}

// Toggle a track-level detector based on something the app knows.
inboundTrackMonitor.detectors.disable('freezed-video-track-detector');

// Suspend everything during a known-noisy state, then re-enable.
monitor.detectors.disableAll();
// …later
monitor.detectors.enableAll();

// Tweak the live config of a detector at runtime via getByName.
const cpu = monitor.detectors.getByName('cpu-performance-detector');
if (cpu) cpu.disabled = true;
```

If you want a detector outright gone (not just silenced), call `detectors.remove(instance)` — or skip its construction entirely at monitor creation time by passing `null` for its config field.

### Sample-channel behavior

Every `addIssue` and every `raiseIssue` adds an entry to the next `ClientSample.clientIssues[]`. **Re-raises do not add a new entry** — they emit `'issue-updated'` to live listeners but the sample buffer is unchanged. Resolutions are not currently included in the sample buffer (only in the realtime `'issue-resolved'` event). If you reconstruct state server-side from samples only, treat each `clientIssues` entry as "the issue started here" and apply your own correlation logic.

### Event listeners cheat-sheet

```ts
// Sample produced.
monitor.on('sample-created', ({ sample }) => { /* … */ });

// Issue lifecycle.
monitor.on('issue',          (issue)    => { /* new addIssue or new raiseIssue */ });
monitor.on('issue-updated',  (issue)    => { /* re-raise of an existing key */ });
monitor.on('issue-resolved', (resolved) => { /* resolveIssue or close() auto-resolve */ });

// Detector-specific events (these fire alongside 'issue', once per episode).
monitor.on('congestion',                          (e) => { /* … */ });
monitor.on('cpulimitation',                       (e) => { /* … */ });
monitor.on('audio-desync-track',                  (e) => { /* … */ });
monitor.on('freezed-video-track',                 (e) => { /* … */ });
monitor.on('dry-inbound-track',                   (e) => { /* … */ });
monitor.on('dry-outbound-track',                  (e) => { /* … */ });
monitor.on('inbound-video-playout-discrepancy',   (e) => { /* … */ });

// Score & stats lifecycle.
monitor.on('score',          ({ clientScore, currentReasons }) => { /* … */ });
monitor.on('stats-collected', ({ durationOfCollectingStatsInMs, collectedStats }) => { /* … */ });
```

## WebRTC Stats Monitors

The monitor creates specialized monitor objects for each WebRTC statistics type, providing navigation, derived fields, and lifecycle management.

### Monitor Hierarchy

```
ClientMonitor
├── PeerConnectionMonitor[]
│   ├── InboundRtpMonitor[]
│   ├── OutboundRtpMonitor[]
│   ├── RemoteInboundRtpMonitor[]
│   ├── RemoteOutboundRtpMonitor[]
│   ├── MediaSourceMonitor[]
│   ├── CodecMonitor[]
│   ├── IceTransportMonitor[]
│   ├── IceCandidateMonitor[]
│   ├── IceCandidatePairMonitor[]
│   ├── CertificateMonitor[]
│   ├── DataChannelMonitor[]
│   └── MediaPlayoutMonitor[]
├── InboundTrackMonitor[]
└── OutboundTrackMonitor[]
```

### Track Monitors

#### InboundTrackMonitor

Monitors incoming media tracks with attached detectors:

**Properties:**

-   `score`: Calculated quality score
-   `bitrate`: Receiving bitrate
-   `jitter`: Network jitter
-   `fractionLost`: Packet loss fraction
-   `dtxMode`: Discontinuous transmission mode
-   `detectors`: Attached detectors

**Detectors:**

-   AudioDesyncDetector (for audio tracks)
-   FreezedVideoTrackDetector (for video tracks)
-   DryInboundTrackDetector
-   PlayoutDiscrepancyDetector (for video tracks)

#### OutboundTrackMonitor

Monitors outgoing media tracks:

**Properties:**

-   `score`: Calculated quality score
-   `bitrate`: Aggregate sending bitrate
-   `sendingPacketRate`: Packet sending rate
-   `remoteReceivedPacketRate`: Remote receiving rate
-   `detectors`: Attached detectors

**Methods:**

-   `getHighestLayer()`: Gets highest bitrate layer
-   `getOutboundRtps()`: Gets all outbound RTP monitors

### RTP Monitors

#### InboundRtpMonitor

Extended inbound RTP statistics with derived fields:

**Derived Fields:**

-   `bitrate`: Calculated receiving bitrate
-   `packetRate`: Packet receiving rate
-   `deltaPacketsLost`: Packets lost since last collection
-   `deltaJitterBufferDelay`: Jitter buffer delay change
-   `ewmaFps`: Exponentially weighted moving average FPS

#### OutboundRtpMonitor

Extended outbound RTP statistics:

**Derived Fields:**

-   `bitrate`: Calculated sending bitrate
-   `payloadBitrate`: Payload-only bitrate
-   `packetRate`: Packet sending rate
-   `retransmissionRate`: Retransmission rate

**Navigation:**

-   `getRemoteInboundRtp()`: Navigate to corresponding remote stats
-   `getMediaSource()`: Navigate to media source

### Connection Monitors

#### IceCandidatePairMonitor

ICE candidate pair with derived metrics:

**Derived Fields:**

-   `availableIncomingBitrate`: Calculated available bandwidth
-   `availableOutgoingBitrate`: Calculated available bandwidth

#### IceTransportMonitor

ICE transport layer monitoring:

**Properties:**

-   `selectedCandidatePair`: Currently selected candidate pair
-   All standard ICE transport fields

### appData and attachments

Every monitor supports two types of additional data properties that serve different purposes:

**`attachments`** - Data shipped with ClientSample:

-   Included in the `ClientSample` when `createSample()` is called
-   Sent to your analytics backend/server
-   Used for server-side processing, analysis, and correlation
-   Survives the monitoring lifecycle and becomes part of the permanent sample data

**`appData`** - Application-specific data (not shipped):

-   Never included in `ClientSample` creation
-   Used exclusively for local application logic
-   Temporary data for runtime decisions and local processing
-   Does not consume bandwidth or storage in your analytics pipeline

```javascript
// Set application data (not shipped with samples)
trackMonitor.appData = {
    userId: "user-123",
    internalTrackId: "track-abc",
    localProcessingFlags: { enableProcessing: true },
};

// Set attachments (shipped with samples)
trackMonitor.attachments = {
    roomId: "room-456",
    participantRole: "presenter",
    mediaType: "screen-share",
    customMetrics: { quality: "high" },
};
```

Every monitor in the hierarchy supports both properties:

-   `ClientMonitor.attachments` / `ClientMonitor.appData`
-   `PeerConnectionMonitor.appData` (attachments set via tracks)
-   All track monitors: `InboundTrackMonitor`, `OutboundTrackMonitor`
-   All RTP monitors: `InboundRtpMonitor`, `OutboundRtpMonitor`, etc.
-   All connection monitors: `IceCandidatePairMonitor`, `IceTransportMonitor`, etc.

**Use Cases:**

_attachments_ for:

-   User/session identification for server-side analysis
-   Room/conference context for grouping samples
-   A/B testing flags for performance comparison
-   Custom quality metrics for specialized analysis

_appData_ for:

-   Local UI state management
-   Runtime feature toggles
-   Temporary computation results
-   Internal application routing information

## Stats Adapters

Stats adapters provide a powerful mechanism to customize how WebRTC statistics are processed before being consumed by monitors. They handle browser-specific differences and allow custom preprocessing logic.

### Built-in Adapters

The library includes several built-in adapters that are automatically applied based on browser detection:

#### Firefox Adapters

-   **Firefox94StatsAdapter**: Normalizes `mediaType` to `kind` field for RTP stats
-   **FirefoxTransportStatsAdapter**: Creates transport stats from ICE candidate pairs when native transport stats are missing

#### Browser-Specific Adaptations

Stats adapters are automatically added based on detected browser:

```javascript
// Automatically applied for Firefox
if (browser.name === "firefox") {
    pcMonitor.statsAdapters.add(new Firefox94StatsAdapter());
    pcMonitor.statsAdapters.add(new FirefoxTransportStatsAdapter());
}
```

### Custom Stats Adapters

Create custom adapters by implementing the `StatsAdapter` interface:

```javascript
import { StatsAdapter } from "@observertc/client-monitor-js";

class CustomStatsAdapter {
    name = "custom-stats-adapter";

    adapt(stats) {
        // Pre-processing: runs before monitor updates
        return stats.map((stat) => {
            if (stat.type === "inbound-rtp" && stat.trackIdentifier) {
                // Custom track identifier normalization
                stat.trackIdentifier = stat.trackIdentifier.replace(/[{}]/g, "");
            }

            if (stat.type === "outbound-rtp" && stat.mediaSourceId) {
                // Add custom metadata
                stat.customQualityFlag = this.calculateQualityFlag(stat);
            }

            return stat;
        });
    }

    postAdapt(stats) {
        // Post-processing: runs after initial monitor updates
        // Useful for cross-stat calculations
        const inboundStats = stats.filter((s) => s.type === "inbound-rtp");
        const outboundStats = stats.filter((s) => s.type === "outbound-rtp");

        // Add custom correlation stats
        if (inboundStats.length > 0 && outboundStats.length > 0) {
            stats.push({
                type: "custom-correlation",
                id: "correlation-metrics",
                timestamp: Date.now(),
                totalStreams: inboundStats.length + outboundStats.length,
                avgBitrate: this.calculateAvgBitrate(inboundStats, outboundStats),
            });
        }

        return stats;
    }

    calculateQualityFlag(stat) {
        // Custom quality assessment logic
        return stat.bitrate > 1000000 ? "high" : "standard";
    }

    calculateAvgBitrate(inbound, outbound) {
        // Custom correlation calculation
        const totalBitrate = [...inbound, ...outbound].reduce((sum, stat) => sum + (stat.bitrate || 0), 0);
        return totalBitrate / (inbound.length + outbound.length);
    }
}

// Add to peer connection monitor
const adapter = new CustomStatsAdapter();
pcMonitor.statsAdapters.add(adapter);

// Remove adapter
pcMonitor.statsAdapters.remove(adapter);
// or by name
pcMonitor.statsAdapters.remove("custom-stats-adapter");
```

### Adapter Processing Flow

Adapters are processed in a specific order during stats collection:

1. **Raw Stats Collection**: `getStats()` called on peer connection
2. **Pre-Adaptation**: `adapt()` method called on all adapters in order
3. **Monitor Updates**: Monitors process adapted stats and update derived fields
4. **Post-Adaptation**: `postAdapt()` method called for advanced cross-stat processing
5. **Final Processing**: Detectors run and scores calculated

### Advanced Adapter Examples

#### Mediasoup Probator Filter

```javascript
class MediasoupProbatorFilter {
    name = "mediasoup-probator-filter";

    adapt(stats) {
        // Filter out mediasoup probator tracks
        return stats.filter((stat) => {
            if (stat.type === "inbound-rtp" || stat.type === "outbound-rtp") {
                return stat.trackIdentifier !== "probator";
            }
            return true;
        });
    }
}
```

#### Bandwidth Estimation Adapter

```javascript
class BandwidthEstimationAdapter {
    name = "bandwidth-estimation-adapter";

    postAdapt(stats) {
        const candidatePairs = stats.filter((s) => s.type === "candidate-pair");
        const selectedPair = candidatePairs.find((p) => p.state === "succeeded");

        if (selectedPair && selectedPair.availableIncomingBitrate) {
            // Add custom bandwidth metrics
            stats.push({
                type: "custom-bandwidth",
                id: "bandwidth-estimation",
                timestamp: Date.now(),
                estimatedBandwidth: selectedPair.availableIncomingBitrate,
                bandwidthUtilization: this.calculateUtilization(stats, selectedPair),
            });
        }

        return stats;
    }

    calculateUtilization(stats, selectedPair) {
        const totalBitrate = stats
            .filter((s) => s.type === "inbound-rtp")
            .reduce((sum, s) => sum + (s.bitrate || 0), 0);
        return totalBitrate / selectedPair.availableIncomingBitrate;
    }
}
```

## Derived Metrics

The library automatically calculates numerous derived metrics from raw WebRTC statistics, providing enhanced insights into connection quality and performance. These metrics are computed during stats processing and are available on monitor objects.

### Client-Level Derived Metrics

Available on `ClientMonitor`:

```javascript
const monitor = new ClientMonitor();

// Aggregated bitrates across all peer connections
console.log(monitor.sendingAudioBitrate); // Total audio sending bitrate (bps)
console.log(monitor.sendingVideoBitrate); // Total video sending bitrate (bps)
console.log(monitor.receivingAudioBitrate); // Total audio receiving bitrate (bps)
console.log(monitor.receivingVideoBitrate); // Total video receiving bitrate (bps)

// Network capacity metrics
console.log(monitor.totalAvailableIncomingBitrate); // Available bandwidth for receiving
console.log(monitor.totalAvailableOutgoingBitrate); // Available bandwidth for sending

// Connection quality
console.log(monitor.avgRttInSec); // Average RTT across connections (seconds)
console.log(monitor.score); // Calculated quality score (0.0-5.0)
console.log(monitor.durationOfCollectingStatsInMs); // Time to collect stats (performance indicator)
```

### Peer Connection Derived Metrics

Available on `PeerConnectionMonitor`:

```javascript
const pcMonitor = /* get from monitor.peerConnections */;

// Bitrate metrics by media type
console.log(pcMonitor.sendingAudioBitrate);    // Audio sending bitrate (bps)
console.log(pcMonitor.sendingVideoBitrate);    // Video sending bitrate (bps)
console.log(pcMonitor.receivingAudioBitrate);  // Audio receiving bitrate (bps)
console.log(pcMonitor.receivingVideoBitrate);  // Video receiving bitrate (bps)

// Packet loss rates
console.log(pcMonitor.outboundFractionLost);   // Outbound packet loss fraction
console.log(pcMonitor.inboundFractionalLost);  // Inbound packet loss fraction

// Delta metrics (change since last collection)
console.log(pcMonitor.deltaInboundPacketsLost);     // Packets lost in period
console.log(pcMonitor.deltaInboundPacketsReceived); // Packets received in period
console.log(pcMonitor.deltaOutboundPacketsSent);    // Packets sent in period
console.log(pcMonitor.deltaAudioBytesSent);         // Audio bytes sent in period
console.log(pcMonitor.deltaVideoBytesSent);         // Video bytes sent in period
console.log(pcMonitor.deltaDataChannelBytesSent);   // Data channel bytes sent

// Connection timing and RTT
console.log(pcMonitor.avgRttInSec);            // Current average RTT (seconds)
console.log(pcMonitor.ewmaRttInSec);           // EWMA smoothed RTT (seconds)
console.log(pcMonitor.connectingStartedAt);    // Connection start timestamp
console.log(pcMonitor.connectedAt);            // Connection established timestamp

// Network topology detection
console.log(pcMonitor.usingTURN);              // Boolean: using TURN relay
console.log(pcMonitor.usingTCP);               // Boolean: using TCP transport
console.log(pcMonitor.iceState);               // ICE connection state

// Historical peaks
console.log(pcMonitor.highestSeenSendingBitrate);           // Peak sending bitrate seen
console.log(pcMonitor.highestSeenReceivingBitrate);         // Peak receiving bitrate seen
console.log(pcMonitor.highestSeenAvailableIncomingBitrate); // Peak available incoming
console.log(pcMonitor.highestSeenAvailableOutgoingBitrate); // Peak available outgoing
```

### Track-Level Derived Metrics

#### Inbound Track Metrics

Available on `InboundTrackMonitor`:

```javascript
const inboundTrack = /* get from monitor.tracks */;

console.log(inboundTrack.bitrate);              // Receiving bitrate (bps)
console.log(inboundTrack.jitter);               // Network jitter (seconds)
console.log(inboundTrack.fractionLost);         // Packet loss fraction
console.log(inboundTrack.score);                // Track quality score (0.0-5.0)
```

#### Outbound Track Metrics

Available on `OutboundTrackMonitor`:

```javascript
const outboundTrack = /* get from monitor.tracks */;

console.log(outboundTrack.bitrate);                    // Sending bitrate (bps)
console.log(outboundTrack.sendingPacketRate);          // Packets sent per second
console.log(outboundTrack.remoteReceivedPacketRate);   // Remote packets received per second
console.log(outboundTrack.jitter);                     // Remote reported jitter
console.log(outboundTrack.fractionLost);               // Remote reported packet loss
console.log(outboundTrack.score);                      // Track quality score (0.0-5.0)
```

### RTP-Level Derived Metrics

#### Inbound RTP Metrics

Available on `InboundRtpMonitor`:

```javascript
const inboundRtp = /* get from pcMonitor.mappedInboundRtpMonitors */;

// Bitrate and packet metrics
console.log(inboundRtp.bitrate);                // Calculated receiving bitrate (bps)
console.log(inboundRtp.packetRate);             // Packets received per second
console.log(inboundRtp.fractionLost);           // Calculated packet loss fraction
console.log(inboundRtp.bitPerPixel);            // Video: bits per pixel efficiency

// Video-specific derived metrics
console.log(inboundRtp.avgFramesPerSec);        // Average FPS over recent samples
console.log(inboundRtp.ewmaFps);                // EWMA smoothed FPS
console.log(inboundRtp.fpsVolatility);          // FPS stability (lower is better)
console.log(inboundRtp.isFreezed);              // Boolean: video appears frozen

// Audio-specific metrics
console.log(inboundRtp.receivingAudioSamples);  // Audio samples received in period
console.log(inboundRtp.desync);                 // Boolean: audio desync detected

// Delta metrics (change since last collection)
console.log(inboundRtp.deltaPacketsLost);           // Packets lost in period
console.log(inboundRtp.deltaPacketsReceived);       // Packets received in period
console.log(inboundRtp.deltaBytesReceived);         // Bytes received in period
console.log(inboundRtp.deltaJitterBufferDelay);     // Jitter buffer delay change
console.log(inboundRtp.deltaFramesDecoded);         // Video frames decoded in period
console.log(inboundRtp.deltaFramesReceived);        // Video frames received in period
console.log(inboundRtp.deltaFramesRendered);        // Video frames rendered in period
console.log(inboundRtp.deltaCorruptionProbability); // Frame corruption change
console.log(inboundRtp.deltaTime);                  // Elapsed time for calculations (ms)
```

#### Outbound RTP Metrics

Available on `OutboundRtpMonitor`:

```javascript
const outboundRtp = /* get from pcMonitor.mappedOutboundRtpMonitors */;

// Bitrate metrics
console.log(outboundRtp.bitrate);               // Total sending bitrate (bps)
console.log(outboundRtp.payloadBitrate);        // Payload-only bitrate (excluding headers/retransmissions)
console.log(outboundRtp.packetRate);            // Packets sent per second
console.log(outboundRtp.bitPerPixel);           // Video: bits per pixel efficiency

// Delta metrics
console.log(outboundRtp.deltaPacketsSent);      // Packets sent in period
console.log(outboundRtp.deltaBytesSent);        // Bytes sent in period
```

#### Remote RTP Metrics

**Remote Inbound RTP** (remote peer's receiving stats):

```javascript
const remoteInboundRtp = /* get from pcMonitor.mappedRemoteInboundRtpMonitors */;

console.log(remoteInboundRtp.packetRate);       // Remote receiving packet rate
console.log(remoteInboundRtp.deltaPacketsLost); // Remote packets lost in period
```

**Remote Outbound RTP** (remote peer's sending stats):

```javascript
const remoteOutboundRtp = /* get from pcMonitor.mappedRemoteOutboundRtpMonitors */;

console.log(remoteOutboundRtp.bitrate);         // Remote sending bitrate
```

### ICE Transport Derived Metrics

Available on `IceTransportMonitor` and `IceCandidatePairMonitor`:

```javascript
const iceTransport = /* get from pcMonitor.mappedIceTransportMonitors */;

// Transport-level bitrates
console.log(iceTransport.sendingBitrate);       // Transport sending bitrate
console.log(iceTransport.receivingBitrate);     // Transport receiving bitrate

// Delta metrics
console.log(iceTransport.deltaPacketsSent);     // Packets sent in period
console.log(iceTransport.deltaPacketsReceived); // Packets received in period
console.log(iceTransport.deltaBytesSent);       // Bytes sent in period
console.log(iceTransport.deltaBytesReceived);   // Bytes received in period

// ICE candidate pair specific
const candidatePair = /* get from pcMonitor.mappedIceCandidatePairMonitors */;
console.log(candidatePair.availableIncomingBitrate); // Bandwidth estimation for receiving
console.log(candidatePair.availableOutgoingBitrate); // Bandwidth estimation for sending
```

### Data Channel Derived Metrics

Available on `DataChannelMonitor`:

```javascript
const dataChannel = /* get from pcMonitor.mappedDataChannelMonitors */;

console.log(dataChannel.deltaBytesSent);        // Bytes sent in period
console.log(dataChannel.deltaBytesReceived);    // Bytes received in period
```

### Media Source and Playout Metrics

**Media Source derived metrics** (local media):

```javascript
const mediaSource = /* get from pcMonitor.mappedMediaSourceMonitors */;
// Media source stats are mostly raw WebRTC stats
// Derived metrics are primarily calculated at RTP level
```

**Media Playout derived metrics** (audio playout):

```javascript
const mediaPlayout = /* get from pcMonitor.mappedMediaPlayoutMonitors */;

console.log(mediaPlayout.deltaSynthesizedSamplesDuration); // Synthesized audio duration in period
console.log(mediaPlayout.deltaSamplesDuration);            // Total samples duration in period
```

### Accessing Derived Metrics

```javascript
// Access derived metrics through monitor hierarchy
monitor.on("stats-collected", () => {
    // Client-level aggregates
    console.log("Total sending bitrate:", monitor.sendingAudioBitrate + monitor.sendingVideoBitrate);

    // Per-connection metrics
    monitor.peerConnections.forEach((pc) => {
        console.log(`PC ${pc.peerConnectionId} RTT:`, pc.avgRttInSec * 1000, "ms");

        // Per-track metrics
        pc.mappedInboundTracks.forEach((track) => {
            if (track.kind === "video") {
                const inboundRtp = track.getInboundRtp();
                console.log(`Video FPS: ${inboundRtp?.ewmaFps}, Volatility: ${inboundRtp?.fpsVolatility}`);
            }
        });
    });
});

// Manual access to specific metrics
const videoTrack = monitor.tracks.find((t) => t.kind === "video" && t.direction === "inbound");
if (videoTrack) {
    const rtp = videoTrack.getInboundRtp();
    console.log("Video quality metrics:", {
        bitrate: rtp.bitrate,
        fps: rtp.ewmaFps,
        volatility: rtp.fpsVolatility,
        packetLoss: rtp.fractionLost,
    });
}
```

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

### Basic Monitoring Setup

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const monitor = new ClientMonitor({
    clientId: "client-123",
    callId: "call-456",
    collectingPeriodInMs: 2000,
    samplingPeriodInMs: 5000,
});

// Add peer connection
const pc = new RTCPeerConnection();
monitor.addSource(pc);

// Handle samples
monitor.on("sample-created", (sample) => {
    // Send to analytics
    fetch("/analytics", {
        method: "POST",
        body: JSON.stringify(sample),
        headers: { "Content-Type": "application/json" },
    });
});

// Handle issues
monitor.on("issue", (issue) => {
    console.warn("Issue detected:", issue.type, issue.payload);
});
```

### Advanced Configuration

```javascript
const monitor = new ClientMonitor({
    clientId: "advanced-client",
    collectingPeriodInMs: 1000,
    samplingPeriodInMs: 3000,

    // Sensitive congestion detection
    congestionDetector: {
        sensitivity: "high",
    },

    // Strict CPU monitoring
    cpuPerformanceDetector: {
        fpsVolatilityThresholds: {
            lowWatermark: 0.05,
            highWatermark: 0.2,
        },
        durationOfCollectingStatsThreshold: {
            lowWatermark: 3000,
            highWatermark: 6000,
        },
    },

    // Quick dry track detection
    dryInboundTrackDetector: {
        thresholdInMs: 3000,
    },

    appData: {
        version: "1.0.0",
        feature: "screen-share",
    },
});
```

### Mediasoup Integration

```javascript
import mediasoup from "mediasoup-client";

const device = new mediasoup.Device();
const monitor = new ClientMonitor({
    clientId: "mediasoup-client",
});

// Load device capabilities
await device.load({ routerRtpCapabilities });

// Add device for monitoring
monitor.addSource(device);

// Create transport
const sendTransport = device.createSendTransport({
    // transport options
});

// The monitor automatically detects the new transport
// For existing transports, add manually:
// monitor.addSource(sendTransport);

// Produce media
const producer = await sendTransport.produce({
    track: videoTrack,
    codecOptions: {},
});

// Track is automatically monitored
```

### Custom Detector

```javascript
// A custom detector following the new lifecycle: stateful issue keyed by the PC,
// auto-resolve when latency recovers, payload enriched with durationInMs on close.
class NetworkLatencyDetector {
    name = "network-latency-detector";
    // Public runtime kill-switch — apps may flip this without removing the detector.
    disabled = false;

    constructor(pcMonitor) {
        this.pcMonitor = pcMonitor;
        this.highLatencyThreshold = 0.2; // 200ms in seconds, matching avgRttInSec
        this.lowLatencyThreshold = 0.1; // 100ms hysteresis floor
        this.issueKey = `high-latency-pc-${pcMonitor.peerConnectionId}`;
        this._startedAt = undefined;
    }

    update() {
        if (this.disabled) return;

        const rtt = this.pcMonitor.avgRttInSec ?? 0;
        const monitor = this.pcMonitor.parent;
        const isActive = monitor.isIssueActive(this.issueKey);

        if (!isActive && rtt > this.highLatencyThreshold) {
            this._startedAt = Date.now();
            monitor.raiseIssue(this.issueKey, {
                type: "high-latency",
                payload: {
                    peerConnectionId: this.pcMonitor.peerConnectionId,
                    rttInSec: rtt,
                    threshold: this.highLatencyThreshold,
                },
            });
        } else if (isActive && rtt < this.lowLatencyThreshold) {
            const active = monitor.activeIssues.get(this.issueKey);
            monitor.resolveIssue(this.issueKey, {
                comment: "latency recovered",
                payload: {
                    ...active?.payload,
                    durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
                },
            });
            this._startedAt = undefined;
        }
    }
}

// Attach the detector when each PeerConnection is added.
monitor.on("new-peerconnnection-monitor", ({ peerConnectionMonitor }) => {
    const detector = new NetworkLatencyDetector(peerConnectionMonitor);
    peerConnectionMonitor.detectors.add(detector);
});
```

### Real-time Monitoring Dashboard

```javascript
class MonitoringDashboard {
    constructor(monitor) {
        this.monitor = monitor;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.monitor.on("score", ({ clientScore, scoreReasons }) => {
            this.updateScoreDisplay(clientScore, scoreReasons);
        });

        this.monitor.on("congestion", ({ availableIncomingBitrate, availableOutgoingBitrate }) => {
            this.showCongestionAlert(availableIncomingBitrate, availableOutgoingBitrate);
        });

        this.monitor.on("stats-collected", ({ durationOfCollectingStatsInMs }) => {
            this.updatePerformanceMetrics(durationOfCollectingStatsInMs);
        });

        this.monitor.on("issue", (issue) => {
            this.addIssueToLog(issue);
        });

        this.monitor.on("issue-resolved", (resolved) => {
            this.addResolvedIssueToLog(resolved);
        });
    }

    updateScoreDisplay(score, reasons) {
        document.getElementById("score").textContent = score.toFixed(1);
        document.getElementById("score-reasons").textContent = JSON.stringify(reasons, null, 2);
    }

    showCongestionAlert(incoming, outgoing) {
        const alert = document.createElement("div");
        alert.className = "congestion-alert";
        alert.textContent = `Congestion detected! Available: ${incoming}/${outgoing} kbps`;
        document.body.appendChild(alert);
    }

    updatePerformanceMetrics(duration) {
        document.getElementById("collection-time").textContent = `${duration}ms`;
    }

    addIssueToLog(issue) {
        const log = document.getElementById("issue-log");
        const entry = document.createElement("div");
        entry.dataset.issueKey = "key" in issue ? issue.key : "";
        entry.textContent = `${new Date(issue.timestamp ?? issue.raisedAt).toISOString()} OPEN  ${issue.type} ${JSON.stringify(issue.payload ?? {})}`;
        log.appendChild(entry);
    }

    addResolvedIssueToLog(resolved) {
        const log = document.getElementById("issue-log");
        const entry = document.createElement("div");
        entry.textContent =
            `${new Date(resolved.resolvedAt).toISOString()} CLOSE ${resolved.type} ` +
            `${resolved.comment ?? ""} duration=${resolved.payload?.durationInMs ?? "?"}ms`;
        log.appendChild(entry);
    }
}

// Initialize dashboard
const dashboard = new MonitoringDashboard(monitor);
```

## Troubleshooting

### Common Issues

#### High Memory Usage

```javascript
// Limit stored scores history
monitor.scoreCalculator.constructor.lastNScoresMaxLength = 5;

// Disable unnecessary detectors
monitor.config.audioDesyncDetector.disabled = true;

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

    // Disable resource-intensive detectors
    cpuPerformanceDetector: { disabled: true },
    audioDesyncDetector: { disabled: true },
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
    score: (data: { clientScore: number; scoreReasons?: Record<string, number> }) => void;
    issue: (issue: ClientIssue) => void;
    congestion: (data: CongestionEvent) => void;
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
2. Use sample compression (@observertc/samples-encoder)
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

## NPM Package

https://www.npmjs.com/package/@observertc/client-monitor-js

## Schemas

Schema definitions are available at https://github.com/observertc/schemas

## Getting Involved

Client-monitor is made with the intention to provide an open-source monitoring solution for WebRTC developers. If you are interested in getting involved, please read our [contribution guidelines](CONTRIBUTING.md).

## License

Apache-2.0
