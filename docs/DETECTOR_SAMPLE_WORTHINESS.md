# Detector Inventory & Sample-Worthiness Assessment

Which detector issues genuinely need to travel in the `ClientSample`, and which are
derivable on the server from stats the sample already carries. Written against the
detector set of 2026-08 (including the proposed `BlockedTransportDetector` and
`NoAvailableIceCandidateDetector`).

## 1. The criterion

Every `ClientSample` already ships the **full stats snapshot** of every monitor —
`inboundRtps` include `freezeCount`, `totalFreezesDuration`, `concealedSamples`,
`framesReceived/Decoded/Rendered`, `totalDecodeTime`; `outboundRtps` include
`qualityLimitationDurations`, `totalEncodeTime`; `iceTransports`, `iceCandidatePairs`,
`mediaSources`, `mediaPlayouts` likewise. All the load-bearing counters are monotonic
totals, so a server holding consecutive samples can compute every delta the client
computed, just at the sampling period (default 8 s) instead of the collecting period
(default 2 s).

An issue therefore *earns* its place in the sample when at least one of these holds:

1. **Cross-source correlation.** The verdict joins stats from several components plus
   timing that no single stats object carries (firewall block = candidate-pair STUN
   counters + transport byte counters + outbound-rtp bitrate + freshness windows).
2. **Non-shipped inputs.** The detector reads things that never reach the sample:
   `MediaStreamTrack.muted/readyState/getSettings()`, `RTCPeerConnection.connectionState`
   transitions between samples, `durationOfCollectingStatsInMs`, wall-clock episode
   timing at 2 s resolution.
3. **Sub-sampling-period dynamics.** The signature lives in the 2 s tick sequence and is
   aliased away at 8 s (fast state flaps, short freezes bounded by episode timing,
   consecutive-tick requirements).
4. **Actionability at the edge.** The issue is the trigger for a server-side or
   support-side action where the joined, human-readable verdict is the product (rejoin
   recommendation, consumer recreation, "check your firewall" messaging).

Issues that fail all four are *server-derivable*: keeping them client-side still has
value (application callbacks, immediate UX), but shipping them in every sample is
redundant bytes — the server can compute the same verdict from the stats it already
stores, often with better fleet-wide thresholds.

## 2. Inventory

Verdict legend — **SEND**: keep in samples (hard or impossible to derive server-side);
**DERIVABLE**: server can reconstruct from shipped stats, make sampling optional;
**EVENT-ONLY**: already an observation event, not an issue — correct as is.

### Connectivity / transport (peer-connection level)

| Issue / event | Detector | Primary inputs | Verdict | Reasoning |
|---|---|---|---|---|
| `blocked-transport` | BlockedTransportDetector | pair STUN counters + transport bytes + outbound-rtp bitrate + freshness | **SEND** | Criterion 1 and 3 in full: three stats sources joined per 2 s tick; at 8 s granularity the STUN-freshness logic is not reproducible. |
| `no-available-ice-candidate` | NoAvailableIceCandidateDetector | connectionState transitions + gathering state + local candidate count | **SEND** | Criterion 2/3: state jumps happen between samples; with no network the *next* sample may never leave the device — the issue may be the last thing that gets out. |
| `ice-disconnected`, `ice-connection-failed` | IceConnectivityDetector | iceState + wall-clock persistence | **SEND** | Sample carries only iceState snapshots; a 5 s disconnected episode inside an 8 s period is invisible server-side. Episode `durationInMs` on resolve is the payload of record. |
| `ice-transport-stalled` | IceConnectivityDetector | pair byte deltas per tick + prior-inbound-traffic memory | **SEND** | Criterion 3: per-tick deltas plus cross-tick memory (`sawInboundTraffic`). |
| `unstable-ice-path` | IceConnectivityDetector + SelectedIcePath | switch timestamps in sliding window | **SEND** | Switch timestamps are not in the stats; only `selectedCandidatePairChanges` totals are — a coarse proxy that loses the windowing. Borderline: a server could threshold on the counter delta, but the path-kind classification is client-side. |
| `ice-restart` / `ice-restart-recommended` (events) | IceConnectivityDetector | ufrag change inference, recommendation state machine | **SEND** (events) | The recommendation is criterion 4 distilled — its entire purpose is to be acted on and audited. |
| `congestion` | CongestionDetector | availableOutgoingBitrate vs highest-seen + qualityLimitationReason + RTT EWMA | **DERIVABLE** (lean) | `availableIncoming/OutgoingBitrate`, `qualityLimitationReason/Durations`, RTT sources are all shipped. Server-side congestion scoring over the fleet is arguably *better*. Keep the client event for app-side bitrate adaptation hooks. |

