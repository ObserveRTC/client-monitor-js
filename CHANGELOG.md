## 4.9.0

The detector layer is rebuilt around one rule: **one detector class raises one issue type**. 27
detector classes became 46, 27 issue types became 37, and the score stopped re-deriving thresholds
from raw stats.

Three things drove it. A class that owned four findings lost all four to one malformed stats
report, because `Detectors.update()` wraps each detector in its own try/catch. `disabled` and
`includeIssueInSample` are per detector, so a config key covering a group could not silence one
finding without silencing its neighbours. And a class holding several conditions accumulated
shared state that coupled them.

Full reference: [docs/DETECTOR_TAXONOMY.md](docs/DETECTOR_TAXONOMY.md).

### Breaking: detector classes split and renamed

| 4.8.0 | 4.9.0 | Issue type |
|---|---|---|
| `AudioConcealmentDetector` | `InventedSpeechDetector` | `audio-concealment` → `invented-speech` |
| `AudioDesyncDetector` | `AVDesyncPlayoutDetector` | `audio-desync` → `av-desync` |
| `BlockedTransportDetector` | `BlockedInboundMediaDetector`, `BlockedOutboundMediaDetector`, `BlockedStunRequestsDetector` | `blocked-transport` → `blocked-inbound-media-transport`, `blocked-outbound-media-transport`, `blocked-stun-requests` |
| `CaptureFailureDetector` | `CaptureSourceLostDetector`, `CaptureTrackMutedDetector`, `SilentAudioSourceDetector` | `capture-track-ended` → `capture-source-lost`; `silent-audio-source` unchanged; the muted class is event-only |
| `DtlsHandshakeDetector` | `DtlsHandshakeFailedDetector`, `DtlsHandshakeStalledDetector` | `dtls-handshake-failed`, `dtls-handshake-stalled`, both unchanged |
| `EncoderPerformanceDetector` | `EncoderBottleneckDetector` | `encoder-bottleneck`, unchanged |
| `FreezedVideoTrackDetector` | `InboundVideoFlowStateDetector`, `VideoRecoveryFailedDetector` | `freezed-video-track` → `video-flow-disrupted`; `video-recovery-failed` unchanged; `keyframe-storm` dropped |
| `IceConnectivityDetector` | `IceDisconnectedDetector`, `IceConnectionFailedDetector`, `IceTransportStalledDetector`, `UnstableIcePathDetector`, `IceRestartDetector`, `IceRestartRecommendationDetector` | `ice-disconnected`, `ice-connection-failed`, `ice-transport-stalled`, `unstable-ice-path`, all unchanged; the two restart classes are event-only |
| `IceTupleChangeDetector` | `IceTraversalDetector` | none (telemetry) |
| `InboundFrameSupplyDetector` | `DecoderBottleneckDetector` | `decoder-bottleneck`, unchanged |
| `LongPcConnectionEstablishment` | `IcePathEstablishmentDetector` | none |
| `MediaPipelineDetector` | `RtpSenderStalledDetector`, `TransportDemuxStalledDetector` | `media-pipeline-stalled` → `rtp-sender-stalled`, `transport-demux-stalled` |
| `NoAvailableIceCandidateDetector` | `IceReachabilityDetector` | `no-available-ice-candidate`, unchanged |
| `OutboundFrameSupplyDetector` | `VideoCaptureBottleneckDetector` | `capture-bottleneck` → `video-capture-bottleneck` |
| `SynthesizedSamplesDetector` | `AudioPlayoutSynthesisDetector` | none → `synthesized-audio` (the condition was event-only before) |

A split class has no alias: one that raised four issues cannot be aliased onto one that raises a
single one without lying about what it does. Import the part you meant.

**Also new**, with no predecessor: `FrameAssemblyStalledDetector`,
`IceEstablishmentFailedDetector`, `PixelatedVideoDetector`, `TransportDelayDetector`,
`TransportLossDetector`, `UplinkCongestionDetector`, `DownlinkCongestionDetector`.

`keyframe-storm` is removed outright, with no replacement.

### Breaking: one config block per detector

Every detector reads a block named after itself — its `name` in camelCase, so
`frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector`. Keys that used to
construct a group of classes are gone, because a `null` intended to silence one finding silently
removed its neighbours: `audioConcealmentDetector`, `audioDesyncDetector`,
`blockedTransportDetector`, `captureFailureDetector`, `dtlsHandshakeDetector`,
`encoderPerformanceDetector`, `iceConnectivityDetector`, `inboundFrameSupplyDetector`,
`longPcConnectionEstablishmentDetector`, `mediaPipelineDetector`,
`noAvailableIceCandidateDetector`, `outboundFrameSupplyDetector`, `syntheticSamplesDetector`,
`videoFreezesDetector`, `videoRecoveryDetector`.

65 config keys: 46 detector blocks, one per class, plus the shared windows below and the basics. A
retired key fails to type-check.

### Breaking: the score is a reading of the open issues

`DefaultScoreCalculator` no longer re-derives anything from raw stats. Every monitor starts at
5.0 and is reduced by the findings its own detectors raised, read from that monitor's own
`IssueRegistry`, so a fault is judged in exactly one place and the score cannot disagree with the
issue list an operator is looking at.

A charge named after an issue type is applied only while that issue is open — what it is *worth*
can still be a continuous reading, so `decoder-bottleneck` costs what the decoder actually fell
behind by. A charge with no issue of that name is a continuous reading on its own:
`volatile-fps`, `dropped-video-frames`, `blocky-video`, `unstable-audio-playout` and
`unstable-transport` exist only here, and are named for what they measure. A reason that cost
nothing is not written at all — a key sitting at `0` reads as a fault that was found and never
resolved.

Connectivity issues are **deliberately not priced**. A path carrying nothing leaves nothing to
have an opinion about, and `dry-inbound-track` / `dry-outbound-track` already take the tracks
riding on it to zero; charging the connection as well would be the same fault counted twice.

**The client score is `5 − RMSE` across five dimensions** — the transport, and inbound and
outbound audio and video — which replaces 4.8.0's "the peer connection scales its tracks by
`pcScore / 5`". Each dimension is the weighted mean of the monitors making it up, and a dimension
nothing reported is *absent* rather than zero: a call that sends no video is not a call whose
video is broken. Squaring the distances is what makes one collapsed dimension cost more than the
same shortfall spread evenly — `[5, 5, 0]` scores `2.11` where an average would say `3.33`.

Removed with it: `DefaultScoreCalculatorInboundVideoTrackScoreAppData`,
`DefaultScoreCalculatorOutboundAudioTrackScoreAppData`,
`DefaultScoreCalculatorOutboundVideoTrackScoreAppData`,
`DefaultScoreCalculatorPeerConnectionScoreAppData`, `DefaultScoreCalculatorSubtractions`,
`DefaultScoreCalculatorSubtractionReason`, and the `VIDEO_QP_THRESHOLDS` / `VIDEO_QP_MAX` /
`VideoQpThresholds` exports — a blocky picture is now `PixelatedVideoDetector`'s verdict over
`InboundTrackMonitor.quantizationDegradation`, not the calculator's own model. What a fault costs
is still tunable through the mutable statics on `DefaultScoreCalculator` (`PIXELATION_WEIGHT_*`
and the activation/saturation pairs); replacing the policy wholesale means assigning your own
`ScoreCalculator` to `ClientMonitor.scoreCalculator`.

### Breaking: retired events

`audio-concealment`, `audio-desync-track`, `capture-track-ended`, `freezed-video-track`,
`keyframe-storm`, `media-pipeline-stalled` and `too-long-pc-connection-establishment` no longer
exist. 68 events in total; the additions mirror the detector table above, plus
`ice-path-establishment-slow` and `capture-source-lost`.

On the wire, one `ClientEventTypes` member is renamed: **`CAPTURE_TRACK_ENDED` →
`CAPTURE_SOURCE_LOST`**, with `CaptureTrackEndedEventPayload` becoming
`CaptureSourceLostEventPayload`. A server matching on the event-type string has to accept the new
name. The sample schema itself is unchanged at **3.7.0**.

### Breaking: renamed and withdrawn monitor fields

The monitors were renamed alongside the detectors reading them, so a field named after a
withdrawn issue is gone too.

| 4.8.0 | 4.9.0 |
|---|---|
| `InboundRtpMonitor.concealmentRate` | `inventedSpeechRatio` |
| `InboundRtpMonitor.dropRatio` | `droppedFrameRatio` (this interval's share, not the call's) |
| `OutboundTrackMonitor.getHighestLayer()` | `highestLayer` |
| `PeerConnectionMonitor.attributeRtpToTransport()` | withdrawn; `hasInboundMedia` / `hasInboundVideo` / `hasOutboundMedia` answer what the detectors used it for |
| `PeerConnectionMonitor.highestSeenSendingBitrate`, `highestSeenReceivingBitrate`, `highestSeenAvailableOutgoingBitrate`, `highestSeenAvailableIncomingBitrate` | withdrawn; the congestion detectors hold their own `DecayingMaxEstimator`, which forgets |
| `InboundTrackMonitor.contentType`, `motionType`, `presentedResolution`, `videoTag`, `paused` | read-only getters over the declared context; write them with `setContext()` / `ClientMonitor.setInboundTrackContext()` |

### Deprecated: `CongestionDetector`

Still registered and still raising `congestion`, and still configured by `congestionDetector`.
It answers for both directions from one signal, which a receiver cannot support — Chrome computes
no incoming bandwidth estimate, so the old detector's incoming fields read zero there. Set
`congestionDetector: null` and listen for `uplink-congestion` / `downlink-congestion` instead.
Nothing else emits on the `congestion` event: the replacements each report on their own, with a
graded severity rather than one on/off verdict for the whole connection.

### Capacity: one detector per direction

`UplinkCongestionDetector` scores the sending path from two witnesses — how far the browser's
bandwidth estimate has fallen below the highest it recently reached, and how far pacer time per
packet sits above its own running median. `DownlinkCongestionDetector` scores the receiving path
from the arriving bitrate against its recent maximum, and the per-frame jitter buffer delay
against its median.

Each pair combines as a geometric mean, so a witness at its healthy level takes the severity to
zero rather than merely failing to add — which is what separates a path running out of room from
a sender that was asked for less. Two numbers are configurable per direction: `minSeverity`, how
deep the trouble has to be before it is reported, and `pacerBloatingSaturatesAt` /
`bufferBloatingSaturatesAt`, where the delay witness tops out as a multiple of the connection's
own median. Neither detector uses a recovery ratio against the old maximum, because nothing knows
what a narrowed path can carry now; the recent maximum decays instead, and fades faster for 30
seconds after an episode closes, since a path rarely gives back all of what one took.

### New: shared facts, shared windows, shared registries

- **`IssueRegistry`** — every monitor owns the issues raised against it, so a detector no longer
  reaches into a client-wide map and the score can read one monitor's findings directly.
  `PeerConnectionMonitor.issues`, `InboundTrackMonitor.issues`, `OutboundTrackMonitor.issues`.
