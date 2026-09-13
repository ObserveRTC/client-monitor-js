# Configuration reference

# Configuration

The `ClientMonitor` accepts a comprehensive configuration object. All configuration options are optional except when specifically noted:

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const monitor = new ClientMonitor({
    // Basic configuration (all optional)
    clientId: "unique-client-id",
    callId: "unique-call-id",
    collectingPeriodInMs: 5000, // Default: 5000ms
    samplingPeriodInMs: 5000, // Default: 5000ms; keep it a multiple of the above

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
    // The keys retired in 4.9.0 are listed under
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
        minSeverity: 0.65,            // how deep the trouble has to be, 0..1
    },                                // (no recovery ratio: it resolves on the browser's verdict)
    downlinkCongestionDetector: {
        minSeverity: 0.65,            // (resolves when the severity falls back under half of it)
    },
    // Deprecated, and still registered unless you switch it off: one verdict for
    // the whole connection, which a receiver cannot support.
    congestionDetector: null,
    transportDelayDetector: {
        thresholdInMs: 300,           // mean RTT at or above which the path counts as slow
        recoveryThresholdInMs: 200,   // RTT below which it resolves (hysteresis)
        // the sustain is peerConnectionWindow, not a duration here
    },
    // Delivery stopping completely, which is a policy fault rather than a quality one.
    // One instance per ICE transport, on `IceTransportMonitor.detectors`.
    blockedInboundMediaDetector: {},  // {} enables with defaults, null removes
    blockedOutboundMediaDetector: {},
    blockedStunRequestsDetector: {},
    transportLossDetector: {
        threshold: 0.05,              // mean interval loss fraction (0..1), worse direction wins
        recoveryThreshold: 0.01,
        durationInMs: 6000,
    },

    // ── Pipeline Disruption ── the send chain ──────────────────────────
    captureSourceLostDetector: {},    // the camera or mic went away under the track
    captureTrackMutedDetector: {},    // the OS or another app took it
    silentAudioSourceDetector: {
        silenceThresholdInMs: 60000,  // long on purpose: silence != a broken mic
        silenceRmsThreshold: 0.0001,   // interval-integrated RMS, not the flickery audioLevel
        recoveryRmsThreshold: 0.0003,  // higher, so one dither blip cannot close a finding
    },
    // Frame supply: is whatever produces this track's frames delivering what it
    // should? Average over a duration, compare, judge.
    // Both average over the `detection` and `recovery` slices of
    // `outboundTrackWindow` rather than holding a window each, so the sustain and
    // the hysteresis are configured in one place.
    videoCaptureBottleneckDetector: {
        produceDegradationThreshold: 0.2,  // camera more than 20% short of the configured fps
    },
    encoderBottleneckDetector: {
        encodeDegradationThreshold: 0.3,   // encoder leaving 30% of handed frames unencoded
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
        decodeDegradationThreshold: 0.1, // 10% of arriving frames left undecoded
        minReceivedFps: 5,               // too thin a stream to judge a decoder on
    },                                   // (the span is inboundTrackWindow)
    decoderPerformanceDetector: {
        decodeTimeBudgetRatio: 0.8,  // share of the per-frame budget decoding may use
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
    videoRecoveryFailedDetector: {
        recoveryFailedThresholdInMs: 5000, // stalled with PLIs out for this long
        recoveryFailedMinPliCount: 2,      // proof we actually asked for repair
    },
    cpuPerformanceDetector: {
        // Both halves of the media pipeline spending this share of stats time in codec work.
        utilizationThreshold: 0.15,
    },

    // ── Perceived Quality ─────────────────────────────────────
    pixelatedVideoDetector: {
        threshold: 0.03,              // bits/pixel at or below which the picture is coarse
        recoveryThreshold: 0.05,      // above this it resolves
        durationInMs: 8000,
    },
    inboundVideoFlowStateDetector: {
        // the stretch both verdicts are measured over is inboundTrackWindow
    },
    inventedSpeechDetector: {
        allowedInventedRatio: 0.05,  // RFC 7294 calls a second above 5% concealment severely concealed
        raiseAfterInventedMs: 400,   // invention beyond the allowance before the issue opens
    },
    audioPlayoutSynthesisDetector: {
        synthesizedRatioThreshold: 0.05,  // share of what was played that was invented
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
    //   inboundVideoFlowStateDetector: null,
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

---

[← back to the README](../README.md)
