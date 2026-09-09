# Pipeline Disruption Detectors — the chain model

This document is the reference for how the library detects **pipeline
disruption**: the two media chains an endpoint runs, the boundaries between
their stages, which detector watches each boundary, and what each one is
allowed to conclude.

It answers one question: *did the media chain stop somewhere, or do two
adjacent components disagree?* — asked from the chair of a WebRTC engineer with
a broken call in front of them. Not "is this call bad", which is
[Perceived Quality](./PERCEIVED_QUALITY_DETECTORS.md)'s question, and not "is
the path carrying traffic well", which is
[Transport Quality](./TRANSPORT_QUALITY_DETECTORS.md)'s. The answer this
category is built to give is a **place**: the boundary where the upstream
counter advanced and the downstream one did not.

This is the deep reference for **Category 3**, the largest of the library's five
detector categories at 16 classes and 16 issue types. The parent map — the other
four categories, what puts a detector in one rather than another, and the rules
that keep the boundaries stable — is
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md). The sibling deep references are
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md),
[TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md),
[PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md) and
[TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md). For the surrounding API
(listening to issues, the `ClientMonitorIssue` union, enabling and disabling
detectors) see the *Events and Issues* section of the
[README](../README.md#events-and-issues).

- [The two chains](#the-two-chains)
- [Boundary, not component](#boundary-not-component)
- [The grid](#the-grid)
- [What every stall clock shares](#what-every-stall-clock-shares)
- [Send — the source](#send--the-source)
- [Send — capture to frame supply](#send--capture-to-frame-supply)
- [Send — processing to encoder input](#send--processing-to-encoder-input)
- [Send — frames to encoder](#send--frames-to-encoder)
- [Send — encoder to RTP sender](#send--encoder-to-rtp-sender)
- [Send — RTP sender to the wire](#send--rtp-sender-to-the-wire)
- [Receive — transport to RTP streams](#receive--transport-to-rtp-streams)
- [Receive — the wire to the track](#receive--the-wire-to-the-track)
- [Receive — packets to frames](#receive--packets-to-frames)
- [Receive — frames to decoder](#receive--frames-to-decoder)
- [Receive — decoder to renderer](#receive--decoder-to-renderer)
- [Beside the receive chain — the repair loop](#beside-the-receive-chain--the-repair-loop)
- [Across both chains — the machine](#across-both-chains--the-machine)
- [Issue taxonomy by boundary](#issue-taxonomy-by-boundary)
- [The neighbours: what is below and what is above](#the-neighbours-what-is-below-and-what-is-above)
- [What this model deliberately does not do](#what-this-model-deliberately-does-not-do)
- [Observability horizon](#observability-horizon)

## The two chains

An endpoint runs two chains, and they are not each other's mirror image. They
meet only at the network, which belongs to neither: the send chain ends where
bytes leave, the receive chain begins where bytes arrive, and everything between
those two points is
[Transport Quality](./TRANSPORT_QUALITY_DETECTORS.md)'s subject rather than this
document's.

```
SEND
  capture device
        │  S1  is the device delivering the frames it was configured for?
        ▼
  frame supply
        │  S2  processing / constraints        (not observable — see below)
        ▼
  encoder input
        │  S3  is the encoder consuming what the source hands it?
        ▼
  encoder
        │  S4  do encoded frames become packets?
        ▼
  RTP sender
        │  S5  does anything at all go on the wire?
        ▼
  ══════ network ══════
```

```
RECEIVE
  ══════ network ══════
        │
        ▼
  ICE transport
        │  R1  do arriving bytes reach an inbound RTP stream?
        ▼
  RTP receiver
        │  R2  is anything arriving on this track at all?
        ▼
  packets
        │  R3  do packets become complete frames?
        ▼
  frame assembly
        │  R4  do assembled frames become decoded pictures?
        ▼
  decoder
        │  R5  do decoded pictures get painted?
        ▼
  renderer

  beside R3–R5:  the repair loop — PLI out, keyframe back
```

Each arrow is a **boundary**, and each boundary has a monotonic counter on
either side of it. That is what makes a disruption locatable rather than merely
detectable: `framesEncoded` rising while `packetsSent` stays flat is not "the
call broke", it is a stage name to hand an engineer.

Two structural facts follow from the shape and are worth stating before the
detail.

**The receive chain has more boundaries than the send chain**, and more
detectors, because the receive side is where the consequences of everything
upstream — the far end's encoder, the SFU, the network — arrive with no context.
A sender knows what it meant to send. A receiver only knows what turned up.

**A boundary can be unwatched, and one is.** S2 has no detector because no
browser stat sits there; the section on it says so rather than leaving a gap in
the diagram unexplained.

## Boundary, not component

The membership test for this category is: *can you name the boundary at which
progress stopped?* An ideal detector's finding reads as a comparison —
"packets advanced, frames received did not" — and never as a verdict about a
component's character.

The reason is not aesthetic. A boundary statement is falsifiable from the stats
alone and stays true regardless of what caused it; a component verdict imports a
theory about which side of the boundary is at fault, and the stats usually
cannot tell. "The encoder is slow" and "something between the capture callback
and the encoder is slow" produce identical numbers, and only one of those two
sentences is a measurement.

**The library is not consistent here, and the inconsistency is worth recording
rather than hiding.** In 4.9.0 `MediaPipelineDetector` was split into
`RtpSenderStalledDetector` and `TransportDemuxStalledDetector` for exactly this
reason: one class raising a generic `media-pipeline-stalled` for two unrelated
boundaries, discriminated by a `stage` / `direction` field, told a reader that
*something in the pipeline* stalled and made them read the payload to find out
what. Two classes named for their boundaries tell them in the issue type. That
was the right move and it is the direction the category is going.

Three issue types still assert a component verdict from boundary evidence:

| Issue type | What the evidence actually says | What the name asserts |
|---|---|---|
| `encoder-bottleneck` | The source delivered *n* fps and the highest active layer emitted fewer, or a frame cost more than its share of the budget | The encoder is the bottleneck |
| `decoder-bottleneck` | Over the window, decoded fps fell below a share of received fps | The decoder is the bottleneck |
| `video-decoder-overloaded` | Decode time per frame overran the budget, or frames were dropped after arriving, with loss quiet | The decoder is overloaded |

In every one of those, the boundary is real and measured; the component named on
the *far* side of it is an inference. An `encoder-bottleneck` on a machine whose
capture pipeline is inserting a background-blur transform is naming the encoder
for a stall that is upstream of it, and nothing in the stats separates the two.

These are kept as they are because the issue type is a public contract that
`observer-js` and dashboards consume, and renaming three types to fix a naming
debt costs every consumer a migration for no change in what is detected. They
are recorded here as **naming debt with a known direction**: if they are ever
renamed, they should be renamed toward the boundary
(`encoder-frame-supply-shortfall` rather than `encoder-bottleneck`), and the
reasoning is the same reasoning that split `media-pipeline-stalled`.

`CpuPerformanceDetector` is a fourth and different case — it names a *cause*
rather than a component — and it gets [its own section](#across-both-chains--the-machine).

## The grid

Every class, the boundary it watches, and where it binds. "Coverage" is what the
detector can actually see: which media kinds, which monitor level, and the blind
spots that follow.

The boundary column carries the **full name and the grid code together**, because
the two are used in different places and a reader needs the mapping in one look.
The code is shorthand for the rest of this document — the chain diagram above, and
every "**Boundary S4.**" that opens a detector's section. The full name is the
`##` heading that boundary's section is titled with, and it is the spelling that
travels: it is what each class stamps in its own source doc comment, what the
layer column of the [full map](./DETECTOR_TAXONOMY.md#the-full-map) uses, and what
`DETECTOR_LAYERS` in `tests/detectors/DetectorTaxonomy.spec.ts` holds the three of
them to. `S1` outside this document would mean nothing to anybody.

| Boundary | Class | Issue type | Config key | Coverage |
|---|---|---|---|---|
| Send — the source | `CaptureSourceLostDetector` | `capture-source-lost` | `captureSourceLostDetector` | Audio + video, outbound track; reads the track object, not stats |
| Send — the source | `SilentAudioSourceDetector` | `silent-audio-source` | `silentAudioSourceDetector` | Audio only, outbound track |
| Send — capture to frame supply (S1) | `VideoCaptureBottleneckDetector` | `capture-bottleneck` | `videoCaptureBottleneckDetector` | Video only; screen shares refused; needs `getSettings().frameRate` |
| **Send — processing to encoder input (S2)** | *(none — no browser stat exists)* | — | — | **Unwatched by design of the stats, not by choice** |
| Send — frames to encoder (S3) | `EncoderBottleneckDetector` | `encoder-bottleneck` | `encoderBottleneckDetector` | Video only; highest active layer only |
| Send — encoder to RTP sender (S4) | `RtpSenderStalledDetector` | `rtp-sender-stalled` | `rtpSenderStalledDetector` | Video in practice — per ssrc, peer connection level; audio has no frame counter |
| Send — RTP sender to the wire (S5) | `DryOutboundTrackDetector` | `dry-outbound-track` | `dryOutboundTrackDetector` | Audio + video, outbound track; **first outbound RTP only** |
| Receive — transport to RTP streams (R1) | `TransportDemuxStalledDetector` | `transport-demux-stalled` | `transportDemuxStalledDetector` | Per ICE transport, peer connection level; **blind on Firefox** |
| Receive — the wire to the track (R2) | `DryInboundTrackDetector` | `dry-inbound-track` | `dryInboundTrackDetector` | Audio + video, inbound track |
| Receive — packets to frames (R3) | `FrameAssemblyStalledDetector` | `frame-assembly-stalled` | `frameAssemblyStalledDetector` | Video only; needs `framesReceived` |
| Receive — frames to decoder (R4) | `DecoderBottleneckDetector` | `decoder-bottleneck` | `decoderBottleneckDetector` | Video only, inbound track |
| Receive — frames to decoder (R4) | `DecoderPerformanceDetector` | `video-decoder-overloaded` | `decoderPerformanceDetector` | Video only; needs a loss reading to proceed |
| Receive — frames to decoder (R4) | `StuckDecoderDetector` | `stuck-decoder` | `stuckDecoderDetector` | Video only; the binary case — nothing decodes at all |
| Receive — decoder to renderer (R5) | `PlayoutDiscrepancyDetector` | `inbound-video-playout-discrepancy` | `playoutDiscrepancyDetector` | Video only; evidence actually spans R4+R5 (see the section) |
| Beside the receive chain — the repair loop | `VideoRecoveryFailedDetector` | `video-recovery-failed` | `videoRecoveryFailedDetector` | Video only, inbound track |
| Across both chains — the machine | `CpuPerformanceDetector` | `cpulimitation` | `cpuPerformanceDetector` | Client monitor singleton; spans every peer connection |

**Each key governs exactly one class** ([design rule
4](./DETECTOR_TAXONOMY.md#4-one-detector-one-config-block)), so passing `null` for
one leaves that detector unregistered and nothing else. Three keys here used to
carry a group and are retired:

- `captureFailureDetector` covered `CaptureSourceLostDetector`,
  `SilentAudioSourceDetector` and the Telemetry `CaptureTrackMutedDetector`; each
  now reads `captureSourceLostDetector`, `silentAudioSourceDetector` and
  `captureTrackMutedDetector`.
- `mediaPipelineDetector` covered both stage-boundary classes; they now read
  `rtpSenderStalledDetector` and `transportDemuxStalledDetector`, each with its own
  `thresholdInMs`.
- `videoRecoveryDetector` covered the repair-loop classes; what remains of that
  group reads `videoRecoveryFailedDetector`.

Turning a whole boundary group off therefore means naming each of its keys. The
name-based route still cannot do it at all: lookup by `name` is exact and the
retired group names are gone, so `disable('media-pipeline-detector')` and
`disable('capture-failure-detector')` return `false` and silence nothing. What each
retired name and key became is listed under
[Renamed and split detectors](./DETECTOR_TAXONOMY.md#renamed-and-split-detectors).

## What every stall clock shares

Eleven of the sixteen classes measure how long a boundary has been broken, and
every one of them accumulates the **monitored object's own `deltaTime`** — the
difference between consecutive stats reports' `timestamp`s — rather than
wall-clock elapsed. `Date.now()` appears only in the issue lifecycle: `raisedAt`,
the `durationInMs` computed at resolution, `resolvedAt`.

This is [design rule 3](./DETECTOR_TAXONOMY.md#3-condition-duration-is-measured-in-stats-time),
and this category is where it earns its keep most obviously, because the
conditions these detectors fire under are precisely the conditions that make
collections run late. A wedged decoder, a saturated encoder and a main thread
too busy to run the collector arrive together. On wall-clock elapsed, the
library's own absence would be counted as evidence for the failure it was absent
during — a tab hidden for a minute would credit a stalled sender with a minute
of stall on evidence nobody observed, and every threshold in the category would
cross at once on the tick the tab came back.

The rule cuts the other way too, and that half matters as much: a collection
that ran late means the boundary was broken for longer than one nominal period,
and `deltaTime` credits it with exactly that. A wedge spanning a nine-second gap
between reports is nine seconds of wedge.

The clocks read the `deltaTime` of the object whose counters are being compared,
never a global one — `mediaSource.deltaTime` for capture,
`outboundRtp.deltaTime` for the sender, `transport.deltaTime` for the demux,
`inboundRtp.deltaTime` for everything on the receive side. That is what keeps
each detector's numerator and denominator on one clock: `sourceFps` was derived
over the media source's interval, so averaging it over anything else would be
comparing two different stretches of time.

**The one deliberate exception is inside `CpuPerformanceDetector`.** Its
`durationOfCollectingStatsInMs` signal is wall clock, because the thing it
measures *is* wall clock: how long the stats collection itself took. A collection
that takes ten seconds is evidence about the main thread no matter what the
stats timestamps say, and measuring it in stats time would be circular.

The five classes that keep no duration at all —
`CaptureSourceLostDetector`, `PlayoutDiscrepancyDetector`,
`DecoderPerformanceDetector`, `EncoderBottleneckDetector` and
`CpuPerformanceDetector` — do so for stated reasons in their own sections: a
terminal track state has nothing to wait for, and the other four use a
consecutive-tick count or hysteresis instead, which is a confidence floor rather
than a persistence bar.

## Send — the source

**Question.** Is the capture device there, and is it producing anything?
**Boundary.** Below the chain rather than on it — this is the input to S1, and
when it fails every boundary above it reports a flat counter with no explanation.

Two classes, both bound to `OutboundTrackMonitor`, each under a key of its own —
`captureSourceLostDetector` and `silentAudioSourceDetector`. They share nothing at
all now: the evidence, the media kind and the lifecycle are different in each, and
switching one off leaves the other running.

### `CaptureSourceLostDetector` — `capture-source-lost`

**What it detects.** The capture device behind an outbound track went away:
`track.readyState` turned `ended`. A webcam unplugged, a Bluetooth headset that
dropped its link, a screen share the user stopped from the browser's own bar, a
virtual camera whose application quit.

**Signals read.** `track.readyState`, and nothing else. This is the one detector
in the category that reads no stats at all, and that is the point: none of these
events leaves a trace in RTP. The `outbound-rtp` entry survives, the counters
simply stop advancing, and every detector above reads a track that has gone
quiet with no way to say why. The track object is the only place the reason is
written down.

**Algorithm and thresholds.** There are none. `readyState === 'ended'` raises on
the tick it is first seen. `ended` is terminal by specification — a track never
comes back from it, the application must acquire a new one — so a duration
threshold would be measuring how long a fact stayed true.

**Raise and resolve.** Raised exactly once per track monitor, guarded by an
internal `_reported` latch, on issue key
`capture-source-lost-track-<trackId>`. **Nothing here ever resolves it**, which
is correct for a terminal condition and is the only issue in this category with
no resolve path. Payload: `peerConnectionId`, `trackId`, `kind` and
`deviceLabel` (the track's `label`). Alongside the issue it emits the
`capture-source-lost` monitor event and, unless `createEvent` is explicitly
`false`, buffers a `CAPTURE_SOURCE_LOST` client event into the sample.

**Stand-downs.** None, deliberately. It is **not** conditioned on the sender
being live or unpaused: a device unplugged during a pause is a fact about the
device, true whether or not anyone was receiving it, and an application about to
resume onto a device that no longer exists is exactly who needs to be told.

**False positives.** Effectively none — `ended` is a browser statement of fact,
not an inference. The failure mode is the opposite one: a track the application
itself stopped reports `ended` identically to one the OS took away, and the
detector cannot separate them.

**What it does not claim.** Why the device went away, or that the call is
broken. A participant who unplugs a webcam on purpose produces this issue, and
that is the correct reading of the evidence.

### `SilentAudioSourceDetector` — `silent-audio-source`

**What it detects.** A microphone that is live, unmuted, enabled, and dutifully
capturing digital silence. The failure is invisible everywhere else in the
stats: the encoder runs, packets flow at the usual rate, the transport is
healthy, and the call is perfect except that nobody can hear this person. It is
the "you're on mute" that muting does not explain — a browser holding the wrong
input device, an OS that handed over a disconnected input, an audio stack that
came back from sleep with a dead capture stream.

**Signals read.** `mediaSource.rmsAudioLevel`, which
`MediaSourceMonitor` derives as `sqrt(deltaTotalAudioEnergy /
deltaSamplesDuration)` — the level integrated over the interval. Deliberately
not the instantaneous `audioLevel`, which reads zero between words and would
make a naive check fire on every pause for breath.

**Algorithm and thresholds with defaults.** Audio tracks only. On each tick
where the source is capturing and `rmsAudioLevel <= silenceRmsThreshold`
(default `0.0001`), the media source's `deltaTime` is added to a silence clock.
Once that clock reaches `silenceThresholdInMs` (default **60000**, one minute)
the issue is raised, once, on key `silent-audio-source-track-<trackId>`.

The minute is not timidity. **A microphone capturing nothing and a person who is
simply not talking are the same measurement**, and only duration separates them.
A threshold in single-digit seconds would file every listener in every meeting
as a broken capture device.

**Raise and resolve.** Any reading strictly above the RMS threshold resolves
with comment `audio detected` and zeroes the clock. Payload at raise:
`peerConnectionId`, `trackId`, `rmsAudioLevel`, `silentForInMs`, `deviceLabel`;
`durationInMs` is added at resolution.

**Stand-downs.** A paused sender resolves with `sender paused`; a track that is
not `live`, or is `muted`, or is not `enabled`, resolves with
`track not capturing`. In all of those, silence is the correct behaviour rather
than a fault — and a mute is worth reporting on its own terms, as a mute, which
the Telemetry `CaptureTrackMutedDetector` does. A tick where `rmsAudioLevel` is
absent entirely returns without touching the clock: an unreported level is not
evidence of sound and not evidence of silence.

**False positives.** A genuinely quiet minute on a live microphone in a very
quiet room. The RMS floor of `0.0001` is low enough that room tone normally
clears it, but a noise-suppression filter aggressive enough to gate room tone
completely will produce this issue on a working microphone.

**What it does not claim.** That the user cannot be heard *now* — it reports
what the source captured over the last minute — and nothing about which of the
several possible causes it is.

## Send — capture to frame supply

**Question.** Is the capture device delivering the frames the track was
configured to capture? **Boundary S1.** Between what the device was asked for
(`track.getSettings().frameRate`) and what it produced
(`mediaSource.sourceFps`).

### `VideoCaptureBottleneckDetector` — `capture-bottleneck`

**What it detects.** A camera degrading in place: a driver struggling, another
application contending for the device, thermal throttling. The track reports
itself `live` and unmuted throughout while the far end's picture turns stuttery.

**Signals read.** `mediaSource.sourceFps` and `mediaSource.deltaTime`; the
`frameRate`, `width` and `height` from the track's own `getSettings()`.
`sourceFps` is the raw frame counter differenced against measured elapsed time,
**never `mediaSource.framesPerSecond`**, which the browser has already smoothed
and which hides exactly the stutter being looked for. It is also deliberately
left `undefined` when the counter went backwards — a replaced track or a
re-acquired device restarts it, and a restart is not a measurement of zero fps.

**Algorithm and thresholds with defaults.** Two running totals, no history.
Frames delivered and the measured time they had to arrive in accumulate until
`durationInMs` (default **15000**) of stats time has accrued; then the average
is compared against the configured `frameRate` using **a threshold and a recovery
threshold**: below `captureFpsRatioThreshold` (default **0.9**) of it raises, and
only a later window at or above `captureFpsRatioRecoveryThreshold` (default
**0.95**) resolves. Either way the totals start over and a fresh window opens.

**Why a pair and not one line.** A camera hovering at the threshold alternates
either side of it, and a single line turns one continuous fault into a stream of
short episodes — each with its own `raisedAt`, its own resolution, its own row in
the sample, its own score recovery. The gap between the two is a dead band: a
finding already open stays open inside it, and a closed one stays closed, so only
a real crossing changes anything. Equal thresholds are legal and simply mean no
hysteresis; a recovery threshold *below* the raise one **throws at
construction**, since it would resolve a camera still failing badly enough to
raise and there is no reading of it worth guessing at.

Averaging over a window rather than thresholding each tick is the whole design.
**A camera that is failing rather than merely busy produces starving intervals
interleaved with healthy ones** — 150 frames in one 5-second tick, then 132,
then 150, then 97 — so tick by tick most of it looks fine and per-tick
thresholding never reaches it, while the average reads well under the configured
rate and raises with the camera still delivering. Averaging also weights how far
the source fell short, not merely how often.

**Raise and resolve.** Raised once per episode on key
`capture-bottleneck-track-<trackId>`, with `VideoCaptureBottleneckIssuePayload` —
fitted to this detector rather than shared with `DecoderBottleneckDetector`, so
everything not marked optional is guaranteed present:

| Field | |
|---|---|
| `sourceFps` | the window average the camera actually delivered |
| `expectedFps` | the configured rate, from `getSettings().frameRate`; always above zero |
| `captureDegradation` | `0..1`, how far the camera fell short — `0` at the threshold, `1` at no frames |
| `averagedOverInMs` | the **measured** window, at least `durationInMs` and usually a little more |
| `capturedFrames` / `expectedFrames` | the counts the two rates were taken from |
| `sourceWidth` / `sourceHeight` | the delivered frame size, when the media source reports one |
| `durationInMs` | filled in at resolution |

`captureDegradation` is the *depth* of the finding, where the issue's existence is
only its *presence* — it is what separates a camera stuttering from one that has
effectively stopped, since both raise `capture-bottleneck` and nothing else tells
them apart. It is measured from `captureFpsRatioThreshold` — the raise line, which is
what defines the finding — rather than from the
configured rate, so it asks the same question at any threshold: a deployment that
raises the threshold is saying it cares about smaller shortfalls, and an absolute
fraction would then report every finding as mild. A camera just over the line
reports near `0`; one delivering nothing reports `1`.

**`trackReadyState` and `trackMuted` are deliberately absent**, having been on the
shared payload. "Live, unmuted, no frames" is still the signature of a camera
degrading in place — but it is a *precondition* of this raise, not evidence
gathered by it: the detector stands down on any track that is not live, unmuted
and enabled, so those two fields could only ever read `"live"` and `false`. They
looked like evidence and carried none.

**Stand-downs.** A backgrounded tab, a paused sender, a track that is not
`live`/unmuted/enabled, and **screen shares**, which are refused outright: a
screen share's frame rate is content-driven, a still document legitimately
delivers almost nothing, and an application capturing a genuinely moving surface
can opt in with `monitor.setOutboundTrackContext(trackId, { contentType:
'camera' })`. A restarted frame counter, a collection gap
(`maxTickGapInMs`, `max(3 × collectingPeriodInMs, 15000)`) or a change in the
capture format all restart the totals rather than counting against the device.
The format change is not detected here: `OutboundTrackMonitor` reads
`getSettings()` once per tick into `captureSettings` and sets
`captureSettingsChanged` when `frameRate`, `width` or `height` moved, and this
detector only acts on the answer — one read and one comparison for every detector
on the track, rather than one each.

Each of those stand-downs also closes the window, and **the first tick after a
stand-down only reopens it without contributing**: that tick's `deltaTime` spans
the stretch that was deliberately not judged — the paused minutes, the
backgrounded minutes — and folding it into the average would blame the camera
for time nobody was watching.

**False positives.** A track whose `getSettings().frameRate` states an
aspiration the device was never going to meet — a `frameRate: 60` constraint on
a 30 fps webcam — produces a permanent `capture-bottleneck`. The detector has no
way to tell an unmet constraint from a degrading device, and does not try.

**What it does not claim.** Anything about the encoder behind the device, which
is S3's boundary; anything about *why* the device fell short.

## Send — processing to encoder input

**Question.** Did everything the application put between the capture callback
and the encoder — constraint downscaling, a canvas pipeline, an insertable-stream
transform, a background-blur or noise-suppression worker — pass frames through
at the rate it received them?

**Nothing watches this boundary, because no browser statistic sits on it.**
`RTCMediaSourceStats.frames` counts what the source produced;
`RTCOutboundRtpStreamStats.framesEncoded` counts what came out of the encoder.
There is no counter in between. A transform that drops every other frame and an
encoder that encodes every other frame are, in `getStats()`, the same two
numbers.

The consequence is stated plainly rather than left implicit: **S2's failures are
attributed to S3**. `encoder-bottleneck` fires when the source delivers and
`framesEncoded` does not keep up, and a slow transform produces exactly that
signature. This is the sharpest instance of the naming debt described under
[Boundary, not component](#boundary-not-component), and the honest reading of an
`encoder-bottleneck` is "something between the capture source and the encoder's
output could not keep up", with the encoder being the most likely but not the
only candidate.

An application that inserts processing and wants this boundary observable has to
instrument it itself; the library cannot, and no threshold tuning changes that.

## Send — frames to encoder

**Question.** Given a capture source that is delivering, is the encoder keeping
up with it? **Boundary S3.** Between `mediaSource.sourceFps` and the highest
active layer's `framesPerSecond` — plus a second reading of the same boundary,
what a frame *cost*.

### `EncoderBottleneckDetector` — `encoder-bottleneck`

**What it detects.** The send-side mirror of `DecoderPerformanceDetector`, and
one quadrant of the four video detectors that split pipeline trouble along two
axes: frames going *missing*, averaged over a duration
(`VideoCaptureBottleneckDetector`, `DecoderBottleneckDetector`), versus a stage
that cannot *keep up*, judged over consecutive ticks (this one and
`DecoderPerformanceDetector`).

The units are not interchangeable and the choice is deliberate. **A duration is
a persistence bar; a tick count is a confidence floor.** Every signal here is a
per-interval ratio that a single stats read can fabricate, so what is wanted is
two independent reads agreeing, whatever the collecting period happens to be.

**Signals read.** `mediaSource.sourceFps`; on the highest active layer,
`framesPerSecond`, `encodeTimePerFrameInMs`,
`qualityLimitationDurationShares.cpu`, `qualityLimitationReason`,
`encoderImplementation` and `powerEfficientEncoder`.

**Algorithm and thresholds with defaults.** Any one of three signals qualifies a
tick:

| Signal | Condition | Default |
|---|---|---|
| Behind | `encodedFps < sourceFps × encodeFpsRatioThreshold` | `0.7` |
| Too slow | `(1000 / sourceFps) × encodeTimeBudgetRatio < encodeTimePerFrameInMs` | `0.8` |
| CPU-limited | `cpuLimitationShareThreshold < qualityLimitationDurationShares.cpu` | **`null` — off** |

Qualifying ticks are counted, and the issue is raised once
`minConsecutiveTicks` (default **2**) of them have run consecutively. Any
non-qualifying tick clears the count and resolves an open issue with
`encoder keeping up again`.

**The CPU signal is off by default and that is the interesting default.**
`CpuPerformanceDetector` already raises `cpulimitation` from the same
`qualityLimitationDurationShares.cpu` reading. Folding it in here as well would
make `encoder-bottleneck` and `cpulimitation` correlate *tautologically* — two
issues that always appear together because they are one measurement reported
twice, which is exactly the thing
[co-firing as independent evidence](#the-neighbours-what-is-below-and-what-is-above)
is supposed not to be. Setting `cpuLimitationShareThreshold` to a number turns
that correlation on knowingly.

**Everything is judged against what the source actually delivered, never the
configured capture rate.** An encoder handed 3 fps and emitting 3 fps is doing
its job perfectly, and comparing that to a configured 30 would call it a
catastrophic failure.

The layer is chosen by `OutboundTrackMonitor.getHighestLayer()`: the single
outbound RTP where there is only one, and otherwise the one with the highest
`bitrate` — which returns nothing at all when several layers are present and
none of them reports a bitrate, standing the detector down rather than picking
arbitrarily.

**Stand-downs.** A backgrounded tab, a paused sender, a track that is not
`live`/unmuted/enabled, no active layer (`getHighestLayer()` absent or
`active === false`), a source delivering nothing (`sourceFps` undefined or
`<= 0`), and — the load-bearing one — **a source that is short of what it
promised**, which resolves with `capture is short; not an encoder problem`. An
encoder handed too few frames has nothing to answer for.

That last stand-down is skipped for screen shares, for the opposite reason to
`VideoCaptureBottleneckDetector`'s refusal of them: a screen share's frame rate
follows the content, so a shortfall against the stated rate is the *normal*
state of a static surface and treating it as a capture problem would excuse the
encoder for the rest of the call. The asymmetry is deliberate — screen shares
never raise `capture-bottleneck` and always remain judgeable for
`encoder-bottleneck`.

**Independence, worked once.** The shortfall test is made here, from the two raw
readings, and deliberately **not** by consulting `VideoCaptureBottleneckDetector`'s
`capture-bottleneck` issue, which is what this class used to do. Reading another
detector's conclusion made the verdict depend on things that have nothing to do
with the encoder in two distinct ways:

- **Disable or reconfigure the capture detector and this one silently stops
  standing down.** `videoCaptureBottleneckDetector: null` leaves
  `VideoCaptureBottleneckDetector` unregistered, no `capture-bottleneck` is ever
  active, and this detector starts blaming the encoder for a starving camera —
  with no error, no warning, and nothing in the issue to indicate it.
- **The answer depended on registration order.** The two only agreed within a
  single tick because `OutboundTrackMonitor` happens to construct the capture
  detector first and `Detectors.update()` runs in insertion order. Reorder the
  two `detectors.add()` calls and the same call produces a different verdict,
  and no test could see it.

What replaced it is `_sourceIsShort()`: compare `mediaSource.sourceFps` against
the `frameRate` in the track's own `getSettings()`, using this detector's own
`encoderBottleneckDetector.sourceSupplyRatioThreshold` (default **0.9**). The two
detectors still reach the same judgement about the source on defaults **because
they read the same two numbers**, and neither the order they run in nor whether
the other one runs at all can change it. A missing or non-positive `frameRate`
answers *no*: nothing was promised, so nothing was fallen short of, and an encoder
is not excused by an expectation never expressed.

The threshold is deliberately **not** `VideoCaptureBottleneckDetector`'s
`captureFpsRatioThreshold`, whose predecessor it used to reach across and read. The
two defaults are equal and the two fields are independently tunable, which is
correct:
the two detectors are asking different questions of the same measurement — *is the
camera failing to deliver what it promised?* against *has the camera fallen short
far enough that the encoder is excused?* — and one shared field meant that raising
the bar for blaming the camera silently widened the range in which the encoder was
let off, with nothing in either detector to say so. Reading a neighbour's block was
the last thread between them ([design rule
4](./DETECTOR_TAXONOMY.md#4-one-detector-one-config-block)).

**False positives.** Everything S2 does, as described above. Also a simulcast
configuration where the highest-bitrate layer is not the one the application
cares about: `getHighestLayer()` picks by bitrate, and a temporarily inverted
bitrate ordering during a reconfiguration picks the wrong layer for a tick or
two — which is part of why `minConsecutiveTicks` exists.

**What it does not claim.** Which encoder, which frame, or that the machine is
overloaded. `encoderImplementation` and `powerEfficientEncoder` ride along in
the payload as evidence for a human, not as part of the verdict.

## Send — encoder to RTP sender

**Question.** Do encoded frames become packets? **Boundary S4.** Between
`deltaFramesEncoded` and `deltaPacketsSent` on the same outbound RTP.

### `RtpSenderStalledDetector` — `rtp-sender-stalled`

**What it detects.** The upstream counter advancing while the downstream one
stays flat: `deltaFramesEncoded > 0` and `deltaPacketsSent === 0` on one ssrc.
**An encoded frame always packetizes**, so a sustained violation of that is a
wedged sender or pacer. It has been seen in the wild after `replaceTrack` races
and simulcast reconfigurations, where the encoder happily keeps running against
a sender that will never transmit again.

This is one of the two classes `MediaPipelineDetector` was split into in 4.9.0,
and it is the cleanest boundary statement in the category: the issue type names
the stage, so a reader learns where the break is from `type` alone rather than
from a `stage` discriminator inside a payload.

**Signals read.** Per outbound RTP: `deltaFramesEncoded`, `deltaPacketsSent`,
`deltaTime`, `active`, and the associated track's `muted` / `readyState`.

**Algorithm and thresholds with defaults.** State is kept **per ssrc**, because
simulcast layers wedge one at a time. On each tick the boundary is either broken
or not; the first broken tick initialises the clock at zero and each subsequent
broken tick adds that outbound RTP's `deltaTime`. Once the clock reaches
`rtpSenderStalledDetector.thresholdInMs` (default **4000**) the issue is raised
once, on key `rtp-sender-stalled-pc-<peerConnectionId>-send-<ssrc>`. Payload:
`peerConnectionId`, `ssrc`, `trackId`, `framesEncodedDelta`, `packetsSentDelta`,
`stalledForMs`, and `durationInMs` at resolution.

**Raise and resolve.** Any tick where the boundary is not broken resolves with
`packets are leaving the rtp sender again`. An ssrc that disappears from the
stats resolves with `outbound rtp is gone` and is dropped from the state map,
rather than leaving an issue open forever.

**Stand-downs.** A closed peer connection. Per ssrc: a missing track, a `muted`
track, a track that is not `live`, or an inactive simulcast layer
(`outboundRtp.active === false`) — a deliberately silenced sender is not a
wedged one.

**Why the innocent explanations cannot produce this signature.** Congestion,
resolution adaptation and a paused sender would all have stopped the *encoder*.
The condition requires `framesEncoded` to be rising, which is what makes silence
on the wire anomalous rather than expected — and it is why this detector needs
no bitrate floors or traffic guards of the kind `TransportDemuxStalledDetector`
carries.

**False positives.** A collecting period short enough that a legitimate pacer
burst spans two reports could show one tick of frames-encoded-with-no-packets;
the 4-second threshold is what absorbs that.

**Coverage, stated honestly.** `framesEncoded` is a video counter. Audio ssrcs
never satisfy `deltaFramesEncoded > 0`, so **this boundary is unwatched for
audio**, and the equivalent audio failure surfaces one stage later as
`dry-outbound-track`.

## Send — RTP sender to the wire

**Question.** Is anything at all going on the wire for this track? **Boundary
S5.** The end of the send chain, where a flat counter means the far end is
receiving nothing regardless of what any upstream stage thinks it is doing.

### `DryOutboundTrackDetector` — `dry-outbound-track`

**What it detects.** Zero bytes sent, tick after tick: this client failing to
put anything on the wire. A stalled encoder, a capture source that quietly
stopped feeding it, a sender that never really started. **It is the one failure
the local user cannot see for themselves**, because their own preview keeps
rendering from the capture stream and looks perfect.

**Signals read.** `deltaBytesSent` and `deltaTime` on the outbound RTP;
`trackMonitor.paused`, `track.muted`, `track.readyState`.

**Algorithm and thresholds with defaults.** Each tick where `deltaBytesSent` is
exactly `0` adds that outbound RTP's `deltaTime` to a dry clock. Once the clock
reaches `dryOutboundTrackDetector.thresholdInMs` (default **5000**) the issue is
raised once per episode, on key `dry-outbound-track-track-<trackId>`, with
payload `trackId` and `duration` (the stats-time length of the dry stretch at
raise); `durationInMs` is added at resolution.

**Raise and resolve.** Anything other than exactly zero bytes — including a
*missing* outbound RTP, since `undefined !== 0` — zeroes the clock and resolves
with `dry outbound track recovered`. That fail-safe is the right default: absent
evidence must not accumulate towards an accusation.

**Stand-downs.** A paused sender, a `muted` track, or a track that is not
`live`, all resolving with `track paused, muted or not live`. In each case the
silence is explained, and an explained silence is not a fault.

**A real limitation, stated.** This detector reads
`getOutboundRtps()?.[0]` — the **first** outbound RTP on the track, in insertion
order, not the highest layer and not all of them. On a simulcast sender with
three layers, only one is watched. If the watched layer is a low-bitrate layer
that keeps trickling while the others die, no issue is raised; if the watched
layer is the one that dies while the others carry the call, the issue is raised
for a track that is being received perfectly. Its neighbour
`RtpSenderStalledDetector` keeps per-ssrc state and does not have this problem.
This is inconsistent, and it is recorded here rather than smoothed over.

**What it does not claim.** Why nothing is leaving. That is what the boundaries
below it are for: read `capture-source-lost`, `capture-bottleneck`,
`encoder-bottleneck` and `rtp-sender-stalled` first — the lowest boundary that
fired is the diagnosis, and `dry-outbound-track` on its own means none of them
could name it.

## Receive — transport to RTP streams

**Question.** Do the bytes arriving on the ICE transport reach an inbound RTP
stream? **Boundary R1.** Between `transport.receivingBitrate` and the summed
`deltaBytesReceived` of every inbound RTP attributed to that transport.

### `TransportDemuxStalledDetector` — `transport-demux-stalled`

**What it detects.** The transport receiving at a media-level rate while every
inbound RTP attributed to it reports zero bytes. Packets are arriving that never
reach a stream — which is what an SSRC mismatch after renegotiation looks like
from inside the browser, or a consumer created against a producer that is
already gone. **It is a boundary worth naming precisely because everything else
looks healthy**: the transport counters keep climbing, ICE is connected, no
quality detector has anything to measure, and the picture is simply never there.

This is the other half of the 4.9.0 `MediaPipelineDetector` split, and the
category's closest classification call — one side of its comparison *is* an ICE
transport. It lands in Pipeline Disruption because the transport is not the
subject: bytes are arriving perfectly well, and the failure is that this
endpoint's receiver does not know what to do with them. The network delivered;
the demux did not. See
[The overlap rule](./DETECTOR_TAXONOMY.md#the-overlap-rule).

**Signals read.** Per ICE transport: `receivingBitrate` and `deltaTime`. Inbound
RTPs come from `IceTransportMonitor.getInboundRtps()`, a plain `transportId`
lookup — so no two detectors can disagree about which stream belongs to which
transport, and none of them holds an opinion about topology. Restoring
`transportId` where a browser omits it happens in the stats adapters, before any
monitor sees the report.

**Algorithm and thresholds with defaults.** State per transport id. The boundary
is broken when *all* of the following hold: at least one inbound RTP is
attributed to the transport; the summed `deltaBytesReceived` across them is
exactly `0`; a `receivingBitrate` was reported; and it is at least
`transportDemuxStalledDetector.minTransportReceiveBitrateBps` (default **20000**). Each
broken tick after the first adds the transport's `deltaTime`; at
`thresholdInMs` (default **4000**) the issue is raised on key
`transport-demux-stalled-pc-<peerConnectionId>-transport-<transportId>`.

**Two guards, each ruling out a different false positive.** The bitrate floor
rules out RTCP and STUN consent explaining the arriving bytes — a transport
receiving a few hundred bps is receiving housekeeping, not media, and calling
that a demux failure would fire on every idle connection. The
at-least-one-inbound-RTP requirement rules out **send-only transports**: the
ordinary shape of an SFU publish transport has nothing to demux into by design,
so there is no expectation to violate. A closed peer connection is not judged
either.

**Raise and resolve.** Any non-broken tick resolves with `inbound rtp is
receiving again`; a transport that disappears resolves with `ice transport is
gone` and is dropped. Payload: `peerConnectionId`, `transportId`,
`demuxedBytesDelta`, `transportReceivingBitrate`, `stalledForMs`, and
`durationInMs` at resolution.

**Blind on Firefox, and it says so.** The upstream half of the comparison is
`transport.receivingBitrate`, which `IceTransportMonitor` derives solely from
`RTCTransportStats.bytesReceived` — and **Firefox still does not populate that
field as of 153**. There the detector is permanently and silently inert: it
cannot tell an SSRC mismatch from a perfectly demuxing call, because it never
learns whether anything arrived.

That is what this detector's public `inputsUnavailable` field is for, and it is one of
the two cases the flag was introduced for. **A detector that stays quiet is
saying one of two completely different things — *nothing is wrong*, or *I could
not see whether anything is wrong* — and from the outside those are identical.**
A dashboard counting issues without counting this flag reads every Firefox
session as healthy on this boundary.

The flag is set on exactly the tick the detector would otherwise have judged: a
transport that has inbound RTP attributed to it, demuxed nothing, and reported
no receiving bitrate. It is aggregated across the transports judged in the tick
— if any one of them went unjudged, the tick's silence is not evidence of health
— and cleared otherwise. **It changes nothing about the verdict**: with no
evidence that bytes arrived, the boundary is not called broken. It only makes
the silence legible. See
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing).

**`suspectedIssueTypes` is gone, and why it had to go.** The predecessor
annotated every `media-pipeline-stalled` payload with the other issue types
active on the peer connection at raise time. It read as helpful — one issue
carrying the context around it — and it was structurally wrong in three ways at
once. It made one detector's output a function of **every other detector's
verdicts**, so disabling an unrelated detector changed this one's payload. It
made the output depend on **the order detectors run in**, since only issues
raised earlier in the same tick were visible. And it duplicated, badly and
locally, work the server is positioned to do properly: correlation needs the
whole session, both endpoints and a time window, and `peerConnectionId` plus a
timestamp gives a server all of that. **Detection is not correlation** — a
detector that asks "has anyone else noticed something?" has stopped detecting.
The field is removed from both split classes' payloads, with no replacement, and
correlating issues belongs to whoever reads them.

## Receive — the wire to the track

**Question.** Is anything arriving on this track at all? **Boundary R2.** The
blunt one: zero bytes received, tick after tick.

### `DryInboundTrackDetector` — `dry-inbound-track`

**What it detects.** Media having stopped arriving — not degraded, not
concealed, but *nothing*. This is "their video is frozen" and "I cannot hear
them" at their most literal, and it catches the transmission failures that leave
every quality detector quiet precisely because nothing is left to measure.

**Signals read.** `inboundRtp.deltaBytesReceived` and `inboundRtp.deltaTime`;
`trackMonitor.paused` and `trackMonitor.remoteOutboundTrackPaused`.

**Algorithm and thresholds with defaults.** Each tick where
`deltaBytesReceived` is exactly `0` adds the inbound RTP's `deltaTime`; at
`dryInboundTrackDetector.thresholdInMs` (default **5000**) the issue is raised
once per episode on key `dry-inbound-track-track-<trackId>`, with payload
`trackId` and `duration`, plus `durationInMs` at resolution. Anything other than
exactly zero — including a missing inbound RTP — resolves with
`dry inbound track recovered`.

**Stand-downs, and the fact that it names which one it saw.** There are two
kinds of deliberate silence and they are different diagnoses, so the resolve
comment distinguishes them: `consumer paused` when *this leg* is paused (a local
opt-out — everyone else may still be receiving the producer fine), and
`remote track paused` when the remote producer is paused (nobody is receiving
it). Either discards the clock and resolves an open issue, because the silence
now has an explanation even though no bytes have flowed.

**Its relationship with `FrameAssemblyStalledDetector` — adjacent, not
overlapping.** These two are next-door boundaries and answer questions that
cannot both be true:

| | `dry-inbound-track` | `frame-assembly-stalled` |
|---|---|---|
| Question | Is anything arriving? | Is what arrives becoming pictures? |
| Requires | `deltaBytesReceived === 0` | `deltaPacketsReceived > 0` |
| Reading | The sender, the SFU or the path stopped | The stream is being delivered and reassembly is failing |

They are **mutually exclusive by construction**, not by suppression: zero bytes
received and packets arriving cannot both hold on the same interval, so neither
needs a guard against the other and neither reads the other's state.
`FrameAssemblyStalledDetector` says so in its own code — "nothing arriving is a
silent sender, not a stalled assembler; that is `DryInboundTrackDetector`'s
question and this detector must not answer it" — which is the boundary
discipline of this whole category in one comment.

**What it does not claim.** Where the media stopped. The far end may have
stopped sending, the SFU may have stopped forwarding, the path may have died.
`dry-inbound-track` is the receive chain reporting that its input is gone, and
which of those it was is a question for the Connectivity and Transport Quality
issues alongside it — or for the far end's own send-chain issues, which only a
server sees.

## Receive — packets to frames

**Question.** Do arriving packets become complete frames? **Boundary R3.**
Between `packetsReceived` and `framesReceived` on the same inbound RTP.

### `FrameAssemblyStalledDetector` — `frame-assembly-stalled`

**New in 4.9.0**, and the class that closed the last unwatched boundary on the
receive side.

**What it detects.** `packetsReceived` keeps advancing and `framesReceived` does
not: RTP is being delivered and no complete picture is being made from it.
Either every frame is missing pieces, or the depacketizer has lost the stream.

**Why the boundary was worth naming.** Before this class existed, this condition
surfaced as `stuck-decoder` — which points at the decoder for something that
happened **before the decoder ever saw a frame**. An engineer reading
`stuck-decoder` reasonably investigates decoding: the codec, the hardware path,
the implementation string. None of that is where the fault is when frames are
not assembling. The issue named the wrong stage, and naming the wrong stage is
worse than naming none, because it spends the reader's time in the wrong place.

`StuckDecoderDetector` had already half-admitted this. Its payload carries a
`variant` discriminator whose `assembly` value means exactly "packets arrive but
no frame is ever reassembled (`framesReceived` flat)" — the condition described
correctly, inside an issue named for a different component. That was the right
instinct filed under the wrong type. **This detector is the other half, stated
directly**, and the variant remains where it is because removing it would change
a public payload for no gain in what is detected.

**Signals read.** `inboundRtp.deltaPacketsReceived`,
`inboundRtp.deltaFramesReceived`, `inboundRtp.deltaTime`. Video only.

**Algorithm and thresholds with defaults.** On each tick with packets arriving
and no frame completed, the packets are added to a running count and the inbound
RTP's `deltaTime` to a stall clock. **Both** bars must be cleared before the
issue is raised: `thresholdInMs` (default **3000**) of stats time *and*
`minPacketsReceived` (default **20**) packets. The packet floor is what
separates a stall from a trickle — twenty packets arriving with no frame out of
them is a stream being delivered and not assembled, whereas three packets is
noise.

**Raise and resolve.** Raised once, on key
`frame-assembly-stalled-track-<trackId>`, with payload `peerConnectionId`,
`trackId`, `ssrc`, `packetsSinceLastFrame`, `stalledForInMs` and `durationInMs`
at resolution. Any tick with `deltaFramesReceived > 0` resets everything and
resolves with `a frame was assembled`.

**Stand-downs.** A paused consumer, a paused remote sender or a backgrounded tab
reset the stall (`not watching this track right now`) rather than counting
towards it. Zero packets arriving resets it too, with `no packets arriving` —
that is `DryInboundTrackDetector`'s question, as above.

**`inputsUnavailable`.** `framesReceived` is the whole point of this detector,
and a browser that does not report it cannot be asked this question at all. A
tick missing either `deltaPacketsReceived` or `deltaFramesReceived` sets the
flag and returns without touching the accumulated state; the flag clears as soon
as both counters are reported again.

**How it and `StuckDecoderDetector` now relate, without depending on each
other.** They will co-fire on a genuine assembly stall, since nothing decoding
is implied by nothing assembling — and neither one knows the other exists.
Neither reads the other's issue, neither is gated on the other being enabled,
and their thresholds are configured under different keys. What separates them is
what each *requires*:

| | `frame-assembly-stalled` | `stuck-decoder` |
|---|---|---|
| Requires | Packets arriving, `deltaFramesReceived === 0` | `deltaFramesDecoded === 0`, `bitrate ≥ minBitrate` |
| Also requires | ≥ 20 packets, ≥ 3 s stats time | ≥ 2 PLIs, ≥ `max(4 s, 15 × RTT)` |
| Claim | Reassembly is producing nothing | Decoding is producing nothing, and repair was asked for |
| Fix it points at | The stream: loss inside every frame, a codec or depacketizer mismatch | Recreating the consumer |

The longer wait and the PLI evidence make `stuck-decoder` the slower of the
two to raise on a shared cause, which is the right ordering: the assembly
statement is the more specific one and should be the one a reader sees first.
Where they split is where the pairing earns its keep — `stuck-decoder` with
`variant: 'decode'` and no `frame-assembly-stalled` is frames assembling and not
decoding, which is a genuinely different fault from frames not assembling at
all.

**What it deliberately does not claim.** *Why* frames are not assembling.
Sustained loss inside every frame and a codec mismatch look identical from here,
and both are real. Attribution is what co-firing with `transport-loss-sustained`
is for, and that comparison belongs to whoever reads the issues, not to this
class.

## Receive — frames to decoder

**Question.** Do assembled frames become decoded pictures? **Boundary R4.**
Between `framesReceived` and `framesDecoded`, read three different ways by three
classes that all stay.

Three classes on one boundary looks like duplication and is not. They differ in
the *shape* of the failure each can see, and each shape has a different fix:

| Class | Failure shape | Evidence | Verdict unit |
|---|---|---|---|
| `DecoderBottleneckDetector` | Graded shortfall, sustained | Decoded fps vs received fps over a window | A ratio over 15 s |
| `DecoderPerformanceDetector` | Decoding is expensive or lossy | Decode time per frame, frames dropped after arrival | Consecutive ticks |
| `StuckDecoderDetector` | Binary wedge | Nothing decodes at all, with RTP still flowing | `max(4 s, 15 × RTT)` and PLIs |

### `DecoderBottleneckDetector` — `decoder-bottleneck`

**What it detects.** The receive-side counterpart of `capture-bottleneck`:
frames arrived and the decoder did not turn enough of them into pictures. The
user sees video that judders or runs behind the audio while the network is
delivering perfectly well.

**Signals read.** `inboundRtp.deltaFramesReceived`,
`inboundRtp.deltaFramesDecoded`, `inboundRtp.deltaTime`; `frameWidth` /
`frameHeight` for the payload.

**Algorithm and thresholds with defaults.** The same two-running-totals shape as
`VideoCaptureBottleneckDetector`, and deliberately so: accumulate received and
decoded frames plus the measured time, and once `durationInMs` (default
**15000**) of stats time has accrued, compare. Decoded below
`decodeFpsRatioThreshold` (default **0.9**) of received raises; at or above
resolves; the window restarts either way.

Averaging over a duration rather than thresholding each tick is what catches a
decoder that **stumbles** rather than one uniformly overloaded: it drops frames
on some intervals and recovers on others, so a per-tick test sees mostly healthy
ticks. The average also weights how far short it fell, not merely how often.

**The bar is the measured arrival rate, never the sender's intent.** Frames that
never arrived are the network's story, told by
[`frozen-video-track`](./PERCEIVED_QUALITY_DETECTORS.md) and the peer
connection's loss reasons — so a stream throttled to 5 fps that decodes cleanly
is silent here.

**Raise and resolve.** Raised once per episode on key
`decoder-bottleneck-track-<trackId>`, updated on every later collection still
past the threshold, and resolved on recovery or on a stand-down. It carries its
own `DecoderBottleneckIssuePayload`: `receivedFpsForDetection` against
`decodedFpsForDetection`, the shortfall between them as `decodeDegradation`, and
the matching `*ForRecovery` fields written at resolution. The shared
`FrameSupplyIssuePayload` it used to borrow is gone — the last argument for it
went with the fitted shape.

**Stand-downs.** A backgrounded tab, a paused consumer, a paused remote sender,
a track that is not `live`/unmuted/enabled, a collection gap, a tick with no
comparable frame counts, and a stream thinner than `minReceivedFps` (default
**5**), which resolves with `stream too thin to judge`. That floor is not a
substituted baseline — the baseline stays the measured arrival rate — it only
refuses a ratio taken over a handful of frames. As with the outbound twin, the
first tick after any stand-down only reopens the window without contributing to
it.

**False positives.** A stream whose arrival is genuinely bursty across a whole
window — a long simulcast layer oscillation, for instance — can average out
below the ratio without the decoder being at fault.

### `DecoderPerformanceDetector` — `video-decoder-overloaded`

**What it detects.** The client failing to decode what it was sent, measured by
what decoding *cost* rather than by how many frames went missing. It exists to
make **network-versus-client attribution possible at all**: frames missing
because they never arrived and frames missing because the machine could not
decode them look identical in a frame-rate chart, and the two have opposite
fixes.

**Signals read.** `deltaFramesReceived`, `deltaFractionLost`,
`decodeTimePerFrameInMs` (derived on the monitor as
`deltaTotalDecodeTime / deltaFramesDecoded`), `dropRatio` (`deltaFramesDropped /
deltaFramesReceived`), `framesPerSecond` falling back to `avgFramesPerSec`, plus
`renderRatio`, `decoderImplementation` and `powerEfficientDecoder` for the
payload.

**Algorithm and thresholds with defaults.** The decoder is only accused once the
frames demonstrably arrived, which takes three gates before any symptom counts:

| Gate | Default | Stand-down comment |
|---|---|---|
| `minFramesReceived` frames in the interval | **10** | `not enough frames to evaluate` |
| A loss reading exists at all | — | `no loss reading; cannot clear the network` |
| Loss at or below `quietLossThreshold` | **0.02** | `loss dominates; not a decoder problem` |

The middle gate is the subtle one and it is right: **an absent measurement
cannot exonerate the network**, so a missing `deltaFractionLost` stands the
detector down rather than letting it proceed on an assumption. Past the gates,
either of two symptoms qualifies a tick — decode time per frame above
`decodeTimeBudgetRatio` (default **0.8**) of the budget the stream's own frame
rate implies (`1000 / fps`: 33 ms at 30 fps, 66 ms at 15 fps), or `dropRatio`
above `dropRatioThreshold` (default **0.1**), frames being thrown away *after*
they had already arrived. `minConsecutiveTicks` (default **2**) qualifying ticks
in a row raise; any non-qualifying tick clears the count and resolves.

**Stand-downs.** A backgrounded tab, where throttled decoding says nothing about
real capability, plus the three gates above. It has no explicit pause check: a
paused consumer or paused remote sender fails the frame-count floor within a
tick or two and stands the detector down that way.

**The overlap with `DecoderBottleneckDetector` is real, deliberate and
kept.** They watch the same R4 boundary and they will co-fire on a badly
overloaded machine. Both stay, because losing either loses a distinction that
changes what an engineer does:

- `decoder-bottleneck` alone: frames are going missing across a sustained
  window, and decoding is not visibly expensive. A supply-side or
  scheduling problem — the decode thread is not getting run — rather than a
  decoder that cannot cope.
- `video-decoder-overloaded` alone: decoding is expensive or lossy on this
  machine right now, without the fifteen-second average having moved yet. The
  earlier and more specific warning, and the one that points at hardware
  acceleration, the codec, or a machine under load.
- Both: the unambiguous case, and the two agreeing from independent evidence is
  worth more than either alone.

The two also read genuinely different inputs — a ratio of two frame counters
over a window, versus decode timing and drops per tick — so their agreement is a
second measurement rather than an echo. Neither reads the other; neither is
gated on the other; their config keys are separate.

**What it does not claim.** That the picture is bad. `frozen-video-track` and
`video-choppy` say that, and both are
[Perceived Quality](./PERCEIVED_QUALITY_DETECTORS.md).

### `StuckDecoderDetector` — `stuck-decoder`

**What it detects.** The wedge: RTP keeps arriving and **no frame ever decodes
again**. A corrupt or incomplete frame breaks the decode chain, PLIs go out and
keyframes may even be produced upstream, yet this consumer never assembles a
usable frame — until the track is recreated. The viewer sees a permanently
frozen tile. It is a per-consumer fault, so another consumer of the same
producer keeps playing normally and only this client can see it.

**Signals read.** `deltaFramesDecoded`, `bitrate`, `deltaBytesReceived`,
`deltaPliCount`, `deltaFramesReceived`, `deltaTime` on the inbound RTP;
`peerConnection.avgRttInSec`. Only RTP deltas, so nothing depends on browser
freeze statistics.

**Algorithm and thresholds with defaults.** Bytes still arriving is exactly what
separates a wedge from a dry track. The wait is
**`max(thresholdInMs, rttMultiplier × RTT)`** — defaults **4000** ms and **15** —
because a wedge never self-heals, so the wait only has to outlast a *legitimate*
PLI → keyframe recovery, whose cost scales with round trip time rather than
being a fixed number of seconds. At least `minPliCount` (default **2**) PLIs
must have gone out in that stretch as well: the browser asking for repair
confirms that it considers itself stuck, which is independent evidence of the
same fact.

**The `variant` discriminator.** Set at raise time from what was observed during
the wedge:

| `variant` | Condition | Reading |
|---|---|---|
| `decode` | Frames were assembled during the stretch | Assembly works, decoding does not — the wedge this issue is named for |
| `assembly` | No frame was ever assembled | The break is upstream of the decoder — `frame-assembly-stalled` is the issue that names it |
| `unknown` | The browser reports no `framesReceived` | No verdict is invented |

**Raise and resolve.** Once per wedge, on key
`stuck-decoder-track-<trackId>`, with `variant`, `stuckForInMs`,
`deadBytesReceived` (the RTP bytes that arrived while nothing decoded),
`pliCountSinceStuck`, `frameWidth`, `frameHeight` and `decoderImplementation`.
Any tick with frames decoding — or with `deltaFramesDecoded` absent, since an
unreported counter is not evidence of a wedge — resets everything and resolves
with `frames decoding`. The `stuck-decoder` **monitor event is the hook for the
application-side mitigation** — recreating the consumer — which is the one place
in this category where an issue names a specific remedy.

**Stand-downs.** A paused consumer, a paused remote sender, or a backgrounded
tab, where suspended decoding with bytes still flowing is expected rather than
broken. Below `minBitrate` (default **10000** bps) it stands down with `rtp not
flowing`, since a dead pipe is starvation and not a wedge — that is
`DryInboundTrackDetector`'s finding. A tick with **no** reported `bitrate` is
evidence of neither, so it holds the accumulated state rather than resetting it;
the distinction between "measured as low" and "not measured" is made
deliberately.

**What it does not claim.** That the far end is at fault. Everything here is
local and per-consumer, which is precisely what makes recreating the track the
right mitigation and what makes the issue useless as evidence about the
producer.

## Receive — decoder to renderer

**Question.** Do decoded pictures get painted? **Boundary R5.** The last
boundary in the chain, and the only one where the browser's own rendering path
is the downstream component.

### `PlayoutDiscrepancyDetector` — `inbound-video-playout-discrepancy`

**What it detects.** Video that arrives perfectly well over the network and
never reaches the screen. The viewer sees a frozen or stuttering tile while
every network statistic reads healthy, which is what makes it worth separating
from loss, jitter or a decoder problem — the frames are here, and the rendering
path is what dropped them.

**Signals read.** `inboundRtp.deltaFramesReceived`,
`inboundRtp.deltaFramesRendered`, and `ewmaFps` for scale in the payload.

**Algorithm and thresholds with defaults.** Per tick, with hysteresis and no
duration clock. `frameSkew = deltaFramesReceived − deltaFramesRendered` and
`skewRatio = frameSkew / deltaFramesReceived`; an episode opens once
`skewRatio` reaches `highSkewRatio` (default **0.25**) and closes only once it
falls below `lowSkewRatio` (default **0.1**). The gap between the two is what
stops a track hovering at the boundary from flapping the issue on and off.

**A ratio rather than a raw count, deliberately.** Five frames of skew is 8% of
a 2-second interval at 30 fps and 3% of a 5-second one, so a raw frame count
would mean a different thing at every collecting period and every frame rate.
`minFramesReceived` (default **10**) is the floor below which the ratio is not
computed at all — a skew of 2 out of 3 frames is noise, not a discrepancy — and
falling below it stands the detector down with `too few frames to judge`.

A tick where **nothing** was painted (`deltaFramesRendered === 0`) is judged like
any other. It is the worst case of the failure being looked for, not a missing
measurement.

**Raise and resolve.** Once per episode on key
`inbound-video-playout-discrepancy-track-<trackId>`, with `trackId`,
`frameSkew`, `skewRatio`, `ewmaFps`, and `durationInMs` at resolution.

**Stand-downs.** A backgrounded tab, where the browser stops rendering by design
and the skew is throttling rather than a fault; a paused consumer; a paused
remote sender. A tick with no `deltaFramesReceived` or no `deltaFramesRendered`
carries no measurement and is skipped without disturbing the current state.

**A boundary imprecision, recorded.** The comparison is `framesReceived` against
`framesRendered`, which spans **decoding as well as painting**: a decoder that
is not decoding produces the same skew as a renderer that is not painting, so
this detector's evidence covers R4 and R5 together rather than R5 alone. The
strict R5 comparison exists and is already computed —
`InboundRtpMonitor.renderRatio` is `deltaFramesRendered / deltaFramesDecoded` —
and nothing thresholds on it; `DecoderPerformanceDetector` carries it in a
payload as context. Tightening this detector onto `renderRatio` would make the
boundary exact, at the cost of missing the case where frames vanish between
assembly and decode without either R4 detector's own bars being cleared. The
current arrangement is the wider net; the imprecision is real and is stated
rather than papered over.

**What it does not claim.** Why the frames were not painted. A hidden or
zero-sized video element, a compositor under load, and a browser bug all look
the same from here.

## Beside the receive chain — the repair loop

Two classes sit beside R3–R5 rather than on any one of them, because what they
watch is not a stage but a **mechanism**: the client sends a picture loss
indication, and a keyframe is supposed to come back. It is Pipeline Disruption
rather than Perceived Quality, and the reason is precise — **it does not say the
picture is bad.** `frozen-video-track` says that. This says the mechanism that
exists to *fix* a bad picture has stopped working (`video-recovery-failed`),
which is a locatable break with a different owner: an SFU operator rather than a
user-facing indicator.

It is configured under `videoRecoveryFailedDetector`.

### `VideoRecoveryFailedDetector` — `video-recovery-failed`

**What it detects.** Keyframes were requested, repeatedly, over a sustained
stretch, and none arrived. A freeze that repairs itself in a second is a lossy
first hop; a freeze where PLI after PLI leaves the client and `keyFramesDecoded`
never moves points **past** the first hop — at forwarding, at a consumer wired to
a producer that is gone, at an encoder on the far side that stopped producing
keyframes. This is the one issue in the category worth waking an SFU operator
for.

**Signals read.** `inboundRtp.deltaPliCount`,
`inboundRtp.deltaKeyFramesDecoded`, `inboundRtp.deltaFramesRendered`,
`inboundRtp.deltaTime`, and `freezeCount` for the payload.

**Independence, worked twice.** The stall condition is derived here from raw
counters — `deltaFramesRendered === 0 && deltaKeyFramesDecoded === 0` — and
deliberately **not** from `inboundRtp.isFreezed`, which is
`FrozenVideoTrackDetector`'s conclusion. The reasoning is the same as
`EncoderBottleneckDetector`'s, arrived at independently on the other side of
the library:

- **A verdict resting on another detector's output dies silently when that
  detector is disabled.** `frozenVideoTrackDetector: null` removes
  `FrozenVideoTrackDetector` entirely, `isFreezed` stops being maintained, and
  this detector would simply never fire again — with nothing anywhere to say
  why.
- **It also inherits that detector's judgement calls.** `isFreezed` is derived
  from `freezeCount` — a browser statistic, not a raw counter — cleared whenever
  the freeze detector itself stands down for a pause or a backgrounded tab, and
  shaped by how that class chooses to keep a persistent freeze alive across
  ticks. None of those choices was made for this question.

And what this detector actually needs is **narrower than "frozen"** anyway:
frames not rendering *and* no keyframe landing is the precise statement that the
repair did not arrive, whereas "frozen" is a broader perceptual claim. The two
detectors are related in subject and independent in mechanism, which is what
lets `frozen-video-track` and `video-recovery-failed` co-firing mean something.

A missing `deltaFramesRendered` counts as **rendering**, not as stalled: a claim
that frames are not arriving needs the counter that says so, not its absence.

**Algorithm and thresholds with defaults.** The clock only starts once a
keyframe has actually been asked for — a stall with no PLI in sight is a real
problem but a *different* one, since nothing was requested and so nothing failed
to come back, and it belongs to the freeze and decoder detectors. The first
stalled tick opens the clock at zero and each one after it adds the inbound
RTP's `deltaTime`; PLIs accumulate from the first.
Both bars must be cleared to raise: `recoveryFailedThresholdInMs` (default
**5000**) of stats time and `recoveryFailedMinPliCount` (default **2**) PLIs, so
the issue's claim — *we asked and nothing came back* — always carries both
halves of its evidence.

**Raise and resolve.** Once, on key `video-recovery-failed-track-<trackId>`,
with `pliCountSinceStalled`, `stalledForInMs`, `freezeCount` and `durationInMs`
at resolution. Any non-stalled tick clears all state and resolves with
`video recovered`.

**Stand-downs.** A backgrounded tab and either end being paused stand the
detector down **for the tick without resetting the counters** — the stall
neither advances nor is forgotten while nobody is watching. This is a deliberate
departure from the reset-on-standdown pattern used elsewhere: the condition being
measured is a property of the stream that a pause does not undo.

**What it does not claim.** Which hop swallowed the repair, or that the far end
is broken. It reports that this client asked and nothing came back.

## Across both chains — the machine

**Question.** Is the client machine, rather than the network, why this call
looks bad?

### `CpuPerformanceDetector` — `cpulimitation`

This is the documented exception in the category, and the one member that
strains the model. Everything else here is filed at a boundary; this one is
filed at a **cause**.

**The tension, stated plainly.** Its evidence is entirely boundary evidence —
the encoder shedding at a quality-limitation share, decoded-versus-received
frames falling, encode time overrunning the per-frame budget, and the stats loop
itself running late. Every one of those is a comparison between two adjacent
counters or between a cost and a budget. But the issue it raises is
`cpulimitation`, which names *why* rather than *where*, and **causes are not
pipeline layers.** A CPU that is saturated shows up at S3 and at R4
simultaneously, which is precisely the shape of a cause rather than a stage.

**Why it is kept here rather than triggering a sixth category.** A "Resource"
category would need exactly one member, and it would immediately become the
place every hard-to-classify detector goes — because "the machine is the reason"
can be argued for a great many findings, and a category whose membership test is
that loose stops constraining anything. The library has one such category-shaped
gravity well already in its history: connectivity layer 6, "media flow", which
existed to hold one detector and was retired in 4.9.0 when the membership tests
were applied honestly and `BlockedTransportDetector` turned out to be Transport
Quality all along.

**One strained member is cheaper than a category that attracts everything hard
to classify.** So it is an explicit cross-boundary member of Pipeline
Disruption, named as such in the grid and in
[the taxonomy](./DETECTOR_TAXONOMY.md#category-3--pipeline-disruption), with the
strain recorded rather than argued away. Its evidence *is* this category's kind
of evidence, its remedy is local rather than a network fix, and the alternative
costs more.

**Binding and state.** A per-`ClientMonitor` singleton — the only class in this
category above peer-connection level — because CPU is a property of the machine
and not of any one connection. It walks `clientMonitor.outboundRtps` and
`clientMonitor.inboundRtps` across every peer connection, and its alert state
lives on `clientMonitor.cpuPerformanceAlertOn`. The issue key is the bare string
`cpulimitation`, with no track or connection suffix.

**Signals read, and their thresholds with defaults.** Five readings — the two
encoder-pressure rows are one signal measured two ways — any of which turns the
alert on:

| Signal | Condition | Default |
|---|---|---|
| Stats loop late | `durationOfCollectingStatsInMs` above the watermark | `highWatermark: 10000` to raise, `lowWatermark: 5000` to stay |
| Browser verdict | `outboundRtp.qualityLimitationReason === 'cpu'` | — (no threshold) |
| Encoder CPU share | `encoderCpuLimitationShareThreshold < qualityLimitationDurationShares.cpu` | `0.3` |
| Encode cost | `(1000 / fps) × encodeTimeBudgetRatio < encodeTimePerFrameInMs` | `0.8` |
| Decode ratio | `min(decoded / received, 1)` at or below `alertOn`, staying below `alertOff` | `alertOn: 0.7`, `alertOff: 0.85` |

The watermark pair and the ratio pair are both **hysteresis, not two
conditions**: which one applies depends on whether the alert is already on, so a
machine sitting on the line cannot flap the issue.

**Why decoded-over-received rather than frame-rate volatility.** The volatility
signal it replaced false-triggered on screen share, whose fps legitimately
swings 15 → 1 when the content goes static. Received and decoded frames fall
*together* there, so the ratio stays near 1.0 and nothing fires.

**The burst guard.** The ratio's own failure mode is a bursty *arrival*: a
simulcast layer switch, a keyframe recovery or a post-stall queue flush dumps
frames into one interval and the decoder trails the spike for a single tick on
an otherwise idle machine. So a smoothed per-ssrc arrival baseline is kept —
EWMA with `alpha = 0.3`, meaning roughly the last five ticks dominate, which
follows a legitimate rate change within a few intervals while a single-tick
spike barely moves it — and any interval whose received count exceeds
`frameArrivalBurstFactor` (default **2.5**) times that baseline is **skipped
rather than judged**. Sustained decoder starvation still alerts, because its low
ratio persists across ticks with ordinary arrival rates. A track with no
baseline yet is skipped too: a fresh consumer routinely starts with a keyframe
burst. The baseline map is rebuilt every tick, **including on ticks another
signal already flagged**, so the guard never compares against a stale average.

**Stand-downs.** A backgrounded tab refuses judgement entirely and resolves any
open alert with `tab in background` — throttled timers and halted rendering
would read as CPU limitation on a wholly idle CPU. Inbound tracks with fewer
than `minReceivedFrames` (default **10**) frames in the interval are skipped
rather than counted either way, which is the screen-share guard in its simplest
form.

**A weakness worth naming.** The payload is `{}` — empty, gaining only
`durationInMs` at resolution. An issue that names a cause and carries none of
the four signals that produced it gives a reader the conclusion without the
evidence, and there is no way from the issue alone to tell an encoder-pressure
`cpulimitation` from a stats-loop-late one. Every other class in this category
ships the comparison it made.

**What it does not claim.** Which process is using the CPU, or that the CPU is
the *only* problem. It is one endpoint's reading of its own machine.

## Issue taxonomy by boundary

| Chain | Boundary | Issue type | Detector | Level |
|---|---|---|---|---|
| Send | the source | `capture-source-lost` | `CaptureSourceLostDetector` | Outbound track |
| Send | the source | `silent-audio-source` | `SilentAudioSourceDetector` | Outbound track |
| Send | S1 capture → frames | `capture-bottleneck` | `VideoCaptureBottleneckDetector` | Outbound track |
| Send | S2 processing | *(unwatched — no stat exists)* | — | — |
| Send | S3 frames → encoder | `encoder-bottleneck` | `EncoderBottleneckDetector` | Outbound track |
| Send | S4 encoder → sender | `rtp-sender-stalled` | `RtpSenderStalledDetector` | Peer connection, per ssrc |
| Send | S5 sender → wire | `dry-outbound-track` | `DryOutboundTrackDetector` | Outbound track |
| Receive | R1 transport → streams | `transport-demux-stalled` | `TransportDemuxStalledDetector` | Peer connection, per transport |
| Receive | R2 wire → track | `dry-inbound-track` | `DryInboundTrackDetector` | Inbound track |
| Receive | R3 packets → frames | `frame-assembly-stalled` | `FrameAssemblyStalledDetector` | Inbound track |
| Receive | R4 frames → decoder | `decoder-bottleneck` | `DecoderBottleneckDetector` | Inbound track |
| Receive | R4 frames → decoder | `video-decoder-overloaded` | `DecoderPerformanceDetector` | Inbound track |
| Receive | R4 frames → decoder | `stuck-decoder` | `StuckDecoderDetector` | Inbound track |
| Receive | R5 decoder → renderer | `inbound-video-playout-discrepancy` | `PlayoutDiscrepancyDetector` | Inbound track |
| Receive | repair loop | `video-recovery-failed` | `VideoRecoveryFailedDetector` | Inbound track |
| Both | the machine | `cpulimitation` | `CpuPerformanceDetector` | Client monitor |

Sixteen classes, sixteen issue types — the class column and the issue column are
the same list read twice, which is what
[one class, one issue type](./DETECTOR_TAXONOMY.md#1-one-detector-class-raises-exactly-one-issue-type)
buys. Every one of them passes the test each issue must pass: *what does an
engineer do differently after seeing this, that they would not do for the issue
next to it?* Read a session by starting at the **lowest boundary in the chain
that fired**, because everything above it is downstream of that break.

`media-pipeline-stalled` is not in this table and has no alias: it became
`rtp-sender-stalled` and `transport-demux-stalled` in 4.9.0, and one type
cannot alias onto two. `blocked-transport` is not here either — it compares what
the senders produce against what the ICE transport puts on the wire, one side of
that disagreement is the network, and by
[the overlap rule](./DETECTOR_TAXONOMY.md#the-overlap-rule) it is Transport
Quality.

## The neighbours: what is below and what is above

**Below: Transport Quality.** Everything in this document is about counters
inside *this endpoint*. Transport Quality is about the path between endpoints,
and the line between them is the overlap rule: if one side of the disagreement
is the network, it is not Pipeline Disruption. `blocked-transport` compares the
senders against the wire and its fix is a network fix, so it is Transport
Quality; `rtp-sender-stalled` compares two counters on either side of the RTP
sender and its fix is local or signaling, so it is here.
`transport-demux-stalled` is the closest call in the library and lands here
because the transport is not the *subject* — bytes arrive perfectly well, and
this endpoint's receiver does not know what to do with them.

**Above: Perceived Quality.** Nothing in this document says the call looks or
sounds bad. This category names a place; Perceived Quality names an experience.
`stuck-decoder` says no frame decodes; `frozen-video-track` says the viewer is
looking at a still picture. `decoder-bottleneck` says frames are going missing
between arrival and decode; `video-choppy` says the frame rate stutters badly
enough to notice.

**Co-firing is independent evidence, never a chain.** The four issue-raising
categories are the order to *read* a failed session in — start at the lowest one
that fired and treat the rest as consequences — and that ordering is a reading
convention, not a mechanism. **No detector in this category reads another
detector's issue, in this category or any other.** Nothing waits for, checks, or
is suppressed by anything else. The two places where a detector genuinely should
stand down on a condition another detector also watches — the capture shortfall
under `EncoderBottleneckDetector`, the stall under
`VideoRecoveryFailedDetector` — both re-derive that condition from the same raw
inputs, at the cost of duplicated lines and for the reasons given in each
section.

The pairings worth reading, and what each split means:

| Together | Reading | Split |
|---|---|---|
| `frozen-video-track` + `stuck-decoder` | The freeze is a local wedge; recreate the consumer | `frozen-video-track` alone: the freeze is real and the break is upstream of anything this endpoint can see |
| `video-choppy` + `decoder-bottleneck` or `video-decoder-overloaded` | The local machine is why the picture stutters | `video-choppy` alone: the sender and the network are still candidates |
| `frame-assembly-stalled` + `transport-loss-sustained` | Loss inside every frame is why nothing assembles | `frame-assembly-stalled` alone: a codec or depacketizer mismatch is the better reading |
| `encoder-bottleneck` + `cpulimitation` | The machine is why the encoder cannot keep up | `encoder-bottleneck` alone: the encoder or the processing above it, on a machine that is otherwise fine |
| `capture-bottleneck` + `dry-outbound-track` | The device degraded and then stopped | `dry-outbound-track` alone: nothing below it could name the cause |

The `encoder-bottleneck` + `cpulimitation` row is the one that depends on a
configuration default staying as it is. Both can read
`qualityLimitationDurationShares.cpu`, and if
`encoderBottleneckDetector.cpuLimitationShareThreshold` is set to a number, the
two stop being independent measurements and start being one measurement reported
twice. It is `null` by default for exactly that reason.

Correlating any of these is the server's job, where the whole session is visible
and `peerConnectionId` plus a time window does the work properly.
[Detection is not correlation](./DETECTOR_TAXONOMY.md#detectors-are-independent):
a detector that asks "has anyone else noticed something?" has stopped detecting.
That is also the whole argument for removing `suspectedIssueTypes`, described
under [R1](#receive--transport-to-rtp-streams).

## What this model deliberately does not do

**No `PipelineState` enum, and no single "where did it break" answer.** An
endpoint runs one send chain per outbound track and one receive chain per
inbound track, all at once and independently; a single current state cannot
represent a client whose camera is fine, whose screen share has stalled, and one
of whose eight inbound tracks is wedged. What the model provides instead is
ordering: the lowest boundary that raised an issue is the diagnosis, and
everything above it is a consequence.

**No graded verdicts.** A pipeline disruption is binary and locatable. "The
encoder is 30% overloaded" is not a finding this category can produce, and every
threshold here exists to answer *did it stop* rather than *how bad is it*. The
graded questions belong to Perceived Quality, whose members are windowed or
hysteretic by construction because users do not perceive ticks. Several
detectors here do compute a ratio — `capture-bottleneck` and
`decoder-bottleneck` against a supply rate,
`inbound-video-playout-discrepancy` against frames received,
`video-decoder-overloaded` against frames dropped — and every one of them uses
it to make a *binary* call about a boundary rather than to report a severity.
The numbers ride along in the payload as evidence; none of them is a grade.

**No cross-endpoint reasoning.** Every counter read here is local. A receive
chain cannot see the far end's send chain, so `dry-inbound-track` cannot say
whether the far end stopped sending or the SFU stopped forwarding, and
`video-recovery-failed` cannot say which hop swallowed the keyframe. Pairing a
receiver's issues with the corresponding sender's is a server-side join on a
session, and the library ships `peerConnectionId`, `trackId` and `ssrc` so that
the join is possible.

**No remedy, with one exception.** These detectors report; they do not act.
`StuckDecoderDetector`'s monitor event is the deliberate exception, because
recreating a consumer is a specific, safe, application-owned action and the
condition under which it is right is exactly what the issue states. Everything
else stops at the finding.

**No detector for what the stats do not carry.** S2 is unwatched because no
counter sits there, and the section on it says so rather than inventing a proxy.
The same discipline governs the rest: where a browser omits a field, the
response is silence with `inputsUnavailable` set, never a guess that downstream
code cannot distinguish from a measurement.

## Observability horizon

Everything above is derived from `getStats()` and the track objects the source
bindings hold, and nothing else. That horizon is what makes some proposals
impossible, and stating it plainly is what keeps the temptation to guess beyond
it from producing unreliable detectors.

**Counters that exist and nothing reads.** Two are worth naming, because they
are the obvious next boundaries and their absence is a choice rather than an
oversight. `OutboundRtpMonitor.deltaFramesSent` is derived on every tick and
consumed by no detector — the `framesEncoded` → `framesSent` sub-boundary inside
S4 is measurable and unwatched. `InboundRtpMonitor.renderRatio`
(`deltaFramesRendered / deltaFramesDecoded`) is the exact R5 comparison and is
only ever carried in a payload; `PlayoutDiscrepancyDetector` uses the wider
`framesReceived`-based skew instead, as its section records.

**Fields whose absence is a permanent blind spot.**
`RTCTransportStats.bytesReceived` is unpopulated on Firefox as of 153, which
makes `TransportDemuxStalledDetector` permanently inert there and is the reason
`inputsUnavailable` exists. `framesReceived` is what
`FrameAssemblyStalledDetector` rests on entirely, and a browser omitting it
cannot be asked that question at all. In both cases the detector sets the flag
and says nothing, which is the only honest response — but a consumer that counts
issues without counting the flag will read those sessions as healthy, and that
misreading is the flag's whole reason for being.

**Kinds that are structurally uncovered.** Nine of the sixteen classes judge
video only — six refusing non-video in `update()`, three registered only on a
video track monitor — and `RtpSenderStalledDetector` is a tenth in effect, since
its condition needs a frame counter that audio does not have. That is not an
omission so much as a consequence of what audio reports: S4's
`framesEncoded > 0, packetsSent === 0` signature cannot exist for audio, and R3,
R4 and R5 have no audio analogue at all. Audio's coverage in this category is
the two dry-track detectors, the capture pair, and whatever `cpulimitation`
catches. An audio equivalent of the receive chain would have to be built on
sample counters
(`totalSamplesReceived`, `concealedSamples`, `jitterBufferEmittedCount`) —
which exist, and which
[Perceived Quality](./PERCEIVED_QUALITY_DETECTORS.md) already reads for a
different question.

**What the horizon rules out entirely.** Which process is consuming the CPU,
what an application's own insertable-stream transform is doing, whether a video
element is visible on screen, what the far end's encoder decided, and whether an
SFU forwarded a keyframe it was asked for. Each of those would make one of the
findings above sharper, and none of them is reachable from `getStats()`. Where a
detector wants one, it says what it cannot claim instead of guessing — which is
why nearly every section here ends with that paragraph.