- **`SlicedWindow`** — the rolling window several detectors had each implemented, done once, and
  shared by every detector on the same monitor so that detectors judging one track judge the same
  stretch of time. Sized per monitor level by `clientWindow`, `inboundTrackWindow`,
  `outboundTrackWindow` and `peerConnectionWindow`, which replace the per-detector `durationInMs`
  keys, and published as `slicedWindow` on each monitor.
- **`DecayingMaxEstimator`** — the largest value seen recently, where "recently" is a half-life
  rather than a window, decaying per second of stats time so applications collecting at different
  periods forget at the same rate.
- **`FrugalQuantileEstimator`** — a streaming quantile held in one number, for baselines of spiky
  signals where an EWMA settles far above the true median.

**`statsClockTime`** — every monitor now accumulates the measured gaps between collections, and
every window and duration in the library is aged on that clock rather than on `Date.now()`. A
late or skipped collection widens a window by the time the condition actually held; a backgrounded
tab cannot age a stall into an issue.

**`inputsUnavailable`** — a detector whose inputs the browser does not report says so, instead of
reading as a healthy path. This is the behaviour whose absence made a whole browser population
look like the best behaved on a fleet.

### New: monitor API

- **`bufferClientSamplesUntilSubscriber`** (default `false`) — samples created before anything
  listens for `'sample-created'` are buffered and replayed in creation order to the first
  subscriber, instead of being dropped. A monitor started before the transport is ready no longer
  loses the opening minute of a call.
- **`ExtensionStatsMonitor`** — application stats are folded into the monitor tree like any other:
  `ClientMonitor.getExtensionStatsMonitor()`, `getExtensionStatsPayload()` and
  `mappedExtensionStatsMonitors`.
- **`ClientMonitor.createdAt` / `uptimeInMs`** — how long this monitor has been running.
- **`ClientMonitor.cpuUtilization`** — the reading behind `cpulimitation`, published on every
  collection the detector could judge whether or not it raised.

### Fixed

| Fix | What was wrong |
|---|---|
| One-way media no longer reads as a fault | `blocked-transport` and `ice-transport-stalled` both assumed a peer connection carries media in both directions; an SFU publish transport does not, and both raised on healthy calls. Each now requires that return media was expected at all — at least one inbound RTP stream attributed to the transport |
| Data-channel bitrate accumulators reset each collection | they accumulated forever, so a 40 kbps signalling channel read as 9.7 Mbps after twenty minutes |
| RTCP round trip only counted when the report advances | `getStats()` keeps serving the last `remote-inbound-rtp` after the far end goes quiet, so the average converged on a measurement nobody had made recently |
| `postAdapt` no longer runs twice | every accumulator in `_acceptAdaptedStats` was applied twice per collection |
| The issue union matches what detectors raise | it declared `blocked-transport` and `capture-bottleneck`, which nothing raises, and omitted `blocked-stun-requests` and `video-capture-bottleneck`, which are raised — so `video-capture-bottleneck` also carried no score weight |

## 4.8.0

Transport observability. Three themes: **the RTP → transport → candidate-pair graph is fully traversable and attributed by one rule**, **DTLS handshake failure finally has an owner**, and **samples stop repeating constants** (sample schema **3.7.0**).

### Wire / payload changes — schema `ClientSample` 3.7.0

-   **Payloads may nest.** `ClientEvent.payload`, `ClientIssue.payload`, `ClientMetaData.payload` and `ExtensionStat.payload` accept nested structures (`Record<string, unknown>`), not only flat records of primitives — still records on the wire, never pre-serialised JSON strings. `ClientPayload` widened accordingly; `ClientPayloadValue` is removed (it named the flat-only constraint).
-   **`PEER_CONNECTION_ICE_PATH_CHANGED` carries structured `from`/`to`.** The path evidence travels as records now that the schema allows nesting; before 3.7.0 the two fields were JSON documents in strings. Consumers parsing them with `JSON.parse` must read them as objects instead.
-   **`IceTransportStats` static members ship on change only.** `iceRole`, `iceLocalUsernameFragment`, `localCertificateId`, `remoteCertificateId`, `tlsVersion`, `dtlsCipher`, `dtlsRole` and `srtpCipher` are constant after the DTLS handshake, so they appear in a transport's first sample and again only when a value changes — the ufrag changing is exactly an ICE restart, a change worth shipping. Consumers keep the last seen value per transport `id`; **absence means "unchanged", not "unknown"**. `sendIceTransportMetadataOnChangeOnly: false` restores every-sample emission. Dynamic members (`iceState`, `dtlsState`, `selectedCandidatePairId`, `selectedCandidatePairChanges`, byte/packet counters) are unchanged.
-   **Two new issues: `dtls-handshake-failed` and `dtls-handshake-stalled`** (see the detector below), in the `ClientMonitorIssue`/`ClientMonitorResolvedIssue` unions and the `isClientMonitorIssue` guard.
-   **`LONG_PC_CONNECTION_ESTABLISHMENT` says where setup is stuck.** The event payload gains `stalledStage` (`'ice-gathering' | 'ice-checking' | 'dtls' | 'unknown'`) plus the most severe transport's `iceState`/`dtlsState` and the pc's `iceGatheringState` — `connectionState: 'connecting'` covers ICE and DTLS alike, and until now the event could not tell a STUN desert from a certificate problem.
-   **`unstable-ice-path` payload gains `nativePairChanges`** — how many switches the browser's own counter saw inside the window, which can exceed the observed transition count (see below).
-   **Firefox < 153 reconstructed transport counter is spec-aligned.** `selectedCandidatePairChanges` now counts the first selection as 1, matching the native counter's "going from no selected pair to having one also increments" semantics; it previously landed on 0.

### New: `DtlsHandshakeDetector`

Separates "the network path failed" (the ICE detectors' territory) from "the secure media transport never negotiated", which nothing owned: a certificate fingerprint mismatch, DTLS version intolerance, or a middlebox that passes STUN but eats DTLS all presented as a generically slow `connecting`. `dtlsState: 'failed'` raises `dtls-handshake-failed` immediately; ICE proven healthy while DTLS sits in `new`/`connecting` past `stalledThresholdInMs` (default 6000) raises `dtls-handshake-stalled`. ICE health comes from the transport's `iceState` where the browser reports one, and from the selected pair being `succeeded` where it does not (Safari, and the transport reconstructed for Firefox < 153) — the payload's `iceEvidence` names which proof was used. Never judges a transport on its first observed tick (Firefox 153/154 report pre-negotiation values that only 155 makes trustworthy), never treats `closed` as a failure, and restarts its stall timer when the ufrag changes. Config: `dtlsHandshakeDetector`, `null` to disable. *(4.9.0 split this class in two and retired that key; the two detectors now read `dtlsHandshakeFailedDetector` and `dtlsHandshakeStalledDetector`.)*

### One attribution rule for RTP → transport

-   **`attributeRtpToTransport` (utils) / `PeerConnectionMonitor.attributeRtpToTransport()`** is now the single rule mapping RTP streams onto a transport: exact `transportId` match, and streams carrying no `transportId` belong to a transport only when it is the pc's sole transport — exact under BUNDLE, never double-counted without it.
-   `BlockedTransportDetector` and `MediaPipelineDetector` both use it. They previously disagreed: the pipeline detector's permissive filter counted a `transportId`-less inbound stream against **every** transport of a non-BUNDLE connection, so one quiet stream could raise `media-pipeline-stalled` on two transports at once.
-   **The traversal graph is complete**: `getIceTransport()` and `getSelectedCandidatePair()` on all four RTP monitors (only the inbound one could traverse before), and `getSelectedIcePath()` on `IceTransportMonitor` — any stream can now answer "is this on TURN?" in two hops.

### Selected-pair churn is counted from the browser

-   **`IceTransportMonitor.deltaSelectedCandidatePairChanges`** differences the native `selectedCandidatePairChanges` counter (Chrome 80+, Firefox 155+; absent on Safari). Counted only once the transport already had a selection, so the first selection is never churn; a backwards counter reads as a reset, not as movement.
-   **`unstable-ice-path` uses the larger of observed transitions and the native delta.** The path diffing in `SelectedIcePath` remains the classifier and the only portable signal, but it is tick-to-tick and structurally blind to a flap that departs and returns within one collecting period — the native counter sees it. An inferred ICE restart clears the native tally and suppresses the next ticks, so a restart's own reselection never counts.

### Fixed

-   **Peer-connection `iceState` is the most severe state across its transports**, not whatever transport happened to be listed first — a failed transport is no longer masked by a healthy sibling on a non-BUNDLE connection. Severity: `failed > disconnected > checking > new > connected > completed > closed`.
-   **The `never-established` restart recommendation reports the most severe transport** instead of the first one, for the same reason.

## 4.7.0

A large release, summarised by what actually changed rather than by the order it was built in. Three themes: **scores now say who is responsible for what**, **detectors were rebuilt around the signal each one can actually see**, and **three new detectors cover failures nothing owned**.

### Breaking

-   **`sourceEncoderBottleneckDetector` config is gone**, replaced by `outboundFrameSupplyDetector`, `encoderPerformanceDetector` and `inboundFrameSupplyDetector` — one block per attachment point. Code that passed it (including `: null` to disable) must be updated; TypeScript flags it, JavaScript does not.
-   **`ClientEvent.payload`, `ClientIssue.payload`, `ClientMetaData.payload` and `ExtensionStat.payload` are records on the wire, not pre-serialised JSON strings.** Servers must read them as objects. Callers passing nested structures to `addEvent`/`raiseIssue`/`addIssue`/`addMetaData` must flatten or JSON-encode those values themselves — a nested structure in an event payload is now a compile error. (~12% escaping overhead removed from payload bytes, ~18% faster whole-sample serialisation.)
-   **`encode*ScoreReasons` removed from the `ScoreCalculator` interface.** Custom calculators implement `update()` and set `reasons` on the calculated scores; the sampling helper is exported as `sampledScoreReasons`.
-   **`low-bitrate-per-pixel` and `low-bitrate-for-resolution` no longer exist** as score reasons, along with `BPP_RANGES`, `expectedVideoBitrate`, `VIDEO_BITRATE_EXPECTATION` and `calculateBaseVideoScore`. `pixelated-video` replaces them.
-   **`high-packetloss` and `high-jitter` no longer appear on track score reasons** — only on the peer connection. See *Score attribution* below.
-   Schema **`ClientSample` 3.6.0**: `scoreReasons` is a `Record<string, number>` on the client, peer-connection and track entries.

### Score attribution: the path is the connection's problem, the picture is the track's

The same network condition used to be charged up to three times. Measured over a captured session whose real streams ran at 0.00% loss and 2 ms jitter: mean client score **2.93 → 4.86**, share of samples below 3.0 **85% → 0%**.

-   **Streams carrying no media no longer measure the path.** An SFU's bandwidth-probation stream (mediasoup's `mid: "probator"`) delivers deliberately discardable packets and no frames — observed at ~2 kbps with ~50% "loss" and ~490 ms "jitter" beside real streams at 0% and 2 ms. Averaged in unweighted it produced `high-jitter: 2` **and** `high-packetloss: 2` on **99% of samples**. A stream must now show evidence of carrying media before its ratios count: `MIN_PATH_SAMPLE_BITRATE` (8 kbps), `MIN_PATH_SAMPLE_PACKETS` (25/interval), or any frames. Any one suffices, so DTX audio and thin video still count. This alone moved the peer connection's mean from 1.08 to 4.92.
-   **Tracks are no longer charged for loss or jitter.** Those are properties of the shared path and are already charged there. Charging them again could floor a track — an outbound audio track scored **0.03** on a path whose loss was 0% at the 95th percentile. Tracks keep every penalty measuring what the user *perceived*: freezes, low and volatile fps, dropped frames, pixelation, concealment, time-stretch, jitter-buffer delay. A server joins a track's symptoms to its peer connection's path reasons from the same sample.
-   **The client score aggregation is unchanged**: the peer connection still scales its tracks by `pcScore / 5`, so a degraded path degrades what the viewer got from every track on it and a call can never score better than the connection carrying it. Removing the track-level loss and jitter penalties is what stops the same packets being charged twice; the multiplication itself was only ever counting the path once.
-   **RTT and jitter are separate peer-connection reasons** — a long path and a jittery path are different problems (`high-rtt` at −1 above 150 ms, −2 above 300 ms; `high-jitter` at −1 above 30 ms, −2 above 100 ms). **`very-high-rtt` is gone** — it was the only reason key that split one condition across two keys instead of carrying the magnitude, which is what every other reason does. Loss uses the per-interval `deltaFractionLost` and is **averaged** across streams rather than summed.
-   **Each entity ships only its own reasons.** The client entry carried the aggregate of everything below it, so one track pixelating produced `pixelated-video` on the track entry *and* the client entry. `ClientMonitor.scoreReasons` now means what it means everywhere else — this entity's own subtractions, of which there are none today. The aggregate moved to the `'score'` event's `currentReasons` for applications reacting live. `sendScoreReasonsToServer` (default `true`) drops reasons from the wire without touching scores.

