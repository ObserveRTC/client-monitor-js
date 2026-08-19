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
        incomingDecodedFramesRatioThresholds: {
            alertOn: 0.7,
            alertOff: 0.85,
            minReceivedFrames: 10,
        },
        durationOfCollectingStatsThreshold: {
            lowWatermark: 5000,
            highWatermark: 10000,
        },
        encoderCpuLimitationShareThreshold: 0.3, // share of the interval spent CPU-limited
        encodeTimeBudgetRatio: 0.8,              // share of the per-frame budget encoding may use
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
    iceConnectivityDetector: {
        disconnectedThresholdInMs: 5000,   // how long `disconnected` must last before an issue
        transportStallThresholdInMs: 5000, // sending but receiving nothing for this long
        pathSwitchWindowInMs: 30000,       // window for counting selected-path switches
        pathSwitchThreshold: 3,            // switches in that window => unstable path
        iceRestartRecommendationThresholdInMs: 10000, // before recommending a restart
        iceRestartRecommendationCooldownInMs: 15000,  // min gap between recommendations
        createEvent: true,
    },
    blockedTransportDetector: {
        thresholdInMs: 5000,          // how long the STUN-ok-but-media-blocked discrepancy must persist
        minMediaBitrateBps: 10000,    // "producer is demonstrably producing" bar
        maxReturnBitrateBps: 2000,    // at or below this, the return path is STUN-only
        maxSendShare: 0.1,            // transport send below this share of produced => not leaving
        stunFreshnessInMs: 10000,     // how recent a STUN response must be to count as verified
    },
    noAvailableIceCandidateDetector: {
        thresholdInMs: 6000,          // grace for `new`/`connecting` with zero local candidates
    },

    audioConcealmentDetector: {
        onThreshold: 0.03,        // Webex treats >3% concealment as significant, >5% as severe
        offThreshold: 0.01,
        windowInMs: 15000,        // spans several collections even at a 5s collecting period
        minSamplesInWindow: 24000,
    },
    jitterBufferStressDetector: {
        targetDelayThresholdInMs: 200,
        timeStretchThreshold: 0.02,
        minConsecutiveTicks: 2,
    },
    decoderPerformanceDetector: {
        decodeTimeBudgetRatio: 0.8,  // share of the per-frame budget decoding may use
        dropRatioThreshold: 0.1,
        minFramesReceived: 10,
        quietLossThreshold: 0.02,    // above this, blame the network instead
        minConsecutiveTicks: 2,
    },
    videoRecoveryDetector: {
        windowInMs: 30000,
        pliRateAlertOn: 0.5,         // real-world storms run ~0.5-0.7 PLI/s sustained
        pliRateAlertOff: 0.15,
        recoveryFailedThresholdInMs: 5000,
        recoveryFailedMinPliCount: 2,
    },
    stuckDecoderDetector: {
        thresholdInMs: 4000,   // floor; effective wait = max(this, rttMultiplier x RTT)
        rttMultiplier: 15,     // high-RTT paths get more time to recover legitimately
        minStuckTicks: 2,      // never judge on fewer observations than this
        minBitrate: 10000,     // bps below which this is a dry track, not a wedge
        minPliCount: 2,
    },
    sourceEncoderBottleneckDetector: {
        captureFpsRatioThreshold: 0.5,
        minSourceFps: 5,
        encodeFpsRatioThreshold: 0.7,
        encodeTimeBudgetRatio: 0.8,
        cpuLimitationShareThreshold: 0.3,
        minConsecutiveTicks: 2,
    },
    captureFailureDetector: {
        silenceThresholdInMs: 30000, // long on purpose: silence != a broken mic
        silenceRmsThreshold: 0.001,
        createEvent: true,
    },

    // Observations — these emit events and never raise issues.
    codecChangeDetector: { createEvent: true },
    videoResolutionChangeDetector: { createEvent: true },
    simulcastLayerDetector: { createEvent: true },
    statsGapDetector: {
        gapRatioThreshold: 2, // multiple of collectingPeriodInMs that counts as a gap
        minGapInMs: 5000,     // a single missed short tick is jitter, not a gap
        createEvent: true,
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

Detectors turn the collected stats into *verdicts*. Each one watches a specific failure mode and reports through up to three channels: **stateful issues** (raised when the condition starts, resolved when it clears — with the full lifecycle shipped to the server, see [Sample-channel behavior](#sample-channel-behavior)), **monitor events** (realtime, for the application to act on), and **client events** (buffered into samples for server-side correlation).

Configuration follows one convention everywhere: omit a detector's config key to get defaults, pass `null` to not construct it at all, or flip the instance's `disabled` flag at runtime to silence it without removing it (see [Controlling which detectors run](#controlling-which-detectors-run)).

### Detector overview

| Detector | Watches | Reports | Good for |
|---|---|---|---|
| [`AudioConcealmentDetector`](#audioconcealmentdetector) | inbound audio | issue `audio-concealment` | How the audio actually *sounded* — catches degradation packet loss numbers miss |
| [`JitterBufferStressDetector`](#jitterbufferstressdetector) | inbound audio | issue `audio-jitter-buffer-stress` | The jitter buffer adding latency *and* stretching audio — delay the user hears |
| [`AudioDesyncDetector`](#audiodesyncdetector) | inbound audio | issue `audio-desync` | Playback drifting out of sync through heavy sample correction |
| [`SynthesizedSamplesDetector`](#synthesizedsamplesdetector) | audio playout | event `synthesized-audio` | The playout device injecting synthesized audio |
| [`FreezedVideoTrackDetector`](#freezedvideotrackdetector) | inbound video | issues `freezed-video-track`, `keyframe-storm`, `video-recovery-failed` | Frozen pictures and a repair loop that stopped working |
| [`DecoderPerformanceDetector`](#decoderperformancedetector) | inbound video | issue `video-decoder-overloaded` | Frames arrived but this device cannot decode them in time |
| [`StuckDecoderDetector`](#stuckdecoderdetector) | inbound video | issue `stuck-decoder` | RTP flowing, nothing decoding — the wedge only recreating the consumer fixes |
| [`PlayoutDiscrepancyDetector`](#playoutdiscrepancydetector) | inbound video | issue `inbound-video-playout-discrepancy` | Frames received but not rendered — a rendering pipeline backlog |
| [`DryInboundTrackDetector` / `DryOutboundTrackDetector`](#dryinboundtrackdetector--dryoutboundtrackdetector) | tracks | issues `dry-inbound-track`, `dry-outbound-track` | A track that should be flowing but carries no bytes at all |
| [`SourceEncoderBottleneckDetector`](#sourceencoderbottleneckdetector) | outbound video | issues `capture-bottleneck`, `encoder-bottleneck` | Whether the *camera* or the *encoder* is the reason you send fewer frames |
| [`CaptureFailureDetector`](#capturefailuredetector) | outbound tracks | issues `capture-track-ended`, `silent-audio-source` | Vanished devices and microphones producing pure silence |
| [`CongestionDetector`](#congestiondetector) | peer connection | issue `congestion` | Bandwidth-limited sending corroborated by RTT / loss |
| [`CpuPerformanceDetector`](#cpuperformancedetector) | whole client | issue `cpulimitation` | The device running out of CPU for encode/decode |
| [`LongPcConnectionEstablishmentDetector`](#longpcconnectionestablishmentdetector) | peer connection | event `too-long-pc-connection-establishment` | Connection setup taking suspiciously long |
| [`IceConnectivityDetector`](#iceconnectivitydetector) | ICE transports | issues `ice-disconnected`, `ice-connection-failed`, `ice-transport-stalled`, `unstable-ice-path`; events `ice-restart`, `ice-restart-recommended` | Runtime ICE health and *when* an ICE restart is warranted |
| [`BlockedTransportDetector`](#blockedtransportdetector) | ICE transports | issue `blocked-transport` | STUN passes but media does not — the firewall / policy-middlebox signature |
| [`NoAvailableIceCandidateDetector`](#noavailableicecandidatedetector) | peer connection | issue `no-available-ice-candidate` | Zero local ICE candidates while the connection falls over — no usable network at all |
| [`IceTupleChangeDetector`](#icetuplechangedetector) | ICE transports | event `ice-tuple-changed` | The low-level signal that the selected network tuple changed |
| [`CodecChangeDetector`](#observation-detectors) | tracks | event `codec-changed` / `CODEC_CHANGED` | Which codec/profile is actually in use, and when it changed |
| [`VideoResolutionChangeDetector`](#observation-detectors) | video tracks | event `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | The adaptation ladder, with the *reason* attached |
| [`SimulcastLayerDetector`](#observation-detectors) | outbound video | event `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Which simulcast layers are actually being sent |
| [`StatsGapDetector`](#observation-detectors) | the monitor itself | event `stats-collection-gap` / `STATS_COLLECTION_GAP` | Backgrounded-tab gaps that would otherwise read as network spikes |

The last four are **observations**: they emit events and never raise issues, because what they report is not a fault — it is the missing context in most investigations.

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
| `FreezedVideoTrackDetector` | `freezed-video-track` | **Yes** | `inbound-rtp` `freezeCount`, `totalFreezesDuration` |
| `FreezedVideoTrackDetector` | `keyframe-storm` | **Yes** | `inbound-rtp` `pliCount`, `firCount`, `keyFramesDecoded` |
| `FreezedVideoTrackDetector` | `video-recovery-failed` | No | tick-level sequencing of freeze + PLI + keyframe counters |
| `AudioDesyncDetector` | `audio-desync` | **Yes** | `inbound-rtp` inserted/removed sample totals |
| `AudioConcealmentDetector` | `audio-concealment` | **Yes** | `inbound-rtp` `concealedSamples`, `silentConcealedSamples` |
| `JitterBufferStressDetector` | `audio-jitter-buffer-stress` | **Yes** (approx.) | `inbound-rtp` jitter-buffer totals; the consecutive-tick nuance is lost |
| `SynthesizedSamplesDetector` | event only | **Yes** | `media-playout` synthesized-sample totals |
| `PlayoutDiscrepancyDetector` | `inbound-video-playout-discrepancy` | **Yes** | `inbound-rtp` `framesReceived` vs `framesRendered` |
| `DecoderPerformanceDetector` | `video-decoder-overloaded` | Partially | `inbound-rtp` decode/drop totals; frame-budget + quiet-loss guards are coarser at the sampling period |
| `StuckDecoderDetector` | `stuck-decoder` | No | tick-level bytes-up/frames-flat/PLI-up fingerprint; drives consumer recreation |
| `DryInboundTrackDetector` | `dry-inbound-track` | No | guards read `MediaStreamTrack.muted`/`readyState` + remote pause state — not in the sample |
| `DryOutboundTrackDetector` | `dry-outbound-track` | No | same non-sampled track-state guards |
| `CaptureFailureDetector` | `capture-track-ended` | No | `MediaStreamTrack` `ended` event — no stats representation |
| `CaptureFailureDetector` | `silent-audio-source` | No | energy totals are sampled, but the live/enabled/unmuted guards are not |
| `SourceEncoderBottleneckDetector` | `capture-bottleneck`, `encoder-bottleneck` | No | discriminator reads `track.getSettings().frameRate` — not in the sample |
| `CongestionDetector` | `congestion` | Mostly | `candidate-pair` available bitrates + `outbound-rtp` `qualityLimitationReason` — two components, but both sampled |
| `CpuPerformanceDetector` | `cpulimitation` | No | joins send-side and receive-side evidence plus `durationOfCollectingStatsInMs`, which is not sampled |
| `IceConnectivityDetector` | `ice-disconnected`, `ice-connection-failed`, `ice-transport-stalled`, `unstable-ice-path` | No | state transitions and episode timing happen *between* samples |
| `BlockedTransportDetector` | `blocked-transport` | No | joins candidate-pair STUN counters + transport bytes + outbound-rtp bitrate per collecting tick |
| `NoAvailableIceCandidateDetector` | `no-available-ice-candidate` | No | connection-state jumps + gathering state; with no network the next sample may never leave the device |

A deeper walkthrough of the reasoning lives in [`docs/DETECTOR_SAMPLE_WORTHINESS.md`](docs/DETECTOR_SAMPLE_WORTHINESS.md).

---

### Audio detectors

#### AudioConcealmentDetector

Reports how the audio actually *sounded*. Opus + NetEQ conceal a lot of loss inaudibly, and audio also degrades without dramatic loss — so the **audible** concealment share (silent concealment subtracted) is both more sensitive and more specific than packet loss. Judged over a sliding window, since concealment is bursty.

**Use the result:** show a "poor audio from X" indicator on the affected participant's tile; the `burstiness` field tells you whether to describe it as choppiness (`bursty`) or dropouts (`continuous`). Server-side, the issue lifecycle gives you exact audible-degradation windows per participant.

```javascript
audioConcealmentDetector: {
    onThreshold: 0.03,         // audible concealment share that raises (Webex: >3% = significant)
    offThreshold: 0.01,        // share below which it resolves (hysteresis)
    windowInMs: 15000,         // sliding window; spans several ticks even at 5s collection
    minSamplesInWindow: 24000, // don't judge on less than ~0.5s of 48kHz audio
}
```

```typescript
monitor.on('audio-concealment', ({ trackMonitor, concealmentRate, concealmentEventRate }) => {
    // the user is HEARING this — mark the participant's tile
    ui.setAudioQualityWarning(trackMonitor.track.id, { rate: concealmentRate });
});
monitor.on('issue-resolved', (issue) => {
    if (issue.type === 'audio-concealment') ui.clearAudioQualityWarning(/* by key */);
});
```

**Sources:** [Voice quality monitoring (Webex)](https://help.webex.com/article/kqh7le/Voice-quality-monitoring) · [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

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

#### AudioDesyncDetector

Detects heavy sample correction (acceleration/deceleration) on an inbound audio track — the signature of playback drifting and being yanked back, which the user perceives as warbly or out-of-sync audio.

**Use the result:** correlate with lip-sync complaints; persistent desync on one track is usually the far end's capture clock, so route the report to *that* participant's diagnostics rather than the listener's.

```javascript
audioDesyncDetector: {
    fractionalCorrectionAlertOnThreshold: 0.1,  // >10% of samples corrected raises
    fractionalCorrectionAlertOffThreshold: 0.05, // <5% resolves
}
```

```typescript
monitor.on('audio-desync-track', ({ trackMonitor }) => {
    diagnostics.flag('audio-desync', trackMonitor.track.id);
});
```

**Sources:** [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### SynthesizedSamplesDetector

Watches `media-playout` for synthesized (concealment/generated) samples injected at the playout device level, and emits `'synthesized-audio'` plus the `EXCESSIVE_SYNTHESIZED_AUDIO` client event when the duration in one interval exceeds the configured minimum.

**Use the result:** sustained synthesized playout with otherwise healthy inbound stats points at the *output* path — suggest the user switch audio output device.

```javascript
syntheticSamplesDetector: {
    minSynthesizedSamplesDuration: 0, // ms of synthesized audio per interval before reporting
    createEvent: true,                // also buffer EXCESSIVE_SYNTHESIZED_AUDIO into samples
}
```

**Sources:** [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Video detectors

#### FreezedVideoTrackDetector

Owns the whole freeze/repair domain of an inbound video track. It derives the freeze state (a freeze persists until frames actually render again) and watches the repair loop — PLI/FIR out, keyframes back in:

-   `freezed-video-track` — the picture is frozen (config: `videoFreezesDetector`).
-   `keyframe-storm` — sustained PLI rate; self-reinforcing congestion, since keyframes are large (config: `videoRecoveryDetector`).
-   `video-recovery-failed` — PLIs going out, picture still frozen, keyframes not advancing: the repair request left the client and nothing came back, which points at SFU forwarding (config: `videoRecoveryDetector`).

**Use the result:** on `freezed-video-track`, overlay a spinner/last-frame treatment on the tile. `video-recovery-failed` is your escalation signal — pair it with [`stuck-decoder`](#stuckdecoderdetector): if both fire, recreate the consumer; if only recovery fails (no bytes checked here), the producer or SFU forwarding needs the look.

```javascript
videoFreezesDetector: {},          // freeze issue on/off ({} = defaults, null = off)
videoRecoveryDetector: {
    windowInMs: 30000,             // window for PLI/keyframe rates
    pliRateAlertOn: 0.5,           // real-world storms run ~0.5-0.7 PLI/s sustained
    pliRateAlertOff: 0.15,
    recoveryFailedThresholdInMs: 5000, // frozen + PLIs out + no keyframe for this long
    recoveryFailedMinPliCount: 2,      // proof we actually asked for repair
}
```

```typescript
monitor.on('freezed-video-track', ({ trackMonitor }) => ui.showFreezeOverlay(trackMonitor.track.id));
monitor.on('video-recovery-failed', ({ trackMonitor, pliCountSinceStalled }) => {
    // we asked for a keyframe repeatedly and nothing came back — not a local problem
    reportToServer('recovery-failed', trackMonitor.track.id, { pliCountSinceStalled });
});
```

**Sources:** [PLI: Picture Loss Indication (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/pli/) · [RFC 4585: RTP/AVPF (PLI/FIR)](https://datatracker.ietf.org/doc/html/rfc4585) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

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

#### StuckDecoderDetector

Catches the per-consumer decode wedge: RTP bytes keep arriving while nothing decodes and PLIs fire continuously — a corrupted/incomplete frame broke the decode chain and it never recovers on its own. The wait is adaptive (`max(thresholdInMs, rttMultiplier × RTT)` plus a minimum number of stuck ticks), and the `minBitrate` floor separates it from a merely starved track.

**Use the result:** **recreate the consumer** — that is the known mitigation, and this detector fires exactly and only when it applies (delivery confirmed, output zero). The payload's `variant` separates an `assembly` wedge (no frame ever reassembled) from a `decode` wedge, and `deadBytesReceived` quantifies the waste for the report.

```javascript
stuckDecoderDetector: {
    thresholdInMs: 4000,   // floor; effective wait = max(this, rttMultiplier × RTT)
    rttMultiplier: 15,     // high-RTT paths get more time to recover legitimately
    minStuckTicks: 2,      // never judge on fewer observations
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
    lowSkewThreshold: 2,  // frames of skew at which the issue resolves
    highSkewThreshold: 5, // frames of skew at which it raises
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

#### SourceEncoderBottleneckDetector

Splits "we are sending fewer frames than we should" into its two causes, indistinguishable from RTP alone: `capture-bottleneck` (the camera/OS never produced the frames) and `encoder-bottleneck` (the source is healthy; the encoder fell behind).

**Use the result:** capture-bottleneck → the fix is at the device (suggest lowering capture constraints, closing other camera apps; lighting can throttle cameras). Encoder-bottleneck → reduce encode load: drop the top simulcast layer, lower resolution/framerate, disable background effects. The payload carries `encoderImplementation`, `cpuLimitationShare` and the fps pair for the report.

```javascript
sourceEncoderBottleneckDetector: {
    captureFpsRatioThreshold: 0.5,   // source below 50% of configured fps = starving
    minSourceFps: 5,                 // absolute floor when getSettings() has no frameRate
    encodeFpsRatioThreshold: 0.7,    // encoder below 70% of source fps = behind
    encodeTimeBudgetRatio: 0.8,      // encode time per frame vs the frame budget
    cpuLimitationShareThreshold: 0.3, // share of interval explicitly CPU-limited
    minConsecutiveTicks: 2,
}
```

```typescript
monitor.on('capture-bottleneck', ({ trackMonitor, sourceFps, expectedFps }) => {
    ui.hintCameraTrouble(trackMonitor.track.id, { sourceFps, expectedFps });
});
monitor.on('encoder-bottleneck', () => sender.dropTopSimulcastLayer());
```

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### CaptureFailureDetector

Watches the source end of outbound tracks: the device is gone (`capture-track-ended`), the OS or another app took it (`capture-track-muted` event), or a live, unmuted microphone has produced nothing but silence for a long stretch (`silent-audio-source` — the threshold is deliberately long, because only duration separates a dead mic from a quiet person).

**Use the result:** `capture-track-ended` → open the device picker. `silent-audio-source` → the classic "are you speaking? we can't hear you" banner, with a shortcut to switch microphone.

```javascript
captureFailureDetector: {
    silenceThresholdInMs: 30000, // long on purpose: silence ≠ broken until it persists
    silenceRmsThreshold: 0.001,  // interval-integrated RMS, not the flickery audioLevel
    createEvent: true,           // also buffer CAPTURE_TRACK_ENDED / _MUTED into samples
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

#### CongestionDetector

Detects network congestion on a peer connection: bandwidth-limited outbound streams, corroborated (depending on `sensitivity`) by an RTT jump over its own EWMA baseline or by outbound loss. The RTT it reads never mixes RTCP and ICE measurements.

**Use the result:** reduce what you send — lower simulcast layers or cap the bitrate — and show a network-quality indicator. The event payload carries the available bitrates plus the maxima seen before congestion, which sizes *how much* to back off.

```javascript
congestionDetector: {
    sensitivity: 'medium', // 'high': any bw-limitation | 'medium': + RTT rise | 'low': + >5% loss
}
```

```typescript
monitor.on('congestion', ({ availableOutgoingBitrate, maxSendingBitrate }) => {
    sender.capBitrate(Math.min(availableOutgoingBitrate, maxSendingBitrate * 0.8));
    ui.setNetworkIndicator('poor');
});
```

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

#### CpuPerformanceDetector

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

#### LongPcConnectionEstablishmentDetector

Emits `'too-long-pc-connection-establishment'` (and the `LONG_PC_CONNECTION_ESTABLISHMENT` client event) when a peer connection stays in `connecting` past the threshold. Re-arms on any exit from `connecting`, so slow *retries* are reported too.

**Use the result:** show "connecting is taking longer than usual"; if it repeats, retry with `iceTransportPolicy: 'relay'` to test whether direct connectivity is the blocker. The [`never-established`](#iceconnectivitydetector) restart recommendation is this detector's escalation.

```javascript
longPcConnectionEstablishmentDetector: {
    thresholdInMs: 5000,
    createEvent: true,
}
```

**Sources:** [RTCPeerConnection.connectionState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState) · [ICE (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/ice/)

#### IceConnectivityDetector

Runtime ICE and transport health, per ICE transport (a peer connection without BUNDLE has several, and they fail independently). Raises `ice-disconnected` (only after the threshold — transient blips self-heal), `ice-connection-failed` (immediately — `failed` is terminal for the generation), `ice-transport-stalled` (still sending, receiving nothing, after inbound had been seen) and `unstable-ice-path` (selected path flapping).

**Use the result — the restart loop:** the library names *when* an ICE restart is warranted; performing it is the application's job. `'ice-restart-recommended'` carries a `reason` and a `recommendationCount` so you can escalate to a full rejoin when restarts stop helping; `'ice-restart'` then reports whether the restart you performed `recovered` or `failed`.

| `reason` | Meaning |
|---|---|
| `ice-failed` | ICE gave up on this generation — restart immediately. |
| `ice-disconnected` | `disconnected` outlasted the self-heal window. |
| `transport-stalled` | ICE says connected, but the selected path stopped delivering. |
| `never-established` | The connection never finished connecting (covers stuck DTLS). |

```javascript
iceConnectivityDetector: {
    disconnectedThresholdInMs: 5000,   // how long `disconnected` may self-heal
    transportStallThresholdInMs: 5000, // sending-but-not-receiving tolerance
    pathSwitchWindowInMs: 30000,       // window for counting selected-path switches
    pathSwitchThreshold: 3,            // switches in the window => unstable path
    iceRestartRecommendationThresholdInMs: 10000,
    iceRestartRecommendationCooldownInMs: 15000,
    createEvent: true,                 // buffer ICE_RESTART / _RECOMMENDED into samples
}
```

```typescript
monitor.on('ice-restart-recommended', ({ peerConnectionMonitor, reason, recommendationCount }) => {
    if (recommendationCount >= 3) return session.rejoin(); // restarts are not helping
    rtcPeerConnection.restartIce();                        // or mediasoup transport.restartIce()
});
monitor.on('ice-restart', ({ outcome }) => metrics.count(`ice-restart.${outcome}`));
```

**Sources:** [ICE restart: recovering connectivity (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/ice-restart/) · [RTCPeerConnection.restartIce (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce) · [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [RFC 7675: STUN consent freshness](https://datatracker.ietf.org/doc/html/rfc7675)

#### BlockedTransportDetector

The firewall signature: a middlebox that lets ICE/STUN through but blocks the media itself. Every connectivity signal looks healthy — the candidate pair is `succeeded`, consent checks keep passing, `iceConnectionState` is `connected` — yet the call carries nothing. The existing detectors structurally miss this case: STUN consent responses count into the pair's `bytesReceived`, so the pair never looks dry and the inbound-stall check never fires, while the dry-track detectors see outbound-rtp counters advancing and stay silent.

Raises `blocked-transport` (per ICE transport) when, sustained for `thresholdInMs`, all three hold: STUN demonstrably alive (`responsesReceived` advanced within `stunFreshnessInMs`), the application demonstrably producing (outbound RTP on the transport ≥ `minMediaBitrateBps`), and the media demonstrably not traversing. The payload's `evidence` field says which discrepancy was observed:

| `evidence` | Meaning |
|---|---|
| `media-not-leaving-transport` | RTP senders produce bytes but the transport's own send counter barely moves — host firewall, blocked socket, dead route. |
| `no-return-traffic` | Media leaves at full rate, STUN answers, but nothing except STUN comes back — not even RTCP. Classic DPI / UDP-throttling firewall. |

The detector judges the *sending* side, where the client holds both halves of the proof. A firewall blocking only the receive direction shows up on the remote peer's sending side, or as a dry inbound track here.

```javascript
blockedTransportDetector: {
    thresholdInMs: 5000,          // discrepancy persistence before raising
    minMediaBitrateBps: 10000,    // below this the transport is legitimately quiet
    maxReturnBitrateBps: 2000,    // at/below this the return path counts as STUN-only
    maxSendShare: 0.1,            // transport send under this share of produced => blocked on send
    stunFreshnessInMs: 10000,     // consent checks run ~5s; must comfortably exceed one interval
}
```

**Use the result:** tell the user their network blocks media (a TURN/TLS fallback or a network change is the fix, an ICE restart on the same path is not), and correlate server-side: many `blocked-transport` clients on one corporate network is a firewall policy, not N user problems.

**Sources:** [RFC 7675: STUN consent freshness](https://datatracker.ietf.org/doc/html/rfc7675) · [RTCIceCandidatePairStats (W3C webrtc-stats)](https://www.w3.org/TR/webrtc-stats/#candidatepair-dict*) · [WebRTC and firewalls (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/firewall/)

#### NoAvailableIceCandidateDetector

The other end of the connectivity spectrum: the client cannot even *begin* to connect because ICE gathering produced **zero local candidates**. A healthy establishment gathers a host candidate within milliseconds — even without internet, any up interface yields one. Zero candidates while the connection state jumps from `new`/`connecting` straight to `disconnected`/`failed` means there was nothing to connect *with*: no interface, airplane mode, a VPN that tore down every route. This is a different diagnosis from every other ICE issue — those describe a path that existed and stopped working; this one says no path was ever possible.

Raises `no-available-ice-candidate` (per peer connection) immediately on `disconnected`/`failed` with zero local candidates on a never-connected PC, and after `thresholdInMs` when the PC just sits in `new`/`connecting` with nothing gathered. Resolves when a local candidate appears or the connection reaches `connected`. Never fires on a connection that once connected — mid-call network loss belongs to `IceConnectivityDetector`.

```javascript
noAvailableIceCandidateDetector: {
    thresholdInMs: 6000, // grace for `new`/`connecting` before the sustained variant raises
}
```

**Use the result:** skip the ICE-restart dance entirely — recommend the user check their connection; on the server, treat the client as offline-at-join rather than call-quality-degraded.

**Sources:** [RTCPeerConnection.connectionState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState) · [RTCPeerConnection.iceGatheringState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceGatheringState) · [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445)

#### IceTupleChangeDetector

The low-level primitive under the path detectors: emits `'ice-tuple-changed'` whenever the set of selected `local:remote` network tuples changes. Always registered; `SelectedIcePath` classifies *what kind of* change it was, and only `IceConnectivityDetector` raises issues.

**Use the result:** debugging and logging — a tuple change with no `ice-path-changed` classification usually means a port change on the same interface.

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [TURN server: when you need it and what it costs (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/turn/) · [RTCIceCandidateStats.relayProtocol (MDN)](https://developer.mozilla.org/docs/Web/API/RTCIceCandidateStats/relayProtocol) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

### Observation detectors

These four emit events and **never raise issues** — they record context that is not a fault but is the missing column in most investigations. Each has a single config option, `createEvent` (default `true`), which buffers the matching client event into samples for server-side use.

| Detector | Monitor event / client event | Use the result for |
|---|---|---|
| `CodecChangeDetector` | `codec-changed` / `CODEC_CHANGED` | Answering "why do all the bad calls use H264" — compares `sdpFmtpLine` too, so an H264 profile switch is caught. Fires once or twice per call. |
| `VideoResolutionChangeDetector` | `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | Following the adaptation ladder. On outbound tracks the event carries `qualityLimitationReason` — the field that separates encoder adaptation from your own constraint changes. Classified `upgrade` / `downgrade` / `reshape` (orientation flip). |
| `SimulcastLayerDetector` | `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Debugging "why is this participant blurry": a layer counts as active only if it *sent bytes*, so a layer the encoder quietly gave up on becomes visible. |
| `StatsGapDetector` | `stats-collection-gap` / `STATS_COLLECTION_GAP` | Discounting the metrics right after a backgrounded-tab / sleep gap instead of reading them as a network spike. |

```javascript
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

Most built-in detectors raise their own stateful issue with a typed payload, emit a detector-specific named event on entry, and resolve the issue when the condition clears — enriching the resolved payload with `durationInMs`. The four *observation* detectors (`CodecChangeDetector`, `VideoResolutionChangeDetector`, `SimulcastLayerDetector`, `StatsGapDetector`) are the exception: they emit events only, because what they report is not a fault.

| `type` | Raised when | Resolved when | Detector-specific event | Payload shape |
|---|---|---|---|---|
| `audio-desync` | Audio sample-correction fraction crosses the on-threshold | Correction fraction falls below the off-threshold | `'audio-desync-track'` | `AudioDesyncIssuePayload` |
| `congestion` | Per-PC bandwidth limitation + sensitivity-specific corroborator | Bandwidth limitation clears | `'congestion'` | `CongestionIssuePayload` |
| `cpulimitation` | CPU-tagged outbound RTP / stats-collection slowness / low inbound decoded-to-received frames ratio | Indicators normalize | `'cpulimitation'` | `CpuPerformanceIssuePayload` |
| `dry-inbound-track` | Inbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-inbound-track'` | `DryInboundTrackIssuePayload` |
| `dry-outbound-track` | Outbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-outbound-track'` | `DryOutboundTrackIssuePayload` |
| `freezed-video-track` | `freezeCount` increases | No new freezes for one tick | `'freezed-video-track'` | `FreezedVideoTrackIssuePayload` |
| `inbound-video-playout-discrepancy` | `framesReceived - framesRendered > highSkewThreshold` | Skew drops below `lowSkewThreshold` | `'inbound-video-playout-discrepancy'` | `PlayoutDiscrepancyIssuePayload` |
| `ice-disconnected` | An ICE transport stayed `disconnected` past `disconnectedThresholdInMs` | ICE reconnects, or the transport goes away | — | `IceDisconnectedIssuePayload` |
| `ice-connection-failed` | An ICE transport reached `failed` | ICE reconnects (typically after a restart) | — | `IceConnectionFailedIssuePayload` |
| `ice-transport-stalled` | Still sending on a succeeded pair of a connected transport, but receiving nothing for `transportStallThresholdInMs` | Inbound traffic resumes | — | `IceTransportStalledIssuePayload` |
| `unstable-ice-path` | `pathSwitchThreshold` selected-path switches within `pathSwitchWindowInMs` | The window drains | — | `UnstableIcePathIssuePayload` |
| `audio-concealment` | Audible concealment share (silence excluded) crosses `onThreshold` over the window | Share falls below `offThreshold` | `'audio-concealment'` | `AudioConcealmentIssuePayload` |
| `audio-jitter-buffer-stress` | Target delay grown **and** NetEQ time-stretching, for `minConsecutiveTicks` | Either condition clears | `'audio-jitter-buffer-stress'` | `JitterBufferStressIssuePayload` |
| `video-decoder-overloaded` | Frames arrived and loss was quiet, but decode time overran the frame budget or frames were dropped after arrival | The decoder keeps up again | `'video-decoder-overloaded'` | `DecoderPerformanceIssuePayload` |
| `keyframe-storm` | Sustained PLI rate above `pliRateAlertOn` | Rate falls below `pliRateAlertOff` | `'keyframe-storm'` | `KeyframeStormIssuePayload` |
| `video-recovery-failed` | PLIs sent, picture frozen, `keyFramesDecoded` not advancing for `recoveryFailedThresholdInMs` | A keyframe arrives or the freeze ends | `'video-recovery-failed'` | `VideoRecoveryFailedIssuePayload` |
| `capture-bottleneck` | The capture source produced far fewer frames than configured | The source recovers | `'capture-bottleneck'` | `CaptureBottleneckIssuePayload` |
| `encoder-bottleneck` | A healthy source outran the encoder, or the encoder was CPU-limited | The encoder keeps up again | `'encoder-bottleneck'` | `EncoderBottleneckIssuePayload` |
| `capture-track-ended` | The outbound track's device reached `ended` | — (terminal) | `'capture-track-ended'` | `CaptureTrackEndedIssuePayload` |
| `silent-audio-source` | A live, enabled, unmuted microphone produced silence for `silenceThresholdInMs` | Audio appears, or the track stops capturing | `'silent-audio-source'` | `SilentAudioSourceIssuePayload` |
| `stuck-decoder` | RTP bytes flowing, nothing decoding, PLIs firing, for `thresholdInMs` | Frames decode again | `'stuck-decoder'` | `StuckDecoderIssuePayload` |

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
monitor.on('congestion',                          (e) => { /* … */ });
monitor.on('cpulimitation',                       (e) => { /* … */ });
monitor.on('audio-desync-track',                  (e) => { /* … */ });
monitor.on('freezed-video-track',                 (e) => { /* … */ });
monitor.on('dry-inbound-track',                   (e) => { /* … */ });
monitor.on('dry-outbound-track',                  (e) => { /* … */ });
monitor.on('inbound-video-playout-discrepancy',   (e) => { /* … */ });
monitor.on('audio-concealment',                   (e) => { /* audible concealment, not raw loss */ });
monitor.on('audio-jitter-buffer-stress',          (e) => { /* buffer grown AND stretching */ });
monitor.on('video-decoder-overloaded',            (e) => { /* frames arrived, client could not decode */ });
monitor.on('keyframe-storm',                      (e) => { /* PLIs feeding the congestion that caused them */ });
monitor.on('video-recovery-failed',               (e) => { /* we asked for a keyframe; nothing came back */ });
monitor.on('stuck-decoder',                       (e) => { /* RTP flowing, nothing decodes — recreate the consumer */ });
monitor.on('capture-bottleneck',                  (e) => { /* the camera never produced the frames */ });
monitor.on('encoder-bottleneck',                  (e) => { /* the source did; the encoder could not keep up */ });
monitor.on('capture-track-ended',                 (e) => { /* the device is gone */ });
monitor.on('capture-track-muted',                 (e) => { /* the OS or another app took it */ });
monitor.on('silent-audio-source',                 (e) => { /* live mic producing digital silence */ });

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
monitor.on('new-selected-ice-path', (e) => { /* an ICE transport selected its first path */ });

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

// Audio concealment and jitter buffer (the "how did it sound" set)
console.log(inboundRtp.concealmentRate);            // Audible concealment share — silence excluded
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
    congestionDetector: {
        sensitivity: "high",
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
