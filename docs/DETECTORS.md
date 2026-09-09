# Detector reference

# Detectors

Detectors turn the collected stats into *verdicts*. Each one watches a specific failure mode and reports through up to three channels: **stateful issues** (raised when the condition starts, resolved when it clears — with the full lifecycle shipped to the server, see [Sample-channel behavior](./EVENTS_AND_ISSUES.md#sample-channel-behavior)), **monitor events** (realtime, for the application to act on), and **client events** (buffered into samples for server-side correlation).

Configuration follows one convention everywhere: omit a detector's config key to get defaults, pass `null` to not construct it at all, or flip the instance's `disabled` flag at runtime to silence it without removing it (see [Controlling which detectors run](./EVENTS_AND_ISSUES.md#controlling-which-detectors-run)).

> **This section gets you started and then hands off.** Every detector belongs to one of five categories, and each category has a deep reference carrying the algorithm, the thresholds, the stand-downs, the false positives and what each detector refuses to claim. The map of the categories, the rules that decide which one a detector lands in, and a complete index of all 45 classes — class, `name` string, issue type, layer and config key — are in [docs/DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md).
>
> | Category | Question it answers | Deep reference |
> |---|---|---|
> | Connectivity | Can this endpoint establish and keep the path? | [docs/CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md) |
> | Transport Quality | The path exists — is it carrying traffic well enough? | [docs/TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md) |
> | Pipeline Disruption | Did the media chain stop, or do two components disagree? | [docs/PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md) |
> | Perceived Quality | Is what the user sees and hears degraded? | [docs/PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md) |
> | Telemetry | What is this session's shape, and what changed about it? | [docs/TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md) |
>
> The groupings below are by **subject** — audio, video, send side, connection — which is how you look a detector up when you have a symptom. The categories are by **detection shape**, which is how the library decides what belongs where. The two do not line up one-to-one, and [the taxonomy explains why](./DETECTOR_TAXONOMY.md#category-is-not-subject).

## Detector overview

| Detector | Watches | Reports | Good for |
|---|---|---|---|
| [`InventedSpeechDetector`](#inventedspeechdetector) | inbound audio | issue `invented-speech` | How the audio actually *sounded* — catches degradation packet loss numbers miss |
| [`JitterBufferStressDetector`](#jitterbufferstressdetector) | inbound audio | issue `audio-jitter-buffer-stress` | The jitter buffer adding latency *and* stretching audio — delay the user hears |
| [`AVDesyncPlayoutDetector`](#avdesyncplayoutdetector) | inbound audio + its linked video | issue `av-desync` | Lip sync: the two tracks of one participant playing out at different points in the sender's timeline |
| [`AudioPlayoutSynthesisDetector`](#audioplayoutsynthesisdetector) | audio playout | event `synthesized-audio` | The playout device injecting synthesized audio |
| [`InboundVideoFlowStateDetector`](#inboundvideoflowstatedetector) | inbound video | issue `video-flow-disrupted` | The picture stopped moving — once and for long (`frozen`), or repeatedly and briefly (`choppy`) |
| [`VideoRecoveryFailedDetector`](#videorecoveryfaileddetector) | inbound video | issue `video-recovery-failed` | We asked for a keyframe repeatedly and nothing came back |
| [`PixelatedVideoDetector`](#pixelatedvideodetector) | inbound video | issue `pixelated-video` | Too few bits per pixel for too long — the picture the viewer calls blocky |
| [`DecoderPerformanceDetector`](#decoderperformancedetector) | inbound video | issue `video-decoder-overloaded` | Frames arrived but this device cannot decode them in time |
| [`FrameAssemblyStalledDetector`](#frameassemblystalleddetector) | inbound video | issue `frame-assembly-stalled` | Packets keep arriving and no complete frame is ever assembled from them |
| [`StuckDecoderDetector`](#stuckdecoderdetector) | inbound video | issue `stuck-decoder` | RTP flowing, nothing decoding — the wedge only recreating the consumer fixes |
| [`PlayoutDiscrepancyDetector`](#playoutdiscrepancydetector) | inbound video | issue `inbound-video-playout-discrepancy` | Frames received but not rendered — a rendering pipeline backlog |
| [`DryInboundTrackDetector` / `DryOutboundTrackDetector`](#dryinboundtrackdetector--dryoutboundtrackdetector) | tracks | issues `dry-inbound-track`, `dry-outbound-track` | A track that should be flowing but carries no bytes at all |
| [`VideoCaptureBottleneckDetector`](#videocapturebottleneckdetector) | outbound video | issue `video-capture-bottleneck` | The camera is not delivering the frames it was configured for — caught *while it degrades*, not once it has stopped |
| [`EncoderBottleneckDetector`](#encoderbottleneckdetector) | outbound video | issue `encoder-bottleneck` | The camera is delivering and the encoder cannot keep up with it |
| [`DecoderBottleneckDetector`](#decoderbottleneckdetector) | inbound video | issue `decoder-bottleneck` | Frames arrived and the decoder did not turn enough of them into pictures |
| [`CaptureSourceLostDetector`](#capture-detectors) | outbound tracks | issue `capture-source-lost` | The capture device went away — unplugged, quit, stopped from the browser bar |
| [`SilentAudioSourceDetector`](#capture-detectors) | outbound audio | issue `silent-audio-source` | A live, unmuted microphone producing nothing but digital silence |
| [`CaptureTrackMutedDetector`](#capture-detectors) | outbound tracks | event `capture-track-muted` / `CAPTURE_TRACK_MUTED` | The OS or another application took the device — a timestamp, not a fault |
| [`UplinkCongestionDetector`](./CONNECTION_DETECTORS.md#uplinkcongestiondetector) | peer connection | issue `uplink-congestion` | The sending path is out of room — estimate collapsing with the pacer filling |
| [`DownlinkCongestionDetector`](./CONNECTION_DETECTORS.md#downlinkcongestiondetector) | peer connection | issue `downlink-congestion` | The receiving path is out of room — arriving bitrate collapsing with the jitter buffer bloating |
| [`TransportDelayDetector`](./CONNECTION_DETECTORS.md#transport-quality-detectors) | peer connection | issue `transport-delay-degraded` | A working path whose round trip is long enough, for long enough, to break turn-taking |
| [`TransportLossDetector`](./CONNECTION_DETECTORS.md#transport-quality-detectors) | peer connection | issue `transport-loss-sustained` | A path persistently dropping a material share of what crosses it |
| [`CpuPerformanceDetector`](./CONNECTION_DETECTORS.md#cpuperformancedetector) | whole client | issue `cpulimitation` | The device running out of CPU for encode/decode |
| [`IcePathEstablishmentDetector`](./CONNECTION_DETECTORS.md#icepathestablishmentdetector) | peer connection | event `ice-path-establishment-slow` | Connection setup taking suspiciously long, and where it is stuck |
| [`IceEstablishmentFailedDetector`](./CONNECTION_DETECTORS.md#iceestablishmentfaileddetector) | peer connection | issue `ice-establishment-failed` | The call never connected: candidates existed, nothing was ever nominated |
| [`IceDisconnectedDetector`](./CONNECTION_DETECTORS.md#the-layer-5-detectors) | ICE transports | issue `ice-disconnected` | A working path went `disconnected` and stayed there past the threshold |
| [`IceConnectionFailedDetector`](./CONNECTION_DETECTORS.md#the-layer-5-detectors) | ICE transports | issue `ice-connection-failed` | The browser gave up on the ICE generation — with `everConnected` saying which fault it is |
| [`IceTransportStalledDetector`](./CONNECTION_DETECTORS.md#the-layer-5-detectors) | ICE transports | issue `ice-transport-stalled` | Still sending on a connected path, nothing coming back |
| [`UnstableIcePathDetector`](./CONNECTION_DETECTORS.md#the-layer-5-detectors) | ICE transports | issue `unstable-ice-path` | The selected path will not settle |
| [`IceRestartDetector`](./CONNECTION_DETECTORS.md#the-restart-loop) | ICE transports | event `ice-restart` / `ICE_RESTART` | A new ICE generation was inferred, and whether it recovered or failed |
| [`IceRestartRecommendationDetector`](./CONNECTION_DETECTORS.md#the-restart-loop) | ICE transports | event `ice-restart-recommended` / `ICE_RESTART_RECOMMENDED` | *When* an ICE restart is warranted — your app decides whether to perform one |
| [`BlockedStunRequestsDetector`](./CONNECTION_DETECTORS.md#the-blocked-media-detectors) | ICE transports | issue `blocked-stun-requests` | The path stopped answering STUN while we were still asking |
| [`BlockedOutboundMediaDetector`](./CONNECTION_DETECTORS.md#the-blocked-media-detectors) | ICE transports | issue `blocked-outbound-media-transport` | STUN passes but nothing comes back about our media — the firewall / policy-middlebox signature |
| [`BlockedInboundMediaDetector`](./CONNECTION_DETECTORS.md#the-blocked-media-detectors) | ICE transports | issue `blocked-inbound-media-transport` | The far end says it sends and nothing arrives (off unless its key is supplied) |
| [`RtpSenderStalledDetector`](./CONNECTION_DETECTORS.md#rtpsenderstalleddetector--transportdemuxstalleddetector) | peer connection | issue `rtp-sender-stalled` | Frames encode and no packet leaves the sender |
| [`TransportDemuxStalledDetector`](./CONNECTION_DETECTORS.md#rtpsenderstalleddetector--transportdemuxstalleddetector) | peer connection | issue `transport-demux-stalled` | Traffic arrives on the transport and no inbound RTP accounts for it |
| [`DtlsHandshakeFailedDetector`](./CONNECTION_DETECTORS.md#the-dtls-detectors) | ICE transports | issue `dtls-handshake-failed` | `dtlsState: 'failed'` — terminal for this key exchange |
| [`DtlsHandshakeStalledDetector`](./CONNECTION_DETECTORS.md#the-dtls-detectors) | ICE transports | issue `dtls-handshake-stalled` | ICE proven healthy while DTLS never answers at all |
| [`IceReachabilityDetector`](./CONNECTION_DETECTORS.md#icereachabilitydetector) | peer connection | issue `no-available-ice-candidate` | Zero local ICE candidates while the connection falls over — no usable network at all |
| [`IceTraversalDetector`](./CONNECTION_DETECTORS.md#icetraversaldetector) | ICE transports | event `ice-tuple-changed` | The low-level signal that the selected network tuple changed |
| [`CodecChangeDetector`](./CONNECTION_DETECTORS.md#observation-detectors) | tracks | event `codec-changed` / `CODEC_CHANGED` | Which codec/profile is actually in use, and when it changed |
| [`VideoResolutionChangeDetector`](./CONNECTION_DETECTORS.md#observation-detectors) | video tracks | event `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | The adaptation ladder, with the *reason* attached |
| [`SimulcastLayerDetector`](./CONNECTION_DETECTORS.md#observation-detectors) | outbound video | event `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Which simulcast layers are actually being sent |
| [`StatsGapDetector`](./CONNECTION_DETECTORS.md#observation-detectors) | the monitor itself | event `stats-collection-gap` / `STATS_COLLECTION_GAP` | Backgrounded-tab gaps that would otherwise read as network spikes |

45 classes, 35 issue types, and 10 that emit events only — because what they
report is not a fault but the missing context in most investigations.

## One detector, one issue

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
[Controlling which detectors run](./EVENTS_AND_ISSUES.md#controlling-which-detectors-run), and note that
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
[docs/DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#the-five-design-rules).

## Duration is measured in stats time

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

## When a detector cannot see its inputs

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

## Which issues belong in the sample

Every issue-raising detector exposes a runtime flag next to `disabled`:

```ts
/** like `disabled`, flippable at runtime */
public includeIssueInSample = true;
```

When flipped to `false`, the detector keeps working locally — monitor events fire and the issue lifecycle (`activeIssues`, `'issue'` / `'issue-resolved'`) is maintained — but neither the raise entry nor the resolution entry is buffered into the `ClientSample`. (`raiseIssue` / `addIssue` accept the same thing directly via `includeInSample` for custom issues.)

In case shrinking down the sample size is something your application wants, the table below is the useful thing to know: it says for every issue whether the server can **derive the same verdict from one component's stats that the sample already carries** (all the load-bearing counters are monotonic totals, so a server holding consecutive samples can recompute every delta). Issues that are derivable are the safe candidates for `includeIssueInSample = false`; issues that are not derivable join stats across components, depend on state that never reaches the sample (`MediaStreamTrack.muted`, `getSettings()`, connection-state transitions), or live in sub-sampling-period timing — switch those off and the information is gone.

| Detector | Issue | Derivable from one component's sampled stats? | From what |
| --- | --- | --- | --- |
| `InboundVideoFlowStateDetector` | `video-flow-disrupted` | **Yes** | `inbound-rtp` `freezeCount`, `totalFreezesDuration`, `framesRendered` |
| `VideoRecoveryFailedDetector` | `video-recovery-failed` | No | tick-level sequencing of freeze + PLI + keyframe counters |
| `PixelatedVideoDetector` | `pixelated-video` | **Yes** | `inbound-rtp` `bytesReceived`, `frameWidth`, `frameHeight`, `framesPerSecond` — but the screen-share and pause guards are not sampled |
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
| `CaptureSourceLostDetector` | `capture-source-lost` | No | `MediaStreamTrack` `ended` event — no stats representation |
| `SilentAudioSourceDetector` | `silent-audio-source` | No | energy totals are sampled, but the live/enabled/unmuted guards are not |
| `VideoCaptureBottleneckDetector` | `video-capture-bottleneck` | No | the frame rate is a counter differenced against measured elapsed time, and the guards read `track.getSettings()`, pause state, screen-share content type and live track state — none of it reconstructable from a sample |
| `EncoderBottleneckDetector` | `encoder-bottleneck` | No | joins the media source's produced frames with the highest active layer's encoded frames over the shared detection window |
| `DecoderBottleneckDetector` | `decoder-bottleneck` | No | differences `framesDecoded` against `framesReceived` per collecting tick, behind pause and live-track guards that are not sampled |
| `UplinkCongestionDetector` | `uplink-congestion` | Mostly | `candidate-pair.availableOutgoingBitrate` + `outbound-rtp` `totalPacketSendDelay` and `qualityLimitationReason` — two components, but both sampled |
| `DownlinkCongestionDetector` | `downlink-congestion` | **Yes** | `inbound-rtp` `bytesReceived`, `jitterBufferDelay`, `jitterBufferEmittedCount` |
| `CpuPerformanceDetector` | `cpulimitation` | No | joins send-side and receive-side evidence plus `durationOfCollectingStatsInMs`, which is not sampled |
| `TransportDelayDetector` | `transport-delay-degraded` | **Yes** (approx.) | `candidate-pair` / `remote-inbound-rtp` round trip totals; the window means are per collecting tick |
| `TransportLossDetector` | `transport-loss-sustained` | **Yes** (approx.) | `inbound-rtp` and `remote-inbound-rtp` loss totals; the per-tick "carried packets" gating that keeps muted tracks out of the mean is lost |
| `IceDisconnectedDetector`, `IceConnectionFailedDetector`, `IceTransportStalledDetector`, `UnstableIcePathDetector` | `ice-disconnected`, `ice-connection-failed`, `ice-transport-stalled`, `unstable-ice-path` | No | state transitions and episode timing happen *between* samples |
| `BlockedStunRequestsDetector` | `blocked-stun-requests` | No | candidate-pair STUN request/response counters per collecting tick |
| `BlockedOutboundMediaDetector` | `blocked-outbound-media-transport` | No | joins candidate-pair STUN counters with `remote-inbound-rtp` arrival per collecting tick |
| `IceReachabilityDetector` | `no-available-ice-candidate` | No | connection-state jumps + gathering state; with no network the next sample may never leave the device |
| `IceEstablishmentFailedDetector` | `ice-establishment-failed` | No | needs the *latched* fact that no pair was ever nominated, plus connection-state history; a connection that never establishes may never ship a sample either |
| `RtpSenderStalledDetector` | `rtp-sender-stalled` | No | cross-references `framesEncoded` against `packetsSent` per collecting tick, behind track live/muted and layer-active guards |
| `TransportDemuxStalledDetector` | `transport-demux-stalled` | No | cross-references transport bytes against inbound-rtp bytes per collecting tick |


---

## Audio detectors

> Three of these four are **Perceived Quality** — invented speech, jitter-buffer stress and desync are continuously-measured perceptual values judged over an accumulator or a window, and so is `AudioPlayoutSynthesisDetector` despite emitting only an event. Full reference, including why the audio-clarity sub-layer is deliberately empty and what each proxy cannot claim: [docs/PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md).

### InventedSpeechDetector

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

### JitterBufferStressDetector

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

### AVDesyncPlayoutDetector

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

**Support is thin, and the flag says so.** `estimatedPlayoutTimestamp` is populated by Firefox, exposed by Chrome only when A/V sync is enabled internally, and not reported by Safari. Where it is missing — or where no pairing was declared — the detector sets `inputsUnavailable` instead of staying quiet, so a dashboard can tell "in sync" from "never measured". One further limitation the spec creates: the timestamp may be extrapolated between sender reports, so a frozen renderer can keep reporting smooth playout and this detector will believe it. Treat a `video-flow-disrupted` issue as a reason to distrust a clean sync reading over the same interval.

**Replaces `AudioDesyncDetector` (removed in 4.9.0).** That detector read NetEQ's accelerate and preemptive-expand counters, which measure jitter-buffer adaptation rather than synchronization — and since A/V sync logic corrects drift by *raising* NetEQ's target delay, it tended to fire on the correction rather than the fault. That signal is still read, correctly labelled, by [`JitterBufferStressDetector`](#jitterbufferstressdetector). No tuning carries over: the quantity changed from a fraction of samples to milliseconds of skew.

**Sources:** [ITU-R BT.1359-1 — Relative timing of sound and vision for broadcasting](https://www.itu.int/rec/R-REC-BT.1359/en) · [W3C webrtc-stats: `estimatedPlayoutTimestamp`](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-estimatedplayouttimestamp)

### AudioPlayoutSynthesisDetector

Watches `media-playout` for synthesized (concealment/generated) samples injected at the playout device level, and raises `synthesized-audio` plus the `EXCESSIVE_SYNTHESIZED_AUDIO` client event when the share of what was played that was invented exceeds `synthesizedRatioThreshold`. A share rather than a duration on purpose: the counter is in seconds and a per-interval duration reports on every tick that concealed anything at all.

**Use the result:** sustained synthesized playout with otherwise healthy inbound stats points at the *output* path — suggest the user switch audio output device.

```javascript
audioPlayoutSynthesisDetector: {
    synthesizedRatioThreshold: 0.05,  // share of the played audio that was invented
    createEvent: true,                // also buffer EXCESSIVE_SYNTHESIZED_AUDIO into samples
}
```

**Sources:** [How WebRTC's NetEQ jitter buffer provides smooth audio (webrtcHacks)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

## Video detectors

> These split across two categories, and the split is the useful part. `video-flow-disrupted` and `pixelated-video` are **Perceived Quality** — they say the picture is bad, without saying where it broke ([docs/PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md)). The rest are **Pipeline Disruption** — they name a boundary in the receive chain, or a repair loop beside it, and their answer is a stage rather than an experience ([docs/PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md)). Both can be right about the same thirty seconds, and neither reads the other.

### InboundVideoFlowStateDetector

Reports an inbound picture that stopped moving: repeatedly and briefly (`choppy`), or once and for long (`frozen`). Use it to answer "is this person watching moving video right now" — the complaint behind most "you're breaking up" reports, and one no single stat answers.

It replaces the old `InboundVideoFlowStateDetector`, which reported freeze *starts*. Two mutually exclusive states with one configured duration between them, judged over two windows on the stream's own `deltaTime`: `observationWindowInMs` makes the verdict, and a retention window spanning `continuousDurationInMs` decides only when a choppy finding may close. Frozen wins wherever both would fit, and closes the moment frames render again.

`frozen` usually means delivery stopped or the decoder wedged; `choppy` usually means frames are arriving late or in bursts. Both are what the viewer actually sees, so they are the right thing to count when asking how a call went. It describes the picture, not the network — pair it with the transport detectors for a cause.

**The state is published, not just the issue.** `InboundTrackMonitor.frameFlowState` is `'frozen'`, `'choppy'` or `undefined`, and `DefaultScoreCalculator` reads it. It changes only when a finding opens or closes, never on insufficient data, so it does not flicker.

**Use the result:** overlay a spinner or last-frame treatment on the participant's tile for `frozen`; count `choppy` rather than showing it, since a viewer already knows.

```javascript
inboundVideoFlowStateDetector: {
    observationWindowInMs: 10000,   // the recent span freezes are counted over
    continuousDurationInMs: 3000,   // freeze-free time before a choppy finding closes
}
```

```typescript
monitor.on('video-flow-disrupted', ({ trackMonitor, state }) => {
    if (state === 'frozen') ui.showFreezeOverlay(trackMonitor.track.id);
});
```

Screen shares, paused tracks and a backgrounded tab are not judged at all, and the stand-down swallows the monotonic counters rather than skipping the tick — so a quiet period is not replayed as freezes on the way back.

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### VideoRecoveryFailedDetector

The repair loop around a freeze: PLI/FIR out, keyframes back in. `video-recovery-failed` is the failure worth waking an SFU operator for — keyframes were requested, repeatedly, over a sustained stretch, and none arrived. `video-flow-disrupted` says a viewer is looking at a still picture; this says the mechanism that exists to end it is not working.

A freeze that repairs itself in a second is a lossy first hop; a freeze where PLI after PLI leaves the client and `keyFramesDecoded` never moves points past the first hop — at forwarding, at a consumer wired to a producer that is gone, at a far-side encoder that stopped producing keyframes. Both halves of the evidence are required: `recoveryFailedThresholdInMs` of stall *and* `recoveryFailedMinPliCount` requests, so the claim ("we asked and nothing came back") always has both.

It does not derive its stall condition from another detector's verdict. What it needs is narrower anyway — frames not rendering **and** `deltaKeyFramesDecoded === 0`, which is the precise statement that the repair did not land.

**Use the result:** this is your escalation signal — pair it with [`stuck-decoder`](#stuckdecoderdetector): if both fire, recreate the consumer; if only recovery fails, the producer or SFU forwarding needs the look.

```javascript
videoRecoveryFailedDetector: {
    recoveryFailedThresholdInMs: 5000, // stalled with PLIs out for this long
    recoveryFailedMinPliCount: 2,      // proof we actually asked for repair
}
```

```typescript
monitor.on('video-recovery-failed', ({ trackMonitor, pliCountSinceStalled }) => {
    // we asked for a keyframe repeatedly and nothing came back — not a local problem
    reportToServer('recovery-failed', trackMonitor.track.id, { pliCountSinceStalled });
});
```

The stall is accumulated from each tick's `deltaTime` rather than wall-clock elapsed, so a throttled tab cannot age a stall into an issue.

**A `KeyframeStormDetector` existed during development and was removed before release.** A PLI storm is self-reinforcing and worth knowing about, but every storm this library could measure was already reported by `video-recovery-failed` or by the transport detectors underneath it, and a second issue on the same episode is noise rather than evidence. `inboundRtp.pliRate` is still published for anyone who wants to trend it; nothing thresholds it.

**Sources:** [PLI: Picture Loss Indication (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/pli/) · [RFC 4585: RTP/AVPF (PLI/FIR)](https://datatracker.ietf.org/doc/html/rfc4585) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### PixelatedVideoDetector

Perceived video quality: nothing has stalled, frames arrive and decode and render on time, and the experience is still bad. It thresholds a value the inbound RTP monitor already computes and that nothing previously read.

`pixelated-video` is judged on **`bitPerPixel`** — bitrate divided by width × height × frame rate — the picture being drawn with too few bits for its size, for long enough to be worth complaining about. Bits per pixel was chosen over quantizer parameters for a plain reason: `qpSum` is optional, absent on some codecs, and its scale differs between them, so a QP threshold is really a per-codec table that silently produces nothing where it has no entry. `bitPerPixel` is derived from three fields every browser reports and means the same thing everywhere. It is not a precise perceptual model and does not pretend to be.

The class holds no window of its own. The arithmetic lives on `InboundRtpMonitor`, and this detector compares two numbers against two thresholds and counts how long the answer stayed bad — a derived value is a fact about the stream that anything may want, while a threshold is an opinion belonging to whoever is judging.

```javascript
pixelatedVideoDetector: {
    threshold: 0.03,          // bits/pixel at or below which the picture counts as coarse
    recoveryThreshold: 0.05,  // above this it resolves (hysteresis)
    durationInMs: 8000,       // stats time it must stay coarse before raising
},
```

```typescript
monitor.on('pixelated-video', ({ trackMonitor, bitPerPixel }) => ui.hintPoorVideo(trackMonitor.track.id, { bitPerPixel }));
```

**How much a blocky picture costs depends on how big it is shown.** `DefaultScoreCalculator` weighs this finding by `InboundTrackMonitor.displayMagnification` — blown up, the coded blocks are what the viewer complains about; in a thumbnail nobody can see them. Declare the size with `setInboundTrackContext({ presentedResolution })`; undeclared, the table price applies unchanged.

**A juddery picture is a different detector.** Low or erratic frame rate is [`InboundVideoFlowStateDetector`](#inboundvideoflowstatedetector)'s `choppy` state, not a separate `video-choppy` issue — the two were separate classes during development and were merged, because a viewer reporting "it's juddery" is describing one complaint and two issues on it were noise.

**Screen shares are excluded** rather than given a second threshold. A static slide legitimately spends almost nothing per pixel, and that is correct behaviour. Camera video typically runs 0.05–0.2 bits per pixel; below roughly 0.03 blocking artefacts are usually visible. It also stands down on a paused consumer or a paused remote sender, and sets `inputsUnavailable` when the browser reports no frame size or frame rate — "nothing was observed about picture quality" is not the same as "the picture is fine".

**Threshold caveat.** These numbers are round starting points chosen from what camera video usually looks like, not measurements of anything. Tune them against your own fleet before alerting on them.

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### FrameAssemblyStalledDetector

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

**Deliberately narrow.** It says nothing about *why* frames are not assembling — sustained loss inside every frame and a codec mismatch look identical from here, and both are real. Attribution is what co-firing with [`transport-loss-sustained`](./CONNECTION_DETECTORS.md#transport-quality-detectors) is for, and that comparison belongs to whoever reads the issues. A sender that has simply stopped sending is not this: no packets arrive, so nothing accumulates, and [`dry-inbound-track`](#dryinboundtrackdetector--dryoutboundtrackdetector) owns that. Pause, mute and a backgrounded tab each reset the stall rather than counting toward it, and a browser that does not report `framesReceived` sets `inputsUnavailable` rather than staying quietly silent.

**Sources:** [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### DecoderPerformanceDetector

Blames this device only when frames demonstrably *arrived* — healthy receive rate, quiet loss — but decode time overran a budget derived from the stream's own frame rate, or frames were dropped after arrival. This is the detector that separates "the network dropped it" from "the client could not decode it": same chart, opposite fixes.

**Use the result:** reduce decode load — subscribe to lower simulcast layers, cap the number of rendered videos, or pause off-screen tiles. The payload's `decoderImplementation` / `powerEfficientDecoder` tell you whether a software decoder is doing work the hardware could.

```javascript
decoderPerformanceDetector: {
    decodeTimeBudgetRatio: 0.8,  // share of the per-frame budget (1000/fps) decode may use
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

### DecoderBottleneckDetector

The receive-side counterpart of `video-capture-bottleneck`: frames arrived and the decoder did not turn enough of them into pictures. Raises `decoder-bottleneck`.

**The rule, in full:** the frames that arrived and the frames that were decoded both come from `InboundTrackMonitor.detectionRecoveryWindow`, differenced across the same stretch. Leaving more than `decodeDegradationThreshold` of them undecoded raises; the finding ends only once the older recovery span is back within the threshold too.

```javascript
decoderBottleneckDetector: {
    decodeDegradationThreshold: 0.1, // 10% of arriving frames left undecoded
    minReceivedFps: 5,               // too thin a stream to judge a decoder on
},
inboundTrackDetectionRecoveryWindow: {
    detectionWindowMs: 15000,        // the span that raises ...
    recoveryWindowMs: 10000,         // ... and the span behind it that has to agree to clear
}
```

**The bar is the arrival rate, never the sender's.** Frames that never arrived are the network's story — `InboundVideoFlowStateDetector` and the peer connection's loss reasons tell it — so a stream throttled to 5fps that decodes cleanly is silent. That is also what separates it from [`DecoderPerformanceDetector`](#decoderperformancedetector), which asks whether decoding *cost* too much over consecutive ticks: that one is about the price of decoding, this one about frames going missing. Both firing at once is the honest answer when both are true.

**Use the result:** the client cannot decode what it was handed — drop to a lower simulcast layer, or ask the SFU for one.

```typescript
monitor.on('decoder-bottleneck', ({ trackMonitor, decodedFps, receivedFps }) => {
    sfu.requestLowerLayer(trackMonitor.track.id, { decodedFps, receivedFps });
});
```

**What it refuses to judge**, because a low decode rate there is legitimate: a backgrounded tab, a paused consumer, a paused remote sender, a track that is not live and unmuted, and a stream thinner than `minReceivedFps`. The window restarts after a collection gap.

### StuckDecoderDetector

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

### PlayoutDiscrepancyDetector

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

## Track activity

> Both are **Pipeline Disruption**, at the two ends of the chain: `dry-outbound-track` is the last send-side boundary and `dry-inbound-track` the first receive-side one. Full reference: [docs/PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md).

### DryInboundTrackDetector / DryOutboundTrackDetector

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

## Send side

> Every detector in this group is **Pipeline Disruption**, watching one boundary of the send chain `capture → frame supply → encoder → RTP sender`. The boundary each one owns, the one boundary nothing watches, and the naming debt three of the issue types carry are in [docs/PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md).

### VideoCaptureBottleneckDetector

Is the capture device delivering the frames the track was configured to capture? The send-side mirror of [`DecoderBottleneckDetector`](#decoderbottleneckdetector), which asks the same of the decoder. Raises `video-capture-bottleneck`.

**The rule, in full:** the frames the source delivered and the span it had to deliver them in both come from `OutboundTrackMonitor.detectionRecoveryWindow`. Compare the resulting rate against `getSettings().frameRate`: falling more than `produceDegradationThreshold` short raises. It resolves only once the *older* recovery span is back within the threshold too, so a camera sitting on the line cannot flap one long fault into a stream of short episodes. Neither span is read before it says it is ready.

```javascript
videoCaptureBottleneckDetector: {
    produceDegradationThreshold: 0.2,  // more than 20% short of the configured frame rate
},
outboundTrackDetectionRecoveryWindow: {
    detectionWindowMs: 5000,           // the span that raises ...
    recoveryWindowMs: 4000,            // ... and the span behind it that has to agree to clear
}
```

**Why a span rather than a per-tick threshold.** A camera that is failing rather than merely busy dips and recovers: 150 frames per 5s tick becomes 132, back to 150, then 97. Tick by tick most of it looks fine; differenced across the window it does not, so the finding opens while the camera is still delivering rather than after it stops. Differencing the endpoints also weights *how far* the source fell short rather than merely how often, and a collection missed in the middle costs nothing, because the totals carry across it.

**Why a span and not a tick count.** What matters here is that the device stayed short for a stretch of time that means something. A tick count would mean six seconds at a 2s collecting period and thirty at a 10s one. The span is shared with [`EncoderBottleneckDetector`](#encoderbottleneckdetector), so the two are judged over the same stretch.

**The rate is always the counter, never `mediaSource.framesPerSecond`.** It is `mediaSource.frames` differenced across the window against *measured* elapsed time. The browser's own figure is coarse and smooths this exact stutter away — it can read `30` across an interval that actually delivered 132 frames in five seconds. Where the counter restarted the window reports no delta, and a restart is not a measurement.

**No baseline, no judgement.** If the browser does not report `getSettings().frameRate`, nothing is substituted for it: there is no rate for the measurement to fall short *of*, so the check stays quiet.

**What it refuses to judge**, because a low frame rate there is legitimate: a backgrounded tab (`ClientMonitor.activeTab === false`), a paused or stopped sender, and screen shares, whose frame rate is content-driven (a still document delivers nothing). If you capture a moving surface that should be watched, declare it with `monitor.setOutboundTrackContext(trackId, { contentType: 'camera' })`. The totals also restart after a settings change or a collection gap — that threshold is derived from `collectingPeriodInMs` rather than configured.

```typescript
monitor.on('issue', (issue) => {
    if (issue.type !== 'video-capture-bottleneck') return;
    const { producedFpsForDetection, expectedFps } = issue.payload;
    ui.hintCameraTrouble(issue.payload.trackId, { producedFpsForDetection, expectedFps });
});
```

**Threshold caveat.** `0.2` is a round starting point, not a measurement. Treat `video-capture-bottleneck` as observation-grade until a corpus of your own sets the number.

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### EncoderBottleneckDetector

Given a capture source that *is* delivering, is the encoder keeping up with it? Use it to tell a struggling encoder apart from a starving camera, which is [`VideoCaptureBottleneckDetector`](#videocapturebottleneckdetector)'s subject. The send-side mirror of [`DecoderPerformanceDetector`](#decoderperformancedetector). Raises `encoder-bottleneck`.

Both counters come from `OutboundTrackMonitor.detectionRecoveryWindow` — the frames the media source produced and the frames the highest layer encoded, measured across the same stretch. Leaving more than `encodeDegradationThreshold` of the frames handed over unencoded opens the issue, and every later collection still short of it *updates* that issue rather than opening another.

```javascript
encoderBottleneckDetector: {
    encodeDegradationThreshold: 0.3,   // 30% of handed-over frames left unencoded
},
outboundTrackDetectionRecoveryWindow: {
    detectionWindowMs: 5000,           // the span the raise is judged over ...
    recoveryWindowMs: 4000,            // ... and the span behind it that has to agree to clear
}
```

**The window is shared, not per detector.** The stretch that raises and the stretch that resolves live on the track monitor, so this detector and the capture one are judged over the same spans and there is one place to widen them. The issue ends only once the stretch *before* the detection window is back within the threshold, so an encoder hovering at the line cannot flap one long fault into a stream of short ones. Neither window is read before it says it is ready.

**Everything is measured against what the source actually delivered**, never against what the track was configured to capture at. An encoder handed 3fps and emitting 3fps is doing its job perfectly; comparing it to a configured 30 would call that a catastrophic failure. A starving camera therefore cannot make the encoder look guilty — handed nothing, it has nothing to answer for. That is also why screen shares are judged like any other track here: their frame rate follows the content, and the encoder is still expected to keep up with whatever it is given.

That comparison is made from the two raw counters, and **not** by consulting `video-capture-bottleneck`. Detectors observe; they do not consume each other's verdicts — otherwise disabling the capture detector would silently change this one's answer, and the two would only agree within a tick because of registration order.

**The continuous reading is published too.** `OutboundTrackMonitor.videoEncodingDegradation` carries the measured shortfall on every judged collection, whether or not a finding is open, and goes `undefined` where nothing could be measured. `degradedEncodingPerformance` is the boolean beside it.

**Use the result:** reduce encode load — drop the top simulcast layer, lower resolution or frame rate, disable background effects.

```typescript
monitor.on('issue', (issue) => {
    if (issue.type === 'encoder-bottleneck') sender.dropTopSimulcastLayer();
});
```

**Correlate rather than combine.** `CpuPerformanceDetector` reports CPU limitation as its own `cpulimitation` issue, and the useful thing to do with the two is correlate them: `encoder-bottleneck` and `cpulimitation` firing together is evidence the encoder is CPU-bound. That inference is only worth something while this one is derived *without* reading the same signal, which is why no CPU share is wired in here.

### Capture detectors

Three classes watch the source end of outbound tracks, one per finding, each registered from a config key of its own — so `captureTrackMutedDetector: null` silences the mute telemetry and leaves the two issue-raising classes running.

| Class | Reports | What it means |
|---|---|---|
| `CaptureSourceLostDetector` | issue `capture-source-lost` | `readyState` turned `ended`: a webcam unplugged, a Bluetooth headset that dropped its link, a screen share stopped from the browser's own bar, a virtual camera whose application quit |
| `SilentAudioSourceDetector` | issue `silent-audio-source` | A live, unmuted, enabled microphone capturing nothing but digital silence |
| `CaptureTrackMutedDetector` | event `capture-track-muted` only | `track.muted` flipped true: the OS grabbed the microphone, another application claimed the camera, the lid closed, the privacy shutter moved |

**None of these leaves a trace in RTP.** The encoder keeps its `outbound-rtp` entry and the counters simply stop advancing, so every detector reading transport or encoder stats sees a track that went quiet with no way to say why. The track object is the only place the reason is written down.

`capture-source-lost` is raised exactly once per track monitor and nothing resolves it — `ended` is terminal by specification, and the application has to acquire a new track. It is deliberately not conditioned on the sender being live: a device unplugged during a pause is a fact about the device, and an application about to resume onto a device that no longer exists is precisely who needs to be told.

`silent-audio-source` reads the media source's `rmsAudioLevel`, which integrates `totalAudioEnergy` over the interval — the instantaneous `audioLevel` reads zero between words and would fire on every pause for breath. The threshold is measured in tens of seconds on purpose: a microphone capturing nothing and a person who simply is not talking are the same measurement, and only duration separates them. A paused sender, a track that is not `live`, or a muted or disabled track each stand the check down and resolve any open issue.

**`capture-track-muted` raises no issue, by design.** A muted source is very often exactly what the user intended, and `track.muted` covers the deliberate system mute and the accidental device grab with the same flag — calling it a fault would file thousands of correct system mutes as call failures. What it is worth is a timestamp: the record of when capture stopped, next to which the silence and dry-track findings that follow stop looking mysterious. Only the false → true transition is reported, never the first observation (a track already muted when monitoring began says nothing about a change) and never the return to unmuted (the sibling detectors observe the recovery directly).

**Use the result:** `capture-source-lost` → open the device picker. `silent-audio-source` → the classic "are you speaking? we can't hear you" banner, with a shortcut to switch microphone. `capture-track-muted` → log it and read it alongside whatever else fired.

```javascript
captureTrackEndedDetector: { createEvent: true }, // also buffer CAPTURE_SOURCE_LOST into samples
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
monitor.on('capture-source-lost', () => ui.openDevicePicker('audioinput'));
```

**Sources:** [MediaStreamTrack mute event (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

## Custom Detectors

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

See [Controlling which detectors run](./EVENTS_AND_ISSUES.md#controlling-which-detectors-run) for the full set of registry helpers.

---

## Replaying a captured session

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
npm run replay -- session.jsonl --only video-capture-bottleneck,encoder-bottleneck
npm run replay -- session.jsonl --config '{"videoCaptureBottleneckDetector":{ ... }}'
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

expect(run.issueTypes.has('video-capture-bottleneck')).toBe(true);
run.close();
```

Its second argument is config overrides, so the same capture can be replayed
against different thresholds to find where a detector flips. For full control
— multiple monitors, tick-by-tick assertions, real-time replay — use
`StatsReplayer` directly; `tests/fixtures/README.md` has the details.

---

[← back to the README](../README.md)