### Pixelation is measured from the quantizer, and charged by how big the picture is

-   **`pixelated-video` reads the inbound `qpSum`.** The old bitrate-per-pixel reason was wrong twice over: its floor ignored resolution (required bitrate scales as roughly `pixels^0.75`, so one floor cannot fit 180p and 1080p — in practice it demanded ~1 Mbps at 360p30 and took a loss-free 640×358@30 VP8 stream at 500 kbps to full saturation every sample), and dividing by *measured* fps meant a track halving its frame rate doubled its bits-per-pixel and shed the penalty — the metric rewarded dropping frames. QP is the encoder stating how coarsely it had to quantize, which is the blockiness the viewer is looking at. **Where the browser reports no `qpSum` for the codec, the reason is absent entirely** rather than modelled from bitrate. `InboundRtpMonitor.avgQpPerFrame`/`deltaQpSum` are new, mirroring the outbound side, and reset rather than carrying a stale average forward when nothing decoded.
-   **Bands are per codec and per motion class** (`VIDEO_QP_THRESHOLDS`, indexed `[codec][motionType]`). QP scales are not comparable as fractions of their ranges (H.264 0–51, VP8 0–127, VP9/AV1 0–255), and the same quantizer is not equally visible on all content — movement masks artifacts, a slide shows every blocked edge. Bands run the *opposite* way to bitrate. Undeclared, screen share is judged `lowmotion` and everything else `standard`. Unrecognised codec, no judgement. All ramps on `DefaultScoreCalculator` are mutable statics.
-   **A large picture is charged harder than a small one, deliberately unfairly.** The presented size selects the weight a saturated quantizer is worth: **3.0** when the picture is magnified ≥1.5× linear (`PIXELATION_MAX_PENALTY_LARGE` — a big video gone to blocks is the worst thing short of it stopping), **2.0** at roughly decoded size, **0.5** below 0.75× (a thumbnail nobody can see the blocks in). Magnification is `sqrt(presentedArea / decodedArea)`, taken from the areas so a differently proportioned box is not magnification on width alone. **Undeclared presented size means the ordinary 2.0** — nothing is substituted for a missing number.

### Application-declared track context

-   **`ClientMonitor.setInboundTrackContext(trackId, ctx)` / `setOutboundTrackContext(trackId, ctx)`**, and `setContext()` on either track monitor. Everything the application knows and the stats never reveal travels through one call per direction, taking a partial object. `InboundTrackContext` carries `contentType`, `motionType`, `presentedResolution` and `videoTag`; `OutboundTrackContext` carries `contentType` alone, because motion and presentation describe how a track is *watched* and the sender does not know.
-   **Declarable before the track exists**, in both directions: signaling often announces a guest's screen share before a packet arrives. A declaration is applied immediately if the monitor exists and otherwise held pending, consumed by whichever peer connection first manifests the track. Separate maps per direction — one shared map meant a send and a receive track sharing an id could take each other's declaration. No timers, no cleanup.
-   **Contexts merge, they do not replace**, on a live monitor and in the pending state alike, so a content type from signaling survives a later call that only attaches the video element. An explicit `undefined` means "not declared here", not "reset".
-   **`presentedResolution` is declared in device pixels, or derived from `videoTag`** and re-measured every tick, so going full-screen or resizing a panel is picked up. The derivation reads the element's **layout box** (`clientWidth`/`clientHeight` × `devicePixelRatio`) with the frame's aspect ratio fitted into it as `object-fit: contain` does — never `videoWidth`/`videoHeight`, which are the *intrinsic* decoded size and would make every magnification exactly 1. Applications using `object-fit: cover` should declare the resolution themselves.
-   **One `TrackContentType`** (`'camera' | 'screenshare'`) in `monitors/TrackMonitor.ts`, replacing the identical `InboundTrackContentType` and `OutboundTrackContentType`. What differs between the directions is not the type but how it is arrived at: auto-detected from `track.getSettings().displaySurface` when sending, declared when receiving. `track.contentHint` is **never** used — applications set `'detail'`/`'text'` on camera tracks too.
-   **Screen share is now actually scored as screen share.** The old special case tested `contentHint !== 'screen'`, not a valid value, so it matched every track. Screen-share tracks skip the fps, bitrate-volatility and target-deviation penalties (meaningless on mostly-static VBR content) and are charged on `downscaled-screenshare` instead: encoded area below ½ of the captured surface −1, below ¼ −2, where shared text stops being readable. Inbound screen share skips `low-fps`/`volatile-fps` for the same reason.

### Frame supply: four detectors in a 2×2, one job each

`SourceEncoderBottleneckDetector` is gone. In its place, each cell answers one question with the unit that question deserves:

| | frames going missing (averaged over a duration) | the stage cannot keep up (consecutive ticks) |
|---|---|---|
| outbound | `capture-bottleneck` — `OutboundFrameSupplyDetector` | `encoder-bottleneck` — `EncoderPerformanceDetector` |
| inbound | `decoder-bottleneck` — `InboundFrameSupplyDetector` | `video-decoder-overloaded` — `DecoderPerformanceDetector` |

-   **Ticks and durations are not two spellings of the same thing.** A tick count is a *confidence* floor — two independent stats reads agreed — and every encoder/decoder signal is a per-interval ratio a single read can get wrong. A duration is a *persistence* bar: the capture device stayed short long enough to matter. So `minConsecutiveTicks: 2` on the performance detectors, `durationInMs: 15_000` on the supply detectors. This is also why `JitterBufferStressDetector`, `DecoderPerformanceDetector` and `StuckDecoderDetector` keep tick counts.
-   **`capture-bottleneck` averages rather than thresholding each tick.** Add up the frames the source delivered and the time it had; when 15 s has accumulated, compare the average against `getSettings().frameRate` at `captureFpsRatioThreshold` (0.9). Two running totals, no history buffer. Averaging is what catches a camera degrading in *bursts* — 150 frames per 5 s tick becomes 132, back to 150, then 97, so most individual ticks look fine while the 15 s average reads 24.5 fps against a configured 30 — and it weights how far the source fell short, not merely how often. On the captured failure it raises at t=45 s, 30 seconds before the camera stopped; the previous consecutive-tick rule never reached its threshold at all, because the starving ticks were interleaved with healthy ones.
-   **New issue `decoder-bottleneck`**: frames arrived and the decoder did not turn enough of them into pictures. Deliberately narrow — the bar is the *arrival* rate, so a stream throttled to 5 fps that decodes cleanly is silent, and frames that never arrived remain the network's story.
-   **Capture and encoder are chained and mutually exclusive.** If the capture device is short, that is the whole answer and the encoder is not judged: an encoder handed too few frames has nothing to answer for. `EncoderPerformanceDetector` reads `isIssueActive('capture-bottleneck-track-<id>')` rather than sharing a private field, so the dependency is inspectable — a quiet encoder is explained by an issue anyone can see. At most one of the two is ever active.
-   **No baseline, no judgement.** Nothing is substituted for a missing `getSettings().frameRate`: without a stated rate there is nothing to fall short *of*. The rate is always the frame counter differenced against *measured* elapsed time, never `mediaSource.framesPerSecond` — the browser's own figure is coarse and smooths this exact stutter away, reporting `30` across an interval that delivered 132 frames in five seconds. `MediaSourceMonitor.sourceFps` is `undefined`, not `0`, on a counter reset, so `replaceTrack` no longer presents a healthy new camera as a dead one.
-   **Four situations are no longer judged**, because a low frame rate in them is legitimate: screen shares (content-driven — declare a moving surface with `setOutboundTrackContext(id, { contentType: 'camera' })`), backgrounded tabs, paused or non-live senders, and collection gaps/settings changes/counter resets, which discard the window rather than interpret it. The gap threshold is **derived from `collectingPeriodInMs`** (`maxTickGapInMs`), not configured — a fixed millisecond value means something different at every period.
-   **`cpuLimitationShareThreshold` defaults to `null`** on the encoder detector: the browser's CPU-limitation share is ignored unless configured. `CpuPerformanceDetector` already reports it, and the useful thing to do with the two is *correlate* them — which only works while `encoder-bottleneck` is derived without reading the same signal. Set `0.3` for the old behaviour.

**Threshold caveat.** `0.9` over 15 s comes from two captured sessions — one failure, one control, one user, one camera model. They catch that failure and stay silent on that control, and are otherwise unvalidated. Treat `capture-bottleneck` as observation-grade until a corpus sets the numbers; low light is the case most likely to trip them, since many webcams settle at 15 fps in a dim room while `getSettings().frameRate` still reports 30.

### Pause and visibility: absence is not evidence

