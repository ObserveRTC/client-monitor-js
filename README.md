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
12. [Schema Reference](#schema-reference)
13. [Examples](#examples)
14. [Troubleshooting](#troubleshooting)
15. [API Reference](#api-reference)
16. [FAQ](#faq)

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

Customize logging behavior by providing your own logger:

```javascript
import { setLogger, Logger } from "@observertc/client-monitor-js";

const customLogger: Logger = {
    trace: (...args) => console.trace(...args),
    debug: (...args) => console.debug(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
};

setLogger(customLogger);
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

    // Detector configurations (all optional with defaults)
    audioDesyncDetector: {
        disabled: false,
        createIssue: true,
        fractionalCorrectionAlertOnThreshold: 0.1,
        fractionalCorrectionAlertOffThreshold: 0.05,
    },

    congestionDetector: {
        disabled: false,
        createIssue: true,
        sensitivity: "medium", // 'low', 'medium', 'high'
    },

    cpuPerformanceDetector: {
        disabled: false,
        createIssue: true,
        fpsVolatilityThresholds: {
            lowWatermark: 0.1,
            highWatermark: 0.3,
        },
        durationOfCollectingStatsThreshold: {
            lowWatermark: 5000,
            highWatermark: 10000,
        },
    },

    dryInboundTrackDetector: {
        disabled: false,
        createIssue: true,
        thresholdInMs: 5000,
    },

    dryOutboundTrackDetector: {
        disabled: false,
        createIssue: true,
        thresholdInMs: 5000,
    },

    videoFreezesDetector: {
        disabled: false,
        createIssue: true,
    },

    playoutDiscrepancyDetector: {
        disabled: false,
        createIssue: true,
        lowSkewThreshold: 2,
        highSkewThreshold: 5,
    },

    syntheticSamplesDetector: {
        disabled: false,
        createIssue: true,
        minSynthesizedSamplesDuration: 1000,
    },

    longPcConnectionEstablishmentDetector: {
        disabled: false,
        createIssue: true,
        thresholdInMs: 5000,
    },

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

#### Event Methods

-   **`addEvent(event: ClientEvent)`**: Adds a custom client event
-   **`addIssue(issue: ClientIssue)`**: Adds a custom client issue
-   **`addMetaData(metaData: ClientMetaData)`**: Adds metadata
-   **`addExtensionStats(stats: ExtensionStat)`**: Adds custom extension stats

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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
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
    disabled: false,
    createIssue: true,
    thresholdInMs: 5000,
}
```

### Custom Detectors

Create custom detectors by implementing the `Detector` interface:

```javascript
import { Detector } from "@observertc/client-monitor-js";

class CustomDetector implements Detector {
    public readonly name = 'custom-detector';

    constructor(private monitor: any) {}

    public update() {
        // Custom detection logic
        if (this.detectCustomCondition()) {
            this.monitor.parent.emit('custom-issue', {
                type: 'custom-issue',
                payload: { reason: 'Custom condition detected' }
            });
        }
    }

    private detectCustomCondition(): boolean {
        // Your detection logic here
        return false;
    }
}

// Add to monitor
const detector = new CustomDetector(someMonitor);
monitor.detectors.add(detector);

// Remove detector
monitor.detectors.remove(detector);
```

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

The monitor generates events for WebRTC state changes and issues for detected problems.

### Client Events

Automatically generated events include:

-   **PEER_CONNECTION_OPENED**: New peer connection
-   **PEER_CONNECTION_CLOSED**: Peer connection closed
-   **MEDIA_TRACK_ADDED**: New media track
-   **MEDIA_TRACK_REMOVED**: Media track ended
-   **ICE_CANDIDATE**: ICE candidate discovered
-   **NEGOTIATION_NEEDED**: SDP negotiation required

### Client Issues

Issues are generated by detectors:

-   **congestion**: Network congestion detected
-   **cpu-limitation**: CPU performance issues
-   **audio-desync**: Audio synchronization problems
-   **video-freeze**: Video track frozen
-   **dry-track**: Track not flowing data

### Custom Events and Issues

Add custom events and issues:

```javascript
// Custom event
monitor.addEvent({
    type: "user-action",
    payload: { action: "mute-audio" },
    timestamp: Date.now(),
});

// Custom issue
monitor.addIssue({
    type: "custom-problem",
    payload: { severity: "high", description: "Custom issue detected" },
    timestamp: Date.now(),
});
```

### Event Listeners

Listen for real-time events:

```javascript
// Sample created
monitor.on("sample-created", (sample) => {
    console.log("New sample:", sample);
});

// Issue detected
monitor.on("issue", (issue) => {
    console.log("Issue:", issue.type, issue.payload);
});

// Score updated
monitor.on("score", ({ clientScore, scoreReasons }) => {
    console.log("Score:", clientScore, "Reasons:", scoreReasons);
});

// Congestion detected
monitor.on("congestion", ({ peerConnectionMonitor, availableIncomingBitrate }) => {
    console.log("Congestion detected on PC:", peerConnectionMonitor.peerConnectionId);
});

// Stats collected
monitor.on("stats-collected", ({ durationOfCollectingStatsInMs, collectedStats }) => {
    console.log("Stats collection took:", durationOfCollectingStatsInMs, "ms");
});
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
        createIssue: true,
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
class NetworkLatencyDetector {
    name = "network-latency-detector";

    constructor(pcMonitor) {
        this.pcMonitor = pcMonitor;
        this.highLatencyThreshold = 200; // ms
    }

    update() {
        const rttMs = (this.pcMonitor.avgRttInSec || 0) * 1000;

        if (rttMs > this.highLatencyThreshold) {
            this.pcMonitor.parent.emit("high-latency", {
                peerConnectionId: this.pcMonitor.peerConnectionId,
                rttMs,
            });

            this.pcMonitor.parent.addIssue({
                type: "high-latency",
                payload: { rttMs, threshold: this.highLatencyThreshold },
            });
        }
    }
}

// Add to peer connection monitor
monitor.on("peer-connection-opened", ({ peerConnectionMonitor }) => {
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
        entry.textContent = `${new Date().toISOString()}: ${issue.type} - ${JSON.stringify(issue.payload)}`;
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

Enable debug logging:

```javascript
import { setLogger } from "@observertc/client-monitor-js";

setLogger({
    trace: console.trace,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
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