### Inbound media quality (track level)

| Issue | Detector | Primary inputs | Verdict | Reasoning |
|---|---|---|---|---|
| `freezed-video-track` | FreezedVideoTrackDetector | `freezeCount` deltas + rendered-frames recovery | **DERIVABLE** | The canonical example: `freezeCount` and `totalFreezesDuration` are shipped monotonic totals — the server can compute freeze incidence and total frozen time *exactly*, per sample, with no client help. Only fine-grained episode boundaries are lost. |
| `audio-desync` | AudioDesyncDetector | inserted/removed samples ratios | **DERIVABLE** | `insertedSamplesForDeceleration` / `removedSamplesForAcceleration` / `totalSamplesReceived` are shipped totals; the ratio is one division server-side. |
| `audio-concealment` | AudioConcealmentDetector | concealed/silentConcealed samples over a 15 s window | **DERIVABLE** | Same totals shipped; the 15 s window even aligns better with 8 s samples than with 2 s ticks. |
| `synthesized-audio` (EXCESSIVE_SYNTHESIZED_AUDIO) | SynthesizedSamplesDetector | media-playout synthesized durations | **DERIVABLE** | `mediaPlayouts` ship the totals. |
| `audio-jitter-buffer-stress` | JitterBufferStressDetector | jitterBufferTargetDelay + time-stretch per tick, consecutive ticks | **DERIVABLE** (borderline) | Totals shipped; only the consecutive-2 s-tick requirement is lost. An 8 s-window server rule is a fine approximation. |
| `inbound-video-playout-discrepancy` | PlayoutDiscrepancyDetector | framesReceived − framesRendered skew | **DERIVABLE** | Both totals shipped. |
| `keyframe-storm` | FreezedVideoTrackDetector | PLI/FIR/keyframe rates over 30 s window | **DERIVABLE** | `pliCount`/`firCount`/`keyFramesDecoded` totals shipped; a 30 s window spans ~4 samples cleanly. |
| `video-recovery-failed` | FreezedVideoTrackDetector | frozen + PLIs out + keyframes flat, per tick | **SEND** | Criterion 3/4: the "asked and nothing came back" claim needs tick-level sequencing, and it is the SFU-debugging hook. |
| `stuck-decoder` | StuckDecoderDetector | bytes rising + frames flat + PLI rising, RTT-scaled wait, consecutive ticks | **SEND** | Criterion 3 and 4: tick-sequenced fingerprint, and the issue is the trigger for consumer recreation. |
| `video-decoder-overloaded` | DecoderPerformanceDetector | decode time vs frame budget + drop ratio + quiet-loss guard | **SEND** (borderline) | The counters are shipped, but the frame-budget comparison uses per-interval fps and the quiet-loss attribution guard; server reconstruction at 8 s is a blunter instrument. Keep, or demote once a server rule is validated. |
| `dry-inbound-track` | DryInboundTrackDetector | per-tick zero bytes + `track.muted`/`readyState` guards + remote-pause guard | **SEND** | Criterion 2: the guards read MediaStreamTrack state and mediasoup pause state that stats never carry; without them a server reimplementation false-positives on every legitimate pause. |

### Outbound media / capture (track level)