-   **`ClientMonitor.activeTab`** and the tab-visibility watcher (`watchTabVisibility`, on by default). Defaults to `true` and stays `true` when the watcher is disabled or no `document` exists, so `false` always means the tab really is hidden. Each transition is a `TAB_VISIBILITY_CHANGED` client event. Browsers throttle background tabs, so the detectors whose signals that corrupts stand down: `CpuPerformanceDetector`, `DecoderPerformanceDetector`, `StuckDecoderDetector`, `PlayoutDiscrepancyDetector` and `FreezedVideoTrackDetector`.
-   **Paused producers and consumers no longer look like failures.** `MediasoupTransportBinding` mirrors pause state onto the track monitors, keeping the two kinds of silence distinct: a producer's pause lands on `OutboundTrackMonitor.paused` (the sender stopped for everyone), a consumer's on `InboundTrackMonitor.paused` (this leg opted out; the producer may still feed everyone else). `remoteOutboundTrackPaused` keeps its meaning and stays application-set. Both are synced on the observer events *and* re-synced every tick, because track monitors are created lazily from stats — an event-only sync would lose a pause that happened before the monitor existed.
-   **Ten detectors stand down on a paused track**: both dry-track detectors, `StuckDecoderDetector`, `AudioConcealmentDetector`, `JitterBufferStressDetector`, plus `CaptureFailureDetector` (silence check only), `FreezedVideoTrackDetector`, `AudioDesyncDetector`, `PlayoutDiscrepancyDetector` and `SimulcastLayerDetector`.
-   **Monotonic counters are swallowed, not merely skipped.** Freeze counts and NetEQ correction counters keep climbing through a pause, so skipping the paused ticks would deliver the whole pause as one delta on the first tick back — a false alarm exactly when the media was restored. Observed in a captured session: a resuming consumer showed 2.7 M concealed samples in one interval and was healthy on the next tick.
-   **Pause stands down the silence check only, on capture.** `capture-track-ended` and `capture-track-muted` still fire while paused: a camera unplugged or seized by another application is a fact about the *device*, true whether or not anyone was receiving it, and an application resuming onto a device that has since disappeared needs to know.
-   **Known gap:** `SynthesizedSamplesDetector` reads `MediaPlayoutMonitor`, which has no link to a track monitor, so it cannot see a pause. Chrome's media-playout stats are per output device rather than per track, so the association is not merely missing but ambiguous. Left as a documented gap rather than guessed at.

### New detectors

-   **`BlockedTransportDetector`** raises `blocked-transport` on the firewall signature every other detector structurally misses: STUN keeps answering — the pair is `succeeded`, consent passes, `iceConnectionState` is `connected` — yet media does not traverse. STUN consent responses count into the pair's `bytesReceived`, so it never looks dry. Requires three sustained pieces of evidence over `thresholdInMs` (5 s): STUN demonstrably alive, the application demonstrably producing, and the media demonstrably not traversing. The payload's `evidence` separates `media-not-leaving-transport` (host firewall, blocked socket, dead route) from `no-return-traffic` (DPI / UDP-throttling middlebox). Sending side only, where the client holds both halves of the proof.
-   **`NoAvailableIceCandidateDetector`** raises `no-available-ice-candidate` when the client cannot even begin: ICE gathering produced **zero local candidates** while the connection falls to `disconnected`/`failed` (immediately) or sits past `thresholdInMs` (6 s). Every other ICE issue describes a path that existed and stopped working; this one says no path was ever possible — no interface, airplane mode, a VPN that tore down every route. Never fires on a connection that once reached `connected`.
-   **`MediaPipelineDetector`** raises `media-pipeline-stalled`, the stage classifier: every pipeline stage has a monotonic counter proving progress, and a disruption is the first boundary where the upstream counter advances and the downstream one does not. `stage: 'rtp-sender'` — frames encode while no packet leaves. `stage: 'transport-demux'` — the ICE transport receives well above what RTCP and STUN can explain while every inbound RTP stays flat. `suspectedIssueTypes` links the specialist issues active at raise time, so one entry both localises the first broken stage and points at the evidence; registered last among the peer-connection detectors for that reason.
-   Supporting: `PeerConnectionMonitor.iceGatheringState`, `IceCandidateMonitor.direction`, `PeerConnectionMonitor.localIceCandidates`.

### Detector correctness pass

A sweep of all 28 detectors for machinery that buys nothing and for fabricated baselines. Seven of these change a verdict; each is a case that was silently wrong.

-   **`?? 0` on a deciding input is a fabricated baseline, and three of them were suppressing real detections.** `DecoderPerformanceDetector` treated a missing `deltaFractionLost` as *a perfectly quiet network* and handed the decoder the blame for exactly the misattribution the check exists to prevent. `AudioConcealmentDetector` treated a missing `deltaSilentConcealedSamples` as zero, counting every silent moment as audible damage and defeating the one subtraction the detector is built around. `StuckDecoderDetector` treated a missing `bitrate` as a dead pipe, tearing down the accumulating stretch every tick — on any adapter that omits the field the detector could never fire at all. All three now hold their judgement instead.
-   **`StuckDecoderDetector` could never fire without `pliCount` either**, for the same reason; and its `minStuckTicks` config is **removed** — the time threshold already guarantees at least two ticks, so at the shipped default it could not change any verdict, and above it it was a second persistence bar in a different unit.
-   **`PlayoutDiscrepancyDetector` silently skipped its own maximal case.** A truthiness guard on `deltaFramesRendered` meant "everything arrived and nothing reached the screen" was never judged. `ewmaFps` also vetoed detection despite appearing only in the payload; it is now optional there and gates nothing.
-   **`EncoderPerformanceDetector` left `encoder-bottleneck` open forever** when the highest simulcast layer deactivated — a bare return where every other exit stands down.
-   **`CongestionDetector`'s `low` sensitivity required an RTT reading it never uses**, so a bandwidth-limited connection losing >5% was silently not congested before the first RTCP receiver report.
-   **`SynthesizedSamplesDetector` never emitted its client event.** A truthy `createEvent` test against a default that left the field unset made `EXCESSIVE_SYNTHESIZED_AUDIO` unreachable in every default build. It now spells the check `=== false` like every sibling, and the default sets `createEvent: true`.
-   **`AudioDesyncDetector` was comparing cumulative counters against zero.** Its `_prevCorrectedSamples` was initialised to `0` and never updated, so what it called a per-tick delta was the whole session's correction total — a fraction that could only climb. It now reads the deltas `InboundRtpMonitor` already computes, which also removes the duplicate subtraction.

Same-verdict simplifications: payload-only running totals and their sliding-window bookkeeping removed from `FreezedVideoTrackDetector` (`firRate`, `keyFrameRate`) and `AudioConcealmentDetector` (`concealmentEventRate`, `burstiness`); `MAX_WINDOW_ENTRIES` caps that were unreachable at any sane collecting period; `_xxxOn` booleans paired with `_xxxStartedAt` timestamps collapsed to the timestamp alone in five detectors; a duplicated ended-payload, a re-tested condition, and two spellings of one assignment.

### CPU performance detector: frame-arrival burst guard

-   **Bursty frame arrival no longer reads as CPU limitation.** A simulcast layer switch, keyframe recovery or post-stall queue flush delivers a pile of frames inside one collect interval; the decoder trails that spike for exactly that interval and the decoded/received ratio dips while the machine is idle — observed as repeated one-tick dips on an idle machine, each coinciding with a `VIDEO_RESOLUTION_CHANGED` and recovering to ~1.0 next tick. The detector now keeps a smoothed (EWMA, α = 0.3) arrival baseline per inbound video ssrc and skips the ratio judgement on any interval exceeding `frameArrivalBurstFactor` × baseline (default 2.5), and on a track's first interval. Sustained starvation still alerts, because its low ratio persists across ordinary-arrival intervals. Set the factor to `undefined` for the old behaviour.

### Replay harness CLI

-   **`npm run replay -- <stats.jsonl>`** runs a captured session through a real `ClientMonitor` on a virtual clock and prints every detector fire as NDJSON on stdout — one record per fire with the issue's own timestamp plus the `tick`/`tickTimestamp` locating it in the input, then a summary with per-type counts. Warnings go to stderr, so output pipes into `jq` or a corpus runner sweeping thresholds. `--only`, `--config`, `--pretty`, `--updates`, `--real-time`, `--no-summary`; reads stdin with `-`. Note a per-detector config block **replaces** the shipped one wholesale, so a sweep must pass the whole block. No new dependency: `scripts/replay.mjs` compiles to CommonJS under `.replay/`. `tests/fixtures/degrading-camera.jsonl` replays the interleaved-degradation shape through the real stats path.

### Per-detector issue sampling

-   Every issue-raising detector exposes **`includeIssueInSample = true`** next to `disabled`. Set `false` and the detector keeps working locally — events fire, `activeIssues` and the issue lifecycle are maintained — but neither the raise nor the resolution is buffered into the `ClientSample`. `raiseIssue`/`addIssue` accept `includeInSample` directly. Useful for shrinking the sample when an issue is derivable server-side; the per-issue derivability table is in `docs/DETECTOR_SAMPLE_WORTHINESS.md`.

### Other

-   Data channels carry their mediasoup identity: the binding stamps `dataProducerId`/`dataConsumerId` onto the matching `DataChannelMonitor.attachments`, joining `sctpStreamParameters.streamId` against `RTCDataChannelStats.dataChannelIdentifier`, retried each tick until the lazily-created monitor appears.
-   Fixed: the `ICE_CANDIDATE` event payload was built by spreading an `RTCIceCandidate`, whose properties are prototype getters — the spread copied nothing.
-   New monitor events `'blocked-transport'`, `'no-available-ice-candidate'`, `'media-pipeline-stalled'`; new config blocks of the same names (`null` disables, omitted applies defaults).
-   New score reason keys servers may encounter: `high-jitter`, `bandwidth-limitation`, `frozen-video`, `pixelated-video`, `audio-concealment`, `audio-time-stretch`, `high-jitter-buffer-delay`, `downscaled-screenshare`. **`pixelated-video` ranges 0–3.0**, unlike every other normalized reason.
-   New doc `docs/SCORE_CALCULATIONS.md` — every reason key, threshold, ramp and formula, with what each key means for the user experience. The README's scoring section is now the overview.

## 4.6.0

### Browser stats normalization

