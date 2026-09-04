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

The `ClientMonitor` accepts a comprehensive configuration object. All configuration options are optional except when specifically noted:

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const monitor = new ClientMonitor({
    // Basic configuration (all optional)
    clientId: "unique-client-id",
    callId: "unique-call-id",
    collectingPeriodInMs: 2000, // Default: 2000ms
    samplingPeriodInMs: 4000, // Default: 8000ms

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
    // One block per detector, keyed by the detector's own `name` in camelCase:
    // `frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector` and
    // nothing else. No key is shared and no detector reads a neighbour's block,
    // so any detector can be tuned or switched off on its own. Where two
    // detectors want the same tunable they each carry their own copy with its
    // own default — deliberately, so tuning one never retunes the other.
    //
    // The seven keys retired in 4.10.0 are listed under
    // "Detector config keys that changed" below; there is no alias for any of
    // them. After construction, every built-in detector also exposes a public
    // `disabled` boolean flag — flip it at runtime to silence the detector
    // without removing it.
    //
    // The blocks below are in the same order as `ClientMonitorConfig`, grouped
    // by detector category. Every value shown is the built-in default.

    // ── Connectivity ──────────────────────────────────────────────
    iceReachabilityDetector: {
        thresholdInMs: 6000,          // grace for `new`/`connecting` with zero local candidates
    },
    // Telemetry, and nothing to tune: `{}` enables, `null` disables.
    iceTraversalDetector: {},
    icePathEstablishmentDetector: {
        thresholdInMs: 5000,          // how long `connecting` may last before it is reported
        createEvent: true,            // also buffer LONG_PC_CONNECTION_ESTABLISHMENT into samples
    },
    iceEstablishmentFailedDetector: {
        // The other half of layer 3: establishment that demonstrably did not work.
        // Well past icePathEstablishmentDetector.thresholdInMs — a connection that
        // is merely slow has to be given time to stop being merely slow.
        thresholdInMs: 15000,
    },
    // `dtlsState: 'failed'` is terminal, so there is no threshold: `{}` / `null`.
    dtlsHandshakeFailedDetector: {},
    dtlsHandshakeStalledDetector: {
        stalledThresholdInMs: 6000,   // ICE healthy but DTLS still `new`/`connecting` for this long
    },
    iceDisconnectedDetector: {
        disconnectedThresholdInMs: 5000, // how long `disconnected` may self-heal
    },
    // ICE never self-heals from `failed`, so there is nothing to tune here either.
    iceConnectionFailedDetector: {},
    iceTransportStalledDetector: {
        transportStallThresholdInMs: 5000, // sending but receiving nothing for this long
    },
    unstableIcePathDetector: {
        pathSwitchWindowInMs: 30000,  // window for counting selected-path switches
        pathSwitchThreshold: 3,       // switches in that window => unstable path
    },
    iceRestartDetector: {
        createEvent: true,            // also buffer ICE_RESTART into samples
    },
    // All four recommendation conditions live here, thresholds and cooldowns
    // included. They are its own rather than borrowed from the detectors that
    // raise the corresponding issues, so disabling those does not silence the
    // recommendation — and it is normal to want the advice to wait longer than
    // the issue did.
    iceRestartRecommendationDetector: {
        createEvent: true,            // also buffer ICE_RESTART_RECOMMENDED into samples
        iceRestartRecommendationThresholdInMs: 10000, // per transport: disconnected / stalled
        iceRestartRecommendationCooldownInMs: 15000,  // min gap between those recommendations
        restartRecommendationThresholdInMs: 10000,    // per pc: never established at all
        restartRecommendationCooldownInMs: 15000,     // min gap between those recommendations
    },

    // ── Transport Quality ── properties of a path that already works. Round
    //    starting points, meant to be tuned against a real fleet.
    uplinkCongestionDetector: {
        headroomDropRatio: 0.25,      // (available - sending) dropping this far below its average
        sendDelayGrowthRatio: 3,      // pacer queue over its own EWMA baseline
    },                                // (no recovery ratio: it resolves on the browser's verdict)
    downlinkCongestionDetector: {
        collapseRatio: 0.6,           // arriving bitrate below this share of its rolling max
        bufferElevationRatio: 2,      // video jitter buffer delay over its own baseline
    },                                // (no recoveryRatio: it resolves on the browser's verdict)
    transportDelayDetector: {
        thresholdInMs: 300,           // smoothed RTT at or above which the path counts as slow
        recoveryThresholdInMs: 200,   // RTT below which it resolves (hysteresis)
        durationInMs: 6000,           // stats time it must stay high before raising
    },
    transportLossDetector: {
        threshold: 0.05,              // mean interval loss fraction (0..1), worse direction wins
        recoveryThreshold: 0.01,
        durationInMs: 6000,
    },
    blockedTransportDetector: {
        thresholdInMs: 5000,          // how long the STUN-ok-but-media-blocked discrepancy must persist
        maxSendShare: 0.1,            // transport send below this share of produced => not leaving
        stunFreshnessInMs: 10000,     // how recent a STUN response must be to count as verified
    },
    transportJitterDetector: {
        thresholdInMs: 100,           // mean inter-arrival jitter
        recoveryThresholdInMs: 30,
        durationInMs: 6000,
    },

    // ── Pipeline Disruption ── the send chain ──────────────────────────
    captureTrackEndedDetector: {
        createEvent: true,            // also buffer CAPTURE_TRACK_ENDED into samples
    },
    silentAudioSourceDetector: {
        silenceThresholdInMs: 60000,  // long on purpose: silence != a broken mic
        silenceRmsThreshold: 0.0001,  // interval-integrated RMS, not the flickery audioLevel
    },
    // Frame supply: is whatever produces this track's frames delivering what it
    // should? Average over a duration, compare, judge.
    sourceCaptureBottleneckDetector: {
        durationInMs: 15000,           // average the capture device over this long ...
        captureFpsRatioThreshold: 0.9, // ... then require 90% of the configured fps
    },
    encoderPerformanceDetector: {
        encodeFpsRatioThreshold: 0.7,  // encoder below 70% of source fps = behind
        encodeTimeBudgetRatio: 0.8,    // encode time per frame vs the frame budget
        cpuLimitationShareThreshold: null, // null = ignore the browser's CPU-limited signal
        minConsecutiveTicks: 2,        // two reads agreeing, not a span of time
        // Its own field, starting at the same value as
        // sourceCaptureBottleneckDetector.captureFpsRatioThreshold and free to move
        // independently: this one decides when the encoder is excused, that one
        // decides when the camera is blamed.
        sourceSupplyRatioThreshold: 0.9,
    },
    rtpSenderStalledDetector: {
        thresholdInMs: 4000,          // frames encoding while no packet leaves, in stats time
    },
    dryOutboundTrackDetector: { thresholdInMs: 5000 },

    // ── Pipeline Disruption ── the receive chain ──────────────────────
    transportDemuxStalledDetector: {
        thresholdInMs: 4000,                  // its own copy, not shared with the sender detector
        minTransportReceiveBitrateBps: 20000, // above this, incoming transport traffic must demux
    },
    dryInboundTrackDetector: { thresholdInMs: 5000 },
    frameAssemblyStalledDetector: {
        thresholdInMs: 3000,          // packets arriving with no frame completed, in stats time
        minPacketsReceived: 20,       // below this it is a trickle, not a stall
    },
    decoderBottleneckDetector: {
        durationInMs: 15000,           // average the decoder over this long ...
        decodeFpsRatioThreshold: 0.9,  // ... then require 90% of what arrived
        minReceivedFps: 5,             // too thin a stream to judge a decoder on
    },
    decoderPerformanceDetector: {
        decodeTimeBudgetRatio: 0.8,  // share of the per-frame budget decoding may use
        dropRatioThreshold: 0.1,
        minFramesReceived: 10,
        quietLossThreshold: 0.02,    // above this, blame the network instead
        minConsecutiveTicks: 2,
    },
    stuckDecoderDetector: {
        thresholdInMs: 4000,   // floor; effective wait = max(this, rttMultiplier x RTT)
        rttMultiplier: 15,     // high-RTT paths get more time to recover legitimately
        minBitrate: 10000,     // bps below which this is a dry track, not a wedge
        minPliCount: 2,
    },
    playoutDiscrepancyDetector: {
        lowSkewRatio: 0.1,
        highSkewRatio: 0.25,
        minFramesReceived: 10,
    },

    // ── Pipeline Disruption ── the repair loop, and the machine ────────────
    keyframeStormDetector: {
        windowInMs: 30000,
        pliRateAlertOn: 0.5,         // real-world storms run ~0.5-0.7 PLI/s sustained
        pliRateAlertOff: 0.15,
    },
    videoRecoveryFailedDetector: {
        recoveryFailedThresholdInMs: 5000, // stalled with PLIs out for this long
        recoveryFailedMinPliCount: 2,      // proof we actually asked for repair
    },
    cpuPerformanceDetector: {
        incomingDecodedFramesRatioThresholds: {
            alertOn: 0.7,
            alertOff: 0.85,
            minReceivedFrames: 10,
            frameArrivalBurstFactor: 2.5, // ~2.5x the smoothed arrival rate reads as a burst
        },
        durationOfCollectingStatsThreshold: {
            lowWatermark: 5000,
            highWatermark: 10000,
        },
        encoderCpuLimitationShareThreshold: 0.3, // share of the interval spent CPU-limited
        encodeTimeBudgetRatio: 0.8,              // share of the per-frame budget encoding may use
    },

    // ── Perceived Quality ─────────────────────────────────────
    pixelatedVideoDetector: {
        threshold: 0.03,              // bits/pixel at or below which the picture is coarse
        recoveryThreshold: 0.05,      // above this it resolves
        durationInMs: 8000,
    },
    choppyVideoDetector: {
        minFramesPerSecond: 10,       // smoothed fps below this is too slow
        maxFpsVolatility: 0.2,        // volatility above this is too erratic
        durationInMs: 8000,
    },
    frozenVideoTrackDetector: {
        minConsecutiveTicks: 2,       // consecutive frozen intervals before an issue
    },
    inventedSpeechDetector: {
        allowedInventedRatio: 0.05,  // RFC 7294 calls a second above 5% concealment severely concealed
        raiseAfterInventedMs: 400,   // invention beyond the allowance before the issue opens
    },
    audioPlayoutSynthesisDetector: {
        minSynthesizedSamplesDuration: 0, // synthesized audio per interval before reporting
        createEvent: true,                // also buffer EXCESSIVE_SYNTHESIZED_AUDIO into samples
    },
    avDesyncPlayoutDetector: {
        // Asymmetric on purpose: audio ahead of the picture is far more
        // objectionable than audio behind it (ITU-R BT.1359-1).
        audioAheadRaiseInMs: 90,     // audio ahead by this much raises
        audioAheadResolveInMs: 45,   // …and resolves back below this
        audioBehindRaiseInMs: 185,   // magnitudes, for audio lagging the picture
        audioBehindResolveInMs: 125,
        sustainForInMs: 3000,        // stats time past the threshold before raising
    },
    jitterBufferStressDetector: {
        targetDelayThresholdInMs: 200,
        timeStretchThreshold: 0.02,
        minConsecutiveTicks: 2,
    },

    // ── Telemetry ── these emit events and never raise issues ───────────────
    captureTrackMutedDetector: { createEvent: true },
    codecChangeDetector: { createEvent: true },
    videoResolutionChangeDetector: { createEvent: true },
    simulcastLayerDetector: { createEvent: true },
    statsGapDetector: {
        gapRatioThreshold: 2, // multiple of collectingPeriodInMs that counts as a gap
        minGapInMs: 5000,     // a single missed short tick is jitter, not a gap
        createEvent: true,
    },

    // To outright disable a detector at construction time, pass `null`. Because
    // every detector has a key of its own, that removes exactly one detector:
    //   frozenVideoTrackDetector: null,
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

Detectors turn the collected stats into *verdicts*. Each one watches a specific failure mode and reports through up to three channels: **stateful issues** (raised when the condition starts, resolved when it clears — with the full lifecycle shipped to the server, see [Sample-channel behavior](#sample-channel-behavior)), **monitor events** (realtime, for the application to act on), and **client events** (buffered into samples for server-side correlation).

Configuration follows one convention everywhere: omit a detector's config key to get defaults, pass `null` to not construct it at all, or flip the instance's `disabled` flag at runtime to silence it without removing it (see [Controlling which detectors run](#controlling-which-detectors-run)).

> **This section gets you started and then hands off.** Every detector belongs to one of five categories, and each category has a deep reference carrying the algorithm, the thresholds, the stand-downs, the false positives and what each detector refuses to claim. The map of the categories, the rules that decide which one a detector lands in, and a complete index of all 45 classes — class, `name` string, issue type, layer and config key — are in [docs/DETECTOR_TAXONOMY.md](./docs/DETECTOR_TAXONOMY.md).
>
> | Category | Question it answers | Deep reference |
> |---|---|---|
> | Connectivity | Can this endpoint establish and keep the path? | [docs/CONNECTIVITY_DETECTORS.md](./docs/CONNECTIVITY_DETECTORS.md) |
> | Transport Quality | The path exists — is it carrying traffic well enough? | [docs/TRANSPORT_QUALITY_DETECTORS.md](./docs/TRANSPORT_QUALITY_DETECTORS.md) |
> | Pipeline Disruption | Did the media chain stop, or do two components disagree? | [docs/PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md) |
> | Perceived Quality | Is what the user sees and hears degraded? | [docs/PERCEIVED_QUALITY_DETECTORS.md](./docs/PERCEIVED_QUALITY_DETECTORS.md) |
> | Telemetry | What is this session's shape, and what changed about it? | [docs/TELEMETRY_DETECTORS.md](./docs/TELEMETRY_DETECTORS.md) |
>
> The groupings below are by **subject** — audio, video, send side, connection — which is how you look a detector up when you have a symptom. The categories are by **detection shape**, which is how the library decides what belongs where. The two do not line up one-to-one, and [the taxonomy explains why](./docs/DETECTOR_TAXONOMY.md#category-is-not-subject).

### Detector overview

| Detector | Watches | Reports | Good for |
|---|---|---|---|
| [`InventedSpeechDetector`](#inventedspeechdetector) | inbound audio | issue `invented-speech` | How the audio actually *sounded* — catches degradation packet loss numbers miss |
| [`JitterBufferStressDetector`](#jitterbufferstressdetector) | inbound audio | issue `audio-jitter-buffer-stress` | The jitter buffer adding latency *and* stretching audio — delay the user hears |
| [`AVDesyncPlayoutDetector`](#avdesyncdetector) | inbound audio + its linked video | issue `av-desync` | Lip sync: the two tracks of one participant playing out at different points in the sender's timeline |
| [`AudioPlayoutSynthesisDetector`](#audioplayoutsynthesisdetector) | audio playout | event `synthesized-audio` | The playout device injecting synthesized audio |
| [`FrozenVideoTrackDetector`](#frozenvideotrackdetector) | inbound video | issue `frozen-video-track` | The picture stopped moving, with no claim about why |
| [`KeyframeStormDetector`](#keyframestormdetector--videorecoveryfaileddetector) | inbound video | issue `keyframe-storm` | Keyframes requested far faster than any healthy stream needs — a self-reinforcing repair loop |
| [`VideoRecoveryFailedDetector`](#keyframestormdetector--videorecoveryfaileddetector) | inbound video | issue `video-recovery-failed` | We asked for a keyframe repeatedly and nothing came back |
| [`PixelatedVideoDetector`](#pixelatedvideodetector--choppyvideodetector) | inbound video | issue `pixelated-video` | Too few bits per pixel for too long — the picture the viewer calls blocky |
| [`ChoppyVideoDetector`](#pixelatedvideodetector--choppyvideodetector) | inbound video | issue `video-choppy` | Frame rate consistently too low, or erratic enough to read as stutter |
| [`DecoderPerformanceDetector`](#decoderperformancedetector) | inbound video | issue `video-decoder-overloaded` | Frames arrived but this device cannot decode them in time |
| [`FrameAssemblyStalledDetector`](#frameassemblystalleddetector) | inbound video | issue `frame-assembly-stalled` | Packets keep arriving and no complete frame is ever assembled from them |
| [`StuckDecoderDetector`](#stuckdecoderdetector) | inbound video | issue `stuck-decoder` | RTP flowing, nothing decoding — the wedge only recreating the consumer fixes |
| [`PlayoutDiscrepancyDetector`](#playoutdiscrepancydetector) | inbound video | issue `inbound-video-playout-discrepancy` | Frames received but not rendered — a rendering pipeline backlog |
| [`DryInboundTrackDetector` / `DryOutboundTrackDetector`](#dryinboundtrackdetector--dryoutboundtrackdetector) | tracks | issues `dry-inbound-track`, `dry-outbound-track` | A track that should be flowing but carries no bytes at all |
| [`SourceCaptureBottleneckDetector`](#sourcecapturebottleneckdetector) | outbound video | issue `capture-bottleneck` | The camera is not delivering the frames it was configured for — caught *while it degrades*, not once it has stopped |
| [`EncoderPerformanceDetector`](#encoderperformancedetector) | outbound video | issue `encoder-bottleneck` | The camera is delivering and the encoder cannot keep up with it |
| [`DecoderBottleneckDetector`](#decoderbottleneckdetector) | inbound video | issue `decoder-bottleneck` | Frames arrived and the decoder did not turn enough of them into pictures |
| [`CaptureTrackEndedDetector`](#capture-detectors) | outbound tracks | issue `capture-track-ended` | The capture device went away — unplugged, quit, stopped from the browser bar |
| [`SilentAudioSourceDetector`](#capture-detectors) | outbound audio | issue `silent-audio-source` | A live, unmuted microphone producing nothing but digital silence |
| [`CaptureTrackMutedDetector`](#capture-detectors) | outbound tracks | event `capture-track-muted` / `CAPTURE_TRACK_MUTED` | The OS or another application took the device — a timestamp, not a fault |
| [`UplinkCongestionDetector`](#uplinkcongestiondetector) | peer connection | issue `uplink-congestion` | The outgoing bandwidth estimate collapsing while we still want it |
| [`DownlinkCongestionDetector`](#downlinkcongestiondetector) | peer connection | issue `downlink-congestion` | Arriving bitrate collapsing with the video jitter buffer deepening |
| [`TransportDelayDetector`](#transport-quality-detectors) | peer connection | issue `transport-delay-degraded` | A working path whose round trip is long enough, for long enough, to break turn-taking |
| [`TransportLossDetector`](#transport-quality-detectors) | peer connection | issue `transport-loss-sustained` | A path persistently dropping a material share of what crosses it |
| [`TransportJitterDetector`](#transport-quality-detectors) | peer connection | issue `transport-delivery-unstable` | Packets arrive, but unevenly enough to force the receiver to buffer |
| [`CpuPerformanceDetector`](#cpuperformancedetector) | whole client | issue `cpulimitation` | The device running out of CPU for encode/decode |
| [`IcePathEstablishmentDetector`](#icepathestablishmentdetector) | peer connection | event `ice-path-establishment-slow` | Connection setup taking suspiciously long, and where it is stuck |
| [`IceEstablishmentFailedDetector`](#iceestablishmentfaileddetector) | peer connection | issue `ice-establishment-failed` | The call never connected: candidates existed, nothing was ever nominated |
| [`IceDisconnectedDetector`](#the-layer-5-detectors) | ICE transports | issue `ice-disconnected` | A working path went `disconnected` and stayed there past the threshold |
| [`IceConnectionFailedDetector`](#the-layer-5-detectors) | ICE transports | issue `ice-connection-failed` | The browser gave up on the ICE generation — with `everConnected` saying which fault it is |
| [`IceTransportStalledDetector`](#the-layer-5-detectors) | ICE transports | issue `ice-transport-stalled` | Still sending on a connected path, nothing coming back |
| [`UnstableIcePathDetector`](#the-layer-5-detectors) | ICE transports | issue `unstable-ice-path` | The selected path will not settle |
| [`IceRestartDetector`](#the-restart-loop) | ICE transports | event `ice-restart` / `ICE_RESTART` | A new ICE generation was inferred, and whether it recovered or failed |
| [`IceRestartRecommendationDetector`](#the-restart-loop) | ICE transports | event `ice-restart-recommended` / `ICE_RESTART_RECOMMENDED` | *When* an ICE restart is warranted — your app decides whether to perform one |
| [`BlockedTransportDetector`](#blockedtransportdetector) | ICE transports | issue `blocked-transport` | STUN passes but media does not — the firewall / policy-middlebox signature |
| [`RtpSenderStalledDetector`](#rtpsenderstalleddetector--transportdemuxstalleddetector) | peer connection | issue `rtp-sender-stalled` | Frames encode and no packet leaves the sender |
| [`TransportDemuxStalledDetector`](#rtpsenderstalleddetector--transportdemuxstalleddetector) | peer connection | issue `transport-demux-stalled` | Traffic arrives on the transport and no inbound RTP accounts for it |
| [`DtlsHandshakeFailedDetector`](#the-dtls-detectors) | ICE transports | issue `dtls-handshake-failed` | `dtlsState: 'failed'` — terminal for this key exchange |
| [`DtlsHandshakeStalledDetector`](#the-dtls-detectors) | ICE transports | issue `dtls-handshake-stalled` | ICE proven healthy while DTLS never answers at all |
| [`IceReachabilityDetector`](#icereachabilitydetector) | peer connection | issue `no-available-ice-candidate` | Zero local ICE candidates while the connection falls over — no usable network at all |
| [`IceTraversalDetector`](#icetraversaldetector) | ICE transports | event `ice-tuple-changed` | The low-level signal that the selected network tuple changed |
| [`CodecChangeDetector`](#observation-detectors) | tracks | event `codec-changed` / `CODEC_CHANGED` | Which codec/profile is actually in use, and when it changed |
| [`VideoResolutionChangeDetector`](#observation-detectors) | video tracks | event `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | The adaptation ladder, with the *reason* attached |
| [`SimulcastLayerDetector`](#observation-detectors) | outbound video | event `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Which simulcast layers are actually being sent |
| [`StatsGapDetector`](#observation-detectors) | the monitor itself | event `stats-collection-gap` / `STATS_COLLECTION_GAP` | Backgrounded-tab gaps that would otherwise read as network spikes |

45 classes, 35 issue types, and 10 that emit events only — because what they
report is not a fault but the missing context in most investigations.

### One detector, one issue

**Every class in the table above raises at most one issue type.** A detector that
would raise two different issues is two detectors, and each keeps at most one
collection — one map, set or array — for the thing it tracks. That is why the
table is long: `IcePathStabilityDetector` became six classes,
`DtlsHandshakeDetector` two, `CaptureFailureDetector` three,
`MediaPipelineDetector` two, and the freeze/repair trio three.

The reasons are practical. `Detectors.update()` wraps each `update()` in its own
try/catch, so a class owning four findings loses all four to one malformed stats
report while four classes lose one. `disabled` and `includeIssueInSample` are per
detector, so a class owning four findings can only be silenced as a block. And a
single class holding four conditions accumulates shared state that couples them.

**And every class reads a config block of its own**, keyed by its `name` in
camelCase — `frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector`
and nothing else. That is the config counterpart of the same rule: a key shared by
six classes means a `null` meant to silence one finding takes five neighbours with
it, and a threshold read out of a neighbour's block means tuning that detector
silently retunes this one. Where two detectors genuinely want the same tunable,
each carries its own copy with its own default.

**No issue type was renamed by any of this.** The issue type is the public
contract that dashboards and `observer-js` consume; the class is an
implementation unit. What did change is the detector `name` strings passed to
`detectors.disable()`, and the config keys — every detector now reads a block
named after itself, so the group keys that used to construct several classes are
retired. Both mappings are in
[Controlling which detectors run](#controlling-which-detectors-run), and note that
a split name or key can only ever have resolved to one of its parts.

Two more rules hold across every implementation, and both are visible in the
sections below. **Implementations stay deliberately simple** — there is no
shared base class or threshold helper, and duplicated straightforward bookkeeping
is preferred to an abstraction that would need a parameter per caller. **Derived
values are computed on the monitored object; detectors only compare them against
thresholds** — `bitPerPixel`, `ewmaFps`, `fpsVolatility`, `avgInboundFractionLost`,
`avgOutboundFractionLost`, `avgInboundJitterInMs` and `ewmaRttInSec` all live on
the monitors, so the same numbers are available to a scoring implementation or to
your own code without a detector in the way. The full reasoning is in
[docs/DETECTOR_TAXONOMY.md](./docs/DETECTOR_TAXONOMY.md#the-five-design-rules).

### Duration is measured in stats time

Every detector that waits for a condition to persist accumulates the monitored
object's **`deltaTime`** — the gap between consecutive stats reports'
`timestamp`s — rather than wall-clock elapsed. `Date.now()` is used for the issue
lifecycle only: `raisedAt`, the `durationInMs` computed at resolution, and
`resolvedAt`.

This matters most in exactly the conditions detectors fire under. A saturated
main thread, a backgrounded tab or a throttled timer makes collections run late
or be skipped. Measured against the wall clock, a tab hidden for a minute has
"watched" a minute of blocked media and a minute of stalled handshake, and every
duration threshold crosses at once on the tick where the tab comes back — on
evidence nobody observed. Measured in stats time it has watched whatever the
collector managed to sample. The rule cuts the other way too: a collection that
ran late means the condition held for longer than one nominal period, and
`deltaTime` credits it with that.

### When a detector cannot see its inputs

A silent detector is saying one of two very different things: *nothing is wrong*,
or *the browser did not report the stats I need*. `inputsUnavailable` is the
difference, set per tick and only for missing **evidence**:

```ts
import { TransportDelayDetector } from '@observertc/client-monitor-js';

const delay = pcMonitor.detectors
    .getByName<TransportDelayDetector>('transport-delay-detector');

if (delay?.inputsUnavailable) {
    // no RTT was reported this tick — "no issue" here means "no measurement"
}
```

**The generic parameter is load-bearing.** `inputsUnavailable` is a public field
on the eight detector classes that compute it, not a member of the `Detector`
interface, and a bare `getByName()` returns `Detector | undefined` — which does
not declare the flag. `getByName<T>()`, or a cast, is how you name the class you
are asking for. The interface stays that small on purpose: nothing in the library
reads the flag yet, so it moves onto the contract only if and when something does.

The case is not hypothetical: Firefox still does not populate `bytesSent` /
`bytesReceived` on `RTCTransportStats` as of 153, so every detector reading a
transport bitrate is permanently silent there — correctly, having no evidence,
but invisibly. A dashboard counting issues without counting this reads those
sessions as healthy.

A detector standing down because a track is paused, a tab is backgrounded or a
sender is muted is **not** unavailable. That is *not applicable*, which is a
different statement about a different thing.

### Which issues belong in the sample

Every issue-raising detector exposes a runtime flag next to `disabled`:

```ts
/** like `disabled`, flippable at runtime */
public includeIssueInSample = true;
```

When flipped to `false`, the detector keeps working locally — monitor events fire and the issue lifecycle (`activeIssues`, `'issue'` / `'issue-resolved'`) is maintained — but neither the raise entry nor the resolution entry is buffered into the `ClientSample`. (`raiseIssue` / `addIssue` accept the same thing directly via `includeInSample` for custom issues.)

In case shrinking down the sample size is something your application wants, the table below is the useful thing to know: it says for every issue whether the server can **derive the same verdict from one component's stats that the sample already carries** (all the load-bearing counters are monotonic totals, so a server holding consecutive samples can recompute every delta). Issues that are derivable are the safe candidates for `includeIssueInSample = false`; issues that are not derivable join stats across components, depend on state that never reaches the sample (`MediaStreamTrack.muted`, `getSettings()`, connection-state transitions), or live in sub-sampling-period timing — switch those off and the information is gone.

| Detector | Issue | Derivable from one component's sampled stats? | From what |
| --- | --- | --- | --- |
| `FrozenVideoTrackDetector` | `frozen-video-track` | **Yes** | `inbound-rtp` `freezeCount`, `totalFreezesDuration` |
| `KeyframeStormDetector` | `keyframe-storm` | **Yes** | `inbound-rtp` `pliCount`, `firCount`, `keyFramesDecoded` |
| `VideoRecoveryFailedDetector` | `video-recovery-failed` | No | tick-level sequencing of freeze + PLI + keyframe counters |
| `PixelatedVideoDetector` | `pixelated-video` | **Yes** | `inbound-rtp` `bytesReceived`, `frameWidth`, `frameHeight`, `framesPerSecond` — but the screen-share and pause guards are not sampled |
| `ChoppyVideoDetector` | `video-choppy` | Partially | `inbound-rtp` `framesPerSecond`; the EWMA and the volatility window are per collecting tick and coarser at the sampling period |
| `FrameAssemblyStalledDetector` | `frame-assembly-stalled` | **Yes** (approx.) | `inbound-rtp` `packetsReceived` vs `framesReceived`; the pause and background guards are not sampled |
| `AVDesyncPlayoutDetector` | `av-desync` | No | joins `estimatedPlayoutTimestamp` across two `inbound-rtp` reports, and the pairing between them is application-declared context that never reaches the sample |
| `InventedSpeechDetector` | `invented-speech` | **Yes** | `inbound-rtp` `concealedSamples`, `silentConcealedSamples`, `totalSamplesReceived` |
| `JitterBufferStressDetector` | `audio-jitter-buffer-stress` | **Yes** (approx.) | `inbound-rtp` jitter-buffer totals; the consecutive-tick nuance is lost |
| `AudioPlayoutSynthesisDetector` | event only | **Yes** | `media-playout` synthesized-sample totals |
| `PlayoutDiscrepancyDetector` | `inbound-video-playout-discrepancy` | **Yes** | `inbound-rtp` `framesReceived` vs `framesRendered` |
| `DecoderPerformanceDetector` | `video-decoder-overloaded` | Partially | `inbound-rtp` decode/drop totals; frame-budget + quiet-loss guards are coarser at the sampling period |
| `StuckDecoderDetector` | `stuck-decoder` | No | tick-level bytes-up/frames-flat/PLI-up fingerprint; drives consumer recreation |
| `DryInboundTrackDetector` | `dry-inbound-track` | No | guards read `MediaStreamTrack.muted`/`readyState` + remote pause state — not in the sample |
| `DryOutboundTrackDetector` | `dry-outbound-track` | No | same non-sampled track-state guards |
| `CaptureTrackEndedDetector` | `capture-track-ended` | No | `MediaStreamTrack` `ended` event — no stats representation |
| `SilentAudioSourceDetector` | `silent-audio-source` | No | energy totals are sampled, but the live/enabled/unmuted guards are not |
| `SourceCaptureBottleneckDetector` | `capture-bottleneck` | No | the frame rate is a counter differenced against measured elapsed time, and the guards read `track.getSettings()`, pause state, screen-share content type and live track state — none of it reconstructable from a sample |
| `EncoderPerformanceDetector` | `encoder-bottleneck` | No | joins the media source's frame rate with the highest active layer's encode time and CPU-limitation shares per collecting tick, and compares `sourceFps` against `track.getSettings().frameRate`, which is not sampled |
| `DecoderBottleneckDetector` | `decoder-bottleneck` | No | differences `framesDecoded` against `framesReceived` per collecting tick, behind pause and live-track guards that are not sampled |
| `UplinkCongestionDetector` | `uplink-congestion` | Mostly | `candidate-pair.availableOutgoingBitrate`, `sendingBitrate` and the outbound pacer counters — all sampled, but the EWMA baselines it compares against are not |
| `DownlinkCongestionDetector` | `downlink-congestion` | Mostly | Inbound bitrate and `jitterBufferDelay` / `jitterBufferEmittedCount` — sampled, with the same caveat about the baseline |
| `CpuPerformanceDetector` | `cpulimitation` | No | joins send-side and receive-side evidence plus `durationOfCollectingStatsInMs`, which is not sampled |
| `TransportDelayDetector` | `transport-delay-degraded` | **Yes** (approx.) | `candidate-pair` / `remote-inbound-rtp` round trip; the EWMA smoothing is per collecting tick |
| `TransportLossDetector` | `transport-loss-sustained` | **Yes** (approx.) | `inbound-rtp` and `remote-inbound-rtp` loss totals; the per-tick "carried packets" gating that keeps muted tracks out of the mean is lost |
| `TransportJitterDetector` | `transport-delivery-unstable` | **Yes** (approx.) | `inbound-rtp` `jitter`, averaged; same per-tick gating caveat |
| `IceDisconnectedDetector`, `IceConnectionFailedDetector`, `IceTransportStalledDetector`, `UnstableIcePathDetector` | `ice-disconnected`, `ice-connection-failed`, `ice-transport-stalled`, `unstable-ice-path` | No | state transitions and episode timing happen *between* samples |
| `BlockedTransportDetector` | `blocked-transport` | No | joins candidate-pair STUN counters + transport bytes + outbound-rtp bitrate per collecting tick |
| `IceReachabilityDetector` | `no-available-ice-candidate` | No | connection-state jumps + gathering state; with no network the next sample may never leave the device |
| `IceEstablishmentFailedDetector` | `ice-establishment-failed` | No | needs the *latched* fact that no pair was ever nominated, plus connection-state history; a connection that never establishes may never ship a sample either |
| `RtpSenderStalledDetector` | `rtp-sender-stalled` | No | cross-references `framesEncoded` against `packetsSent` per collecting tick, behind track live/muted and layer-active guards |
| `TransportDemuxStalledDetector` | `transport-demux-stalled` | No | cross-references transport bytes against inbound-rtp bytes per collecting tick |


---

### Audio detectors

> Three of these four are **Perceived Quality** — invented speech, jitter-buffer stress and desync are continuously-measured perceptual values judged over an accumulator or a window, and so is `AudioPlayoutSynthesisDetector` despite emitting only an event. Full reference, including why the audio-clarity sub-layer is deliberately empty and what each proxy cannot claim: [docs/PERCEIVED_QUALITY_DETECTORS.md](./docs/PERCEIVED_QUALITY_DETECTORS.md).

#### InventedSpeechDetector

Reports a listener being fed audio the sender never sent. When packets are missing or late, NetEQ fabricates audio from what came before so playout never stops — usually inaudibly, which is why packet loss is a poor proxy for how a call sounded. What the listener hears is the fabrication, so that is what this measures: the **audible** invented share (silent concealment subtracted, because concealment during talker silence is indistinguishable from the real thing).

One accumulator, in milliseconds, is the whole of it. Each tick adds `inventedSpeechRatio × deltaTime` of invention and drains `allowedInventedRatio × deltaTime` of allowance, clamped to `[0, raiseAfterInventedMs]`; the issue opens when it is full and closes when it is empty. Two properties follow, and both are the point: **the verdict does not depend on how often you poll** — a rate integrated over elapsed time has no tick-length artefact — and **a brief pause does not end an episode**, since a clean tick drains only the allowance. Someone who breaks up, pauses for breath and breaks up again is one issue, not three.

**Use the result:** show a "poor audio from X" indicator on the affected participant's tile. Server-side, the issue lifecycle gives you exact audible-degradation windows per participant.

```javascript
inventedSpeechDetector: {
    allowedInventedRatio: 0.05, // share that may be invented without counting — and the drain rate
    raiseAfterInventedMs: 400,  // invented ms beyond the allowance before the issue opens
}
// At these defaults: 0.4s of excess invention opens it (two seconds of audio at
// 25% invented), and raiseAfterInventedMs / allowedInventedRatio = 8s of clean
// audio closes it.
```

```typescript
monitor.on('invented-speech', ({ trackMonitor, inventedSpeechRatio }) => {
    // the user is HEARING this — mark the participant's tile
    ui.setAudioQualityWarning(trackMonitor.track.id, { rate: inventedSpeechRatio });
});
monitor.on('issue-resolved', (issue) => {
    if (issue.type === 'invented-speech') ui.clearAudioQualityWarning(/* by key */);
});
```

**Sources:** [RFC 7294 §3.4 (severely concealed seconds)](https://www.rfc-editor.org/rfc/rfc7294#section-3.4) · [Voice quality monitoring (Webex)](https://help.webex.com/article/kqh7le/Voice-quality-monitoring) · [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### JitterBufferStressDetector

Fires only when the jitter buffer's target delay has grown **and** NetEQ is time-stretching audio. Either alone is the system working (buying latency to hide jitter is success); together they are added delay the user actually hears.

**Use the result:** for latency-sensitive products, surface a "your connection is adding delay" hint; there is nothing to fix client-side, so the main value is attribution — this participant's audio lag is *their network jitter*, not your platform.

```javascript
jitterBufferStressDetector: {
    targetDelayThresholdInMs: 200, // >200ms added delay is noticeable degradation
    timeStretchThreshold: 0.02,    // share of samples stretched/compressed
    minConsecutiveTicks: 2,        // sustained, not a one-tick blip
}
```

```typescript
monitor.on('audio-jitter-buffer-stress', ({ trackMonitor, targetDelayInMs }) => {
    log.info(`audio delayed ~${Math.round(targetDelayInMs)}ms by jitter buffering`, trackMonitor.track.id);
});
```

**Sources:** [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [NetEQ (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/neteq/) · [RTCRtpReceiver.jitterBufferTarget (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget)

#### AVDesyncPlayoutDetector

Lip sync: a participant's voice and their lips playing out at measurably different points in that participant's own timeline. It is the only detector in the library that compares **two** streams — synchronization is a relationship, and no reading of the audio track alone contains the answer.

The measurement is the difference between the two tracks' `estimatedPlayoutTimestamp`. Both values are already expressed on the *sender's* NTP clock, because each has been resolved through that sender's RTCP sender reports, so they subtract directly: positive means audio is ahead of the picture.

**You must declare the pairing.** The library cannot infer which video track belongs with which audio track — an SFU forwards independent streams, and `MediaStream` grouping does not survive every topology. Until you declare it, this detector reports `inputsUnavailable` rather than guessing, because a wrong pairing produces a confidently wrong number:

```typescript
monitor.setInboundTrackContext(audioTrack.id, { linkedVideoTrackId: videoTrack.id });
```

**The thresholds are asymmetric on purpose.** Sound arrives after light in the physical world, so a viewer forgives audio lagging far more readily than audio leading; ITU-R BT.1359-1 puts the acceptability limits near +90 ms ahead against −185 ms behind. A single absolute threshold would be either too strict on lag or too lax on lead.

```javascript
avDesyncPlayoutDetector: {
    audioAheadRaiseInMs: 90,     // audio ahead of the picture — the objectionable direction
    audioAheadResolveInMs: 45,
    audioBehindRaiseInMs: 185,   // magnitudes, for audio lagging the picture
    audioBehindResolveInMs: 125,
    sustainForInMs: 3000,        // stats time past the threshold before the issue opens
}
```

```typescript
monitor.on('av-desync', ({ trackMonitor, linkedVideoTrackId, playoutDiffInMs, direction }) => {
    diagnostics.flag('av-desync', trackMonitor.track.id, { linkedVideoTrackId, playoutDiffInMs, direction });
});
```

**Use the result:** report it against the *sender*, not the listener — one participant desynchronised for everybody is that participant's pipeline, while one listener seeing it on every speaker is local. And read it together with the coverage caveat below, because absence of this issue is very often absence of measurement.

**Support is thin, and the flag says so.** `estimatedPlayoutTimestamp` is populated by Firefox, exposed by Chrome only when A/V sync is enabled internally, and not reported by Safari. Where it is missing — or where no pairing was declared — the detector sets `inputsUnavailable` instead of staying quiet, so a dashboard can tell "in sync" from "never measured". One further limitation the spec creates: the timestamp may be extrapolated between sender reports, so a frozen renderer can keep reporting smooth playout and this detector will believe it. Treat a `frozen-video-track` issue as a reason to distrust a clean sync reading over the same interval.

**Replaces `AudioDesyncDetector` (removed in 4.10.0).** That detector read NetEQ's accelerate and preemptive-expand counters, which measure jitter-buffer adaptation rather than synchronization — and since A/V sync logic corrects drift by *raising* NetEQ's target delay, it tended to fire on the correction rather than the fault. That signal is still read, correctly labelled, by [`JitterBufferStressDetector`](#jitterbufferstressdetector). No tuning carries over: the quantity changed from a fraction of samples to milliseconds of skew.

**Sources:** [ITU-R BT.1359-1 — Relative timing of sound and vision for broadcasting](https://www.itu.int/rec/R-REC-BT.1359/en) · [W3C webrtc-stats: `estimatedPlayoutTimestamp`](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-estimatedplayouttimestamp)

#### AudioPlayoutSynthesisDetector

Watches `media-playout` for synthesized (concealment/generated) samples injected at the playout device level, and emits `'synthesized-audio'` plus the `EXCESSIVE_SYNTHESIZED_AUDIO` client event when the duration in one interval exceeds the configured minimum.

**Use the result:** sustained synthesized playout with otherwise healthy inbound stats points at the *output* path — suggest the user switch audio output device.

```javascript
audioPlayoutSynthesisDetector: {
    minSynthesizedSamplesDuration: 0, // ms of synthesized audio per interval before reporting
    createEvent: true,                // also buffer EXCESSIVE_SYNTHESIZED_AUDIO into samples
}
```

**Sources:** [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Video detectors

> These split across two categories, and the split is the useful part. `frozen-video-track`, `pixelated-video` and `video-choppy` are **Perceived Quality** — they say the picture is bad, without saying where it broke ([docs/PERCEIVED_QUALITY_DETECTORS.md](./docs/PERCEIVED_QUALITY_DETECTORS.md)). The rest are **Pipeline Disruption** — they name a boundary in the receive chain, or a repair loop beside it, and their answer is a stage rather than an experience ([docs/PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md)). Both can be right about the same thirty seconds, and neither reads the other.

#### FrozenVideoTrackDetector

Reports that an inbound video track's picture has stopped moving — the freeze the person watching actually sees, **without any claim about why**. Raises `frozen-video-track` and nothing else; the repair loop around a freeze is a different question with a different audience and lives in [`KeyframeStormDetector` and `VideoRecoveryFailedDetector`](#keyframestormdetector--videorecoveryfaileddetector), each deriving its own condition from the same raw counters rather than from this detector's verdict.

A freeze starts when `freezeCount` advances and persists until frames render again: `freezeCount` counts freeze *starts*, so its delta alone would declare a persistent freeze over after a single tick, which is why staying frozen additionally requires `deltaFramesRendered === 0`. The issue waits for `minConsecutiveTicks` intervals — `freezeCount` advances on any inter-frame gap past roughly `max(3 × average, average + 150ms)`, which is a sub-second hiccup nobody notices, and surviving into a second observation is what separates that from a freeze worth reporting.

**The freeze state is published, not just the issue.** `inboundRtp.isFreezed` is derived here and read by `DefaultScoreCalculator` to score the track — a property of the stats rather than a conclusion about a fault, so it belongs with whoever computes it. It follows that `frozenVideoTrackDetector: null` also removes the flag, and the score stops penalising freezes.

**Use the result:** overlay a spinner or last-frame treatment on the participant's tile. The payload carries `freezeTimeInMs` alongside `observedSpanInMs` — both from the stats timestamps rather than the nominal collecting period — so a server can judge severity from the frozen share of a measured window even when a collection ran late.

```javascript
frozenVideoTrackDetector: { minConsecutiveTicks: 2 },  // consecutive frozen intervals before an issue (null = off)
```

```typescript
monitor.on('frozen-video-track', ({ trackMonitor }) => ui.showFreezeOverlay(trackMonitor.track.id));
```

A backgrounded tab, a paused consumer and a paused remote sender all stand the detector down, and the stand-down swallows the monotonic counter rather than skipping the tick — so the quiet period is not replayed as freezes on the way back.

**One caveat that changes what you will actually see.** All three stats adapters in the tree document `inbound-rtp.framesRendered` as never emitted, so on every browser the library adapts, the "persists until frames render again" clause cannot engage: what remains is `freezeCount` advancing in each of `minConsecutiveTicks` consecutive collections. Repeated freezing raises as intended; a **single continuous freeze**, which increments the counter once and then holds, does not. This is recorded as a defect rather than documented as behaviour — see [docs/PERCEIVED_QUALITY_DETECTORS.md](./docs/PERCEIVED_QUALITY_DETECTORS.md#visual--continuity).

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### KeyframeStormDetector / VideoRecoveryFailedDetector

The repair loop around a freeze: PLI/FIR out, keyframes back in. Two classes, two issues, a config key each (`keyframeStormDetector`, `videoRecoveryFailedDetector`), and neither reads the other or `frozen-video-track`.

`keyframe-storm` fires when `pliRate` stays above `pliRateAlertOn` over a rolling window. A PLI goes out whenever the decoder cannot continue from what it has, so an occasional one is ordinary; a stream of them says every repair attempt is itself being lost or arriving unusable. It is worth an issue of its own because the loop is **self-reinforcing**: a keyframe is several times the size of a delta frame, so a burst of keyframe requests puts a burst of large frames on a link that was already dropping packets — the request made to fix the picture worsens the congestion that provoked it. Left running, a call can sit in this state indefinitely at full bitrate and never show a moving picture.

`video-recovery-failed` is the failure worth waking an SFU operator for: keyframes were requested, repeatedly, over a sustained stretch, and none arrived. `frozen-video-track` says a viewer is looking at a still picture; this says the mechanism that exists to end it is not working. A freeze that repairs itself in a second is a lossy first hop; a freeze where PLI after PLI leaves the client and `keyFramesDecoded` never moves points past the first hop — at forwarding, at a consumer wired to a producer that is gone, at a far-side encoder that stopped producing keyframes. Both halves of the evidence are required: `recoveryFailedThresholdInMs` of stall *and* `recoveryFailedMinPliCount` requests, so the claim ("we asked and nothing came back") always has both.

Neither derives its stall condition from `inboundRtp.isFreezed`. That flag is `FrozenVideoTrackDetector`'s conclusion and disappears when `frozenVideoTrackDetector` is `null`; what `VideoRecoveryFailedDetector` actually needs is narrower anyway — frames not rendering **and** `deltaKeyFramesDecoded === 0`, which is the precise statement that the repair did not land.

**Use the result:** `video-recovery-failed` is your escalation signal — pair it with [`stuck-decoder`](#stuckdecoderdetector): if both fire, recreate the consumer; if only recovery fails, the producer or SFU forwarding needs the look.

```javascript
keyframeStormDetector: {
    windowInMs: 30000,             // window for the PLI rate
    pliRateAlertOn: 0.5,           // real-world storms run ~0.5-0.7 PLI/s sustained
    pliRateAlertOff: 0.15,         // hysteresis: the first honest reading below this closes it
},
videoRecoveryFailedDetector: {
    recoveryFailedThresholdInMs: 5000, // stalled with PLIs out for this long
    recoveryFailedMinPliCount: 2,      // proof we actually asked for repair
}
```

```typescript
monitor.on('keyframe-storm', ({ trackMonitor, pliRate }) => metrics.gauge('pli-storm', pliRate));
monitor.on('video-recovery-failed', ({ trackMonitor, pliCountSinceStalled }) => {
    // we asked for a keyframe repeatedly and nothing came back — not a local problem
    reportToServer('recovery-failed', trackMonitor.track.id, { pliCountSinceStalled });
});
```

The storm window is accumulated from each tick's `deltaTime` rather than wall-clock elapsed, so a throttled tab cannot stretch the denominator and hide a storm the media clock says is still raging. Raising needs half a window of history behind it — a rate computed over one short interval is a count, not a rate.

**Sources:** [PLI: Picture Loss Indication (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/pli/) · [RFC 4585: RTP/AVPF (PLI/FIR)](https://datatracker.ietf.org/doc/html/rfc4585) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### PixelatedVideoDetector / ChoppyVideoDetector

Perceived video quality: nothing has stalled, frames arrive and decode and render on time, and the experience is still bad. Both threshold values the inbound RTP monitor already computes and that nothing previously read.

`pixelated-video` is judged on **`bitPerPixel`** — bitrate divided by width × height × frame rate — the picture being drawn with too few bits for its size, for long enough to be worth complaining about. Bits per pixel was chosen over quantizer parameters for a plain reason: `qpSum` is optional, absent on some codecs, and its scale differs between them, so a QP threshold is really a per-codec table that silently produces nothing where it has no entry. `bitPerPixel` is derived from three fields every browser reports and means the same thing everywhere. It is not a precise perceptual model and does not pretend to be.

`video-choppy` is judged on **`ewmaFps`** and **`fpsVolatility`**, and reports either fault under one issue with the payload naming which was seen. The two legs are genuinely different and neither implies the other: a steady 8 fps is smooth-but-slow and usually means the sender is limited; 25 fps swinging between 5 and 40 is fast-but-lurching and usually means delivery is bursty. Both are the same complaint from the viewer ("it's juddery"), which is why one issue with an `evidence` field keeps the viewer's question intact while preserving the distinction that matters to whoever investigates.

| `evidence` | Meaning |
|---|---|
| `low-framerate` | `ewmaFps` below `minFramesPerSecond` |
| `unstable-framerate` | `fpsVolatility` above `maxFpsVolatility` — mean absolute deviation over the monitor's rolling window, relative to its mean |

Neither class holds a window of its own. The arithmetic lives on `InboundRtpMonitor`, and these detectors compare two numbers against two thresholds and count how long the answer stayed bad — a derived value is a fact about the stream that anything may want, while a threshold is an opinion belonging to whoever is judging.

```javascript
pixelatedVideoDetector: {
    threshold: 0.03,          // bits/pixel at or below which the picture counts as coarse
    recoveryThreshold: 0.05,  // above this it resolves (hysteresis)
    durationInMs: 8000,       // stats time it must stay coarse before raising
},
choppyVideoDetector: {
    minFramesPerSecond: 10,   // smoothed fps below this is too slow
    maxFpsVolatility: 0.2,    // volatility above this is too erratic
    durationInMs: 8000,
},
```

```typescript
monitor.on('pixelated-video', ({ trackMonitor, bitPerPixel }) => ui.hintPoorVideo(trackMonitor.track.id, { bitPerPixel }));
monitor.on('video-choppy',    ({ trackMonitor, evidence })    => ui.hintPoorVideo(trackMonitor.track.id, { evidence }));
```

**Screen shares are excluded** rather than given a second threshold. A static slide legitimately spends almost nothing per pixel and sits at 2 fps jumping when the slide changes, and that is correct behaviour. Camera video typically runs 0.05–0.2 bits per pixel; below roughly 0.03 blocking artefacts are usually visible. Both also stand down on a paused consumer or a paused remote sender, `video-choppy` additionally on a backgrounded tab, and both set `inputsUnavailable` when the browser reports no frame size or frame rate — "nothing was observed about picture quality" is not the same as "the picture is fine".

**Threshold caveat.** These numbers are round starting points chosen from what camera video usually looks like, not measurements of anything. Tune them against your own fleet before alerting on them.

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### FrameAssemblyStalledDetector

Watches the one boundary in the receive chain that nothing else watches: packets arriving from the network, and frames coming out of reassembly. When `packetsReceived` keeps advancing and `framesReceived` does not, RTP is being delivered and no complete picture is being made from it — every frame is missing pieces, or the depacketizer has lost the stream. Raises `frame-assembly-stalled`.

Naming this boundary matters because the same condition otherwise surfaces as [`stuck-decoder`](#stuckdecoderdetector), which points at the decoder for something that happened before the decoder ever saw a frame. (`StuckDecoderDetector` already half-admits this with its `assembly` variant; this detector is the other half, stated directly.)

```javascript
frameAssemblyStalledDetector: {
    thresholdInMs: 3000,     // stats time packets must keep arriving with no frame completed
    minPacketsReceived: 20,  // below this it is a trickle, not a stall
}
```

```typescript
monitor.on('frame-assembly-stalled', ({ trackMonitor, packetsSinceLastFrame }) => {
    reportToServer('frame-assembly-stalled', trackMonitor.track.id, { packetsSinceLastFrame });
});
```

**Deliberately narrow.** It says nothing about *why* frames are not assembling — sustained loss inside every frame and a codec mismatch look identical from here, and both are real. Attribution is what co-firing with [`transport-loss-sustained`](#transport-quality-detectors) is for, and that comparison belongs to whoever reads the issues. A sender that has simply stopped sending is not this: no packets arrive, so nothing accumulates, and [`dry-inbound-track`](#dryinboundtrackdetector--dryoutboundtrackdetector) owns that. Pause, mute and a backgrounded tab each reset the stall rather than counting toward it, and a browser that does not report `framesReceived` sets `inputsUnavailable` rather than staying quietly silent.

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### DecoderPerformanceDetector

Blames this device only when frames demonstrably *arrived* — healthy receive rate, quiet loss — but decode time overran a budget derived from the stream's own frame rate, or frames were dropped after arrival. This is the detector that separates "the network dropped it" from "the client could not decode it": same chart, opposite fixes.

**Use the result:** reduce decode load — subscribe to lower simulcast layers, cap the number of rendered videos, or pause off-screen tiles. The payload's `decoderImplementation` / `powerEfficientDecoder` tell you whether a software decoder is doing work the hardware could.

```javascript
decoderPerformanceDetector: {
    decodeTimeBudgetRatio: 0.8,  // share of the per-frame budget (1000/fps) decode may use
    dropRatioThreshold: 0.1,     // frames dropped after arriving
    minFramesReceived: 10,       // don't judge starved intervals (e.g. static screen share)
    quietLossThreshold: 0.02,    // above this, the network is the better explanation
    minConsecutiveTicks: 2,
}
```

```typescript
monitor.on('video-decoder-overloaded', ({ trackMonitor, decodeTimePerFrameInMs, frameBudgetInMs }) => {
    // frames are arriving; this device can't keep up — lower the decode load
    sfuClient.preferLayer(trackMonitor.track.id, 'low');
});
```

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### DecoderBottleneckDetector

The receive-side counterpart of `capture-bottleneck`: frames arrived and the decoder did not turn enough of them into pictures. Raises `decoder-bottleneck`.

**The rule, in full:** add up the frames that arrived and the frames that were decoded; once `durationInMs` has accumulated, compare them. Decoded below `decodeFpsRatioThreshold` of arrived → raise. At or above → resolve. Start a new window.

```javascript
decoderBottleneckDetector: {
    durationInMs: 15000,        // average the decoder over this long ...
    decodeFpsRatioThreshold: 0.9, // ... then require 90% of what arrived
    minReceivedFps: 5,          // too thin a stream to judge a decoder on
}
```

**The bar is the arrival rate, never the sender's.** Frames that never arrived are the network's story — `FrozenVideoTrackDetector` and the peer connection's loss reasons tell it — so a stream throttled to 5fps that decodes cleanly is silent. That is also what separates it from [`DecoderPerformanceDetector`](#decoderperformancedetector), which asks whether decoding *cost* too much over consecutive ticks: that one is about the price of decoding, this one about frames going missing. Both firing at once is the honest answer when both are true.

**Use the result:** the client cannot decode what it was handed — drop to a lower simulcast layer, or ask the SFU for one.

```typescript
monitor.on('decoder-bottleneck', ({ trackMonitor, decodedFps, receivedFps }) => {
    sfu.requestLowerLayer(trackMonitor.track.id, { decodedFps, receivedFps });
});
```

**What it refuses to judge**, because a low decode rate there is legitimate: a backgrounded tab, a paused consumer, a paused remote sender, a track that is not live and unmuted, and a stream thinner than `minReceivedFps`. The window restarts after a collection gap.

#### StuckDecoderDetector

Catches the per-consumer decode wedge: RTP bytes keep arriving while nothing decodes and PLIs fire continuously — a corrupted/incomplete frame broke the decode chain and it never recovers on its own. The wait is adaptive (`max(thresholdInMs, rttMultiplier × RTT)` plus a minimum number of stuck ticks), and the `minBitrate` floor separates it from a merely starved track.

**Use the result:** **recreate the consumer** — that is the known mitigation, and this detector fires exactly and only when it applies (delivery confirmed, output zero). The payload's `variant` separates an `assembly` wedge (no frame ever reassembled) from a `decode` wedge, and `deadBytesReceived` quantifies the waste for the report.

```javascript
stuckDecoderDetector: {
    thresholdInMs: 4000,   // floor; effective wait = max(this, rttMultiplier × RTT)
    rttMultiplier: 15,     // high-RTT paths get more time to recover legitimately
    minBitrate: 10000,     // bps below which this is a dry track, not a wedge
    minPliCount: 2,        // the browser must be asking for repair
}
```

```typescript
monitor.on('stuck-decoder', async ({ trackMonitor, variant, deadBytesReceived }) => {
    // the stream is delivered but nothing decodes — recreate the consumer
    await sfuClient.recreateConsumerFor(trackMonitor.track.id);
    reportToServer('stuck-decoder', { variant, deadBytesReceived });
});
```

**Sources:** [PLI: Picture Loss Indication (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/pli/) · [RFC 4585: RTP/AVPF (PLI/FIR)](https://datatracker.ietf.org/doc/html/rfc4585) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### PlayoutDiscrepancyDetector

Detects a growing skew between frames *received* and frames *rendered* on an inbound video track — decode succeeded, but the rendering pipeline is falling behind.

**Use the result:** re-attach the media element or recreate the `<video>` sink; this is a local rendering problem, not a network one.

```javascript
playoutDiscrepancyDetector: {
    lowSkewRatio: 0.1,     // share of received frames at which the issue resolves
    highSkewRatio: 0.25,   // share of received frames at which it raises
    minFramesReceived: 10, // below this the interval carries too few frames to judge
}
```

```typescript
monitor.on('inbound-video-playout-discrepancy', ({ trackMonitor }) => {
    videoSinks.reattach(trackMonitor.track.id);
});
```

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Track activity

> Both are **Pipeline Disruption**, at the two ends of the chain: `dry-outbound-track` is the last send-side boundary and `dry-inbound-track` the first receive-side one. Full reference: [docs/PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md).

#### DryInboundTrackDetector / DryOutboundTrackDetector

Raise `dry-inbound-track` / `dry-outbound-track` when a track that should be flowing carries no bytes at all past a threshold. This is *starvation* — contrast with [`stuck-decoder`](#stuckdecoderdetector), where bytes flow and nothing decodes.

**Use the result:** inbound dry → verify the producer is not paused, then resubscribe/reconsume; outbound dry → check the local track (`muted`, `enabled`, `readyState`) and the transport before blaming the network.

```javascript
dryInboundTrackDetector:  { thresholdInMs: 5000 },
dryOutboundTrackDetector: { thresholdInMs: 5000 },
```

```typescript
monitor.on('dry-inbound-track', async ({ trackMonitor }) => {
    if (!(await sfuClient.isProducerPaused(trackMonitor.track.id))) {
        await sfuClient.resubscribe(trackMonitor.track.id);
    }
});
```

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Send side

> Every detector in this group is **Pipeline Disruption**, watching one boundary of the send chain `capture → frame supply → encoder → RTP sender`. The boundary each one owns, the one boundary nothing watches, and the naming debt three of the issue types carry are in [docs/PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md).

#### SourceCaptureBottleneckDetector

Is the capture device delivering the frames the track was configured to capture? The send-side mirror of [`DecoderBottleneckDetector`](#decoderbottleneckdetector), which asks the same of the decoder. Raises `capture-bottleneck`.

**The rule, in full:** add up the frames the source delivered and the time it had to deliver them; once `durationInMs` has accumulated, compare the average against `getSettings().frameRate`. Below `captureFpsRatioThreshold` of it → raise. At or above → resolve. Start again. Two running totals, no history buffer.

```javascript
sourceCaptureBottleneckDetector: {
    durationInMs: 15000,           // average the capture device over this long ...
    captureFpsRatioThreshold: 0.9, // ... then require 90% of the configured fps
}
```

**Why average rather than threshold each tick.** A camera that is failing rather than merely busy dips and recovers: 150 frames per 5s tick becomes 132, back to 150, then 97. Tick by tick most of it looks fine. The average over 15s does not — 26.3fps against a configured 30 — so it raises while the camera is still delivering, about half a minute before this one stopped entirely. Averaging also weights *how far* the source fell short rather than merely how often.

**Why a duration and not a tick count.** What matters here is that the device stayed short for a stretch of time that means something. A tick count would mean six seconds at a 2s collecting period and thirty at a 10s one. ([`EncoderPerformanceDetector`](#encoderperformancedetector) is the other way round, and says why.)

**The rate is always the counter, never `mediaSource.framesPerSecond`.** `sourceFps` is the frame counter differenced against *measured* elapsed time. The browser's own figure is coarse and smooths this exact stutter away — it can read `30` across an interval that actually delivered 132 frames in five seconds. When `sourceFps` is undefined the counter restarted, and a restart is not a measurement.

**No baseline, no judgement.** If the browser does not report `getSettings().frameRate`, nothing is substituted for it: there is no rate for the measurement to fall short *of*, so the check stays quiet.

**What it refuses to judge**, because a low frame rate there is legitimate: a backgrounded tab (`ClientMonitor.activeTab === false`), a paused or stopped sender, and screen shares, whose frame rate is content-driven (a still document delivers nothing). If you capture a moving surface that should be watched, declare it with `monitor.setOutboundTrackContext(trackId, { contentType: 'camera' })`. The totals also restart after a settings change or a collection gap — that threshold is derived from `collectingPeriodInMs` rather than configured.

```typescript
monitor.on('capture-bottleneck', ({ trackMonitor, sourceFps, expectedFps }) => {
    ui.hintCameraTrouble(trackMonitor.track.id, { sourceFps, expectedFps });
});
```

**Threshold caveat.** `0.9` over 15s came from two captured sessions — one failure, one control, one camera model. They catch that failure and stay silent on that control, and are otherwise unvalidated: treat `capture-bottleneck` as observation-grade until a corpus sets the numbers.

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### EncoderPerformanceDetector

Given a capture source that *is* delivering, is the encoder keeping up with it? The send-side mirror of [`DecoderPerformanceDetector`](#decoderperformancedetector). Raises `encoder-bottleneck`.

Any one of three signals is enough: the highest active layer encodes below `encodeFpsRatioThreshold` of what the source delivered, encoding one frame costs more than `encodeTimeBudgetRatio` of the per-frame budget (`1000 / sourceFps`), or — only if you configure it — the browser reported itself CPU-limited for more than `cpuLimitationShareThreshold` of the interval.

```javascript
encoderPerformanceDetector: {
    encodeFpsRatioThreshold: 0.7,      // encoder below 70% of source fps = behind
    encodeTimeBudgetRatio: 0.8,        // encode time per frame vs the frame budget
    cpuLimitationShareThreshold: null, // null = ignore the browser's CPU-limited signal
    minConsecutiveTicks: 2,            // two reads agreeing, not a span of time
    sourceSupplyRatioThreshold: 0.9,   // below this share of the promised fps, the encoder is excused
}
```

**Everything is measured against what the source actually delivered**, never against what the track was configured to capture at. An encoder handed 3fps and emitting 3fps is doing its job perfectly; comparing it to a configured 30 would call that a catastrophic failure. It also stands down entirely while the source is short of the rate it promised — `mediaSource.sourceFps` under `sourceSupplyRatioThreshold` of `track.getSettings().frameRate` — because the frames were never there to encode. The two issues are mutually exclusive by construction.

That comparison is made here, from the two raw readings, and **not** by consulting `capture-bottleneck`. An earlier version called `ClientMonitor.isIssueActive('capture-bottleneck-track-<id>')` and stood down on the result, which made the verdict depend on things that have nothing to do with the encoder: disable `SourceCaptureBottleneckDetector` and this one silently stopped standing down, and the two only agreed within a single tick because `OutboundTrackMonitor` happens to register the capture detector first and `Detectors.update()` preserves registration order. Detectors observe; they do not consume each other's verdicts. Both still reach the same judgement about the source on defaults because they read the same two numbers. The ratio each compares them against is its own field, though — `sourceSupplyRatioThreshold` here, `captureFpsRatioThreshold` on the capture detector, both defaulting to `0.9`. Sharing one field was the last thread between the two, and it ran the wrong way: raising the bar for blaming the camera silently widened the range in which the encoder was excused. They ask different questions of the same measurement — *is the camera failing to deliver what it promised?* against *has the camera fallen short far enough that the encoder is excused?* — and are now tunable apart. The stand-down is skipped for screen shares, whose frame rate is content-driven, exactly as `capture-bottleneck` is never raised for one.

**Why `minConsecutiveTicks` here and a duration on the capture side.** They answer different questions. A tick count is a *confidence* floor — every signal above is a per-interval ratio that a single stats read can get wrong, so what is wanted is two independent reads agreeing, which is two samples whatever the collecting period happens to be. A duration is a *persistence* bar — the capture case, where the device has to stay short long enough to matter. `DecoderPerformanceDetector` and `JitterBufferStressDetector` use ticks for the same reason this one does.

**Why `cpuLimitationShareThreshold` defaults to `null`.** `CpuPerformanceDetector` already reports CPU limitation as its own `cpulimitation` issue, and the useful thing to do with the two is correlate them — `encoder-bottleneck` and `cpulimitation` firing together is evidence the encoder is CPU-bound. That inference is only worth something while `encoder-bottleneck` is derived *without* reading the same signal; wire the CPU share in here too and the correlation becomes tautological. Set a number (`0.3` is a reasonable one) if you would rather have the extra sensitivity than the independent evidence.

**Use the result:** reduce encode load — drop the top simulcast layer, lower resolution or frame rate, disable background effects. The payload carries `encoderImplementation`, `cpuLimitationShare` and the fps pair for the report.

```typescript
monitor.on('encoder-bottleneck', () => sender.dropTopSimulcastLayer());
```

#### Capture detectors

Three classes watch the source end of outbound tracks, one per finding, each registered from a config key of its own — so `captureTrackMutedDetector: null` silences the mute telemetry and leaves the two issue-raising classes running.

| Class | Reports | What it means |
|---|---|---|
| `CaptureTrackEndedDetector` | issue `capture-track-ended` | `readyState` turned `ended`: a webcam unplugged, a Bluetooth headset that dropped its link, a screen share stopped from the browser's own bar, a virtual camera whose application quit |
| `SilentAudioSourceDetector` | issue `silent-audio-source` | A live, unmuted, enabled microphone capturing nothing but digital silence |
| `CaptureTrackMutedDetector` | event `capture-track-muted` only | `track.muted` flipped true: the OS grabbed the microphone, another application claimed the camera, the lid closed, the privacy shutter moved |

**None of these leaves a trace in RTP.** The encoder keeps its `outbound-rtp` entry and the counters simply stop advancing, so every detector reading transport or encoder stats sees a track that went quiet with no way to say why. The track object is the only place the reason is written down.

`capture-track-ended` is raised exactly once per track monitor and nothing resolves it — `ended` is terminal by specification, and the application has to acquire a new track. It is deliberately not conditioned on the sender being live: a device unplugged during a pause is a fact about the device, and an application about to resume onto a device that no longer exists is precisely who needs to be told.

`silent-audio-source` reads the media source's `rmsAudioLevel`, which integrates `totalAudioEnergy` over the interval — the instantaneous `audioLevel` reads zero between words and would fire on every pause for breath. The threshold is measured in tens of seconds on purpose: a microphone capturing nothing and a person who simply is not talking are the same measurement, and only duration separates them. A paused sender, a track that is not `live`, or a muted or disabled track each stand the check down and resolve any open issue.

**`capture-track-muted` raises no issue, by design.** A muted source is very often exactly what the user intended, and `track.muted` covers the deliberate system mute and the accidental device grab with the same flag — calling it a fault would file thousands of correct system mutes as call failures. What it is worth is a timestamp: the record of when capture stopped, next to which the silence and dry-track findings that follow stop looking mysterious. Only the false → true transition is reported, never the first observation (a track already muted when monitoring began says nothing about a change) and never the return to unmuted (the sibling detectors observe the recovery directly).

**Use the result:** `capture-track-ended` → open the device picker. `silent-audio-source` → the classic "are you speaking? we can't hear you" banner, with a shortcut to switch microphone. `capture-track-muted` → log it and read it alongside whatever else fired.

```javascript
captureTrackEndedDetector: { createEvent: true }, // also buffer CAPTURE_TRACK_ENDED into samples
captureTrackMutedDetector: { createEvent: true }, // also buffer CAPTURE_TRACK_MUTED into samples
silentAudioSourceDetector: {
    silenceThresholdInMs: 60000, // long on purpose: silence ≠ broken until it persists
    silenceRmsThreshold: 0.0001, // interval-integrated RMS, not the flickery audioLevel
}
```

```typescript
monitor.on('silent-audio-source', ({ trackMonitor, silentForInMs }) => {
    ui.showBanner("We can't hear you — check your microphone", { switchDeviceAction: true });
});
monitor.on('capture-track-ended', () => ui.openDevicePicker('audioinput'));
```

**Sources:** [MediaStreamTrack mute event (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Connection & client health

> This group spans three categories. The transport-quality four are in
> [docs/TRANSPORT_QUALITY_DETECTORS.md](./docs/TRANSPORT_QUALITY_DETECTORS.md),
> the ICE and DTLS detectors in
> [docs/CONNECTIVITY_DETECTORS.md](./docs/CONNECTIVITY_DETECTORS.md), and the two
> stage-boundary detectors at the end in
> [docs/PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md).
>
> **The connectivity layer model.** The ICE and DTLS detectors below are not an
> assorted pile — they are the five layers a WebRTC connection climbs before
> media flows (reachability → discovery/traversal → path establishment → secure
> transport → path continuity), where **an issue belongs to the first layer
> whose proof fails**. That is what keeps "the user cannot connect" from
> producing five issues that all mean approximately the same thing. A layer holds
> **one class per issue**, not one class per layer: layer 5 holds four classes,
> layers 3 and 4 two each, and the order they are registered in carries no
> meaning, because no detector reads another's conclusion.
>
> There is no longer a sixth "media flow" layer.
> [`BlockedTransportDetector`](#blockedtransportdetector) moved to **Transport
> Quality**, because every connectivity stage completes and holds while it fires
> — the path is simply not delivering, which is Transport Quality's membership
> test rather than Connectivity's.
>
> **Category is not subject**, which is the one thing to know before reading the
> map: [`IceTraversalDetector`](#icetraversaldetector) and the two in
> [the restart loop](#the-restart-loop) are **Telemetry** even though their
> subject is connectivity and they are documented with the layer model, because a
> restart is what a healthy application *does* and a relay path is a cost rather
> than a fault. See
> [docs/DETECTOR_TAXONOMY.md](./docs/DETECTOR_TAXONOMY.md#category-is-not-subject).
>
> Reading a failed session: **start at the lowest layer that raised an issue**;
> everything above it is downstream of that failure.


#### UplinkCongestionDetector

Reports the sending path no longer carrying what the encoder wants to produce. Three things must hold together: the browser reporting the encoder bandwidth-limited, the **room left on the path** (`availableOutgoingBitrate - sendingBitrate`) dropping far below its own average, and packets queueing in the pacer on the way out.

The room is the signal. On a healthy call it is comfortably positive and steady — the encoder asks for less than the path offers. When a path narrows the estimate drops immediately and the encoder takes a beat to follow it down, so the room falls through zero and goes sharply negative for a collection or two. That moment is what this looks for: not a level, but a sender pressed against a ceiling that just moved.

**Use the result:** reduce what you send — lower simulcast layers or cap the bitrate — and show a network-quality indicator. The payload carries the estimate now and the maximum it fell away from, which sizes *how much* to back off.

```javascript
uplinkCongestionDetector: {
    headroomDropRatio: 0.25,    // room must drop this far below its average, as a share of the path's recent max
    sendDelayGrowthRatio: 3,    // pacer queue this many times its own EWMA baseline
}
```

```typescript
monitor.on('uplink-congestion', ({ availableOutgoingBitrate, sendingBitrate, headroomInBps }) => {
    // headroomInBps is negative here: the encoder is over the ceiling by that much.
    sender.capBitrate(availableOutgoingBitrate * 0.8);
    ui.setNetworkIndicator('poor');
});
```

**It never rests on `qualityLimitationReason` alone, and that is the point.** The browser saying the encoder is limited by bandwidth is nearly always true on a real call: over a throttled run it read `bandwidth` on every collection, including every healthy one — precision 0.53. As one of three it is a filter rather than a claim. Its *absence* is what closes the finding, and there is no recovery threshold on any bitrate: nothing knows what the path can carry after it narrows, so a link that settles at half its old capacity has recovered and a ratio against its old maximum would never say so.

**The room shape rules out the look-alike by construction.** A muted camera, a replaced track or a still screen share drags the estimate down — an estimator cannot probe above what is being sent — and a detector watching the estimate alone reads that as a narrowing path. All three make the room *grow*, because the encoder is asking for less while the path keeps offering what it did.

Where the browser computed no estimate, or reports no limitation verdict, the detector sets [`inputsUnavailable`](#when-a-detector-cannot-see-its-inputs) rather than reading as a healthy path.

**Sources:** [W3C webrtc-stats: availableOutgoingBitrate](https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatepairstats-availableoutgoingbitrate) · [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/)

#### DownlinkCongestionDetector

Reports the receiving path no longer carrying what is being sent to it. There is no incoming bandwidth estimate to read — `availableIncomingBitrate` is absent on Chrome, whose congestion control is send-side, so the estimate for your downlink is computed at the far end and never reaches you — so the verdict is rebuilt from three things that must hold together: the browser reporting the path bandwidth-limited, `receivingBitrate` collapsing below `collapseRatio` of its rolling maximum, *and* the video jitter buffer holding frames at `bufferElevationRatio` of its own pre-episode baseline.

It closes the finding when the browser stops reporting a bandwidth limitation, not on a bitrate threshold: nothing here knows what the path can carry now, so a link that settles at half its old capacity has recovered and a ratio against its old maximum would never say so.

**Use the result:** ask the sender for less (a lower simulcast layer, a lower target), and show the receiving side of your network indicator.

```javascript
downlinkCongestionDetector: {
    collapseRatio: 0.6,        // arriving bitrate below this share of its rolling max
    bufferElevationRatio: 2,   // buffer delay over its own pre-episode baseline
}
```

```typescript
monitor.on('downlink-congestion', ({ receivingBitrate, maxReceivingBitrate, jitterBufferDelayInMs }) => {
    ui.setNetworkIndicator('poor');
    signaling.requestLowerLayer();
});
```

**The buffer half is what makes it mean anything.** A static screen share, a muted camera or a dropped simulcast layer collapses the arriving bitrate with the buffer perfectly normal — the sender simply had less to send. **Loss is recorded on the payload and not read:** measured against a 500 kbit throttle it ran at 39% and 47% for about six seconds and then read zero for the rest of an unchanged throttle, because the far end's estimator had adapted down and stopped overshooting. Anything resting on it resolves in the middle of the episode it is reporting.

**Know this before you trend it: it is blind on a receive-only connection.** `qualityLimitationReason` describes this endpoint's *encoder*, and a connection that sends nothing reports none — so a webinar attendee or a spectator sets [`inputsUnavailable`](#when-a-detector-cannot-see-its-inputs) rather than getting a verdict. Same for an audio-only sender and for browsers that do not implement the field. On a shared last mile the sending verdict is about the link both directions cross, which is what makes it worth gating on; where the two directions do not share a bottleneck, the gate can be shut while your downlink is genuinely congested.

**Sources:** [W3C webrtc-stats: jitterBufferDelay](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay) · [W3C webrtc-stats: availableIncomingBitrate](https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatepairstats-availableincomingbitrate)

##### The `congestion` event

The two detectors raise two issue types, because they answer two questions from two sets of evidence. But plenty of applications only want to know that this connection is capacity-limited *somewhere* — enough to dim a network badge — so both also emit **`congestion`**, discriminated on `direction`:

```typescript
monitor.on('congestion', (event) => {
    ui.setNetworkIndicator('poor');

    if (event.direction === 'uplink') sender.capBitrate(event.availableOutgoingBitrate * 0.8);
    else signaling.requestLowerLayer();
});

// The same question asked of a connection rather than of the event stream:
if (peerConnectionMonitor.congested) { /* either direction */ }
```

It carries the whole payload of whichever detector fired rather than a flattened summary, because a bandwidth estimate and an arriving bitrate are not the same quantity and should not share a field name. A connection congested both ways fires it twice, once per direction, as the two findings open — two independent verdicts, since neither detector consults the other. There is no combined *issue*: `getActiveIssuesByType` takes `'uplink-congestion'` or `'downlink-congestion'`, and `peerConnectionMonitor.congested` is the one-word reading of the pair.

#### Transport quality detectors

The path is established, ICE is connected, DTLS completed — and the transport is still the reason the call is bad. Congestion was the only detector here for a long time, answering for both directions from one signal; it is now two, and three more cover the properties of a working path that had no owner at all.

> Full reference for all five — where each number is derived, the shared two-threshold shape, the false positives and what each one refuses to claim: [docs/TRANSPORT_QUALITY_DETECTORS.md](./docs/TRANSPORT_QUALITY_DETECTORS.md).

| Property | Detector | Issue | The question |
|---|---|---|---|
| Capacity | `UplinkCongestionDetector` | `uplink-congestion` | Is our sending path narrower than what we want to put on it? |
| | `DownlinkCongestionDetector` | `downlink-congestion` | Is our receiving path narrower than what is being sent to us? |
| Delay | `TransportDelayDetector` | `transport-delay-degraded` | Does the round trip take too long? |
| Delivery reliability | `TransportLossDetector` | `transport-loss-sustained` | Are packets being dropped? |
| | [`BlockedTransportDetector`](#blockedtransportdetector) | `blocked-transport` | Are they being dropped *completely*, by policy? |
| Delivery stability | `TransportJitterDetector` | `transport-delivery-unstable` | Do they arrive evenly? |

**`transport-delay-degraded`** reads `pcMonitor.ewmaRttInSec`, already smoothed on the peer connection — a single inflated RTT sample is common and means nothing. What the detector adds is duration and hysteresis: the round trip must stay above `thresholdInMs` for `durationInMs` of *stats time*, and must fall below `recoveryThresholdInMs` to clear, so a call sitting exactly on the line does not flap the issue open and shut. Round trip around 300 ms is where turn-taking starts to break down; ITU-T G.114 puts one-way "generally acceptable" at 150 ms. Note that **RTT to an SFU is a half-path measurement** and never sees the far leg — this is evidence about *this endpoint's* path and must not be presented as end-to-end latency.

**`transport-loss-sustained`** watches both directions with one threshold and reports whichever is worse, with the direction in the payload. Loss has always been visible to this library, but only as somebody else's qualifier: it gated the retired `CongestionDetector`'s low-sensitivity mode and stands `DecoderPerformanceDetector` down so it does not blame a decoder for a network fault. Neither makes a claim *about the loss*, so nothing could raise it, resolve it, or count it. The means it reads — `avgInboundFractionLost` and `avgOutboundFractionLost` — exclude streams that carried nothing this tick rather than counting them as healthy; without that gating, a call with eight muted tracks and one bleeding one looks fine.

**`transport-delivery-unstable`** reads `avgInboundJitterInMs`: packets arrive, but not evenly, forcing the receiver to buffer more than it should. Capacity may be fine and loss may be zero; what is wrong is the timing. Keep it distinct from [`audio-jitter-buffer-stress`](#jitterbufferstressdetector), which measures the *jitter buffer* straining — deep target delay plus audible time-stretching — a perceived symptom on one track. This measures the network delivering unevenly, which is its cause and lives on the path. They frequently co-fire, and that co-firing is informative precisely because neither consults the other: cause and symptom confirmed independently is evidence, whereas a symptom detector that only fires when a cause detector already fired is just an echo.

```javascript
transportDelayDetector: {
    thresholdInMs: 300,          // smoothed RTT at or above which the path counts as slow
    recoveryThresholdInMs: 200,  // RTT below which it resolves
    durationInMs: 6000,          // stats time it must stay high before raising
},
transportLossDetector: {
    threshold: 0.05,             // mean interval loss fraction (0..1)
    recoveryThreshold: 0.01,
    durationInMs: 6000,
},
transportJitterDetector: {
    thresholdInMs: 100,          // mean inter-arrival jitter
    recoveryThresholdInMs: 30,
    durationInMs: 6000,
},
```

```typescript
monitor.on('transport-delay-degraded',    ({ rttInMs })              => ui.setNetworkIndicator('slow', rttInMs));
monitor.on('transport-loss-sustained',    ({ fractionLost, direction }) => metrics.gauge(`loss.${direction}`, fractionLost));
monitor.on('transport-delivery-unstable', ({ jitterInMs })           => metrics.gauge('jitter', jitterInMs));
```

**None of them reads any other.** They will co-fire when several are true, and that is the honest answer: a path can be uncongested and slow (a long physical route, a relay on the wrong continent) or congested and short; a well-behaved congestion controller produces a congested path with very little loss, while a lossy wireless link produces loss with no congestion signal at all.

All three new detectors set `inputsUnavailable` when the browser reports nothing to judge, so "no issue" and "no measurement" stay distinguishable.

**Threshold caveat.** These are round starting points meant to be tuned against a real fleet, not measurements of anything.

**Sources:** [ITU-T G.114 (one-way transmission time)](https://www.itu.int/rec/T-REC-G.114) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### CpuPerformanceDetector

> Filed under **Pipeline Disruption** even though it names a cause rather than a boundary — the one strained member of that category, and [the taxonomy says why it is kept there anyway](./docs/PIPELINE_DISRUPTION_DETECTORS.md#across-both-chains--the-machine).

Client-wide CPU pressure: outbound streams explicitly CPU-limited (instantaneous label *and* sustained duration shares), encode time per frame over budget, inbound decode falling behind receive, or stats collection itself slowing down.

**Use the result:** shed load in order of user impact — disable background blur/effects first, then reduce rendered remote videos, then lower capture resolution. Resolve restores them.

```javascript
cpuPerformanceDetector: {
    incomingDecodedFramesRatioThresholds: { alertOn: 0.7, alertOff: 0.85, minReceivedFrames: 10 },
    durationOfCollectingStatsThreshold: { lowWatermark: 5000, highWatermark: 10000 },
    encoderCpuLimitationShareThreshold: 0.3, // share of interval spent CPU-limited
    encodeTimeBudgetRatio: 0.8,              // encode ms per frame vs 1000/fps budget
}
```

```typescript
monitor.on('cpulimitation', () => effects.disableBackgroundBlur());
monitor.on('issue-resolved', (issue) => {
    if (issue.type === 'cpulimitation') effects.restore();
});
```

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### IcePathEstablishmentDetector

Emits `'ice-path-establishment-slow'` (and the `LONG_PC_CONNECTION_ESTABLISHMENT` client event) when a peer connection stays in `connecting` past the threshold. Re-arms on any exit from `connecting`, so slow *retries* are reported too. Since 4.8.0 the payload names *where* setup is stuck via `stalledStage` — `'ice-gathering'`, `'ice-checking'`, `'dtls'` or `'unknown'` — because `connecting` covers ICE and the DTLS handshake alike, and the two have different fixes.

**It raises no issue, on purpose:** saying establishment is slow is not yet a claim that it has failed. That claim belongs to [`IceEstablishmentFailedDetector`](#iceestablishmentfaileddetector), the other half of layer 3, with its own threshold well past this one's. The `never-established` ICE restart recommendation used to live here too; it now belongs to [`IceRestartRecommendationDetector`](#the-restart-loop) alongside the other three restart reasons, so that the rate limiting across all four is shared — and since 4.10.0 its threshold and cooldown live in that detector's own config block rather than in this one, so `icePathEstablishmentDetector: null` no longer silences the recommendation.

**Use the result:** show "connecting is taking longer than usual"; if it repeats, retry with `iceTransportPolicy: 'relay'` to test whether direct connectivity is the blocker. `stalledStage` says whether to look at the network (`ice-gathering`, `ice-checking`) or at certificates and DTLS interop (`dtls`).

```javascript
icePathEstablishmentDetector: {
    thresholdInMs: 5000,  // `connecting` for this long is reported
    createEvent: true,    // also buffer LONG_PC_CONNECTION_ESTABLISHMENT into samples
}
```

**Sources:** [RTCPeerConnection.connectionState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState) · [ICE (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/ice/)

#### IceEstablishmentFailedDetector

The other half of layer 3, and the one that produces an issue: `ice-establishment-failed` is **the call that never connected** — by a wide margin the most common connectivity failure a user actually reports, and until this detector existed the one thing the library could not put in `activeIssues`. Layer 3 emitted an event when establishment dragged on, but an event is a notification: it is gone the moment it fires, it does not resolve, and nothing asking "what is wrong with this session right now" could see it. So the single most user-visible failure produced an empty issue list, which reads as a healthy call.

Three facts must hold together, none sufficient alone, for the whole of `thresholdInMs` of accumulated stats time:

-   **Local candidates exist** — so this is emphatically not the no-network case, which [`IceReachabilityDetector`](#icereachabilitydetector) owns. The two are mutually exclusive by construction rather than by suppression.
-   **The peer connection never reached `connected`** — so this is establishment failing, not a working call that later broke, which the [layer-5 detectors](#the-layer-5-detectors) own.
-   **No candidate pair was ever nominated or reached `succeeded`** — which separates "checks are still running and might yet win" from "nothing ever won". The check is *latched*: a pair that won once is proof establishment got there, however the pair looks on any later tick.

The default 15 s sits well past `icePathEstablishmentDetector.thresholdInMs` on purpose — a connection that is merely slow has to be given time to stop being merely slow. Measuring in stats time rather than wall clock matters here more than almost anywhere: ICE checking legitimately takes seconds, and a wall-clock threshold would punish a slow collection rather than a slow connection.

**The payload carries what was tried, not only that it failed** — which is where the candidate types and pair states this library has collected since forever finally earn their place:

| `localCandidateCounts` shows | Reading |
|---|---|
| host only | Gathering never reached a STUN server |
| host + srflx, no relay | TURN was never configured or never answered — the most common cause of a call that fails only between certain networks |
| relay present, every pair `in-progress` or `failed` | The relay is unreachable, or the far end never answered the checks |

`candidatePairStates` is every distinct pair `state` seen, deduplicated and sorted, and `candidatePairCount` how many there were.

```javascript
iceEstablishmentFailedDetector: {
    thresholdInMs: 15000, // stats time the connection must go on failing to establish
}
```

```typescript
monitor.on('issue', (issue) => {
    if (issue.type !== 'ice-establishment-failed') return;
    const { localCandidateCounts, candidatePairStates } = issue.payload;
    if (localCandidateCounts.relay === 0) ui.showBanner('This network needs a TURN relay to connect');
    reportToServer('establishment-failed', { localCandidateCounts, candidatePairStates });
});
```

**What it will not claim:** which side is at fault. Every fact here is local — what this endpoint gathered and how its own checks went — and a far end that never sent an answer looks exactly like a far end whose candidates cannot be reached. The counts are evidence for a human or for server-side correlation, not a verdict.

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### The layer-5 detectors

Runtime health of a path that **already worked**, per ICE transport — a peer connection without BUNDLE has several and they fail independently. Four classes, four issues, four config keys — `iceDisconnectedDetector`, `iceConnectionFailedDetector`, `iceTransportStalledDetector`, `unstableIcePathDetector` — each of which removes exactly its own class when set to `null`.

| Class | Issue | Raised when |
|---|---|---|
| `IceDisconnectedDetector` | `ice-disconnected` | `disconnected` outlasted `disconnectedThresholdInMs` |
| `IceConnectionFailedDetector` | `ice-connection-failed` | `iceState` reached `failed` — immediately, since it is terminal for the generation |
| `IceTransportStalledDetector` | `ice-transport-stalled` | Still sending on a succeeded pair of a connected transport, nothing coming back, after inbound had been seen |
| `UnstableIcePathDetector` | `unstable-ice-path` | `pathSwitchThreshold` selected-path switches inside `pathSwitchWindowInMs` |

Each keeps its own per-transport state and each reads the ICE local username fragment itself to notice a new generation, rather than asking `IceRestartDetector` — so none depends on another or on the order they run in. That is about twenty duplicated lines per class, and it is deliberate.

**`ice-disconnected` waits; `ice-connection-failed` does not.** `disconnected` on its own is never worth an issue: it is what a browser says when consent checks have missed for a moment, and a Wi-Fi roam or a brief radio dropout produces it several times in an ordinary call while ICE quietly recovers. Only duration separates the blip from the outage. `failed` is the opposite — the browser will not retry candidates on its own, so there is nothing to wait out. A transport falling from `disconnected` into `failed` does *not* resolve the disconnection issue: it has not recovered, it has got worse.

**`ice-connection-failed` carries `everConnected`**, and that field is the reason the issue is worth reading rather than just counting. `IceTransportMonitor.everConnected` is a latch — set the first time the transport reads `connected` or `completed`, never cleared — so it is the transport's own record rather than an inference. `failed` alone conflates two faults that share a state and share nothing else:

| `everConnected` | Meaning | Where to look |
|---|---|---|
| `false` | The path **never worked**: no candidate pair ever won | Symmetric NAT with no TURN, a firewall eating the checks, a TURN credential the client never got |
| `true` | The path **worked and was lost** | The network underneath: the interface changed, the NAT binding expired, the route died |

**`ice-transport-stalled` is the quiet failure**: every state reads healthy while the transport keeps sending and receives nothing back. No state machine will ever report it, because as far as the browser is concerned nothing has gone wrong. Our own outbound traffic is what makes the expectation defensible — a live path returns at least STUN consent responses and RTCP for whatever we send. The mirror case, silence in *both* directions, is deliberately **not** reportable: it cannot be told apart from a legitimately idle connection. Two guards keep it off send-only transports, which is the ordinary shape of an SFU uplink: inbound traffic must have been seen on the transport before, and inbound RTP must be attributed to it at all.

**`unstable-ice-path` counts switches as the larger of two sources.** Diffing `selectedCandidatePairId` tick to tick is portable but blind to a flap that departs and returns inside one collecting period; the browser's own `selectedCandidatePairChanges` delta (Chrome 80+, Firefox 155+) sees exactly those but is absent on Safari. Taking the maximum uses the better evidence where it exists and still works where it does not; the payload carries the native count separately as `nativePairChanges`. The window is *tumbling*, not sliding — each tick adds the transport's `deltaTime`, and once `pathSwitchWindowInMs` accumulates both counters reset. Three switches in thirty seconds is reasoned rather than arbitrary: a legitimate handover produces one, occasionally two, and consent checks run roughly every five seconds, so three means no path survived even a few consent intervals.

```javascript
iceDisconnectedDetector:     { disconnectedThresholdInMs: 5000 },   // how long `disconnected` may self-heal
iceConnectionFailedDetector: {},                                    // terminal state, nothing to tune
iceTransportStalledDetector: { transportStallThresholdInMs: 5000 }, // sending-but-not-receiving tolerance
unstableIcePathDetector: {
    pathSwitchWindowInMs: 30000,       // window for counting selected-path switches
    pathSwitchThreshold: 3,            // switches in the window => unstable path
}
```

```typescript
monitor.on('issue', (issue) => {
    if (issue.type !== 'ice-connection-failed') return;
    // "never worked" and "worked and was lost" need different evidence and different fixes
    reportToServer(issue.payload.everConnected ? 'path-lost' : 'path-never-worked', issue.payload);
});
```

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [RFC 7675: STUN consent freshness](https://datatracker.ietf.org/doc/html/rfc7675) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### The restart loop

Two classes sit beside the connectivity ladder rather than on it. Neither raises an issue and neither ever will: a restart is a fact about the connection, not a fault — restarts are exactly what a healthy application does when a network changes underneath a call, so an issue would flag the recovery rather than the problem.

`IceRestartRecommendationDetector` names *when* an ICE restart is warranted; performing it is the application's job, because only the application knows whether renegotiation is safe right now, whether signalling is even up, and what an SFU on the other end expects. Four conditions warrant one, and they live in one class because they answer one question — *would starting ICE over help?* — and because the rate limiting only means anything if it is shared. Two detectors each politely waiting out their own cooldown produce twice the nagging.

| `reason` | Scope | Waits for |
|---|---|---|
| `ice-failed` | per transport | Nothing — ICE never self-heals from `failed`. |
| `ice-disconnected` | per transport | `iceRestartRecommendationThresholdInMs`. |
| `transport-stalled` | per transport | `iceRestartRecommendationThresholdInMs`. |
| `never-established` | per peer connection | `restartRecommendationThresholdInMs`. |

`never-established` is measured against `connectingStartedAt` rather than any transport clock, because the fault is the absence of a working transport — there may be none in a reportable state, or none at all. It yields to `ice-failed` and `ice-disconnected`: a transport in either state names what went wrong, where "it never connected" only names what did not happen.

**All four thresholds and cooldowns live in one block of its own**, `iceRestartRecommendationDetector`, and they are its own rather than borrowed from the detectors that raise the corresponding issues — recommending a renegotiation is a different decision from reporting a fault, and it is normal to want the advice to wait longer than the issue did. It used to read the `never-established` pair out of `icePathEstablishmentDetector` and the per-transport pair out of the path-stability key, so each half was gated by a different neighbour. Both halves now run whenever this key is set, and `iceRestartRecommendationDetector: null` is the one way to silence any of it:

```javascript
iceRestartDetector: { createEvent: true },
iceRestartRecommendationDetector: {
    createEvent: true,
    iceRestartRecommendationThresholdInMs: 10000, // per transport: disconnected / stalled
    iceRestartRecommendationCooldownInMs: 15000,
    restartRecommendationThresholdInMs: 10000,    // per pc: never established at all
    restartRecommendationCooldownInMs: 15000,
}
```

Every verdict here is reached from raw transport and connection state, never by asking the layer-5 detectors what they concluded — which is why the stall condition and all its guards are written out a second time in this class. A restart already in flight suppresses further recommendations until it resolves, since asking for a second while the first is still negotiating is how an application ends up in a restart loop.

`IceRestartDetector` then reports what happened. The evidence is a changed ICE local username fragment, which is renegotiated per generation and is the one field a restart cannot leave alone — an inference, not a report, since the browser exposes no "a restart happened" signal and stats cannot separate one the application asked for from one the browser started itself. Firefox's transport report is reconstructed by `FirefoxStatsAdapter` and carries no fragment, so the detector falls back to the selected local candidate's `usernameFragment` and stays silent when neither exists. Three outcomes are emitted rather than one, because "a restart was attempted" and "the restart worked" are different facts:

| `outcome` | Meaning |
|---|---|
| `detected` | A new generation was observed. |
| `recovered` | That generation reached `connected` / `completed`. |
| `failed` | That generation reached `failed`. A generation still checking has no outcome yet, and none is invented for it. |

```typescript
monitor.on('ice-restart-recommended', ({ peerConnectionMonitor, reason, recommendationCount }) => {
    if (recommendationCount >= 3) return session.rejoin(); // restarts are not helping
    rtcPeerConnection.restartIce();                        // or mediasoup transport.restartIce()
});
monitor.on('ice-restart', ({ outcome }) => metrics.count(`ice-restart.${outcome}`));
```

A rising `recommendationCount` against a flat `iceGeneration` is what tells you the advice is not being taken; a rising count *with* a rising generation says restarts are being performed and are not working, which is the escalation-to-rejoin signal.

**Sources:** [ICE restart: recovering connectivity (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/ice-restart/) · [RTCPeerConnection.restartIce (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce) · [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445)

#### BlockedTransportDetector

> **Transport Quality**, not Connectivity — it *requires* every connectivity stage to have completed before it will judge. Full reference, including the two `evidence` shapes and the Firefox fallback that makes it work at all: [docs/TRANSPORT_QUALITY_DETECTORS.md](./docs/TRANSPORT_QUALITY_DETECTORS.md).

**Transport Quality → delivery reliability**, not a connectivity layer. It used to be filed as a sixth connectivity layer, "media flow", on the reasoning that the network is the subject. That was the wrong cut: every connectivity stage completes and *holds* while this fires — the candidate pair is `succeeded`, consent checks keep passing, `iceConnectionState` reads `connected` — and the path simply is not delivering, which is Transport Quality's membership test word for word. Under the delivery-reliability heading it also sits where it belongs relative to its neighbour: [`transport-loss-sustained`](#transport-quality-detectors) is a path dropping a share of what crosses it, and `blocked-transport` is a path dropping all of it for a reason that is policy rather than capacity. The issue type, its payload and the `blockedTransportDetector` config key are unchanged.

The firewall signature: a middlebox that lets ICE/STUN through but blocks the media itself. Every connectivity signal looks healthy and yet the call carries nothing. The other detectors structurally miss this case: STUN consent responses count into the pair's `bytesReceived`, so the pair never looks dry and [`ice-transport-stalled`](#the-layer-5-detectors) never fires, while the dry-track detectors see outbound-rtp counters advancing and stay silent.

Raises `blocked-transport` (per ICE transport) when, sustained for `thresholdInMs`, all of these hold: ICE brought the path up and the selected pair is `succeeded`, STUN is demonstrably alive (`responsesReceived` advanced within `stunFreshnessInMs`), at least one outbound RTP stream is attributed to the transport, and the transport's own send counter is moving at under `maxSendShare` of what those senders produce.

**Only the send side is judged, and that is a deliberate limit.** There the client holds both halves of the proof — it produced the bytes and it reads what the transport put on the wire. On the receive side it holds one half: what *should* have arrived is a fact about the far end that no client stat reports, so a middlebox eating media, an SFU that stopped forwarding, a paused producer and a silent speaker are the same reading in `getStats()`. A dry return path is [`dry-inbound-track`](#dryinboundtrackdetector)'s finding, and a block in the receive direction surfaces on the remote peer's own sending side.

**Nothing is gated on media having flowed successfully first.** A blocked transport is normally blocked from its first packet — the user is behind a corporate firewall, nothing gets out, and reloading puts them behind the same wall — so any "it was working and then stopped" bar would switch the detector off in the case it exists for.

The payload's `evidence` field splits the fault by where it happened:

| `evidence` | Meaning | Where the fault is |
|---|---|---|
| `media-discarded-on-send` | The pair's `packetsDiscardedOnSend` is advancing — the OS refused the packets. | On this machine: socket error, host firewall, full send buffer. |
| `media-not-leaving-transport` | No discard counter advancing, whether because the browser reports none or because it reports zero. | Beyond this machine: the packets left as far as this endpoint can tell. |

An *unreported* `packetsDiscardedOnSend` falls on the same side as a zero one — a counter the browser does not publish is not evidence of a local fault.

**One instance judges one transport**, and lives on `IceTransportMonitor.detectors`, so reaching it means `iceTransport.detectors.getByName('blocked-transport-detector')` rather than the peer connection's registry. A replaced transport gets a detector whose clocks start at zero; a transport that goes away takes its detector with it, leaving the issue open, as with every monitor-bound detector. The `blockedTransportDetector` config key gates construction on every transport at once.

Every clock — how long the discrepancy has held, how long since STUN last answered, and the interval under the fallback bitrate — accumulates the ICE transport's own `deltaTime`. That matters most in exactly the conditions this detector fires under: a saturated main thread that delays collections would otherwise credit the firewall with time the library merely spent not looking, and would age out a perfectly fresh STUN response for the same reason.

**It detects only where the browser supplies the stats, and never infers them.** Where the transport's byte counters are missing (Firefox through 153) the selected pair's own `deltaBytesSent` is read instead — a different real measurement of the same traffic. Where `responsesReceived` is missing (Firefox before 142) there is no substitute for proof that the path still answers, so the transport is not judged at all and `inputsUnavailable` is set, rather than reading ICE's `connected` as consent. A consent counter that has not advanced *yet* is treated the same way: the freshness clock starts when the first response lands, not at zero.

```javascript
blockedTransportDetector: {
    thresholdInMs: 5000,          // discrepancy persistence before raising
    maxSendShare: 0.1,            // transport send under this share of produced => blocked on send
    stunFreshnessInMs: 10000,     // consent checks run ~5s; must comfortably exceed one interval
}
```

**Use the result:** tell the user their network blocks media (a TURN/TLS fallback or a network change is the fix, an ICE restart on the same path is not), and correlate server-side: many `blocked-transport` clients on one corporate network is a firewall policy, not N user problems.

**Sources:** [RFC 7675: STUN consent freshness](https://datatracker.ietf.org/doc/html/rfc7675) · [RTCIceCandidatePairStats (W3C webrtc-stats)](https://www.w3.org/TR/webrtc-stats/#candidatepair-dict*) · [WebRTC and firewalls (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/firewall/)

#### The DTLS detectors

Layer 4 separates "the network path failed" (the ICE detectors' territory) from "the secure media transport never negotiated", which nothing owned before: a certificate fingerprint mismatch, DTLS version intolerance, or a middlebox that passes STUN but eats DTLS all used to present as a generically slow `connecting`.

Two classes, per ICE transport, each with a config key of its own — because the browser announcing a verdict and the browser saying nothing at all are different problems with different evidence, and either can now be switched off without the other.

`DtlsHandshakeFailedDetector` raises **`dtls-handshake-failed`** on the first tick reporting `dtlsState: 'failed'`. There is nothing to wait for and nothing to average — `failed` is the browser's terminal verdict on this key exchange — so there is no maturity guard and no duration threshold, and the issue is raised once per transport rather than once per tick. Only a later `connected` resolves it, which in practice means an ICE restart re-ran the handshake and the new generation succeeded; a transport dropping back to `new`/`connecting` after a restart is not yet evidence of anything, so the issue stays open until one actually completes. Its `dtlsHandshakeFailedDetector` block is empty by design: `failed` is not a matter of degree, so there is nothing here to tune — `{}` enables the detector, `null` removes it.

`DtlsHandshakeStalledDetector` raises **`dtls-handshake-stalled`** when the ICE side is proven healthy while `dtlsState` sits in `new`/`connecting` past `stalledThresholdInMs`. This is the half with no verdict to read: a handshake being eaten by a middlebox and one that is a few hundred milliseconds from completing look identical in a single stats report, and only duration separates them — accumulated in stats time, so a collection that ran late credits the handshake with exactly the time it spent quiet.

The ICE-health proof is what keeps the layer honest, since DTLS cannot complete over a path that is not yet usable and reporting it would mean re-reporting what the ICE detectors already own. It has two forms, and the payload's `iceEvidence` records which one carried it — a finding resting on the weaker of them is worth less to whoever reads it:

| `iceEvidence` | Meaning |
|---|---|
| `transport-ice-state` | The transport reported `iceState` `connected`/`completed`. |
| `selected-pair-succeeded` | No `iceState` reported (Safari, and the transport reconstructed for Firefox < 153); the selected pair being `succeeded` stood in. |

What the stall detector will not judge: a transport on its first observed tick (Firefox 153/154 report pre-negotiation transport values that only 155 makes trustworthy); `dtlsState: 'closed'`, which is a shutdown, not a failure; and a transport whose ICE side is not proven healthy, where the ICE detectors own whatever is wrong. An inferred ICE restart clears the stall timer, since the new generation re-runs the handshake and deserves the full threshold rather than inheriting the old one's.

```javascript
dtlsHandshakeFailedDetector: {},  // terminal state, nothing to tune
dtlsHandshakeStalledDetector: {
    stalledThresholdInMs: 6000,   // ICE healthy, DTLS still `new`/`connecting` for this long
}
```

**Use the result:** `dtls-handshake-failed` is a configuration or interop problem, not a network problem — check certificate fingerprints in signaling and TLS interception on the client's network; an ICE restart on the same path *can* help because it re-keys DTLS. Server-side, a failure rate concentrated on one browser version is a browser regression; concentrated on one customer network, a middleware/DPI policy.

**Sources:** [RTCDtlsTransport.state (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCDtlsTransport/state) · [RTCTransportStats (W3C webrtc-stats)](https://www.w3.org/TR/webrtc-stats/#transportstats-dict*) · [RFC 8827: WebRTC Security Architecture](https://datatracker.ietf.org/doc/html/rfc8827)

#### IceReachabilityDetector

The other end of the connectivity spectrum: the client cannot even *begin* to connect because ICE gathering produced **zero local candidates**. A healthy establishment gathers a host candidate within milliseconds — even without internet, any up interface yields one. Zero candidates while the connection state jumps from `new`/`connecting` straight to `disconnected`/`failed` means there was nothing to connect *with*: no interface, airplane mode, a VPN that tore down every route. This is a different diagnosis from every other ICE issue — those describe a path that existed and stopped working; this one says no path was ever possible.

Raises `no-available-ice-candidate` (per peer connection) immediately on `disconnected`/`failed` with zero local candidates on a never-connected PC, and after `thresholdInMs` when the PC just sits in `new`/`connecting` with nothing gathered. Zero candidate rows count as evidence only once `iceGatheringState` reads `complete` — before that they mean gathering is still running, and where the field is absent they mean nothing was measured. Resolves when a local candidate appears or the connection reaches `connected`. Never fires on a connection that once connected — mid-call network loss belongs to [the layer-5 detectors](#the-layer-5-detectors), and an establishment that had candidates but never won a pair belongs to [`ice-establishment-failed`](#iceestablishmentfaileddetector). The two layer-1 and layer-3 issues are mutually exclusive by construction rather than by suppression.

```javascript
iceReachabilityDetector: {
    thresholdInMs: 6000, // grace for `new`/`connecting` before the sustained variant raises
}
```

**Use the result:** skip the ICE-restart dance entirely — recommend the user check their connection; on the server, treat the client as offline-at-join rather than call-quality-degraded.

**Sources:** [RTCPeerConnection.connectionState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState) · [RTCPeerConnection.iceGatheringState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceGatheringState) · [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445)

#### RtpSenderStalledDetector / TransportDemuxStalledDetector

Media moves through a fixed chain — capture → frame supply → encoder → RTP sender ‖ RTP receiver → frame assembly → decoder → renderer — every stage carries a monotonic counter proving progress, and a disruption is *locatable* as the boundary where the upstream counter advances and the downstream one stays flat. Most boundaries are owned by specialist detectors; these two cover the ones nothing else does. The whole chain, boundary by boundary, is [docs/PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md). Each has a config key of its own and raises its own issue:

| Class | Issue | The boundary |
|---|---|---|
| `RtpSenderStalledDetector` | `rtp-sender-stalled` | `deltaFramesEncoded > 0` while `deltaPacketsSent === 0` on the same outbound RTP — an encoded frame always packetizes, so a sustained violation is a wedged sender or pacer (seen after `replaceTrack` races and simulcast reconfigurations). State is kept per ssrc, since simulcast layers wedge one at a time. |
| `TransportDemuxStalledDetector` | `transport-demux-stalled` | The ICE transport receiving at or above `minTransportReceiveBitrateBps` — well above what RTCP + STUN can explain — while every inbound RTP attributed to it reports zero bytes. Traffic arrives that never reaches a stream: an SSRC mismatch after renegotiation, or a consumer created against a producer that is already gone. |

There is no `media-pipeline-stalled` issue any more, and no `stage` / `direction` discriminator: one class raises one issue type, and the two boundaries are different enough that folding them into one payload field never helped a reader decide anything. Neither class reads any issue but its own — the predecessor annotated every payload with a `suspectedIssueTypes` list of the other issues active on the peer connection, which made one detector's output a function of every other detector's verdicts and of the order they ran in. That field is gone. Correlating issues is the server's job, where the whole session is visible and `peerConnectionId` plus a time window does the same work properly.

The innocent explanations for silence on the wire — congestion, resolution adaptation, a paused sender — would all have stopped the *encoder*, so they cannot produce the send-side signature. What is refused outright: a closed peer connection, and an outbound RTP whose track is missing, muted or not live, or whose simulcast layer is inactive. On the receive side, the bitrate floor rules out RTCP and STUN explaining the arriving bytes, and without at least one inbound RTP there is no demux expectation to violate at all — a send-only transport has nothing to demux into by design.

```javascript
rtpSenderStalledDetector: {
    thresholdInMs: 4000,                  // stats time a broken boundary must persist
},
transportDemuxStalledDetector: {
    thresholdInMs: 4000,                  // its own copy of the same tunable
    minTransportReceiveBitrateBps: 20000, // above this, incoming traffic must demux
}
```

```typescript
monitor.on('rtp-sender-stalled',      ({ ssrc })        => sender.renegotiate(ssrc));
monitor.on('transport-demux-stalled', ({ transportId }) => sfuClient.recreateConsumersOn(transportId));
```

**Use the result:** `rtp-sender-stalled` → renegotiate or replace the sender (the encoder is fine, the pipe after it is wedged); `transport-demux-stalled` → recreate the consumers / re-signal SSRCs (the network is fine, the demux is not).

`transport-demux-stalled` reads `transport.receivingBitrate`, derived from the `RTCTransportStats.bytesReceived` Firefox does not populate as of 153, so it sets [`inputsUnavailable`](#when-a-detector-cannot-see-its-inputs) on a tick where nothing demuxed and no receiving bitrate was reported — its silence there is "cannot see", not "nothing is wrong". `rtp-sender-stalled` compares `framesEncoded` against `packetsSent` on the same outbound RTP, both well supported everywhere, and has no such blind spot.

#### IceTraversalDetector

The low-level primitive under the path detectors: emits `'ice-tuple-changed'` whenever the set of selected `local:remote` network tuples changes. It raises no issue by design — needing TURN is a cost, not a fault, and no threshold on tuple changes would be defensible, so its `iceTraversalDetector` block is empty: `{}` enables it, `null` removes it. Until 4.10.0 it had no key at all and was the one detector registered unconditionally. `SelectedIcePath` classifies *what kind of* change it was and emits `'ice-path-changed'`; [`UnstableIcePathDetector`](#the-layer-5-detectors) owns the issue raised when a path keeps switching. Growing from an empty tuple set is skipped, since establishment is not a change.

**Use the result:** debugging and logging — a tuple change with no `ice-path-changed` classification usually means a port change on the same interface.

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [TURN server: when you need it and what it costs (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/turn/) · [RTCIceCandidateStats.relayProtocol (MDN)](https://developer.mozilla.org/docs/Web/API/RTCIceCandidateStats/relayProtocol) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Observation detectors

These emit events and **never raise issues** — they record context that is not a fault but is the missing column in most investigations. Each reads a config block of its own, named after the detector, and each carries `createEvent` (default `true`), which buffers the matching client event into samples for server-side use; `statsGapDetector` adds the two thresholds that decide what counts as a gap.

> These are the **Telemetry** category. The full reference — every event payload, the change-detection rules, the Session and Endpoint facts that no detector carries at all, and the recorded gaps — is [docs/TELEMETRY_DETECTORS.md](./docs/TELEMETRY_DETECTORS.md).

The membership test is deliberately counterfactual: *would raising an issue here ever be the right thing to do?* If the answer is no, it belongs here. A detector never lands here because of a bug or a missing implementation.

| Detector | Monitor event / client event | Use the result for |
|---|---|---|
| `CodecChangeDetector` | `codec-changed` / `CODEC_CHANGED` | Answering "why do all the bad calls use H264" — compares `sdpFmtpLine` too, so an H264 profile switch is caught. Fires once or twice per call. |
| `VideoResolutionChangeDetector` | `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | Following the adaptation ladder. On outbound tracks the event carries `qualityLimitationReason` — the field that separates encoder adaptation from your own constraint changes. Classified `upgrade` / `downgrade` / `reshape` (orientation flip). |
| `SimulcastLayerDetector` | `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Debugging "why is this participant blurry": a layer counts as active only if it *sent bytes*, so a layer the encoder quietly gave up on becomes visible. |
| [`CaptureTrackMutedDetector`](#capture-detectors) | `capture-track-muted` / `CAPTURE_TRACK_MUTED` | Marking where capture stopped, so the silence and dry-track findings that follow stop looking mysterious. `track.muted` covers the deliberate system mute and the accidental device grab alike, which is why it is not an issue. Config: `captureTrackMutedDetector`. |
| `StatsGapDetector` | `stats-collection-gap` / `STATS_COLLECTION_GAP` | Discounting the metrics right after a backgrounded-tab / sleep gap instead of reading them as a network spike. |

Three connectivity detectors are telemetry too and are documented with their subject rather than here: [`IceTraversalDetector`](#icetraversaldetector), and the two in [the restart loop](#the-restart-loop). So is [`AudioPlayoutSynthesisDetector`](#audioplayoutsynthesisdetector) — though that one is the exception the rule admits: it is a perceived-quality detector with a missing issue rather than telemetry, since a listener hearing invented speech across a sustained window *is* a fault worth raising.

```javascript
captureTrackMutedDetector: { createEvent: true },
codecChangeDetector: { createEvent: true },
videoResolutionChangeDetector: { createEvent: true },
simulcastLayerDetector: { createEvent: true },
statsGapDetector: {
    gapRatioThreshold: 2, // multiple of collectingPeriodInMs that counts as a gap
    minGapInMs: 5000,     // a single missed short tick is jitter, not a gap
    createEvent: true,
},
```

```typescript
monitor.on('video-resolution-changed', ({ trackMonitor, direction, to, qualityLimitationReason }) => {
    if (trackMonitor.direction === 'outbound' && direction === 'downgrade' && qualityLimitationReason === 'cpu') {
        // the encoder is shrinking the picture because of CPU, not bandwidth
        effects.disableBackgroundBlur();
    }
});
monitor.on('stats-collection-gap', ({ gapInMs }) => metrics.markUnreliableWindow(gapInMs));
```

**Sources:** [Simulcast (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/simulcast/) · [Page Visibility API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

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

---

### Replaying a captured session

Detector thresholds are only as good as the sessions they were checked against,
so the library ships a replay harness: a captured session is fed back through a
real `ClientMonitor` on a virtual clock, producing the same monitors, derived
fields, issues, events and samples the live run produced — against current or
experimental thresholds.

The input is JSONL, one captured collection tick per line, described by the
`ReplayEntry` type in `tests/helpers/StatsReplayer.ts`. Producing the lines is
not this library's business: a server-side capture, an app-side listener on
`'stats-collected'`, or a script synthesizing a scenario all work.

**From the command line:**

```bash
npm run replay -- tests/fixtures/degrading-camera.jsonl
npm run replay -- session.jsonl --only capture-bottleneck,encoder-bottleneck
npm run replay -- session.jsonl --config '{"sourceCaptureBottleneckDetector":{ ... }}'
cat session.jsonl | npm run replay -- - --pretty
```

Everything on stdout is NDJSON — one `{"record":"issue",...}` object per
detector fire, carrying the issue's own timestamp plus the `tick` and
`tickTimestamp` that locate it in the input, then a closing `summary` record
with per-type counts. Progress and warnings go to stderr, so the output pipes
straight into `jq`, a notebook, or a corpus runner sweeping thresholds across
many sessions. Detectors that are opt-in in production are **enabled** by
default under replay: the point of a replay is to see what they would have said.
`--help` lists every flag.

**From a spec** — drop the file in `tests/fixtures/` and use `replayFixture`:

```typescript
import { replayFixture } from './helpers/replayFixture';

const run = await replayFixture('degrading-camera');

expect(run.issueTypes.has('capture-bottleneck')).toBe(true);
run.close();
```

Its second argument is config overrides, so the same capture can be replayed
against different thresholds to find where a detector flips. For full control
— multiple monitors, tick-by-tick assertions, real-time replay — use
`StatsReplayer` directly; `tests/fixtures/README.md` has the details.

## Score Calculation

The scoring system provides quantitative quality assessment ranging from 0.0 (worst) to 5.0 (best). The library includes a `DefaultScoreCalculator` implementation and allows custom score calculators via the `ScoreCalculator` interface.

> **Full reference:** every reason key, threshold, ramp and formula is documented in [docs/SCORE_CALCULATIONS.md](./docs/SCORE_CALCULATIONS.md). This section is the overview.

### ScoreCalculator Interface

```typescript
interface ScoreCalculator {
    update(): void;
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

Based on Round Trip Time (RTT), jitter and packet loss. RTT and jitter are penalized **separately** — a long path and a jittery path are different problems with different fixes, and the score reasons say which one it is:

**RTT Penalties (`high-rtt`)** — one reason key, two magnitudes, like jitter and loss:

-   150-300ms average RTT: -1.0 point
-   \>300ms average RTT: -2.0 points

**Jitter Penalties (`high-jitter`)** — measured jitter averaged over the streams that reported one:

-   30-100ms average jitter: -1.0 point
-   \>100ms average jitter: -2.0 points

**Packet Loss Penalties (`high-packetloss`)** — the per-interval `deltaFractionLost`, **averaged** across streams (a raw sum would read ten streams at 1% each as 10%):

-   1-5% loss: -1.0 point
-   5-20% loss: -2.0 points
-   > 20% loss: -5.0 points

**Loss and jitter are attributed here and nowhere else.** They are properties of the *path*, shared by every stream on the transport, so track scores do not subtract for them — see [Track Score Calculations](#track-score-calculations).

**Only streams carrying media measure the path.** Both averages skip any stream that shows no evidence of carrying media in the interval: under `MIN_PATH_SAMPLE_BITRATE` (8 kbps) *and* under `MIN_PATH_SAMPLE_PACKETS` (25 packets) *and* delivering no frames. An SFU's bandwidth-probation stream — mediasoup sends one on `mid: "probator"` — is a handful of deliberately discardable packets with no frames, and its loss and jitter figures are not measurements of anything: observed at ~2 kbps with ~50% "loss" and ~490 ms "jitter" while the real streams beside it ran at 0% loss and 2 ms jitter. Averaged in with equal weight it used to pin the connection at the minimum score for an entire session.

#### Normalized penalty ramps

Most metric-driven penalties are **normalized to `0..1`**: nothing is subtracted while the metric stays at or below an *activation threshold*, then the penalty ramps up linearly and saturates at `1.0` at a *saturation point*:

```
penalty(value) = clamp((value − activation) / (saturation − activation), 0, 1)
```

The activation/saturation constants are `public static readonly` on `DefaultScoreCalculator`. Penalties that are effectively binary (a frozen picture, a CPU-limited encoder) stay stepped. The tables in [docs/SCORE_CALCULATIONS.md](./docs/SCORE_CALCULATIONS.md) list every ramp.

#### Track Score Calculations

**Track scores measure what the user perceived, not what the network did.** Freezes, low and volatile fps, dropped frames, pixelation, invented speech, time-stretch and jitter-buffer delay are all measurements of damage. Packet loss and jitter are *causes*, they are properties of the path rather than of any one track, and they are attributed once on the peer connection — so no track penalty subtracts for them. A server attributing a degradation joins a track's symptoms to its peer connection's path reasons, which arrive in the same sample.

**Inbound Audio Track Score:**

-   Based on normalized bitrate. **Packet loss is not subtracted here** — it belongs to the peer connection; what the loss *did* to the audio is measured directly as invented speech and time-stretch below
-   When the audio detectors run, their sustained verdicts **gate** additional penalties, and the current per-tick metric **scales** them as a normalized `0..1` ramp starting at the detector's own configured threshold:
    -   `invented-speech` issue active → scaled by `inventedSpeechRatio` (detector `allowedInventedRatio` → 0.10)
    -   `audio-jitter-buffer-stress` issue active → `high-jitter-buffer-delay`, scaled by `jitterBufferTargetDelayInMs` (detector `targetDelayThresholdInMs` → 500 ms)
    -   `audio-jitter-buffer-stress` issue active → `audio-time-stretch`, scaled by `timeStretchRate` (detector `timeStretchThreshold` → 0.3) — the same issue gates both jitter-buffer penalties, one for the depth and one for the warping
    -   A tick where the metric dipped back under the threshold contributes no penalty even while the issue is still open
-   Without the detectors the score falls back to the pure loss decay

```javascript
normalizedBitrate = log10(max(bitrate, MIN_AUDIO_BITRATE) / MIN_AUDIO_BITRATE) / NORMALIZATION_FACTOR;
score = min(MAX_SCORE, 5 * normalizedBitrate) - issuePenalties;
```

**Inbound Video Track Score:**

-   FPS volatility (`volatile-fps`, normalized 0–1): activation 0.1, saturation 0.2 — *skipped for screen share*
-   Sustained low fps while frames are flowing (`low-fps`, ewma fps < 10): -1.0 — *skipped for screen share*
-   Dropped frames (`dropped-video-frames`, normalized 0–1): activation 10%, saturation 20% of frames dropped instead of rendered
-   Frame corruptions (`video-frame-corruptions`, normalized 0–1): per-interval corruption probability, activation 0.05, saturation 0.5
-   Frozen picture (`frozen-video`, from the freeze state the detector derives): -2.0
-   Pixelation (`pixelated-video`): ramps 0→1 from the codec's activation QP to its saturation QP (`VIDEO_QP_THRESHOLDS`), from the mean quantizer of the frames actually decoded (`avgQpPerFrame`, from the inbound `qpSum`) — then multiplied by a weight chosen by **how big the picture is shown**, so the reason ranges 0–3.0.

    **A large pixelated video is charged harder, deliberately.** The same QP is punishing at full screen and nearly invisible in a grid thumbnail, because what the eye resolves is the coded block's size on screen. So the weight is not symmetric — the big video is the one the viewer is complaining about:

    ```
    magnification = sqrt((presentedW * presentedH) / (decodedW * decodedH))
    >= 1.5 -> weight 3.0   |   0.75..1.5 -> weight 2.0   |   < 0.75 -> weight 0.5
    ```

    For vp8 standard motion (band 40 → 80), the same stream at QP 60 costs **0.25** in a thumbnail, **1.0** in a grid tile and **1.5** in speaker view; at saturation, **3.0**. No clamp is needed — the tiers are flat. **No presented resolution, no adjustment** (the ordinary 2.0 applies).

    ```typescript
    monitor.setInboundTrackContext(trackId, { presentedResolution: { width: 1280, height: 720 } });  // device pixels
    monitor.setInboundTrackContext(trackId, { videoTag });  // or hand over the element — re-measured every tick
    ```

    The `videoTag` route measures the element's layout box (`clientWidth`/`clientHeight` × `devicePixelRatio`) with the frame's aspect ratio fitted into it as `object-fit: contain` does; an application using `object-fit: cover` should declare the resolution itself. [Full table](docs/SCORE_CALCULATIONS.md#pixelated-video-in-full).

    ```typescript
    monitor.setInboundTrackContext(trackId, { presentedResolution: { width: 1280, height: 720 } });  // device pixels
    monitor.setInboundTrackContext(trackId, { videoTag });  // or hand over the element — re-measured every tick
    ```

    The `videoTag` route measures the element's layout box (`clientWidth`/`clientHeight` × `devicePixelRatio`) with the frame's aspect ratio fitted into it, as `object-fit: contain` does; an application using `object-fit: cover` should declare the resolution itself. **No presented resolution, no shift** — the shipped band is used as written, and nothing is substituted for the missing number.

    QP is the encoder stating how coarsely it had to quantize, so it measures the blockiness and detail loss the viewer is looking at. Bitrate cannot: the same 500 kbps is generous for a static talking head and starvation for a fast pan, and nothing observable separates those two from bits alone. **Where the browser does not report `qpSum` for the codec in use, the reason is simply absent** — no judgement is better than one inferred from bitrate.

    QP scales are codec-specific and *not* comparable as fractions of their ranges — H.264 runs 0–51, VP8 0–127, VP9 0–255 — so each codec carries its own pair, and an unrecognised codec yields no judgement. The shipped values are literature starting points, not measurements of any deployment; calibrate against your own corpus:

    **Motion class.** The same quantizer is not equally visible on all content: fast movement masks compression artifacts, while a slide or a still face shows every blocked edge. `VIDEO_QP_THRESHOLDS` is therefore indexed `[codec][motionType]` — note the bands run the *opposite* way to bitrate, since high-motion content needs more bits to reach a given QP yet tolerates a higher one once there. Nothing in the stats reveals motion, so the application declares it; undeclared, screen share is judged as `lowmotion` (blocked text is a hard failure) and everything else as `standard`:

    ```typescript
    monitor.setInboundTrackContext(trackId, { motionType: 'highmotion' });   // by id, works before the track exists
    monitor.getInboundTrackMonitor(track.id)?.setContext({ motionType: 'lowmotion' });
    ```

    ```typescript
    import { VIDEO_QP_THRESHOLDS } from '@observertc/client-monitor-js';

    VIDEO_QP_THRESHOLDS.vp8!.standard = { activation: 45, saturation: 90 };
    ```

    Every penalty ramp on `DefaultScoreCalculator` is a mutable static and can be retuned the same way.

Whether an inbound video track is a screen share is decided by `InboundTrackMonitor.contentType` — same mechanism as the outbound side (see below), except a received track exposes no `displaySurface` to auto-detect from, so the application declares it:

```typescript
monitor.getInboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
```

**Outbound Audio Track Score:**

-   Similar to inbound, using sending bitrate
-   Remote packet loss consideration

**Outbound Video Track Score (camera):**

-   Bitrate deviation from target (`high-deviation-from-target-bitrate`, normalized 0–1): activation 5%, saturation 15% under target, gated on the absolute shortfall also exceeding `max(20 kbps, 5% of target)`
-   Quality-limitation penalties from the **interval duration shares** (the instantaneous `qualityLimitationReason` flickers): cpu share ≥30% → -2.0 (`cpu-limitation`), bandwidth share ≥50% → -1.0 (`bandwidth-limitation`, milder — BWE adaptation is the system working); instantaneous reason used as fallback when shares are unavailable
-   Bitrate volatility (`high-volatile-bitrate`, normalized 0–1): activation 0.1, saturation 0.2

**Outbound Video Track Score (screen share):**

Decided by `OutboundTrackMonitor.contentType`, **never** by `track.contentHint` (applications set `'detail'`/`'text'` on camera tracks too, so the hint is not a reliable screen-share signal). The flag is auto-detected only from `track.getSettings().displaySurface` — present exclusively on display capture — and otherwise declared by the application:

```typescript
monitor.getOutboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
```

`getInbound/OutboundTrackMonitor(id)?.setContext(...)` requires the track's monitor to already exist, which only happens on the first stats tick after the track appears on a peer connection. When the application knows earlier — signaling announces a guest's upcoming screen-share track before any media arrives — declare it by track id on the client monitor instead; it is applied immediately if the monitor exists, and otherwise held pending and picked up the moment the track manifests on any peer connection:

```typescript
monitor.setOutboundTrackContext(trackId, { contentType: 'screenshare' });
monitor.setInboundTrackContext(trackId, { contentType: 'screenshare', motionType: 'lowmotion' });
```

Both **merge**: fields omitted from the argument keep whatever was declared before, in the pending state as well as on a live monitor, so a content type declared from signaling survives a later call that only attaches the video element. Passing a field as an explicit `undefined` means "not declared here" rather than "reset"; assign the monitor's field directly to clear it.

#### `InboundTrackContext` — everything the application knows and the stats do not

| Field | Type | What it declares |
|---|---|---|
| `contentType` | `'camera' \| 'screenshare'` | Whether a received video track is a screen share. Nothing to auto-detect from: a received track exposes no `displaySurface`. |
| `linkedVideoTrackId` | `string` | **Audio tracks only.** The inbound video track that is the other half of this participant — the pairing `AVDesyncPlayoutDetector` measures lip sync across. |
| `motionType` | `'lowmotion' \| 'standard' \| 'highmotion'` | How much motion the content carries, which decides which `pixelated-video` band applies. |
| `presentedResolution` | `{ width, height }` | How big the picture actually is on screen, in device pixels. |
| `videoTag` | `HTMLVideoElement` | The element the track renders into; `presentedResolution` is then re-derived from it every tick. |

`linkedVideoTrackId` is **new public API in 4.10.0, and `AVDesyncPlayoutDetector` does nothing without it.** The library cannot infer the pairing: an SFU forwards each participant's audio and video as independent streams with no signalled relationship, and `MediaStream` grouping does not survive every topology. Pairing by arrival order breaks the moment somebody joins mid-call; pairing by "the only video track" breaks in any call with three people. A wrong pairing would not fail loudly — it would produce a confidently wrong skew — so the detector reports `inputsUnavailable` until the application says which two tracks belong together.

Declare it wherever your code already learns that a remote stream's two tracks belong to one participant — typically where you attach a consumer to a UI tile:

```typescript
function onParticipantTracks(participantId: string, audioTrack: MediaStreamTrack, videoTrack: MediaStreamTrack) {
    // By id: works before either track monitor exists, and is held pending until it does.
    monitor.setInboundTrackContext(audioTrack.id, { linkedVideoTrackId: videoTrack.id });

    // Or on a live monitor, alongside anything else you know about the pair:
    monitor.getInboundTrackMonitor(audioTrack.id)?.setContext({ linkedVideoTrackId: videoTrack.id });
    monitor.getInboundTrackMonitor(videoTrack.id)?.setContext({ videoTag: tileFor(participantId) });
}
```

Only the audio track carries the declaration — the link is one-directional, and declaring it on the video track does nothing. It is resolved against the **peer connection's** inbound tracks on every tick, so a re-negotiated video track needs a fresh declaration; a declared id that is absent, or that turns out to be another audio track, resolves to `undefined` and the detector reports that it cannot see rather than measuring something meaningless.

```typescript
const audio = monitor.getInboundTrackMonitor(audioTrack.id);

audio?.getLinkedVideoTrack();            // the paired InboundTrackMonitor, or undefined
audio?.linkedVideoPlayoutDiffInMs;       // signed ms of skew, positive = audio ahead; undefined if unmeasurable
```

For screen-share tracks, sharpness is the quality: fps and bitrate volatility are meaningless on mostly-static content (VBR drops to ~zero between changes), so deviation/volatility penalties are skipped entirely. Instead:

-   Quality-limitation duration share penalties (same as camera)
-   Encoded resolution downscaled vs. the captured surface (`downscaled-screenshare`): encoded area < ½ of source area → -1.0, < ¼ → -2.0 — the point where shared text stops being readable

### Score Reasons

Every penalty the `DefaultScoreCalculator` applies is captured as a **reason**: a map from a reason key to the points it subtracted (`Record<string, number>`). The reasons are the explanation of the score — a `3.0` alone says something is wrong; `{ "frozen-video": 2.0 }` says *what*. They are produced by default, attributed to the entity that caused them, and readable in three places:

**1. The realtime `'score'` event** — carries the client-level aggregate of the current tick's reasons across every peer connection and track (as `currentReasons`):

```typescript
monitor.on("score", ({ clientScore, currentReasons }) => {
    console.log("Client Score:", clientScore);
    console.log("Score Reasons:", currentReasons);
    // Example (normalized penalties carry fractional magnitudes):
    // {
    //   "high-rtt": 1.0,             // pc: raw RTT above 150ms
    //   "high-jitter": 0.25,         // inbound video: jitter 40ms, ramp 20->100ms
    //   "high-packetloss": 2.0,      // pc: avg delta fraction lost 5-20%
    //   "cpu-limitation": 2.0,       // outbound video: cpu-limited >=30% of the interval
    //   "bandwidth-limitation": 1.0, // outbound video: bandwidth-limited >=50%
    //   "frozen-video": 2.0,         // inbound video: picture currently frozen
    //   "invented-speech": 0.5,      // inbound audio: issue active, ratio midway to saturation
    //   "downscaled-screenshare": 2.0, // screenshare sent below 1/4 of source area
    //   "dropped-video-frames": 0.4  // inbound video: 14% frames dropped, ramp 10->20%
    // }
});
```

**2. On the monitors** — each entity holds only its *own* reasons, so a low track score is explained on the track, not on the peer connection:

```typescript
pcMonitor.scoreReasons;                              // rtt / jitter / packetloss only
monitor.getInboundTrackMonitor(id)?.scoreReasons;    // e.g. frozen-video, invented-speech
monitor.getOutboundTrackMonitor(id)?.scoreReasons;   // e.g. cpu-limitation, downscaled-screenshare
```

`ClientMonitor.scoreReasons` follows the same rule: it holds the client's **own** reasons, and there are none today — the client score subtracts nothing directly, being a weighted aggregate of the peer-connection and track scores. So it stays undefined.

The aggregated view lives on the `'score'` **event** instead, as `currentReasons` — every component's reasons summed by key. Score and reasons are kept separate on purpose: the event gives an application the whole picture to react to, while each monitor's `scoreReasons` stays scoped to what that entity itself caused.

```typescript
monitor.on('score', ({ clientScore, currentReasons }) => {
    // currentReasons: { 'high-rtt': 1.0, 'pixelated-video': 0.27 } — the aggregate
});

monitor.scoreReasons;   // the client's OWN reasons — undefined today
```

**3. In the samples — every entity ships only its own reasons.** The peer-connection and track sample entries carry `scoreReasons` as a **record of reason key → subtracted points** (`Record<string, number>`), so a degraded score explains itself on the wire, magnitudes included. The field is omitted when there is nothing to explain.

The **client sample entry carries no reasons**, because the client score subtracts nothing of its own. Shipping the aggregate there would put every reason on the wire a second time in the same sample, and would read as though the client itself were pixelating or losing packets when the cause was one inbound track. A server reconstructs the client-level view in post-analysis by re-aggregating the components of the same sample — the information is not lost, only sent once. If a client-level penalty is ever added it lands on `ClientMonitor.scoreReasons` like any other component's, and ships automatically.

Set `sendScoreReasonsToServer: false` in the config to drop the reasons from the wire entirely — the scores themselves and the realtime event are unaffected.

The full key set — with every threshold, ramp and what each reason means for the user experience — is documented in [docs/SCORE_CALCULATIONS.md](./docs/SCORE_CALCULATIONS.md); the type union is exported as `DefaultScoreCalculatorSubtractionReason`.

**Reasons and issues are not the same verdict, and six conditions are computed twice.** `pixelated-video`, `low-fps`, `volatile-fps`, `high-rtt`, `high-jitter` and `high-packetloss` are derived here from raw stats *and*, independently and with different thresholds, by the detectors that now own those conditions — so a session can carry a `pixelated-video` issue and no `pixelated-video` penalty, or the reverse. For pixelation the two do not even measure the same quantity: bits per pixel against a flat threshold here, a per-codec QP band there. Three audio penalties run the other way, gated on a detector's issue being active, so disabling those detectors quietly stops the score charging for audio degradation that is still happening. All of it is recorded under [known deviations](./docs/DETECTOR_TAXONOMY.md#known-deviations); until it is resolved, read a score reason as the calculator's own opinion rather than as a detector's finding.

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

The sample schema version is **3.7.0** (`ClientMonitor.samplingSchemaVersion`). Two things to know on the consuming side:

-   **Payloads may nest.** Client event, issue, meta and extension-stat payloads are records that may carry nested structures — records on the wire, never pre-serialised JSON strings. (`PEER_CONNECTION_ICE_PATH_CHANGED` ships its `from`/`to` path evidence as structured records since 3.7.0.)
-   **Static ICE transport metadata ships on change only.** `iceRole`, `dtlsRole`, `iceLocalUsernameFragment`, `tlsVersion`, `dtlsCipher`, `srtpCipher` and the certificate references appear in a transport's first sample and again only when a value changes — absence means *unchanged*, not unknown; keep the last seen value per transport `id`. Set `sendIceTransportMetadataOnChangeOnly: false` to restore every-sample emission.

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

`ClientSample` objects compress well because consecutive samples are nearly identical — the same tracks, the same peer connections, counters that moved a little. Two codec packages exploit that by encoding **each sample as the delta from the previous one**; pick one by the wire format you want:

| Package | Wire format | Use it when |
| --- | --- | --- |
| `@observertc/samples-protobuf-codec` | Protobuf binary | You want the smallest payload and already speak protobuf on the server. |
| `@observertc/samples-json-codec` | JSON | You want zero dependencies (~2 KB gzipped) and a payload you can read in a log. |

Both expose the same shape: a `ClientSampleEncoder`, a `ClientSampleDecoder`, and a `createClientSampleCodec()` factory that returns a matched pair.

**Encoding on the client:**

```javascript
import { ClientSampleEncoder } from "@observertc/samples-protobuf-codec";

const encoder = new ClientSampleEncoder();

monitor.on("sample-created", ({ sample }) => {
    const encoded = encoder.encode(sample);

    fetch("/api/samples", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: encoded,
    });
});
```

**Decoding on the server:**

```javascript
import { ClientSampleDecoder } from "@observertc/samples-protobuf-codec";

// one decoder per client connection — see "Delta encoding is stateful" below
const decoder = new ClientSampleDecoder();

const sample = decoder.decode(new Uint8Array(await request.arrayBuffer()));
```

**Delta encoding is stateful, and that has three consequences:**

1. **One encoder per client, one decoder per client.** Each holds the previous sample as its baseline. Sharing an encoder across clients, or decoding two clients' streams through one decoder, produces garbage rather than an error.
2. **Samples must be decoded in the order they were encoded.** A dropped or reordered payload desynchronises the pair. Use `tryDecode()` where the transport can lose messages — it returns `undefined` instead of throwing, so you can drop the sample and wait for the next resync rather than tearing down the connection.
3. **Call `reset()` on both sides when a client reconnects.** The encoder starts a fresh baseline; the decoder must be told to expect one.

**Transport-specific helpers.** Where the payload has to survive a text channel, each codec carries its own:

```javascript
// protobuf: base64 for text transports, or the raw protobuf message
encoder.encodeToBase64(sample);   decoder.decodeBase64(text);
encoder.encodeToMessage(sample);  decoder.decodeFromMessage(message);

// json: a plain JSON-serialisable delta
encoder.encodeToJson(sample);     decoder.decodeJson(json);
                                  decoder.tryDecodeJson(json);
```

**Errors** are `ProtobufCodecError` / `JsonCodecError`, each carrying a `code` and a `context` describing what failed — a schema mismatch and a desynchronised baseline report differently, which is what you want in a log.

**Schema compatibility.** Both codecs export a `schemaVersion` describing the `ClientSample` shape they were built against. This monitor ships schema **3.6.0** (`ClientMonitor.samplingSchemaVersion`). Check the two agree before deploying — a codec built against an older schema silently drops fields the monitor now sends.

**Installation:**

```bash
# choose one
npm install @observertc/samples-protobuf-codec
npm install @observertc/samples-json-codec
```

Both packages ship CommonJS and ESM builds with type definitions.

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

> **Wire format** (schema 3.5.0): `ClientSample.clientIssues[]` ships a stripped shape: `{ type, key?, payload?: Record<string, boolean | string | number>, timestamp }`. Payloads are flat records of primitives on the wire — never pre-serialised JSON strings — so nothing is stringified per issue or per event, and the server reads payload fields directly.

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

Most built-in detectors raise their own stateful issue with a typed payload, emit a detector-specific named event on entry, and resolve the issue when the condition clears — enriching the resolved payload with `durationInMs`. **One class raises exactly one issue type**, so the table below is also the list of issue-raising detector classes.

Ten classes are the exception and emit events only, because what they report is not a fault: `CodecChangeDetector`, `VideoResolutionChangeDetector`, `SimulcastLayerDetector`, `CaptureTrackMutedDetector`, `StatsGapDetector`, `IceTraversalDetector`, `IcePathEstablishmentDetector`, `IceRestartDetector`, `IceRestartRecommendationDetector` and `AudioPlayoutSynthesisDetector`.

| `type` | Raised when | Resolved when | Detector-specific event | Payload shape |
|---|---|---|---|---|
| `av-desync` | The audio track's playout ran ahead of its linked video track's by `audioAheadRaiseInMs`, or behind by `audioBehindRaiseInMs`, for `sustainForInMs` of stats time | The skew falls back inside the matching resolve threshold, or the track pauses | `'av-desync'` | `AVDesyncPlayoutIssuePayload` |
| `uplink-congestion` | The browser reports the encoder bandwidth-limited, `availableOutgoingBitrate - sendingBitrate` is `headroomDropRatio` of the recent maximum below its own average, *and* the pacer queue is `sendDelayGrowthRatio` above its baseline | The browser stops reporting a bandwidth limitation | `'uplink-congestion'` | `UplinkCongestionIssuePayload` |
| `downlink-congestion` | The browser reports the path bandwidth-limited, `receivingBitrate` is below `collapseRatio` of its rolling maximum, *and* the video jitter buffer is above `bufferElevationRatio` of its pre-episode baseline | The browser stops reporting a bandwidth limitation | `'downlink-congestion'` | `DownlinkCongestionIssuePayload` |
| `transport-delay-degraded` | Smoothed RTT stayed at or above `thresholdInMs` for `durationInMs` of stats time | RTT falls below `recoveryThresholdInMs` | `'transport-delay-degraded'` | `TransportDelayIssuePayload` |
| `transport-loss-sustained` | Mean interval loss (worse direction) stayed at or above `threshold` for `durationInMs` | Loss falls below `recoveryThreshold` | `'transport-loss-sustained'` | `TransportLossIssuePayload` |
| `transport-delivery-unstable` | Mean inter-arrival jitter stayed at or above `thresholdInMs` for `durationInMs` | Jitter falls below `recoveryThresholdInMs` | `'transport-delivery-unstable'` | `TransportJitterIssuePayload` |
| `cpulimitation` | CPU-tagged outbound RTP / stats-collection slowness / low inbound decoded-to-received frames ratio | Indicators normalize | `'cpulimitation'` | `CpuPerformanceIssuePayload` |
| `dry-inbound-track` | Inbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-inbound-track'` | `DryInboundTrackIssuePayload` |
| `dry-outbound-track` | Outbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-outbound-track'` | `DryOutboundTrackIssuePayload` |
| `frozen-video-track` | `freezeCount` advanced on `minConsecutiveTicks` consecutive collections | Frames render again, or the track pauses | `'frozen-video-track'` | `FrozenVideoTrackIssuePayload` |
| `inbound-video-playout-discrepancy` | `(framesReceived - framesRendered) / framesReceived > highSkewRatio` | Ratio drops below `lowSkewRatio` | `'inbound-video-playout-discrepancy'` | `PlayoutDiscrepancyIssuePayload` |
| `ice-disconnected` | An ICE transport stayed `disconnected` past `disconnectedThresholdInMs` | ICE reconnects, or the transport goes away | — | `IceDisconnectedIssuePayload` |
| `ice-connection-failed` | An ICE transport reached `failed` | ICE reconnects (typically after a restart) | — | `IceConnectionFailedIssuePayload` |
| `ice-transport-stalled` | Still sending on a succeeded pair of a connected transport, but receiving nothing for `transportStallThresholdInMs` | Inbound traffic resumes | — | `IceTransportStalledIssuePayload` |
| `unstable-ice-path` | `pathSwitchThreshold` selected-path switches within `pathSwitchWindowInMs` | A whole window passes below the threshold | — | `UnstableIcePathIssuePayload` |
| `no-available-ice-candidate` | Gathering reported `complete` with zero local candidates on a never-connected PC — immediately if it fell to `disconnected`/`failed`, after `thresholdInMs` otherwise | A candidate appears, the connection connects, or the PC closes | `'no-available-ice-candidate'` | `NoAvailableIceCandidateIssuePayload` |
| `ice-establishment-failed` | Local candidates existed, the PC never reached `connected`, and no pair was ever nominated, for `thresholdInMs` | The connection establishes after all, or the PC closes | — | `IceEstablishmentFailedIssuePayload` |
| `blocked-transport` | STUN alive, media demonstrably produced, and media demonstrably not traversing, for `thresholdInMs` | Any leg of the three breaks | `'blocked-transport'` | `BlockedTransportIssuePayload` |
| `rtp-sender-stalled` | `deltaFramesEncoded > 0` while `deltaPacketsSent === 0` on one ssrc, for `thresholdInMs` | Packets leave again, or the ssrc goes away | `'rtp-sender-stalled'` | `RtpSenderStalledIssuePayload` |
| `transport-demux-stalled` | Transport receiving above `minTransportReceiveBitrateBps` while every inbound RTP on it stays flat, for `thresholdInMs` | Inbound RTP receives again, or the transport goes away | `'transport-demux-stalled'` | `TransportDemuxStalledIssuePayload` |
| `dtls-handshake-failed` | An ICE transport reached `dtlsState: 'failed'` | A later handshake connects (after an ICE restart re-keys it) | `'dtls-handshake-failed'` | `DtlsHandshakeFailedIssuePayload` |
| `dtls-handshake-stalled` | ICE proven healthy while DTLS sat in `new`/`connecting` past `stalledThresholdInMs` | The handshake completes | `'dtls-handshake-stalled'` | `DtlsHandshakeStalledIssuePayload` |
| `invented-speech` | Invented audio (silence excluded) accumulates `raiseAfterInventedMs` beyond `allowedInventedRatio` | The accumulator drains back to zero | `'invented-speech'` | `InventedSpeechIssuePayload` |
| `audio-jitter-buffer-stress` | Target delay grown **and** NetEQ time-stretching, for `minConsecutiveTicks` | Either condition clears | `'audio-jitter-buffer-stress'` | `JitterBufferStressIssuePayload` |
| `video-decoder-overloaded` | Frames arrived and loss was quiet, but decode time overran the frame budget or frames were dropped after arrival | The decoder keeps up again | `'video-decoder-overloaded'` | `DecoderPerformanceIssuePayload` |
| `keyframe-storm` | Sustained PLI rate above `pliRateAlertOn` | Rate falls below `pliRateAlertOff` | `'keyframe-storm'` | `KeyframeStormIssuePayload` |
| `video-recovery-failed` | PLIs sent, picture frozen, `keyFramesDecoded` not advancing for `recoveryFailedThresholdInMs` | A keyframe arrives or the freeze ends | `'video-recovery-failed'` | `VideoRecoveryFailedIssuePayload` |
| `capture-bottleneck` | the capture device averaged under `captureFpsRatioThreshold` of the configured frame rate over `durationInMs` | the next average comes back at or above it | `'capture-bottleneck'` | `CaptureBottleneckIssuePayload` |
| `decoder-bottleneck` | the decoder averaged under `decodeFpsRatioThreshold` of the frames that arrived over `durationInMs` | the next average comes back at or above it | `'decoder-bottleneck'` | `DecoderBottleneckIssuePayload` |
| `encoder-bottleneck` | A delivering source outran the encoder for `durationInMs` continuously | The encoder keeps up again | `'encoder-bottleneck'` | `EncoderBottleneckIssuePayload` |
| `capture-track-ended` | The outbound track's device reached `ended` | — (terminal) | `'capture-track-ended'` | `CaptureTrackEndedIssuePayload` |
| `silent-audio-source` | A live, enabled, unmuted microphone produced silence for `silenceThresholdInMs` | Audio appears, or the track stops capturing | `'silent-audio-source'` | `SilentAudioSourceIssuePayload` |
| `stuck-decoder` | RTP bytes flowing, nothing decoding, PLIs firing, for `thresholdInMs` | Frames decode again | `'stuck-decoder'` | `StuckDecoderIssuePayload` |
| `frame-assembly-stalled` | Packets kept arriving with `framesReceived` flat for `thresholdInMs`, past `minPacketsReceived` | A frame is assembled, packets stop arriving, or the track pauses | `'frame-assembly-stalled'` | `FrameAssemblyStalledIssuePayload` |
| `pixelated-video` | `bitPerPixel` stayed at or below `threshold` for `durationInMs` of stats time | It rises above `recoveryThreshold`, or the track pauses | `'pixelated-video'` | `PixelatedVideoIssuePayload` |
| `video-choppy` | `ewmaFps` below `minFramesPerSecond`, or `fpsVolatility` above `maxFpsVolatility`, for `durationInMs` | Neither leg holds any more | `'video-choppy'` | `ChoppyVideoIssuePayload` |

Most per-detector payload types are exported from the package root; the six newest are not yet re-exported individually (`TransportDelayIssuePayload`, `TransportLossIssuePayload`, `TransportJitterIssuePayload`, `PixelatedVideoIssuePayload`, `ChoppyVideoIssuePayload`, `FrameAssemblyStalledIssuePayload`), so reach them through the `ClientMonitorIssue` union below, which does narrow to all of them. The resolved-side payload is always the raise-time payload plus `durationInMs` (and, for some, refreshed metrics).

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
        case 'uplink-congestion':
            // issue.payload is UplinkCongestionIssuePayload
            console.log('uplink congestion on PC', issue.payload.peerConnectionId,
                'estimate', issue.payload.availableOutgoingBitrate,
                'room left', issue.payload.headroomInBps);
            break;

        case 'cpulimitation':
            // issue.payload is CpuPerformanceIssuePayload
            console.warn('cpu pressure');
            break;

        case 'av-desync':
            // issue.payload is AVDesyncPlayoutIssuePayload
            console.log('lip sync off by', issue.payload.playoutDiffInMs, 'ms',
                '(', issue.payload.direction, ')',
                'on', issue.payload.trackId, 'vs', issue.payload.linkedVideoTrackId);
            break;

        case 'frozen-video-track':
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
        case 'av-desync':
            console.log(`Lip sync drift on ${own.payload.trackId} lasted ${own.payload.durationInMs}ms`);
            break;
        case 'uplink-congestion':
            console.log(`Uplink congestion on ${own.payload.peerConnectionId} lasted ${own.payload.durationInMs}ms`);
            break;
        // …
    }
});
```

Three helpers are available:

-   `ClientMonitorIssue` — discriminated union of every raised issue produced by the bundled detectors.
-   `ClientMonitorResolvedIssue` — same, for `'issue-resolved'`.
-   `isClientMonitorIssue(issue)` / `isClientMonitorResolvedIssue(issue)` — type guards that return `true` only for the 35 built-in `type` values, and `false` for anything raised by a custom detector or by application code.

`ClientMonitorIssueType` is the literal union of those 35 strings, useful for exhaustive switches and for typing a server-side allow-list.

### Managing active stateful issues

```ts
// All active issues across all detectors:
const all = monitor.getActiveIssuesByType();

// Active issues of one type:
const congestionIssues = monitor.getActiveIssuesByType('uplink-congestion');
for (const issue of congestionIssues) {
    if (issue.payload?.availableOutgoingBitrate < 200_000) {
        ui.showLowBandwidthWarning(issue.key);
    }
}

// Is a specific issue active?
if (monitor.isIssueActive('uplink-congestion-pc-pc-123')) { /* … */ }

// Iterate the raw map (advanced — prefer the helpers):
for (const [key, issue] of monitor.activeIssues) {
    console.log(key, issue.type, issue.payload);
}
```

### Raising your own custom issues

You can raise issues from app code or your own custom detector. Pick a `key` that's unique per logical incident — the detector convention is `${type}-${scope}` (e.g. `uplink-congestion-pc-${peerConnectionId}`, `av-desync-track-${trackId}`).

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

Each detector has one entry in `ClientMonitorConfig`, typed `<ClassName>Config | null` and keyed by the detector's own `name` in camelCase. **One key, one detector**, in both directions: no key constructs a second class, and no detector reads a second key — so `null` removes precisely the detector you named.

```ts
new ClientMonitor({
    // null → don't even construct this detector. No memory, no update() ticks.
    uplinkCongestionDetector: null,

    // undefined / omitted → use defaults (this is the existing behavior).

    // Object → enable with overrides.
    avDesyncPlayoutDetector: {
        audioAheadRaiseInMs: 120,
        audioBehindRaiseInMs: 240,
    },
});
```

Seven keys that used to cover a group of detectors were retired in 4.10.0 — see [Detector config keys that changed](#detector-config-keys-that-changed).

Already running and want to flip a detector on/off without restarting the monitor? Every built-in detector exposes a `public disabled = false` field, and every layer's `detectors` registry exposes ergonomic helpers for finding and toggling them. Issue-raising detectors additionally expose `public includeIssueInSample = true` — flip it to `false` to keep a detector running locally (events, `activeIssues`) while excluding its issues from the samples shipped to the server; see [Which issues belong in the sample](#which-issues-belong-in-the-sample).

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

// Silence uplink congestion alerts across every existing PeerConnection.
for (const pc of monitor.mappedPeerConnections.values()) {
    pc.detectors.disable('uplink-congestion-detector');
}

// Toggle a track-level detector based on something the app knows.
inboundTrackMonitor.detectors.disable('frozen-video-track-detector');

// Suspend everything during a known-noisy state, then re-enable.
monitor.detectors.disableAll();
// …later
monitor.detectors.enableAll();

// Tweak the live config of a detector at runtime via getByName.
const cpu = monitor.detectors.getByName('cpu-performance-detector');
if (cpu) cpu.disabled = true;
```

If you want a detector outright gone (not just silenced), call `detectors.remove(instance)` — or skip its construction entirely at monitor creation time by passing `null` for its config field.

#### Detector names that changed

`name` is the lookup key for `getByName` / `disable` / `enable` / `has` / `isEnabled`, and **lookup is exact**. There is no alias table: a retired name returns `undefined` from `getByName` and `false` from `has`, `disable` and `enable`.

**An alias could only ever have pointed at one part of a split.** A name resolves to exactly one detector, so an old spelling for a class that became several would have picked one of the parts — an application toggling `ice-path-stability-detector` by its old name would have kept working while quietly governing one of the six classes it used to cover. A failed lookup is something a caller can act on; a silently narrowed one is not.

The table below is migration guidance, not resolution — every name in the left column now fails the lookup:

| Retired name | What it became |
|---|---|
| `ice-path-stability-detector` | `ice-disconnected-detector`, `ice-connection-failed-detector`, `ice-transport-stalled-detector`, `unstable-ice-path-detector`, `ice-restart-detector`, `ice-restart-recommendation-detector` |
| `ice-connectivity-detector` | as above |
| `dtls-handshake-detector` | `dtls-handshake-stalled-detector`, `dtls-handshake-failed-detector` |
| `capture-failure-detector` | `capture-track-ended-detector`, `silent-audio-source-detector`, `capture-track-muted-detector` |
| `media-pipeline-detector` | `rtp-sender-stalled-detector`, `transport-demux-stalled-detector` |
| `ice-tuple-change-detector` | `ice-traversal-detector` (a straight rename) |
| `no-available-ice-candidate-detector` | `ice-reachability-detector` |
| `long-pc-connection-establishment-detector` | `ice-path-establishment-detector` |

So an application that was disabling a split detector by its old name is now disabling nothing:

```ts
// Returns false and silences nothing — the name no longer exists.
pc.detectors.disable('ice-path-stability-detector');

// Name each part you meant.
pc.detectors.disable('ice-disconnected-detector');
pc.detectors.disable('ice-connection-failed-detector');

// Or don't construct them in the first place — one key per detector.
new ClientMonitor({
    iceDisconnectedDetector: null,
    iceConnectionFailedDetector: null,
});
```

#### Detector config keys that changed

Every detector reads a config block named after it — its `name` in camelCase, so `frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector`. That was not always true: several keys used to construct a group of classes, which meant a `null` intended to silence one finding silently removed its neighbours. **Seven keys were retired in 4.10.0** to fix that, split where a class had already become several and renamed where the key spelled a different word from the detector:

| Retired config key | What to use instead |
|---|---|
| `captureFailureDetector` | `captureTrackEndedDetector`, `silentAudioSourceDetector`, `captureTrackMutedDetector` |
| `dtlsHandshakeDetector` | `dtlsHandshakeStalledDetector`, `dtlsHandshakeFailedDetector` |
| `icePathStabilityDetector` | `iceDisconnectedDetector`, `iceConnectionFailedDetector`, `iceTransportStalledDetector`, `unstableIcePathDetector`, `iceRestartDetector`, `iceRestartRecommendationDetector` |
| `mediaPipelineDetector` | `rtpSenderStalledDetector`, `transportDemuxStalledDetector` |
| `videoRecoveryDetector` | `keyframeStormDetector`, `videoRecoveryFailedDetector` |
| `videoFreezesDetector` | `frozenVideoTrackDetector` *(rename)* |
| `syntheticSamplesDetector` | `audioPlayoutSynthesisDetector` *(rename)* |

Three more keys went with them, the deprecated spellings 4.9.0 had kept alive in the normalizer:

| Retired config key | Current key |
|---|---|
| `longPcConnectionEstablishmentDetector` | `icePathEstablishmentDetector` |
| `iceConnectivityDetector` | `icePathStabilityDetector`, which was then split — see the table above |
| `noAvailableIceCandidateDetector` | `iceReachabilityDetector` |

**None of these ten is a member of `ClientMonitorConfig` any more**, which means a config object still using one **fails to type-check**. There is no alias and no runtime fallback: if such an object reaches the constructor anyway (plain JavaScript, or a cast), the key is ignored and the detectors that used to read it run on their defaults rather than on your settings — including a `null` meant to disable them. For a key that was *split*, there is no mechanical migration either — decide which of the new blocks you meant.

Two field moves are worth checking for in an existing config. `icePathEstablishmentDetector.restartRecommendationThresholdInMs` and `.restartRecommendationCooldownInMs` now live on `iceRestartRecommendationDetector`, which holds all four recommendation conditions in one block; and `EncoderPerformanceDetector` no longer borrows `sourceCaptureBottleneckDetector.captureFpsRatioThreshold` for its source-shortfall stand-down — it reads its own `encoderPerformanceDetector.sourceSupplyRatioThreshold`, default `0.9`, the value the borrowed one had.

Three detectors that had no key at all gained one, so each can now be disabled individually: `dtlsHandshakeFailedDetector`, `iceConnectionFailedDetector` and `iceTraversalDetector`. All three carry no tunables — `{}` enables, `null` disables. `IceTraversalDetector` in particular used to be registered unconditionally, silenceable only by name.

Config *types* moved with the keys. Each detector file exports `<ClassName>Config`, and the package root re-exports it beside every detector class it already exported, so `import type { StuckDecoderDetectorConfig } from '@observertc/client-monitor-js'` names the block you are building.

The **class** exports carry no legacy names either. `IceTupleChangeDetector`, `LongPcConnectionEstablishmentDetector`, `LongPcConnectionEstablishmentStage` and `NoAvailableIceCandidateDetector` were exported as deprecated aliases in 4.9.0 and removed in 4.10.0; import `IceTraversalDetector`, `IcePathEstablishmentDetector`, `IcePathEstablishmentStage` and `IceReachabilityDetector` instead. The classes that were *split* — the old `IcePathStabilityDetector`, `DtlsHandshakeDetector`, `CaptureFailureDetector` and `MediaPipelineDetector` — never had an alias to remove: a class that raised four issues cannot be aliased onto one that raises a single one without lying about what it does. Import the part you meant.

No issue type, payload or monitor event name was renamed by any of this.

### Sample-channel behavior

Every `addIssue` and every `raiseIssue` adds an entry to the next `ClientSample.clientIssues[]` — unless the issue was raised with `includeInSample: false` (what a detector's `includeIssueInSample = false` compiles down to), in which case neither the raise nor its resolution reaches the sample. **Re-raises do not add a new entry** — they emit `'issue-updated'` to live listeners but the sample buffer is unchanged.

**The issue lifecycle reaches the sample too** (`sendResolvedIssuesToServer`, default `true`). The purpose: the server keeps an on-the-fly mirror of each client's currently *active* issues and can correlate across clients or act immediately (recreate a consumer, recommend a rejoin) instead of only ever learning that issues started. On the wire, both entries of a stateful issue carry the schema-level `key` — the identity the server opens and closes on:

```
raise:      { type: 'stuck-decoder',          key, payload,                                       timestamp: raisedAt }
resolution: { type: 'stuck-decoder-resolved', key, payload: { raisedAt, comment, ...resolution }, timestamp: resolvedAt }
```

The resolution's payload carries only what was **explicitly passed** to `resolveIssue`, flattened — the built-in detectors pass their final payload, so fields like `durationInMs` appear here, while a bare resolve carries just `raisedAt` and `comment`. The raise-time payload is not repeated; the server already has it from the raise entry. `raisedAt` equals the raise entry's `timestamp` — a secondary join for consumers that do not store keys. Issues still active at `close()` are auto-resolved and reach the final sample. Servers switching on issue `type` should ignore or handle the `-resolved` suffix; one-shot `addIssue` entries have no lifecycle and no `key`. Pass `sendResolvedIssuesToServer: false` to restore the previous wire format exactly (raise entries only, no `key`); the realtime `'issue-resolved'` event is emitted either way.

### Event listeners cheat-sheet

```ts
// Sample produced.
monitor.on('sample-created', ({ sample }) => { /* … */ });

// Issue lifecycle.
monitor.on('issue',          (issue)    => { /* new addIssue or new raiseIssue */ });
monitor.on('issue-updated',  (issue)    => { /* re-raise of an existing key */ });
monitor.on('issue-resolved', (resolved) => { /* resolveIssue or close() auto-resolve */ });

// Detector-specific events (these fire alongside 'issue', once per episode).
monitor.on('uplink-congestion',                   (e) => { /* … */ });
monitor.on('downlink-congestion',                 (e) => { /* … */ });
monitor.on('congestion',                          (e) => { /* either direction; e.direction says which */ });
monitor.on('cpulimitation',                       (e) => { /* … */ });
monitor.on('av-desync',                           (e) => { /* … */ });
monitor.on('frozen-video-track',                 (e) => { /* … */ });
monitor.on('dry-inbound-track',                   (e) => { /* … */ });
monitor.on('dry-outbound-track',                  (e) => { /* … */ });
monitor.on('inbound-video-playout-discrepancy',   (e) => { /* … */ });
monitor.on('invented-speech',                     (e) => { /* audio NetEQ invented, not raw loss */ });
monitor.on('audio-jitter-buffer-stress',          (e) => { /* buffer grown AND stretching */ });
monitor.on('video-decoder-overloaded',            (e) => { /* frames arrived, client could not decode */ });
monitor.on('keyframe-storm',                      (e) => { /* PLIs feeding the congestion that caused them */ });
monitor.on('video-recovery-failed',               (e) => { /* we asked for a keyframe; nothing came back */ });
monitor.on('stuck-decoder',                       (e) => { /* RTP flowing, nothing decodes — recreate the consumer */ });
monitor.on('capture-bottleneck',                  (e) => { /* the camera never produced the frames */ });
monitor.on('decoder-bottleneck',                  (e) => { /* frames arrived; the decoder could not decode them */ });
monitor.on('encoder-bottleneck',                  (e) => { /* the source did; the encoder could not keep up */ });
monitor.on('capture-track-ended',                 (e) => { /* the device is gone */ });
monitor.on('capture-track-muted',                 (e) => { /* the OS or another app took it — event only */ });
monitor.on('silent-audio-source',                 (e) => { /* live mic producing digital silence */ });
monitor.on('frame-assembly-stalled',              (e) => { /* packets arriving, no frame ever assembled */ });
monitor.on('pixelated-video',                     (e) => { /* too few bits per pixel, sustained */ });
monitor.on('video-choppy',                        (e) => { /* too slow, or too erratic — `evidence` says which */ });

// Transport quality — properties of a path that is up and holding.
monitor.on('transport-delay-degraded',    (e) => { /* round trip long enough to break turn-taking */ });
monitor.on('transport-loss-sustained',    (e) => { /* packets vanishing — `direction` says which way */ });
monitor.on('transport-delivery-unstable', (e) => { /* packets arrive, but not evenly */ });
monitor.on('blocked-transport',           (e) => { /* STUN passes, media does not — the firewall signature */ });

// Pipeline stage boundaries nothing else covers.
monitor.on('rtp-sender-stalled',      (e) => { /* frames encode, no packet leaves */ });
monitor.on('transport-demux-stalled', (e) => { /* traffic arrives, no inbound RTP accounts for it */ });

// Observations — these never raise an issue.
monitor.on('codec-changed',            (e) => { /* mime type or profile switched */ });
monitor.on('video-resolution-changed', (e) => { /* the adaptation ladder moved */ });
monitor.on('simulcast-layer-changed',  (e) => { /* which layers are actually being sent */ });
monitor.on('stats-collection-gap',     (e) => { /* backgrounded tab: discount this interval */ });

// ICE connectivity.
monitor.on('ice-path-changed',      (e) => { /* selected path changed: direct <-> TURN, protocol, server */ });
monitor.on('ice-restart',           (e) => { /* a new ICE generation was inferred */ });
monitor.on('ice-restart-recommended', (e) => { /* YOUR app decides whether to restartIce() */ });
monitor.on('ice-tuple-changed',     (e) => { /* low-level: the selected tuple set changed */ });
monitor.on('dtls-handshake-failed',  (e) => { /* DTLS is terminal for this transport — config/interop, not network */ });
monitor.on('dtls-handshake-stalled', (e) => { /* ICE fine, DTLS not completing — something eats DTLS */ });
monitor.on('new-selected-ice-path', (e) => { /* an ICE transport selected its first path */ });
monitor.on('no-available-ice-candidate', (e) => { /* gathering produced nothing — no usable network */ });
monitor.on('ice-path-establishment-slow', ({ stalledStage }) => { /* and which stage it is stuck in */ });
// `ice-establishment-failed` has no named event of its own — listen on 'issue'.

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

-   `DryInboundTrackDetector` and `CodecChangeDetector` (any kind)
-   Audio: `AVDesyncPlayoutDetector`, `InventedSpeechDetector`, `JitterBufferStressDetector`
-   Video: `FrozenVideoTrackDetector`, `KeyframeStormDetector`, `VideoRecoveryFailedDetector`, `PlayoutDiscrepancyDetector`, `DecoderBottleneckDetector`, `DecoderPerformanceDetector`, `StuckDecoderDetector`, `VideoResolutionChangeDetector`, `FrameAssemblyStalledDetector`, `PixelatedVideoDetector`, `ChoppyVideoDetector`

Which of them are constructed depends on the matching config keys; see [Detectors](#detectors).

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

**Detectors:** `DryOutboundTrackDetector`, `CaptureTrackEndedDetector`, `CaptureTrackMutedDetector`, `SilentAudioSourceDetector`, `CodecChangeDetector`, and on video tracks `SourceCaptureBottleneckDetector`, `EncoderPerformanceDetector`, `SimulcastLayerDetector`, `VideoResolutionChangeDetector`.

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

**Path helpers** — every one is read from the pair's **own local candidate**, so a
TURN verdict can never be assembled from signals belonging to two different
candidates:

-   `usingTurn`: the local candidate is a relay candidate. A `turn:` url alone is
    *not* a TURN signal — a srflx candidate discovered through a TURN server's
    STUN function carries one too.
-   `usingTcp`: the local candidate's ICE transport protocol is TCP. Note a relay
    reached over TURN/TCP or TURN/TLS commonly still reports `protocol: 'udp'` —
    read `relayProtocol` for the TURN leg.
-   `relayProtocol`: `'udp'`, `'tcp'` or `'tls'`, when exposed.
-   `pathKind`: `'direct'`, `'turn-udp'`, `'turn-tcp'`, `'turn-tls'`, or
    `'turn-unknown'` (a relay whose `relayProtocol` the browser hides).
-   `turnUrl` / `turnServer`: the ICE server, and its identity without the query
    part so the same server over UDP and TCP resolves to one value.
-   `tuple`: `localAddress:localPort:remoteAddress:remotePort:protocol`.
-   `pathKey`: identity of the path this pair belongs to — the transport id,
    falling back to the local candidate's, then to one constant per peer
    connection. Never the pair id, so a path survives a pair switch.

#### IceCandidateMonitor

Adds `isRelay`, `turnTransport` (normalized `relayProtocol`), `turnServer` and
`addressFamily` (`'ipv4'` / `'ipv6'`, `undefined` behind an mDNS name).

#### IceTransportMonitor

ICE transport layer monitoring:

**Properties:**

-   `selectedCandidatePair`: Currently selected candidate pair
-   `everConnected`: a latch, set the first time `iceState` reads `connected` or `completed` and never cleared. It is what separates a path that **never established** from one that **established and was then lost** — two conditions with different causes and different fixes that `iceState === 'failed'` alone conflates. [`ice-connection-failed`](#the-layer-5-detectors) carries it on its payload for exactly that reason.
-   `deltaTime`: milliseconds between this transport's stats report and the previous one, from the reports' own timestamps. Every transport-level detector accumulates this rather than wall-clock elapsed.
-   All standard ICE transport fields

#### SelectedIcePath

The live selected path of one ICE transport, reachable as
`peerConnectionMonitor.selectedIcePath` (the single path — with BUNDLE
negotiated, which is the normal case and always the case for mediasoup
transports, a peer connection has exactly one) or `selectedIcePaths` (all of
them, for a connection whose m-lines were not bundled and can sit on different
paths).

It holds **no copies** of candidate data: `kind`, `usingTurn`, `relayProtocol`,
`turnServer`, `tuple`, addresses, ports and address families are getters reading
through the linked pair and its candidates, alongside `pair`, `localCandidate`,
`remoteCandidate` and `iceTransport`. It follows the pair it is updated with, so
it can never disagree with the stats.

What it owns is what those monitors cannot express:

-   **Transitions.** It compares the selected pair between ticks and emits
    `'ice-path-changed'` with `transition` of `'initial-selection'`,
    `'direct-to-relay'`, `'relay-to-direct'`, `'relay-protocol-changed'`,
    `'turn-server-changed'` or `'path-changed'`, plus `from` / `to` evidence.
-   **TURN usage facts.** `durations` per path kind, `relayDurationInMs`,
    `timeToFirstRelayInMs`, the switch counters, and relay-vs-total bytes and
    packets with `relayBytesRatio`. These are measurements, not verdicts — the
    client does not judge whether TURN usage was appropriate.

```typescript
monitor.on('ice-path-changed', ({ selectedIcePath, transition, from, to }) => {
    console.log(`${transition}: ${from?.kind ?? 'none'} -> ${to.kind}`);
    console.log('relay share of traffic so far:', selectedIcePath.relayBytesRatio);
});
```

These accumulators are deliberately **not** part of the client sample. The sample
already carries `iceTransports`, `iceCandidatePairs` and `iceCandidates`, so a
server can resolve the selected pair and derive the same facts itself, and the
sub-sample transitions it would otherwise miss arrive as
`PEER_CONNECTION_ICE_PATH_CHANGED` client events.

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

Every engine deviates from the [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/) specification — legacy aliases, spec-removed members, missing dictionaries, renamed fields. The library ships one normalizing adapter per browser family, applied automatically based on the detected browser, so the monitors (and everything downstream — detectors, samples, your own code) always see stats as close to the standard shape as possible. Each fix feature-detects from the report itself rather than parsing browser versions, so an adapter applied to an already-conformant report is a no-op.

Adapters do exactly three things: **fold** a value into the standard field it provably belongs to (a renamed member, a legacy report carrying the same measurement), **infer references** — the `*Id` fields that wire one report to another — and **map** legacy enum spellings onto the values the monitors accept.

Inferring a reference is safe where computing a measurement is not. A reference is a structural link, and the report graph either determines it or it doesn't; when it doesn't, the field is left unset rather than guessed. Measured values are never invented: a number a browser omits stays omitted, because an approximation is indistinguishable downstream from a measurement and a detector cannot tell that it is judging a guess.

Nothing is thrown away except a value that survives elsewhere — a member folded into its standard name, or a legacy report whose contents were relocated. Members the spec dropped but a browser still fills (a candidate pair's `priority`, Chromium's `contentType`, Firefox's `selected`) are left on the stat: the browser measured them, monitors copy through whatever they receive, and removing them would only destroy information.

#### ChromeStatsAdapter (Chrome, Edge, Opera)

Folds: `mediaType` → `kind` (the legacy alias, still emitted on every RTP report); `ip` → `address` on ICE candidate reports (Chromium emits both spellings with identical values); the deprecated `track`/`stream` reports and their `trackId` reference (Chrome ≤ M111) → the matching `inbound-rtp` fields.

Infers: `mediaSourceId`, `transportId`, the `remoteId`/`localId` cross-references and `codecId` when absent — normally a no-op on Chromium, kept as a safety net for older versions and for stats arriving through a relay that dropped them.

#### SafariStatsAdapter

Folds: the deprecated `track` reports (Safari ≤ 16.x) → `inbound-rtp` — most importantly `trackIdentifier`, absent on `inbound-rtp` before Safari 16.4, without which a stream cannot be bound to its `MediaStreamTrack` at all, plus freeze/pause counters, frame geometry and audio levels; `mediaType` → `kind`; `data-channel.datachannelid` → `dataChannelIdentifier` (Safari ≤ 17.6).

Maps: legacy `candidate-pair.state` spellings → the spec enum (`inprogress` → `in-progress`, `cancelled` → `failed`).

Infers: `codec.transportId`, spec-required but unfilled through Safari 17.3; `inbound-rtp.remoteId`, which WebKit dropped in Safari 16.4 through 16.6, severing an inbound stream from the sender's clock and RTCP round trip; plus `mediaSourceId` and `codecId` where older WebKit omits them.

#### FirefoxStatsAdapter

Folds: `mediaType` → `kind`; the non-standard `discardedPackets` alias → `packetsDiscarded`. Maps `candidate-pair.state: 'cancelled'` → `'failed'`. Brace-wrapped `{uuid}` track identifiers are intentionally left alone — Firefox wraps `MediaStreamTrack.id` the same way, so they match the application's track ids exactly as emitted.

Reconstructs the whole `transport` report, which Firefox ships none of before Firefox 153, from the `candidate-pair` marked `selected` — accumulating that pair's measured packet and byte counters, and carrying the totals across a selected-pair change rather than jumping back to the new pair's own counters, so ICE-level monitoring behaves the same across browsers. Every number comes from the pair the browser reported. A no-op as soon as a native transport report is present.

Reference inference matters most here, since Firefox omits the most: `outbound-rtp.mediaSourceId`, never emitted, and the link through which a sent stream reaches its source and its `MediaStreamTrack` — resolved by kind when a single source of that kind exists (so simulcast encodings all resolve to it), left unset when a camera and a screen share make it ambiguous. Also `transportId` on RTP, codec and ICE reports, absent before Firefox 153 — resolved to the sole transport, native or reconstructed — plus the `remoteId`/`localId` cross-references and `codecId`, which respects the `encode`/`decode` direction Firefox tags on codec entries.

This is the one stateful adapter, since the reconstructed transport accumulates across ticks: one instance per peer connection, and it should see every tick. Re-adapting the same tick is harmless — the accumulation is keyed on the collection timestamp.

#### Deviations the adapters do not correct

These fields are absent because the browser does not measure them, and nothing in the report can stand in without guessing:

-   `inbound-rtp.framesRendered` — no engine emits it.
-   `remote-inbound-rtp.packetsReceived` — Chromium and WebKit never emit it.
-   Firefox: `qualityLimitationReason`/`Durations`, `totalPacketSendDelay`, `targetBitrate`, `media-source` audio levels, `media-playout` reports, `remote-outbound-rtp` round-trip time.
-   Safari: `media-playout` reports (so `playoutId` and audio-playout metrics are unavailable) and the `address` on host/peer-reflexive ICE candidates, which WebKit nulls.
-   Chromium: `candidate-pair.requestsSent` counts only STUN checks sent before the first response — every later check lands in `consentRequestsSent`, so the sum of the two is the real total. `inbound-rtp.packetsDiscarded` is audio-only.

#### Adding a version-scoped adapter

There is deliberately one adapter per browser family, not one per browser version. Every fix guards on the data — fold `mediaType` if it is there, fill `transportId` if it is missing, rebuild the `transport` report if none is present — which is why a single Firefox adapter covers Firefox 96 through 155 without knowing which it is talking to. Most spec deviations are of the form "this field only exists from version N", and a presence check handles those for free, with no version matrix to maintain across the boundaries each engine has (Firefox at 96, 104, 106, 135, 142, 153, 154; Safari at 16.4, 17.0, 17.4, 18.0).

A version gate is warranted only when the report cannot answer the question: the same field, present in every version, *meaning* something different in a range — a unit change, a counter switching from monotonic to per-interval, or a value that is actively wrong in known builds. None of the deviations handled today are of that kind. Prefer the data whenever it can answer, because a reported user-agent version is the less trustworthy signal: Edge, Opera and Brave lag Chromium and do not report its version, WebViews version themselves oddly, and UA reduction freezes minor versions, so a version gate can be wrong about the engine in a way a presence check cannot.

When one is genuinely needed, register it alongside the browser adapter rather than gating inside shared code — `Sources.addStatsAdapters` already has the browser name and version, and `StatsAdapters` composes adapters in registration order:

```typescript
case "firefox": {
    pcMonitor.statsAdapters.add(new FirefoxStatsAdapter());
    if (majorVersion < 142) pcMonitor.statsAdapters.add(new FirefoxJitterUnitsAdapter());
    break;
}
```

Name it after the deviation it corrects, not the version that introduced it. `FirefoxJitterUnitsAdapter` still says what it does after the next boundary moves; `Firefox94StatsAdapter` — this library's former adapter, which despite its name ran on every Firefox version — said nothing at all.

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

// Means over the streams that actually carried packets this tick — `undefined`
// rather than 0 when none did, so "nothing arrived" and "nothing was lost" do
// not look the same to a detector. These are what TransportLossDetector and
// TransportJitterDetector threshold; the two fields above are sums kept for
// backwards compatibility.
console.log(pcMonitor.avgInboundFractionLost);  // Mean interval inbound loss fraction (0..1)
console.log(pcMonitor.avgOutboundFractionLost); // Mean loss the far end reported for what we send
console.log(pcMonitor.avgInboundJitterInMs);    // Mean inter-arrival jitter (ms)

// Stats time, not wall clock: the newest timestamp in this collection minus the
// newest in the previous one. PC-level detectors accumulate this to measure how
// long a condition held, so a late or skipped collection still measures the time
// the condition actually held underneath.
console.log(pcMonitor.deltaTime);

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
console.log(inboundRtp.timeStretchRate);        // Share of samples NetEQ stretched/compressed
console.log(inboundRtp.estimatedPlayoutTimestamp); // Sender NTP time of the last playable sample

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

// Audio concealment and jitter buffer (the "how did it sound" set)
console.log(inboundRtp.inventedSpeechRatio);        // Share of the interval NetEQ invented — silence excluded
console.log(inboundRtp.concealmentEventRate);       // Concealment events per second
console.log(inboundRtp.timeStretchRate);            // Share of samples NetEQ stretched or compressed
console.log(inboundRtp.avgJitterBufferDelayInMs);   // Latency the buffer actually added, per sample
console.log(inboundRtp.jitterBufferTargetDelayInMs);// What NetEQ is aiming for — a rising target predicts trouble
console.log(inboundRtp.discardRate);                // Packets that arrived too late to use

// Video decode cost and recovery pressure
console.log(inboundRtp.decodeTimePerFrameInMs);     // Decode cost per frame
console.log(inboundRtp.dropRatio);                  // Frames dropped after arriving
console.log(inboundRtp.renderRatio);                // Frames rendered vs decoded
console.log(inboundRtp.keyFrameRate);               // Keyframes decoded per second
console.log(inboundRtp.pliRate);                    // PLIs sent per second
console.log(inboundRtp.firRate);
console.log(inboundRtp.nackRate);
console.log(inboundRtp.retransmissionRatio);        // Share of received bytes that were retransmissions
```

> Every delta above is **counter-reset safe**: a counter that goes backwards
> (SSRC reuse, an ICE restart, a stats-object replacement) yields `0` rather than
> a negative value, so no rate derived from it can go negative.

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

// Encoder cost and pressure
console.log(outboundRtp.encodeTimePerFrameInMs);// Encode cost per frame — the most direct send-side CPU signal
console.log(outboundRtp.avgQpPerFrame);         // Average quantization parameter per encoded frame
console.log(outboundRtp.retransmissionRatio);   // Share of sent bytes that were retransmissions
console.log(outboundRtp.retransmittedPacketRatio);
console.log(outboundRtp.avgPacketSendDelayInMs);// Per-packet pacer delay
console.log(outboundRtp.keyFrameRate);          // Keyframes encoded per second
console.log(outboundRtp.nackRate, outboundRtp.pliRate, outboundRtp.firRate);

// What the encoder spent THIS interval doing, in 0..1 — unlike the raw
// `qualityLimitationDurations` accumulators, this can be compared to a threshold.
console.log(outboundRtp.qualityLimitationDurationShares);
// => { none: 0.25, cpu: 0.75, bandwidth: 0, other: 0 }
```

#### Remote RTP Metrics

**Remote Inbound RTP** (remote peer's receiving stats):

```javascript
const remoteInboundRtp = /* get from pcMonitor.mappedRemoteInboundRtpMonitors */;

console.log(remoteInboundRtp.packetRate);       // Remote receiving packet rate
console.log(remoteInboundRtp.deltaPacketsLost); // Remote packets lost in period

// The RTT the far end measured for the stream we send, averaged over the
// interval from totalRoundTripTime / roundTripTimeMeasurements. `roundTripTime`
// alone is the last single measurement and is noisy.
console.log(remoteInboundRtp.avgRoundTripTimeInSec);
```

> `packetsLost` legitimately *decreases* when a late packet arrives, so the
> counter-reset guard is not merely defensive here — `deltaPacketsLost` is
> clamped at `0` rather than going negative.

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

console.log(mediaSource.deltaFrames);   // Frames the capture source produced in the period
console.log(mediaSource.sourceFps);     // ...as a rate. Compare against what the encoder managed
                                        // to tell a slow camera from a slow encoder.
console.log(mediaSource.rmsAudioLevel); // RMS over the interval, from totalAudioEnergy —
                                        // unlike `audioLevel` it does not read zero between words.

console.log(mediaSource.getOutboundRtps()); // Every encoding fed by this source (simulcast: several)
```

**Media Playout derived metrics** (audio playout):

```javascript
const mediaPlayout = /* get from pcMonitor.mappedMediaPlayoutMonitors */;

console.log(mediaPlayout.deltaSynthesizedSamplesDuration); // Synthesized audio duration in period
console.log(mediaPlayout.deltaSamplesDuration);            // Total samples duration in period
console.log(mediaPlayout.synthesizedSamplesRatio);         // Synthesized share of the interval, 0..1
console.log(mediaPlayout.playoutDelayPerSampleInMs);       // How long audio waited before being played.
                                                           // `totalPlayoutDelay` alone grows forever and
                                                           // cannot be compared to a threshold; this can.
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
    uplinkCongestionDetector: {
        headroomDropRatio: 0.15,
        sendDelayGrowthRatio: 2,
    },

    // Strict CPU monitoring
    cpuPerformanceDetector: {
        incomingDecodedFramesRatioThresholds: {
            alertOn: 0.85,
            alertOff: 0.95,
            minReceivedFrames: 5,
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
        this.monitor.on("score", ({ clientScore, currentReasons }) => {
            // currentReasons is the AGGREGATE: every component's reasons summed
            this.updateScoreDisplay(clientScore, currentReasons);
        });

        this.monitor.on("uplink-congestion", ({ availableOutgoingBitrate, sendingBitrate }) => {
            this.showCongestionAlert(availableOutgoingBitrate, sendingBitrate);
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

    showCongestionAlert(available, sending) {
        const alert = document.createElement("div");
        alert.className = "congestion-alert";
        alert.textContent = `Uplink congestion! Path offers ${available}, encoder sending ${sending}`;
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
    'uplink-congestion': (data: UplinkCongestionEventPayload) => void;
    'downlink-congestion': (data: DownlinkCongestionEventPayload) => void;
    congestion: (data: CongestionEventPayload) => void;   // either of the two, discriminated on `direction`
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
and each one is written to be read on its own:

| Document | What it covers |
|---|---|
| [DETECTOR_TAXONOMY.md](./docs/DETECTOR_TAXONOMY.md) | The five detector categories, the rules that decide which one a detector lands in, and a complete index of all 45 classes |
| [CONNECTIVITY_DETECTORS.md](./docs/CONNECTIVITY_DETECTORS.md) | The five layers a connection climbs, plus the restart telemetry beside them |
| [TRANSPORT_QUALITY_DETECTORS.md](./docs/TRANSPORT_QUALITY_DETECTORS.md) | Capacity, delay, delivery reliability and delivery stability on a path that already works |
| [PIPELINE_DISRUPTION_DETECTORS.md](./docs/PIPELINE_DISRUPTION_DETECTORS.md) | The send and receive media chains, and the boundary each detector watches |
| [PERCEIVED_QUALITY_DETECTORS.md](./docs/PERCEIVED_QUALITY_DETECTORS.md) | What the participant actually sees and hears, and the proxies used to judge it |
| [TELEMETRY_DETECTORS.md](./docs/TELEMETRY_DETECTORS.md) | The facts describing a session — codec, path, layers, devices — and why none of them raises an issue |
| [SCORE_CALCULATIONS.md](./docs/SCORE_CALCULATIONS.md) | Every score reason, threshold, ramp and formula |

## NPM Package

https://www.npmjs.com/package/@observertc/client-monitor-js

## Schemas

Schema definitions are available at https://github.com/observertc/schemas

## Getting Involved

Client-monitor is made with the intention to provide an open-source monitoring solution for WebRTC developers. If you are interested in getting involved, please read our [contribution guidelines](CONTRIBUTING.md).

## License

Apache-2.0