| Issue | Detector | Primary inputs | Verdict | Reasoning |
|---|---|---|---|---|
| `dry-outbound-track` | DryOutboundTrackDetector | zero sent bytes + `track.muted`/`readyState` guards | **SEND** | Same as dry-inbound: the muted/live guards are non-shipped (criterion 2). |
| `capture-track-ended` | CaptureFailureDetector | MediaStreamTrack `ended` event | **SEND** | Pure criterion 2 — no stats representation at all. |
| `silent-audio-source` | CaptureFailureDetector | RMS from totalAudioEnergy + live/enabled/unmuted guards | **SEND** | Energy totals are shipped (derivable in principle) but the enabled/unmuted guards are not; without them the issue is unreconstructable. |
| `capture-bottleneck` / `encoder-bottleneck` | SourceEncoderBottleneckDetector | sourceFps vs configured fps (`getSettings()`) vs encoded fps | **SEND** | `getSettings().frameRate` (criterion 2) is the discriminator between adaptation and failure. |
| `cpulimitation` | CpuPerformanceDetector | qualityLimitationDurations + decoded/received ratio + `durationOfCollectingStatsInMs` | **SEND** | `durationOfCollectingStatsInMs` is not in the sample, and the verdict joins send-side and receive-side evidence (criterion 1/2). |

### Observation events (correct as events, never issues)

`codec-changed`, `video-resolution-changed`, `simulcast-layer-changed`,
`stats-collection-gap`, `ice-path-changed`/`PEER_CONNECTION_ICE_PATH_CHANGED`,
`ICE_RESTART`. These are the missing *columns* in aggregate analysis rather than faults;
they are cheap, low-frequency, and several (codec change, layer change, path change) are
genuinely hard to reconstruct from snapshots because the change happens between samples.
Keep all of them, gated by their existing `createEvent` flags. `stats-collection-gap` is
special: it is the *validity bit* for every rate in the adjacent sample — always send.

## 3. Recommendations

**Issue sampling is configurable per detector; local emission stays unconditional.**
(Implemented.) Every issue-raising detector exposes a runtime flag next to `disabled`:

```ts
public includeIssueInSample = true; // flip like `disabled`, at any time
```

which the detector passes as `includeInSample` on every `raiseIssue` call. The gate is
applied only at sample-buffering time — `emit('issue')`, `activeIssues` and resolution
semantics stay untouched, so application callbacks and the score calculator keep working
when sampling of a detector is off. Custom issues get the same control via the
`includeInSample` option on `raiseIssue` / `addIssue`. To apply the DERIVABLE tier as a
drop-list at startup:

```ts
for (const pc of monitor.peerConnections)
    for (const track of pc.tracks)
        for (const d of track.detectors)
            if (DERIVABLE_DETECTOR_NAMES.has(d.name)) d.includeIssueInSample = false;
// or per detector: monitor detectors registries expose getByName(...)
```

**What must stay.** The connectivity tier (`blocked-transport`,
`no-available-ice-candidate`, the four ICE issues, restart events), the wedge/action tier
(`stuck-decoder`, `video-recovery-failed`), and everything guarded by non-shipped track
state (`dry-*`, `capture-*`, `silent-audio-source`, bottleneck pair, `cpulimitation`).
These are exactly the issues that are cross-correlating and cannot be found by examining
any single component's stats — the stated purpose of issue sampling.

**What the server should own.** Freeze incidence (`freezeCount` /
`totalFreezesDuration`), concealment and desync ratios, playout skew, keyframe-storm
rates, and congestion scoring. Server-side rules see the whole fleet, can be re-tuned
retroactively over stored samples, and don't cost client bytes. Once those rules exist,
flip the corresponding detectors' sampling off by default (keep the detectors — their
events still drive in-app UX) — that is roughly a 40–50 % reduction in issue entries on
typical bad-network sessions, where the DERIVABLE tier dominates volume.

**Interplay with `sendResolvedIssuesToServer`.** The lifecycle mirror only pays for
itself on issues the server acts on live. An issue raised with `includeInSample: false`
skips its resolution entry automatically (no raise entry → no resolve entry), so no
extra configuration is needed there.

**One structural nit.** `keyframe-storm` and `video-recovery-failed` live in
`FreezedVideoTrackDetector` together with the derivable `freezed-video-track`, and the
flag is per *detector*, not per issue type — so flipping that detector's
`includeIssueInSample` also drops `video-recovery-failed` (a SEND-tier issue). If the
DERIVABLE drop-list is applied in production, either keep `FreezedVideoTrackDetector`
sampling on, or split the recovery issues into their own detector first.