-   **One normalizing stats adapter per browser family**, applied automatically from user-agent detection, shaping each engine's `getStats()` output as close to the W3C webrtc-stats spec as possible before monitors consume it. Adapters do three things and no more: **fold** a value into the standard field it provably belongs to (a renamed member, a legacy report carrying the same measurement), **infer references** — the `*Id` fields wiring one report to another, which a browser may omit but the report graph determines — and **map** legacy enum spellings onto the values the monitors accept. Measured values are never invented: an approximated number is indistinguishable downstream from one the browser reported, so a field a browser omits stays omitted, and an ambiguous reference is left unset rather than guessed. Nothing is discarded either, except a value that survives elsewhere: members the spec dropped but a browser still fills (`candidate-pair.priority`, Chromium's `contentType`, Firefox's `selected`) are left on the stat, since the monitors carry through whatever they receive. Every fix feature-detects from the report itself (no version parsing), so an adapter over an already-conformant report is a no-op. All deviations were verified against engine sources (Blink/libwebrtc, WebKit release branches, Firefox release tags) and MDN compat data.
    -   `ChromeStatsAdapter` (Chrome/Edge/Opera): folds the legacy `mediaType` alias into `kind`, the legacy `ip` into `address` on ICE candidates, and the deprecated `track`/`stream` reports (≤ M111) into `inbound-rtp`. Reference inference runs too, as a safety net for older versions and relayed stats.
    -   `SafariStatsAdapter`: folds deprecated `track` reports (≤ 16.x) into `inbound-rtp` — critically recovering `trackIdentifier`, absent before Safari 16.4, without which the monitor cannot bind a stream to its `MediaStreamTrack` — and `datachannelid` into `dataChannelIdentifier` (≤ 17.6); maps legacy `candidate-pair.state` spellings (`inprogress` → `in-progress`, `cancelled` → `failed`); infers `codec.transportId`, spec-required but unfilled through 17.3, and `inbound-rtp.remoteId`, which WebKit dropped in 16.4 through 16.6.
    -   `FirefoxStatsAdapter` (replaces both `Firefox94StatsAdapter` and `FirefoxTransportStatsAdapter`, which are merged into it — Firefox now needs exactly one adapter, with no registration-order constraint between two): folds `mediaType` into `kind` and the non-standard `discardedPackets` alias into `packetsDiscarded`; maps `candidate-pair.state: 'cancelled'` → `'failed'`; reconstructs the `transport` report Firefox ships none of before 153 from the selected candidate pair, as before. **Infers `outbound-rtp.mediaSourceId`** — never emitted by Firefox, and the reference through which a sent stream reaches its source and its `MediaStreamTrack`, so outbound track monitoring works on Firefox again; resolved by kind when a single source of that kind exists (simulcast encodings all resolve to it), left unset when several sources make it ambiguous. Also infers `transportId` on RTP, codec and ICE reports, absent before Firefox 153, resolved against the transport report native or reconstructed. Brace-wrapped `{uuid}` track identifiers are intentionally preserved, since they match Firefox's `MediaStreamTrack.id` format exactly.
    -   Across all three: the `remoteId`/`localId` cross-references between the local and remote view of a stream are resolved by SSRC (the synchronization source *is* the stream's identity), and `codecId` by codec kind, transport and — where a browser tags codec entries with a direction — `encode`/`decode`.

### Fixed

-   **A native Firefox `transport` report listed after the selected candidate pair was ignored**, and a second, reconstructed transport was appended next to it. The scan for an existing transport stopped at the first selected pair, and `getStats()` does not guarantee report order, so on Firefox 153+ this could produce two transports for one connection — which in turn made the transport reference ambiguous. The whole report is now scanned before deciding.
-   **Re-adapting one tick double-counted the reconstructed transport's totals.** Folds and reference inference are idempotent, counter accumulation is not; it is now keyed on the collection timestamp, so adapting the same tick twice is a no-op instead of inflating transport bytes and packets.
    -   Documented, and deliberately left uncorrected: `inbound-rtp.framesRendered` (no engine emits it), `remote-inbound-rtp.packetsReceived` (Chromium/WebKit), Firefox's `qualityLimitation*` family and audio `media-source` levels, Safari's `media-playout` reports and nulled host-candidate `address`, and Chromium's `requestsSent` accounting (later checks land in `consentRequestsSent`).
    -   The adapters (and the `StatsAdapter` interface + `StatsAdapters` registry) are now exported, so applications can reuse or extend them.

### Issue lifecycle in samples

-   **The issue lifecycle now reaches the server** (`sendResolvedIssuesToServer`, default `true`): the sample schema's `ClientIssue` gained an optional `key` field, and with the flag on both entries of a stateful issue carry it — the raise entry as before plus a companion `<issueType>-resolved` entry whose payload holds `raisedAt` (equal to the raise entry's timestamp, a secondary join), the resolve `comment`, and — flattened in — only a payload **explicitly passed** to the resolution (the built-in detectors pass their final payload, so `durationInMs` appears; the raise-time payload is not repeated, since the server already has it from the raise entry). The purpose is server-side, on-the-fly tracking of each client's currently active issues — open on the raise entry, close on the matching key — enabling cross-client correlation and immediate actions without waiting for post-hoc analysis. Issues still active at `close()` are auto-resolved into the final sample. With the flag off, the wire format is identical to previous releases (raise entries only, no `key`); the realtime `'issue-resolved'` event is unaffected either way. Servers switching on issue `type` should ignore or handle the `-resolved` suffix.

## 4.5.0

### Major Features

-   **Audio quality as the user hears it**: two new detectors replace packet loss as the primary audio signal, because Opus + NetEQ conceal a great deal of loss inaudibly and audio also degrades *without* dramatic loss when the jitter buffer misbehaves.
    -   `AudioConcealmentDetector` raises `audio-concealment` from the **audible** concealment share — `silentConcealedSamples` is subtracted, because `concealedSamples` rises during ordinary silence and a detector on the raw counter would flag every quiet moment in every call. It accumulates over a sliding window (concealment is bursty), suppresses while the remote track is paused, and classifies the episode as `'bursty'` (many short clicks) or `'continuous'` (fewer, longer dropouts).
    -   `JitterBufferStressDetector` raises `audio-jitter-buffer-stress` only when the target delay is grown **and** NetEQ is time-stretching. A high target delay alone means NetEQ is succeeding — buying latency to hide jitter, with the user hearing nothing. Requiring both is what separates cause from symptom.
-   **Receive-side attribution**: `DecoderPerformanceDetector` raises `video-decoder-overloaded` only when the frames demonstrably arrived — enough frames received, loss below `quietLossThreshold`, and decode time past a budget derived from the stream's *own* frame rate. Frames dropped because they never arrived and frames dropped because the client could not decode them look identical in a frame-rate chart and have opposite fixes; this is the detector that tells them apart. The payload carries `decoderImplementation` and `powerEfficientDecoder`.
-   **Video repair loop, merged into `FreezedVideoTrackDetector`**: the freeze detector now owns the whole freeze/repair domain and raises two new issues, gated by the new `videoRecoveryDetector` config — `keyframe-storm` (a sustained PLI rate — self-reinforcing, since keyframes are large and worsen the congestion that provoked them) and `video-recovery-failed` (PLIs going out, picture still frozen, `keyFramesDecoded` not advancing; the repair request left the client and nothing came back, which points at SFU forwarding rather than the first-hop network). One detector on purpose: the repair verdicts are judgements *about* the freeze state, and a separate detector would have to consume the freeze detector's side effect — and silently die when it is disabled. Freeze semantics also improved: `isFreezed` now means *currently frozen* — a freeze persists until frames are rendered again — where previously it meant "a freeze started this interval" and dropped after one tick, which made a persistent freeze look one tick long (and would have made `video-recovery-failed` nearly impossible to trigger). The `freezed-video-track` issue's `durationInMs` is now the real episode length.
-   **Stuck decoder**: `StuckDecoderDetector` raises `stuck-decoder` on the per-consumer decode wedge — RTP bytes keep arriving while `framesDecoded` stays flat and PLIs fire. The wait is adaptive: a wedge never self-heals, so it only needs to outlast a legitimate PLI → keyframe recovery — `max(thresholdInMs (4 s), rttMultiplier (15) × RTT)`, at least `minStuckTicks` (2) collections, with a `minBitrate` rate floor (10 kbps) confirming delivery regardless of the collecting period. The "bytes still flowing" requirement is the discriminator: a dry track is starvation, not a wedge, and belongs to `DryInboundTrackDetector`. The payload carries a `variant` (`assembly` — no frame ever reassembled from packets — vs `decode` — frames assemble but never decode), the accumulated dead bytes, PLI count since the wedge began, the frozen resolution and the decoder implementation. The `stuck-decoder` monitor event is the hook for the known mitigation: recreating the consumer. Reads only RTP deltas, so it is independent of browser freeze statistics.
-   **Send-side attribution**: `SourceEncoderBottleneckDetector` splits "we are sending fewer frames than we should" into `capture-bottleneck` (the source never produced them — camera, OS, permissions) and `encoder-bottleneck` (the source did; the encoder could not keep up). The discriminator is `MediaSourceMonitor.sourceFps` against what the highest active layer actually encoded; from RTP alone the two are indistinguishable.
-   **Capture failures**: `CaptureFailureDetector` raises `capture-track-ended` and `silent-audio-source`, and emits `'capture-track-muted'` when the OS or another application takes the device. The silence threshold defaults to 30 s and is long on purpose — a microphone capturing digital silence and a person not talking are the same measurement, and only duration separates them. The level is read from the new `MediaSourceMonitor.rmsAudioLevel` (integrated over the interval) rather than the instantaneous `audioLevel`, which reads zero between words.
-   **Observations, not faults**: four detectors that emit events and never raise issues — `CodecChangeDetector` (`CODEC_CHANGED`; compares `sdpFmtpLine` too, so an H264 profile switch is caught), `VideoResolutionChangeDetector` (`VIDEO_RESOLUTION_CHANGED`, classified `upgrade`/`downgrade`/`reshape`, carrying `qualityLimitationReason` on outbound tracks — the field that separates encoder adaptation from an application changing its constraints), `SimulcastLayerDetector` (`SIMULCAST_LAYER_CHANGED`; a layer counts as active only if it actually sent bytes, since `active: true` with no bytes is the usual shape of a layer the encoder quietly gave up on) and `StatsGapDetector` (`STATS_COLLECTION_GAP`, for backgrounded tabs and sleeping devices — the gap is reported rather than corrected, because the counters cannot say when within it the traffic happened).
-   **Derived fields across the RTP and media monitors** — no schema changes, no new collection; these read fields the monitors already carried.
    -   `InboundRtpMonitor`: `concealmentRate`, `concealmentEventRate`, `timeStretchRate`, `avgJitterBufferDelayInMs`, `jitterBufferTargetDelayInMs`, `discardRate`, `decodeTimePerFrameInMs`, `dropRatio`, `renderRatio`, `keyFrameRate`, `pliRate`, `firRate`, `nackRate`, `retransmissionRatio`, plus the underlying deltas.
    -   `OutboundRtpMonitor`: `encodeTimePerFrameInMs`, `retransmissionRatio`, `retransmittedPacketRatio`, `avgQpPerFrame`, `avgPacketSendDelayInMs`, `keyFrameRate`, `nackRate`, `pliRate`, `firRate`, and `qualityLimitationDurationShares` — what the encoder spent *this interval* doing, in `0..1`, as opposed to the monotonic accumulators which describe the whole call and cannot be compared to a threshold.
    -   `RemoteInboundRtpMonitor`: `avgRoundTripTimeInSec`, averaged from `totalRoundTripTime` / `roundTripTimeMeasurements` rather than the noisy single `roundTripTime`.
    -   `IceCandidatePairMonitor`: `avgRoundTripTimeInSec`, averaged from `totalRoundTripTime` / `responsesReceived` over the interval. `PeerConnectionMonitor.iceRttInSec` now prefers it over `currentRoundTripTime`, which is only the *latest* STUN check — consent checks run every ~5s, so at a 2s collecting period the instantaneous value is stale more often than not.
    -   `MediaSourceMonitor`: `deltaFrames`, `sourceFps`, `rmsAudioLevel`, and `getOutboundRtps()`.
    -   `MediaPlayoutMonitor`: `playoutDelayPerSampleInMs` and `synthesizedSamplesRatio`.

### Bug Fixes

-   **`avgRttInSec` blended two unrelated round trips**: `PeerConnectionMonitor` accumulated one sum from `remoteOutboundRtp.roundTripTime` (an **RTCP** round trip, end to end over the media path) and `selectedCandidatePair.currentRoundTripTime` (an **ICE/STUN** round trip, terminating at whatever ends ICE — in an SFU topology, the SFU), then divided by the combined count. The mixing ratio changed as streams came and went, so the value could move sharply for reasons unrelated to the network, and `CongestionDetector` at medium sensitivity treated that movement as corroboration of congestion. The two are now tracked separately as `rtcpRttInSec` / `iceRttInSec` (each with its own EWMA); `avgRttInSec` and `ewmaRttInSec` became getters preferring the RTCP value and falling back to ICE, so both read from the same source within a tick and their difference can never mix two round trips. RTCP RTT is additionally collected from `remote-inbound-rtp`, which was previously ignored.
-   **RTP monitor deltas were not counter-reset safe**: `InboundRtpMonitor`, `OutboundRtpMonitor`, `RemoteInboundRtpMonitor`, `MediaSourceMonitor` and `MediaPlayoutMonitor` subtracted cumulative counters unguarded, so SSRC reuse, an ICE restart or a stats-object replacement produced negative deltas that propagated into every rate and ratio derived from them. `bitrate` happened to be clamped with `Math.max(0, …)`, which hid the problem for bitrate only. Every cumulative delta now yields `0` when the counter goes backwards. On `RemoteInboundRtpMonitor` this is not merely defensive: `packetsLost` legitimately decreases when a late packet arrives.
-   **`jitterBufferTargetDelayInMs` mixed a stale numerator with a fresh denominator**: it divided the *previous* `jitterBufferTargetDelay` by the *current* `jitterBufferEmittedCount`. It is now a delta over a delta, consistent with `avgJitterBufferDelayInMs`.
-   **`ResolutionChangeDetector.ts` was dead code** (47 bytes, `export const empty = "empty";`, referenced nowhere). Removed; resolution handling now lives in `VideoResolutionChangeDetector` as an event, which is what it should have been — a resolution change is an observation, not a fault.
-   **`deltaCoruption` typo** in `InboundRtpMonitor` (local variable only; the public `deltaCorruptionProbability` was always spelled correctly).

### Other Changes

-   `CpuPerformanceDetector` gained two send-side corroborators: `encoderCpuLimitationShareThreshold` (share of the interval spent explicitly CPU-limited, from `qualityLimitationDurations`) and `encodeTimeBudgetRatio` (encode cost per frame against a budget derived from the stream's frame rate). The instantaneous `qualityLimitationReason` it already used is a single flickering label; both new checks are sustained by construction, so they catch pressure the label misses without adding flapping.
-   New `ClientEventTypes` members with payload types: `CODEC_CHANGED`, `VIDEO_RESOLUTION_CHANGED`, `SIMULCAST_LAYER_CHANGED`, `CAPTURE_TRACK_ENDED`, `CAPTURE_TRACK_MUTED`, `STATS_COLLECTION_GAP`. Mirror them in the server-side schema if you switch on event types there.
-   New monitor events: `'audio-concealment'`, `'audio-jitter-buffer-stress'`, `'video-decoder-overloaded'`, `'keyframe-storm'`, `'video-recovery-failed'`, `'capture-bottleneck'`, `'encoder-bottleneck'`, `'capture-track-ended'`, `'capture-track-muted'`, `'silent-audio-source'`, `'simulcast-layer-changed'`, `'codec-changed'`, `'video-resolution-changed'`, `'stats-collection-gap'`.
-   New config blocks, all following the existing convention (`null` disables construction entirely, omitted applies defaults): `audioConcealmentDetector`, `jitterBufferStressDetector`, `decoderPerformanceDetector`, `videoRecoveryDetector`, `sourceEncoderBottleneckDetector`, `captureFailureDetector`, `codecChangeDetector`, `videoResolutionChangeDetector`, `simulcastLayerDetector`, `statsGapDetector`.
-   The nine new issue types are members of the `ClientMonitorIssue` / `ClientMonitorResolvedIssue` discriminated unions and are recognised by `isClientMonitorIssue`.
-   `OutboundTrackMonitor.getMediaSource()` is now public, so the capture source can be compared against the encoders that consume it.

### Default calibration

Detector defaults are calibrated for realistic deployments, where stats collection commonly runs at ~5 s rather than the library's 2 s default, and validated against production telemetry and industry practice:

-   `audioConcealmentDetector` thresholds match Webex's voice-quality monitoring (a >3% concealment-ratio change is significant; a "severely concealed second" is >5%), and its window grew to 15 s so it spans several collections at a 5 s collecting period instead of degenerating to a single sample.
-   `videoRecoveryDetector.pliRateAlertOn` dropped from 1.0 to **0.5 PLI/s** (window 30 s): a real production keyframe storm ran at ~0.65 PLI/s sustained, which the old threshold would have missed, while healthy streams stay well under 0.1/s outside of joins.
-   `stuckDecoderDetector.minStuckTicks` dropped to 2 — at a 5 s collecting period, 3 observations meant 15 s of frozen video before the verdict, and two observations of bytes-flowing + PLIs-firing + nothing-decoding are already corroborated evidence.
-   `statsGapDetector.minGapInMs` rose to 5 s so a single missed short tick reads as scheduling jitter, not a gap.
-   `audioDesyncDetector` defaults now match their own documentation (`0.1` on / `0.05` off) — the code had shipped `0.5`/`0.25`, requiring **half of all samples** to be corrected before alerting, which effectively never fired.
-   The jitter-buffer stress threshold (200 ms target delay) is consistent with the widely used guidance that >200 ms of added delay causes noticeable degradation.

### Performance

Everything the detectors do is dwarfed by `getStats()` itself (milliseconds per tick vs. ~1.4µs for the heaviest `accept()`), but per-tick allocations add up over a long call, so the hot paths were tightened:

-   The counter-reset `delta` helper is one shared module function (`positiveDelta`) instead of a closure allocated inside every monitor's `accept()` on every tick.
-   The sliding windows in `AudioConcealmentDetector` and `FreezedVideoTrackDetector` keep **running sums** — a tick costs O(evicted) instead of O(window length) — and carry a hard 128-entry cap, so a pathologically fast update rate degrades to a bounded cost instead of unbounded growth.
-   `SimulcastLayerDetector` computes only the cheap comparison key on the steady-state tick; the full per-layer snapshot is materialized exclusively when the layer set actually changed.
-   `OutboundTrackMonitor.getHighestLayer()` iterates the layer map directly instead of materializing an array — several detectors call it every tick.
-   `CpuPerformanceDetector` reads the allocating `outboundRtps` / `inboundRtps` getters once per tick (they flat-map fresh arrays per access), folds the encoder-pressure corroborators into the same loop, and skips the inbound pass entirely once a send-side check has concluded.
-   `VideoResolutionChangeDetector` reuses the already-resolved highest layer instead of walking the layer map a second time for `qualityLimitationReason`.

Measured on the bundled output (Node 22): `InboundRtpMonitor.accept()` ≈ 1.4µs, `OutboundRtpMonitor.accept()` ≈ 0.9µs, windowed detectors ≈ 0.2µs per steady-state tick.

### ICE connectivity & recovery

Also part of this release:

-   **ICE Connectivity Detection**: A new `IceConnectivityDetector` covers runtime ICE and transport health, per ICE transport (a peer connection without BUNDLE has several, and they fail independently). Peer-connection setup latency stays with `LongPcConnectionEstablishmentDetector`.
    -   `ice-disconnected`: raised only once `disconnected` has persisted past `disconnectedThresholdInMs`, so the transient blips ICE routinely heals on its own never produce an issue. Recovery resolves it with the episode duration.
    -   `ice-connection-failed`: raised immediately on `failed`, which is terminal for that ICE generation.
    -   `ice-transport-stalled`: deliberately narrow — raised only while this endpoint is still *sending* on a succeeded pair of a connected transport but receives nothing, and only after inbound traffic had previously been observed. "No traffic in either direction" is not reported, because at peer-connection level it cannot be distinguished from a legitimately idle or paused connection.
    -   `unstable-ice-path`: raised when the selected path switches `pathSwitchThreshold` times within `pathSwitchWindowInMs`.
-   **ICE Restart Recommendation**: The detector reports *when* an ICE restart is warranted and leaves performing it to the application — only the application knows whether renegotiation is safe, whether signalling is up, or whether it would rather rejoin. Listen for `'ice-restart-recommended'` (also buffered as the `ICE_RESTART_RECOMMENDED` client event). It fires immediately on `failed`, and after `iceRestartRecommendationThresholdInMs` for a persistent `disconnected`, an inbound stall, or a peer connection that never finished establishing (`never-established`, tracked from `connectionState` so it covers a stuck DTLS handshake and attempts that never produce a reportable transport); it stays quiet while a restart the application already started is in flight, spaces repeats by `iceRestartRecommendationCooldownInMs`, and carries `recommendationCount` and `iceGeneration` so applications can back off after repeated failed attempts.
-   **ICE Restart Inference**: A changed ICE local username fragment (falling back to the selected local candidate's) is reported as `'ice-restart'` with an `outcome` of `'detected'`, `'recovered'` or `'failed'`, and increments a per-transport ICE generation counter. A `connected → checking` transition alone is never treated as a restart. High-confidence detection still needs the application to instrument `restartIce()`; Firefox exposes no username fragment on the synthesized transport report, so inference degrades there.
-   **`SelectedIcePath`**: The live selected path of an ICE transport, at `peerConnectionMonitor.selectedIcePath` (singular; with BUNDLE — always the case for mediasoup transports — there is exactly one) and `selectedIcePaths`. It stores no copies of candidate data: every descriptive getter reads through the linked candidate pair and its candidates, so it can never disagree with the stats. It emits `'ice-path-changed'` for direct↔relay, relay-protocol, TURN-server and tuple changes, and accumulates TURN usage facts — per-kind durations, `timeToFirstRelayInMs`, switch counters, and relay-vs-total traffic with `relayBytesRatio`. These are measurements, not verdicts; they are kept client-side rather than added to the sample, since the sample already carries everything a server needs to derive them.
-   **ICE path helpers on the monitors**: `IceCandidatePairMonitor` gained `usingTurn`, `usingTcp`, `relayProtocol`, `pathKind`, `turnUrl`, `turnServer`, `tuple` and `pathKey`; `IceCandidateMonitor` gained `isRelay`, `turnTransport`, `turnServer` and `addressFamily`. Every path signal is now read from one candidate of one pair.

### ICE connectivity — bug fixes

-   **`usingTURN` could be true when no pair used TURN**: `PeerConnectionMonitor` evaluated `relayProtocol` and the candidate `url` in two independent `.some()` calls, so one candidate carrying `relayProtocol` and a *different* one carrying a `turn:` url together produced a false positive. TURN is now decided per pair from the local candidate's `candidateType === 'relay'`. The `url` check was dropped entirely: srflx candidates discovered through a TURN server's STUN function also carry a `turn:` url, so it never indicated a relay path.
-   **Negative deltas after counter resets**: `IceCandidatePairMonitor` and `IceTransportMonitor` subtracted cumulative counters without guarding against a reset (stats-object replacement, ICE restart), so a delta — and the bitrate derived from it — could go negative.
-   **`deltaOutboundPacketsSent` was never reset**: every other per-tick delta is zeroed at the top of `PeerConnectionMonitor.accept()`; this one accumulated across ticks and inflated `totalOutboundPacketsSent` quadratically.
-   **Stats were adapted twice per tick**: `collect()` ran `statsAdapters.adapt()` and then called `accept()`, which adapted again. Stateful adapters such as `FirefoxTransportStatsAdapter` are not idempotent, so the second pass was a latent corruption hazard. Adaptation now happens exactly once; `accept()` still adapts raw stats for direct callers.
-   **`CongestionDetector` reported the wrong bitrate**: the `congestion` event payload carried `maxReceivingBitrate` taken from `_maxSendingBitrate`.
-   **`ClientMonitor.collect()` kept collecting after close**: the closed check only logged a warning. `avgRttInSec` also became `NaN` when no peer connection was registered.
-   **A slow establishment after a failed attempt was never reported**: `LongPcConnectionEstablishmentDetector` cleared its one-shot flag only when `connectionState` reached `connected`, so after one failed attempt every later slow establishment on that peer connection was silent — even though a retry failing is more interesting than the first attempt. It now rearms on any exit from `connecting`.
-   **Stale state survived an ICE restart**: a restart now closes the previous generation's issues and clears its bookkeeping. Previously a re-failure in the new generation looked like the already-reported one, so it was never reported and the transport stayed permanently mid-restart, silencing later findings.

### ICE connectivity — other changes

-   `PEER_CONNECTION_ICE_PATH_CHANGED`, `ICE_RESTART`, `ICE_RESTART_RECOMMENDED`, `LONG_PC_CONNECTION_ESTABLISHMENT` and `EXCESSIVE_SYNTHESIZED_AUDIO` are now members of the `ClientEventTypes` enum with payload types, instead of raw strings at the emission sites. Mirror them in the server-side schema if you switch on event types there.
-   `IceTupleChangeDetector` now reads the tuple from the candidate pair instead of rebuilding it, so it and the connectivity detectors always agree on the selected path. It remains the low-level primitive: it reports *that* the tuple set changed, `SelectedIcePath` classifies *what kind of* change it was, and only `IceConnectivityDetector` raises issues.
-   New `iceConnectivityDetector` config block (`null` disables it, as with every detector): `disconnectedThresholdInMs` (5000), `transportStallThresholdInMs` (5000), `pathSwitchWindowInMs` (30000), `pathSwitchThreshold` (3), `iceRestartRecommendationThresholdInMs` (10000), `iceRestartRecommendationCooldownInMs` (15000), `createEvent` (true).
-   New monitor events: `'ice-path-changed'`, `'ice-restart'`, `'ice-restart-recommended'`, `'new-selected-ice-path'`.

## 4.3.2

### Bug Fixes

-   **CPU Detector — false alerts on screen share**: `CpuPerformanceDetector` no longer infers inbound CPU limitation from frame-rate (FPS) volatility, which false-triggered on content such as screen share whose frame rate legitimately swings (e.g. 15 → 1 fps when the shared content goes static). Inbound limitation is now inferred from the ratio of decoded to received frames per stats interval: when the decoder cannot keep up, frames are received but not decoded, so the ratio drops; when fps drops legitimately, received and decoded frames drop together and the ratio stays near 1.0 (no alert). Evaluated on video tracks only, with the existing on/off hysteresis and a minimum received-frame guard. Outbound `qualityLimitationReason === 'cpu'` and stats-collection-duration signals are unchanged.
    -   Config: `cpuPerformanceDetector.fpsVolatilityThresholds` (`{ lowWatermark, highWatermark }`) is replaced by `cpuPerformanceDetector.incomingDecodedFramesRatioThresholds` (`{ alertOn, alertOff, minReceivedFrames }`), defaulting to `alertOn: 0.7`, `alertOff: 0.85`, `minReceivedFrames: 10`. Applications passing `fpsVolatilityThresholds` should update their config.

## 4.3.1

### Bug Fixes

-   Added `dataChannels` to peer connection sample serialization so tracked data channel stats are included in `ClientSample.peerConnections[].dataChannels`.

## 4.3.0

### Major Features

-   **Issue Lifecycle Rework**: The issue system has been rebuilt around a stateful raise/resolve lifecycle keyed by an explicit `key` string. One-shot logging stays available; stateful issues that can be cleared now have a first-class API.
    -   `raiseIssue(key, { type, payload?, timestamp? })`: Creates (or refreshes) a stateful issue. Re-raising with the same `key` updates the entry in place and emits `'issue-updated'` instead of `'issue'`.
    -   `resolveIssue(key, { comment?, payload?, resolvedAt? })`: Resolves a single stateful issue by its `key`. The optional `payload` overwrites the active issue's payload, so detectors enrich the resolved record with episode-level info such as `durationInMs`.
    -   `addIssue({ type, payload?, timestamp? })`: Kept for one-shot, non-stateful issues (e.g. `USER_MEDIA_ERROR`). Emits `'issue'` and buffers into the next sample but never enters the active store and cannot be resolved.
    -   `getActiveIssuesByType(type?)`: Snapshot of currently active stateful issues, optionally filtered by type.
    -   `isIssueActive(key)`: True when a stateful issue with the given key is currently active.
    -   `activeIssues` is now a public read-mostly `Map<string, RaisedClientIssue>` keyed by `key` (previously `Record<string, ClientIssue[]>`).
-   **Discriminated Union for Built-In Issues**: New `ClientMonitorIssue` and `ClientMonitorResolvedIssue` unions narrow `payload` from the `type` discriminator. `switch (issue.type)` inside an `'issue'` / `'issue-resolved'` listener gives full payload typing for every detector that ships with the library, plus `isClientMonitorIssue` / `isClientMonitorResolvedIssue` runtime type guards.
-   **Detector Runtime Toggle**: Every built-in detector now carries a `public disabled = false` field. Flip it at any time (`monitor.detectors` or via the parent peer-connection / track instance) to silence a detector without removing it. `Detectors.update()` skips `disabled === true` entries, and each detector's own `update()` short-circuits as well — so direct invocations behave consistently.
-   **`null` Config = "Don't Instantiate"**: Every detector field in `ClientMonitorConfig` is now typed as `Type | null`. Passing `null` for a detector skips its construction entirely (no instance, no `update()` overhead). Passing `undefined` (the omitted case) still applies the documented defaults; passing an object enables the detector with the provided overrides.
-   **Ergonomic `Detectors` Registry**: The `Detectors` registry attached at every level (`monitor.detectors`, `peerConnectionMonitor.detectors`, track-level `detectors`) now exposes a proper public API for inspection and runtime toggling: `size`, `has(name)`, `getByName<T>(name)`, `find(pred)`, `filter(pred)`, iteration (`for (const d of detectors)`), and the toggle helpers `disable(name)` / `enable(name)` / `disableAll()` / `enableAll()` / `isEnabled(name)`. The previous mutation API (`add` / `remove` / `clear` / `update` / `listOfNames`) is preserved.

### Breaking Changes

-   **Logger API Refactor**: Removed the global `setLogger` API in favor of instance-level logger injection via `ClientMonitor`.
-   **Removed**: `ClientMonitor.resolveActiveIssues(type, issueOrFilter, comment?)` is gone. Callers that resolved stateful issues should switch to `raiseIssue` + `resolveIssue(key, …)`.
-   **Changed**: `ClientMonitor.activeIssues` shape — was `Record<string, ClientIssue[]>` (mutable, sometimes containing stringified payloads), now a `Map<string, RaisedClientIssue>` keyed by issue `key`. Use `getActiveIssuesByType(type?)` / `isIssueActive(key)` instead of `Object.keys` / index access.
-   **Removed**: `createIssue?: boolean` from every detector's config block (`videoFreezesDetector`, `dryInboundTrackDetector`, `dryOutboundTrackDetector`, `audioDesyncDetector`, `congestionDetector`, `cpuPerformanceDetector`, `playoutDiscrepancyDetector`). Whether a detector raises an issue is now the detector's own decision; applications that do not want issues from a particular detector should pass `null` for that detector's config, or flip `detector.disabled = true` at runtime.
-   **Removed**: `disabled?: boolean` from every detector's config block. The flag now lives on the detector instance (`detector.disabled`). The new `Detector` interface includes an optional `disabled?: boolean` so custom detectors can opt in.
-   **Renamed event**: `'resolved-issue'` is now `'issue-resolved'` for consistency with `'issue-updated'`.
-   **Type rename / shape**: `ClientIssue` is now a discriminated union of `AddedClientIssue | RaisedClientIssue`. The wire format on `ClientSample.clientIssues` is unchanged (`{ type, payload?: string, timestamp }`), but in-memory issues carry richer fields. `ResolvedClientIssue` extends `RaisedClientIssue` (which carries `key`, `raisedAt`, `updatedAt`).

### Improvements

-   **Logger Propagation**: `ClientMonitor` now propagates the same logger instance to sources and monitors.
-   **Module-Prefixed Logs**: Internal logs now include module prefixes such as `[ClientMonitor]:` and `[Sources]:` for easier filtering.

### Bug Fixes

-   **`activeIssues` payload corruption**: Previously, `addIssue` stored a JSON-stringified payload in `activeIssues` while emitting the original object via `'issue'`. Every detector's resolve filter then tried to read `(issue.payload as Record).trackId` off a string and silently failed — issues never resolved, the active store grew unbounded. Fixed: in-memory issues keep the original payload object; stringification happens only at sample-serialization time.
-   **Resolution return value**: The old `resolveActiveIssues` returned the *remaining* issues, not the resolved ones, contradicting its name. The new `resolveIssue` returns the resolved issue (or `undefined` if no match).
-   **Reference-equality dead branch**: `resolveActiveIssues(type, issueObject)` could never match because the stored object was a copy of the input. The new API takes a `key` string, eliminating the foot-gun.
-   **`'issue'` event gated on sampling**: Issue events were silently dropped when sampling was disabled and `bufferingEventsForSamples` was false. Event emission is now unconditional; only the sample buffer is gated.
-   **Dry-track detectors spammed events**: `DryInboundTrackDetector` and `DryOutboundTrackDetector` fired their detector-specific event (and re-raised the issue) on every update tick while the dry condition persisted. They now emit exactly once per episode, mirroring the pattern in `AudioDesyncDetector` / `CongestionDetector`.
-   **Extension Stats Providers**: Fixed provider execution in `collect()` so configured extension stat providers are executed and appended to samples correctly.

### Helpers

-   **`AudioDesyncIssuePayload`, `CongestionIssuePayload`, `CpuPerformanceIssuePayload`, `DryInboundTrackIssuePayload`, `DryOutboundTrackIssuePayload`, `FreezedVideoTrackIssuePayload`, `PlayoutDiscrepancyIssuePayload`** are now exported from the package root, so applications can import the exact payload type for each detector.
-   **Resolved issues carry `durationInMs`** on the payload for episode-length detectors (`audio-desync`, `congestion`, `cpulimitation`, `dry-inbound-track`, `dry-outbound-track`, `freezed-video-track`, `inbound-video-playout-discrepancy`). The detector measures the time from `raise` → `resolve` and merges it into the resolved payload.
-   **Auto-resolve on `close()`**: `ClientMonitor.close()` now resolves every still-active issue with `comment: 'monitor closed before issue could be resolved'`, so consumers see a clean lifecycle even if the call drops mid-incident.

### Migration

| Before | After |
|---|---|
| `monitor.addIssue({ type: 'congestion', payload: { … } })` (for a resolvable issue) | `monitor.raiseIssue('congestion-pc-1', { type: 'congestion', payload: { … } })` |
| `monitor.addIssue({ type: 'USER_MEDIA_ERROR', payload: { … } })` (fire-and-forget) | Unchanged — `addIssue` still does the right thing for one-shot logs. |
| `monitor.resolveActiveIssues('congestion', issue => issue.payload.peerConnectionId === 'pc-1')` | `monitor.resolveIssue('congestion-pc-1')` |
| `monitor.activeIssues['congestion']?.[0]` | `monitor.getActiveIssuesByType('congestion')[0]` |
| `monitor.config.congestionDetector.disabled = true` | `peerConnectionMonitor.detectors`-located instance: `detector.disabled = true`; **or** at construction time: `new ClientMonitor({ congestionDetector: null })` to skip instantiation entirely. |
| `monitor.config.audioDesyncDetector.createIssue = false` | Removed. Pass `audioDesyncDetector: null` to skip, or flip `detector.disabled` at runtime. |
| `monitor.on('resolved-issue', …)` | `monitor.on('issue-resolved', …)` |

### Documentation

-   **README**: Rewrote the "Events and Issues" section to cover the new lifecycle, the `ClientMonitorIssue` discriminated union, the `disabled` runtime toggle, the `null`-disables-instantiation config semantics, and end-to-end examples for every built-in detector.
-   **README Logging Section**: Expanded logging documentation with basic, production-adapter, and no-op logger examples.
-   **Score Calculation Notes**: Documented outbound video scoring behavior for screen-share tracks (`contentHint: 'screen'`).

## 4.1.0

### Major Features

-   **Issue Resolution Management**: Introduced `resolveActiveIssues()` method to manage and resolve active issues in real-time
    -   Issues can now be resolved by filter function or by direct reference
    -   Method returns remaining active issues after resolution
    -   Emits `resolved-issue` events when issues are resolved
-   **Active Issues Tracking**: Added `activeIssues` property to ClientMonitor to track all currently active issues by type
-   **Extension Stats Providers**: Implemented extensible stats provider system for injecting custom application metrics
    -   Supports both synchronous and asynchronous providers
    -   Custom stats are automatically included in every sample
    -   Allows correlation of WebRTC metrics with application-specific data

### Improvements

-   **Issue vs Event Distinction**: Clear separation between Issues (resolvable problems) and Events (immutable notifications)
    -   Issues can be resolved when the problem goes away
    -   Events are permanent records of what happened
    -   Detectors now properly use `createIssue` or `createEvent` based on the type of notification
-   **Multiple Event Emissions**: Dry track detectors can now emit multiple events during a single dry period, providing more granular tracking
-   **Detector Configuration**: Clarified and corrected detector configuration comments to reflect actual implementation
    -   `syntheticSamplesDetector` and `longPcConnectionEstablishmentDetector` use `createEvent`
    -   All other detectors use `createIssue`

### Documentation

-   **Enhanced README**: Comprehensive documentation on issue management and resolution
    -   New "Managing Active Issues" section with practical examples
    -   Clear explanation of Events vs Issues distinction
    -   Extended "Extension Stats Providers" subsection in "Collecting and Adapting Stats"
-   **Configuration Comments**: Updated `ClientMonitorConfig.ts` with accurate descriptions of each detector's configuration options

### Bug Fixes

-   **Dry Inbound Track Detector**: Added missing `_evented` flag check to prevent duplicate event emissions
-   **Configuration Consistency**: Fixed property names in detector configurations (`createEvent` vs `createIssue`)

### Migration Notes

This is a minor version update with no breaking changes. Existing applications will continue to work as-is. New applications can take advantage of:

-   The `resolveActiveIssues()` method for dynamic issue management
-   Extension stats providers for custom application metrics
-   Improved issue resolution and tracking capabilities

## 4.0.0

### Breaking Changes

-   **Schema v3.0.0**: Upgraded to use schema version 3.0.0 for sampling with new data structures
-   **API Refactor**: Complete ClientMonitor API refactor with breaking changes
-   **Detector Architecture**: Rewritten detector and monitor system for better performance

### Major Features

-   **Enhanced Detectors**: Added comprehensive documentation and unit tests for all detectors
-   **Score System**: Improved scoring system with detailed score reasons for tracks and connections
-   **Event Handling**: Enhanced event system with better payload handling and new event listeners
-   **Stats Adapters**: Refactored stats adapter architecture for improved statistics collection
-   **Issue Creation**: Added configurable `createIssue` flag across all detectors

### Configuration & Build

-   **Build Process**: Updated to TypeScript compiler with ES module support and minification
-   **Package Config**: Enhanced package.json with better entry points and Node.js 14+ requirement
-   **Documentation**: Restructured documentation with comprehensive README and examples

### Migration Notes

This is a major version with breaking changes. Applications using v3.x will need to update API usage, detector configurations, and event handlers to work with the new architecture.

## 3.0.0

-   The ClientMonitor API is simplified and refactored.

## 2.3.0

-   refactored collectors and sampler
-   `clientMontior.os` is moved to `clientMonitor.meta.operationSystem`
-   `clientMontior.engine` is moved to `clientMonitor.meta.engine`
-   `clientMontior.browser` is moved to `clientMonitor.meta.browser`
-   `clientMontior.audioInputs` is moved to `clientMonitor.meta.audioInputs`
-   `clientMontior.audioOutputs` is moved to `clientMonitor.meta.audioOutputs`
-   `clientMontior.videoInputs` is moved to `clientMonitor.meta.videoInputs`
-   `clientMonitor.alerts` is removed, `clientMonitor.audioDesyncDetector`, `clientMonitor.cpuPerformanceDetector`, and `clientMonitor.congestionDetector`
-   all `updates` fields in storage entries are moved to the entries of the `storage`
-   `metrics` field is removed `elapsedSinceLastCollectInMs` and `elapsedSinceLastSampleInMs` is added to the `stats-collected`, and `sample-created` events
-   refactored mediasoup-collector
-   add events are collected automatically
-   simplified configuration, and detectors configurations are moved to create detectors

## 2.1.0

-   Remove dependency @observertc/samples-schema
-   Add Samples and W3cStats to the source under the `./src/schema` library

## 2.0.0

### Conceptual changes

-   The ClientMonitor is no longer responsible for WebSocket connections, signaling, and transports.
-   The ClientMonitor has become responsible for the following event emissions:
    -   PEER_CONNECTION_OPENED, PEER_CONNECTION_CLOSED
    -   MEDIA_TRACK_ADDED, MEDIA_TRACK_REMOVED
    -   ICE_CONNECTION_STATE_CHANGED
-   Specific collectors can add additional call events. For example, mediasoup adds PRODUCER_PAUSED, PRODUCER_RESUMED, CONSUMER_PAUSED, CONSUMER_RESUMED events.
-   ClientMonitor calculate derived metrics such as sending, and receiving bitrates, total sent and received packets.

### Major Code changes

-   Removed Sender component and corresponding configuration from ClientMonitor.
-   Removed Transport component, as sending and transporting no longer fall under the responsibility of the ClientMonitor.
-   Storage StatsEntries `id` is renamed to `statsId`.
-   PeerConnectionEntry `collectorId` is renamed to `id`, and `collectorLabel` to `label`.
-   Removed `setUserId`, `setCallId`, `setClientId`, `setRoomId`, and `marker` from ClientMonitor, as this information should be used for context creation on the server side, which falls under the responsibility of signaling.
-   Removed `events` field from ClientMonitor, as events have become part of the ClientMonitor itself, and ClientMonitor now provides `on`, `off`, `once` interfaces for events.

### Functionality changes

-   Stats are removed based on visited ids in getStats. If a stat is no longer present in the getStats extracted result, it is removed from the Storage.

### Configuration changes

-   Sampler configuration is reduced.
-   Sender configuration is removed.
-   `statsExpirationTimeInMs` is removed.
-   `createCallEvents` is added.

## 1.3.2

-   Change hash function to makeStamp and stop using sha256 as it turned out to be performance intensive

## 1.3.1

-   Change visibility of MediasoupStatsCollector `addTransport` method to be public
-   make imported schema version to be 2.2.0 instead of the last snapshot

## 1.3.0

-   Change the concept of add and removing stats collectors responsible from the clientMonitor to the Collectors
-   Make warn log instead of throwing exception In case a provided callId is invalid
-   Make callId to be set only once per session
-   Add mediasoup integration
-   Add setter for clientId, and roomId
-   Move addStatsCollector to a new objects called Collectors
-   Add MediasoupStatsCollector, PeerConnectionStatsCollector
-   bugfix timer
-   add event dispatched when client is connected to an observer
-   Add rawstats emitted for onStatsSamples event
-   Add last stats change timestamp to metrics
-   Add Mediasoup hack for trackIdentifier for firefox

## 1.2.0

-   Make timer tick based instead of calculated next delays
-   Be able to collect samples if sender is not available
-   add maxSamples config option to accumulator

## 1.1.0

-   Fix continous media source meta sending due to constantly changing `audioLevel`
-   add ice-candidate-pairs according to schema changes in 2.1.0^
-   align peer-connection-transport changes according to schema changes in 2.1.0^
-   make id navigational alterations in PeerConnectionImpl related to the webrtc schema changes
-   run prettier

## 1.0.1

-   Add validation for extension stats to check if the given payload is a valid json string or not.

## 1.0.0

Init
