# Perceived Quality Detectors — the experience model

This document is the reference for how the library detects **perceived
quality**: the sub-layers of a participant's experience, which detectors own
each one, and what each one is allowed to conclude.

It answers one question: *is what the user sees and hears degraded badly enough
and long enough to matter?* — asked from the participant's chair rather than the
engineer's. Nothing here says where the media chain broke, and nothing here has
to: every counter is advancing, every component agrees, and the call is still
bad.

This is the deep reference for **Category 4** of the library's five detector
categories. The parent map — the other four categories, what puts a detector in
one rather than another, and the rules that keep the boundaries stable — is
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md). The sibling deep references are
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md),
[TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md),
[PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md) and
[TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md). The score system that
consumes some of these conditions — and, as recorded below, still re-derives
several of them independently — is
[SCORE_CALCULATIONS.md](./SCORE_CALCULATIONS.md). For the surrounding API
(listening to issues, the `ClientMonitorIssue` union, enabling and disabling
detectors) see the *Events and Issues* section of the
[README](../README.md#events-and-issues).

- [The sub-layers](#the-sub-layers)
- [The defining distinction: graded and sustained, not binary](#the-defining-distinction-graded-and-sustained-not-binary)
- [What promoting a score reason to a detector changed](#what-promoting-a-score-reason-to-a-detector-changed)
- [Where the arithmetic lives](#where-the-arithmetic-lives)
- [The grid](#the-grid)
- [Visual — clarity](#visual--clarity)
- [Visual — smoothness](#visual--smoothness)
- [Visual — continuity](#visual--continuity)
- [Audio — clarity](#audio--clarity)
- [Audio — continuity](#audio--continuity)
- [Audio — naturalness](#audio--naturalness)
- [Synchronization](#synchronization)
- [Responsiveness](#responsiveness)
- [Issue taxonomy by sub-layer](#issue-taxonomy-by-sub-layer)
- [How this category relates to its neighbours](#how-this-category-relates-to-its-neighbours)
- [What this model deliberately does not do](#what-this-model-deliberately-does-not-do)
- [Observability horizon](#observability-horizon)

## The sub-layers

```
VISUAL    clarity        is the picture drawn with enough detail to read?
          smoothness     does it move at an even, adequate rate?
          continuity     is it moving at all?

AUDIO     clarity        is speech intelligible?            (no detector — deliberately)
          continuity     is the sound whole, or full of holes?
          naturalness    is what comes out of the speaker real audio, or invented?

BOTH      synchronization  do the picture and the voice agree in time?
          responsiveness   can the two people still take turns?
```

**These sub-layers are axes, not a ladder.** That is the first thing to
unlearn on arriving from
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md), where each layer
begins only where the previous one's success is proven and every issue belongs
to the *first* layer whose proof fails. Nothing of the sort applies here. A
picture can be perfectly smooth and unreadably coarse; it can be sharp, steady
and eleven seconds behind the voice; audio can be whole and intelligible while
the conversation is unusable because every turn arrives half a second late.
There is no escalation order to read them in, because none of them is upstream
of another.

What they share is a shape, and it is the shape rather than the subject that
puts a detector in this category: each one watches a **continuously-measured
perceptual value** and reports when it is severely degraded and *stays*
degraded. Every class here is windowed, tick-counted or hysteretic. A single bad
collection is never a perceived-quality problem — users do not perceive ticks.
Until 4.9.0 one class held only the hysteresis half of that promise and had to
be called out here; its replacement, `AVDesyncPlayoutDetector`, holds both — a sustain
window counted in stats time *and* a hysteresis band — so the shape is now
uniform across the category.

Every class binds to an **inbound** monitor, and that is not an accident of the
current tree. Perception happens at the receiver: what the sender's encoder did
is knowable only through what arrived, and a sender-side detector reporting on
the far end's experience would be guessing. The one exception to the binding
level is `AudioPlayoutSynthesisDetector`, which binds to `MediaPlayoutMonitor` —
the playout stage sits after the jitter buffer and is not per-track.

## The defining distinction: graded and sustained, not binary

The boundary with **Pipeline Disruption** is the most confusing one in the
taxonomy, and it is worth drawing precisely, because the two categories
routinely describe the same thirty seconds of the same call.

> Pipeline Disruption asks **"where did progress stop?"** and its answer is
> binary and locatable. Perceived Quality asks **"how bad is it, and for how
> long?"** and its answer is a threshold crossed and held.

A pipeline detector compares two monotonic counters on either side of a named
boundary and reports the boundary: frames encode and no packet leaves; packets
arrive and no frame assembles; RTP flows and no frame ever decodes again. There
is nothing to average, because the finding is an equality with zero. The output
is a stage name to hand an engineer.

A perceived-quality detector has no boundary to name. Everything is running: the
decoder is decoding, the renderer is painting, NetEQ is emitting samples on
schedule. The finding is that the *result* is bad — 0.012 bits per pixel, 6
frames per second, 8% of the last fifteen seconds of audio invented — and the
only thing that turns a number into a finding is a threshold plus time.

**Both can be right about the same call, and neither depends on the other.**
`video-flow-disrupted` and `stuck-decoder` are the standing example.
`StuckDecoderDetector` says RTP is arriving and `framesDecoded` has not moved:
that is a locatable break with a local remedy. `InboundVideoFlowStateDetector` says
the picture the viewer is looking at has stopped: that is the experience, and it
would be equally true if the decoder were healthy and the *sender* had stopped
producing. Seeing both in one session is coherent and useful — one tells you the
user's complaint is real, the other tells you which component to open. Seeing
only the freeze tells you the complaint is real and the cause is somewhere you
have not looked yet.

The rule that makes this work is the library-wide one in
[Detectors are independent](./DETECTOR_TAXONOMY.md#detectors-are-independent):
no detector here reads another's issue, and the co-firing is independent
evidence rather than an echo. `VideoRecoveryFailedDetector` — a Pipeline
Disruption class watching the repair loop around a freeze — deliberately
re-derives "the picture is stuck" from `deltaFramesRendered` and
`deltaKeyFramesDecoded` rather than reading `inboundRtp.isFreezed`, which is
this category's conclusion and disappears entirely when
`inboundVideoFlowStateDetector` is set to `null`.

## What promoting a score reason to a detector changed

Until 4.9.0, three of the conditions in this document existed **only** as score
penalties. `pixelated-video`, `low-fps` and `volatile-fps` were score-reason
keys computed inside `DefaultScoreCalculator`, and that placement decided what could be done with
them: a score reason is a number attached to the current tick's score. It cannot
be raised, cannot be resolved, has no duration, never reaches `activeIssues`,
and is invisible to anything asking "what is wrong with this session right now".
A call that was blocky and juddery for four minutes produced a low score and an
empty issue list.

`PixelatedVideoDetector` and `ChoppyVideoDetector` are those conditions promoted
to first-class findings. What the promotion bought is the whole issue lifecycle:
a `raisedAt`, a `durationInMs` at resolution, a payload carrying the evidence as
it stood when the episode opened, a monitor event an application can act on
live, and a row in the sample that a server can correlate with everything else
that was happening. It also bought a stand-down policy — screen shares, paused
consumers, paused remote producers, backgrounded tabs — which a score penalty
had no way to express beyond one screen-share exemption.

**Through most of 4.9.0's development the score calculator still computed its
own versions in parallel**, and for pixelation the two implementations did not
even measure the same thing — the detector judged `bitPerPixel`, while the
calculator judged `avgQpPerFrame` against a per-codec, per-motion-type band. A
session could carry a `pixelated-video` issue and no `pixelated-video` score
penalty, or the reverse, and both were working as written.

That duplication is gone. The score is now a reading of the open issues and
nothing else, so a condition is judged in exactly one place — here — and the
calculator's own thresholds, ramps and QP tables have been removed with it. What
the calculator still decides is what a finding *costs*, which is a separate
question and lives in one table
(see [Score Calculations](./SCORE_CALCULATIONS.md#tuning)).

The removed QP path is also the concrete illustration of why the detector does
not use QP; see [Visual — clarity](#visual--clarity).

## Where the arithmetic lives

Nearly every value these detectors judge is computed on `InboundRtpMonitor` (or
`MediaPlayoutMonitor`), in `accept()`, on the tick the stats arrive. The one
value derived a level higher, on `InboundTrackMonitor`, is the lip-sync skew,
for the reason given below. The detectors compare and time; none of them
derives.

| Value | How it is derived | Read by |
|---|---|---|
| `bitPerPixel` | `bitrate / (frameWidth * frameHeight * framesPerSecond)` | `PixelatedVideoDetector` |
| `ewmaFps` | `0.9 * previous + 0.1 * framesPerSecond`, seeded with the first reading | `ChoppyVideoDetector` |
| `fpsVolatility` | mean absolute deviation of `lastNFramesPerSec` (≤10 readings) ÷ their mean | `ChoppyVideoDetector` |
| `avgFramesPerSec` | mean of the same ≤10 readings | *(nothing in this category — see below)* |
| `inventedSpeechRatio` | (Δ concealed − Δ silent concealed) ÷ Δ `totalSamplesReceived`, **this interval** | `InventedSpeechDetector` |
| `timeStretchRate` | (Δ inserted + Δ removed) ÷ Δ `totalSamplesReceived` | `JitterBufferStressDetector` |
| `jitterBufferTargetDelayInMs` | Δ `jitterBufferTargetDelay` ÷ Δ `jitterBufferEmittedCount`, ×1000 | `JitterBufferStressDetector` |
| `avgJitterBufferDelayInMs` | Δ `jitterBufferDelay` ÷ Δ `jitterBufferEmittedCount`, ×1000 | `JitterBufferStressDetector` (payload only) |
| `deltaTime` | the two stats reports' `timestamp`s differenced | every duration in this document |
| `linkedVideoPlayoutDiffInMs` | this audio track's `estimatedPlayoutTimestamp` minus its linked video track's — *on `InboundTrackMonitor`, not `InboundRtpMonitor`* | `AVDesyncPlayoutDetector` |
| `captureSettings` / `captureSettingsChanged` | `track.getSettings()` snapshotted per tick, and whether `frameRate`/`width`/`height` moved — *on `OutboundTrackMonitor`* | `VideoCaptureBottleneckDetector`, `EncoderBottleneckDetector` |
| `displayMagnification` | `sqrt(presented area / decoded area)`, unbounded — *on `InboundTrackMonitor`* | `DefaultScoreCalculator` |

The boundary is drawn there on purpose, and
[design rule 2](./DETECTOR_TAXONOMY.md#the-five-design-rules) states it: **a
derived value is a fact about the stream that anything may want; a threshold is
an opinion belonging to whoever is judging.** `bitPerPixel` is true of the
stream whether or not anybody thinks 0.012 is too low. Putting the division on
the monitor means a scoring implementation, a dashboard or an application can
read the same number without a detector in the way, and it is why
`PixelatedVideoDetector` and `ChoppyVideoDetector` are each under a hundred
lines: they hold no window, no ring buffer and no statistics.

Two entries break the pattern, and each does so for a stated reason rather than
by drift.

`isFreezed` runs the other way — `InboundVideoFlowStateDetector` derives the freeze
state and writes it back onto the monitor, because nothing else computes it and
the score needs it. The cost is stated in the detector's own source: disable
`inboundVideoFlowStateDetector` and the field stays `undefined`, so the score quietly
stops penalising freezes.

`linkedVideoPlayoutDiffInMs` sits one level up, on `InboundTrackMonitor` rather
than on `InboundRtpMonitor`, and it has to: it is the only derived value in the
library computed from **two** streams, and neither RTP monitor owns the pair. The
track monitor does — it is where the application's declared pairing lands — so
that is where the subtraction happens, refreshed in `update()` before the
detectors run. The convention itself is unbroken: the monitor still computes the
fact and `AVDesyncPlayoutDetector` still holds only the opinion about how much skew is
too much.

`displayMagnification` sits on `InboundTrackMonitor` for the same reason
`linkedVideoPlayoutDiffInMs` does: it is derived from something no RTP monitor
owns — the `presentedResolution` the application declared, or the `videoTag` the
track re-measures — so the track monitor is the lowest level that has both halves
of the division. It is refreshed in `update()` before the detectors run, and again
inside `setContext()`, since a declared size that only took effect on the next
tick would answer for the previous layout.

The convention holds here too: the monitor computes the **fact** (how magnified
the picture is) and `DefaultScoreCalculator` holds the **opinion** (what a
magnification is worth — ×1.5 blown up, ×0.25 in a thumbnail). Exposing the
magnification rather than a finished weight is what lets a dashboard or a custom
`ScoreCalculator` tier it differently.

No detector in this category derives a value the monitor also computes any more.
The last two both stopped in 4.9.0: `InventedSpeechDetector` used to keep a
numerator and a denominator of its own, because it judged a ratio over a sliding
window and summing per-tick ratios is not the ratio of the sums — integrating a
rate over elapsed time removed that reason, so it reads
`inboundRtp.inventedSpeechRatio` like everything else. The deleted
`AudioDesyncDetector` re-normalized the same two NetEQ counters `timeStretchRate`
is derived from, and that duplication went with the class.

`avgFramesPerSec` is derived and read by nothing in this category
(`DecoderPerformanceDetector`, in Pipeline Disruption, uses it as a fallback);
`ChoppyVideoDetector` uses the EWMA instead. Two smoothings of one signal, one
of them unused here, is worth knowing about before adding a third.

### Duration is stats time

Every sustained-condition clock in this document accumulates the inbound RTP
monitor's `deltaTime` — the gap between the two stats reports a measurement was
derived from — rather than wall-clock elapsed.
[Design rule 3](./DETECTOR_TAXONOMY.md#the-five-design-rules) states the rule;
this category is where it earns most of its keep, because a backgrounded tab, a
throttled timer or a saturated main thread is *itself* one of the things that
makes video look choppy and collections run late.

What it buys, in both directions:

- A tab hidden for a minute has not watched a minute of blocky video. Measured
  against the wall clock, every duration threshold in the category would cross
  at once on the tick the tab comes back, on evidence nobody observed. The specs
  pin this: `PixelatedVideoDetector` and `ChoppyVideoDetector` each have a test
  that advances `Date.now()` by ten minutes with `deltaTime: 0` and asserts that
  nothing is raised.
- A collection that ran late means the condition held *longer* than one nominal
  period, and `deltaTime` credits it with exactly that. The freeze spec's worked
  case is a 2 s tick followed by a 7 s one: `observedSpanInMs` is 9000, not the
  4000 a nominal collecting period would have recorded.
- An absent `deltaTime` contributes zero, not a default. Both video detectors
  use `inboundRtp.deltaTime ?? 0` and are tested for it: a stream whose monitor
  reports no interval never accumulates its way to a threshold.

`Date.now()` survives for the issue lifecycle only — `raisedAt`, the
`durationInMs` computed at resolution, `resolvedAt` — which is why a resolved
issue's `durationInMs` is wall time while its `sustainedForInMs` is stats time.
They can differ, and where they do the difference is the collector's own
lateness.

Two detectors count **collections** instead of milliseconds:
`InboundVideoFlowStateDetector` (`minConsecutiveTicks`) and
`JitterBufferStressDetector` (`minConsecutiveTicks`). That is a confidence floor
rather than a persistence bar — "one noisy stats read cannot open an issue" —
and it is deliberately not the same statement as "this lasted N milliseconds".
It does mean both scale with `collectingPeriodInMs`: two ticks is four seconds
at the default 2000 ms cadence and ten at a 5000 ms one.

## The grid

| Sub-layer | Class | Issue | Config key | Coverage |
|---|---|---|---|---|
| Visual — clarity | `PixelatedVideoDetector` | `pixelated-video` | `pixelatedVideoDetector` | inbound video |
| Visual — smoothness | `ChoppyVideoDetector` | `video-choppy` | `choppyVideoDetector` | inbound video |
| Visual — continuity | `InboundVideoFlowStateDetector` | `video-flow-disrupted` | `inboundVideoFlowStateDetector` | inbound video |
| Audio — clarity | *(none)* | *(none — by design)* | — | **empty, deliberately** |
| Audio — continuity | `InventedSpeechDetector` | `invented-speech` | `inventedSpeechDetector` | inbound audio |
| Audio — naturalness | `AudioPlayoutSynthesisDetector` | `synthesized-audio` | `audioPlayoutSynthesisDetector` | media playout (Chromium only) |
| Synchronization | `AVDesyncPlayoutDetector` | `av-desync` | `avDesyncPlayoutDetector` | inbound audio **paired with a declared video track**, where the browser reports `estimatedPlayoutTimestamp` |
| Responsiveness | `JitterBufferStressDetector` | `audio-jitter-buffer-stress` | `jitterBufferStressDetector` | inbound audio |

**Synchronization is covered, and frequently dark.** Both halves of that are
worth saying. Since 4.9.0 the sub-layer has a detector that measures the thing
it is named after — the offset between the two tracks' playout — rather than
inferring it from repair work, so a `av-desync` issue now means what it says. But
it measures nothing at all unless the application has declared which video track
pairs with the audio track, and unless the browser populates
`estimatedPlayoutTimestamp` (Firefox does, Chrome only when A/V sync is enabled
internally, Safari not at all). On much of a real fleet this detector is
reporting `inputsUnavailable` rather than health, which is exactly why it sets
that flag. Read the two together or read neither.

Seven classes, six issue types. Every class except
`AudioPlayoutSynthesisDetector` binds to `InboundTrackMonitor` and is registered
only for the kind it judges — the video classes are constructed only for video
tracks, the audio classes only for audio ones — so the `kind` guards inside
`update()` are belt and braces for a track whose RTP stream changes kind under
it, not the main filter. `AudioPlayoutSynthesisDetector` binds to
`MediaPlayoutMonitor` and is driven from that monitor's own `accept()`.

Passing `null` for a config key leaves the class unregistered; passing `{}` or
omitting it enables it with the defaults quoted in each section below. One class,
one key, as everywhere ([design rule
4](./DETECTOR_TAXONOMY.md#4-one-detector-one-config-block)) — there is no group to
switch off in one move.

Four of those keys are new in 4.9.0. Two were renamed because the key spelled a
different word from the detector it configures: `videoFreezesDetector` became
`inboundVideoFlowStateDetector`, and `syntheticSamplesDetector` became
`audioPlayoutSynthesisDetector`. The other two followed their classes:
`audioConcealmentDetector` became `inventedSpeechDetector`, and
`audioDesyncDetector` became `avDesyncPlayoutDetector`. Unlike the first two, neither of
those carries any of the old fields, because the detector behind each was
replaced rather than renamed — see [Audio — continuity](#audio--continuity) and
[Synchronization](#synchronization). None of the four is aliased; a config still
using the old spelling fails to type-check, and if it reaches the constructor
anyway the detector runs on its defaults.

The detector `name` strings, which are what `detectors.disable()` /
`enable()` / `getByName()` take, are `pixelated-video-detector`,
`choppy-video-detector`, `inbound-video-flow-state-detector`,
`invented-speech-detector`, `audio-playout-synthesis-detector`,
`av-desync-playout-detector` and `jitter-buffer-stress-detector`. Two of them are new in
4.9.0: `audio-concealment-detector` became `invented-speech-detector` and
`audio-desync-detector` became `av-desync-playout-detector`, in both cases because the
class behind the name was replaced. Like every other retired name neither is
aliased — `disable('audio-desync-detector')` returns `false` rather than silently
governing nothing. See
[retired names](./DETECTOR_TAXONOMY.md#renamed-and-split-detectors).

## Visual — clarity

**Question.** Is the picture being drawn with enough bits to look like the scene
rather than like a mosaic?

### `PixelatedVideoDetector` — `pixelated-video`

**What it detects.** Video the viewer would call blocky or smeared: a picture
being drawn with too few bits for its size, for long enough to be worth
complaining about. Nothing has stalled — frames arrive, decode and render on
time — and the experience is still bad, which is the whole of this category in
one condition.

**Signals.** One value, `inboundRtp.bitPerPixel`, plus `frameWidth`,
`frameHeight` and `framesPerSecond` carried into the payload as context. The
monitor computes it as `bitrate / (frameWidth * frameHeight * framesPerSecond)`
— the interval's bitrate divided by the pixels the interval painted, which is
bits spent on each pixel of each frame. (The config and payload comments call it
"bits per pixel per second"; the arithmetic is the one written here, and the
extra "per second" in the label is a slip rather than a different quantity.)

**Why bits per pixel rather than QP.** The obvious measure of "how coarsely was
this compressed" is the quantizer parameter, and the library has it:
`avgQpPerFrame` is derived on the same monitor as `deltaQpSum /
deltaFramesDecoded`. It is not used here, for a plain reason. `qpSum` is
**optional** in the specification, absent on some codecs and on some
implementations, and its scale differs between codecs — the library's own
QP scale runs to 127 for VP8, 255 for VP9 and AV1, and 51 for H.264 and H.265. A
QP threshold is therefore not a number at all; it is a per-codec table. The score
calculator maintained exactly that table until 4.9.0 (five codecs × three
motion classes) and demonstrated the failure mode: where the codec had no entry,
or where the browser reported no `qpSum`, the whole judgement silently produced
nothing, and nothing distinguished that from a picture that was fine.

`bitPerPixel` is derived from fields every browser reports for video —
`bytesReceived`, `frameWidth`/`frameHeight`, `framesPerSecond` — and means the
same thing everywhere, so one threshold covers every codec including ones that
do not exist yet.

**What that costs, and it is not small.** Bits per pixel is not a perceptual
model. It knows nothing about codec efficiency — AV1 at 0.02 bpp is a very
different picture from VP8 at 0.02 bpp — nothing about content (a static wall
compresses to nearly nothing and looks perfect), and nothing about how large the
picture is on screen. The library *has* the presented size:
`InboundTrackMonitor.presentedResolution`, refreshed every tick from a
`videoTag` the application hands over. No detector reads it; only the score
calculator does. A 180p thumbnail and a full-screen 180p stream are the same
finding here, and only one of them is a complaint.

**Algorithm and thresholds.** Defaults from `ClientMonitor`:

| Key | Default | Meaning |
|---|---|---|
| `threshold` | `0.03` | at or **below** this, the picture counts as coarse |
| `recoveryThreshold` | `0.05` | strictly **above** this, the issue resolves |
| `durationInMs` | `8000` | stats time the picture must stay coarse before raising |

The comparison runs the opposite way round from every transport measure in the
library — low is bad — so the hysteresis band runs *upward* from `threshold` to
`recoveryThreshold`, and a stream sitting inside it keeps whatever state it
already has. The boundaries are exact and specified: `bitPerPixel` equal to
`0.03` counts as coarse (the code returns early only when `threshold <
bitPerPixel`), and `bitPerPixel` equal to `0.05` is still inside the band, so
only `0.051` clears an open issue. The defaults are reasoned from camera video
typically running 0.05–0.2 bits per pixel, with blocking artefacts usually
visible below roughly 0.03.

**Raise.** `_sustainedForInMs`, accumulated from `deltaTime`, reaches
`durationInMs` while `bitPerPixel <= threshold`. At the default 2 s collecting
period that is four consecutive coarse collections. The issue is raised once per
episode; further coarse ticks add nothing.

**Resolve.** `bitPerPixel > recoveryThreshold` (`picture quality recovered`), or
any stand-down below. The resolution payload is the raise payload plus
`durationInMs`.

**Stand-downs.** Consumer paused or remote producer paused (`track paused`);
screen share (`screen share`); a non-video RTP stream, which returns without
touching anything. Each stand-down zeroes the accumulator, so resuming starts a
fresh episode that must earn the full eight seconds again — the spec asserts
exactly that.

**Screen shares are excluded, not re-thresholded.** A static slide legitimately
spends almost nothing per pixel and looks perfect. A second threshold for screen
content would be an opinion about content the library cannot verify, and it
would still be wrong for the slide deck that is mostly a video. `isScreenShare`
comes from `contentType === 'screenshare'`, which for an inbound track the
application declares —
`monitor.setInboundTrackContext(trackId, { contentType: 'screenshare' })` or
`trackMonitor.setContext(...)`. The constructor does try
`track.getSettings().displaySurface` first, but a *received* track normally
exposes no such setting, so in practice an undeclared screen share is judged as
camera video and will raise. That is the category's most likely false positive.

**Backgrounded tabs are not a stand-down here**, unlike its two video
neighbours. That is a real asymmetry: `ChoppyVideoDetector` and
`InboundVideoFlowStateDetector` both check `activeTab` and this class does not. The
defensible reading is that bits per pixel is a property of what arrived and was
decoded rather than of what was painted, so throttled rendering does not
directly distort it; the honest reading is that a hidden tab whose decode
pipeline is being throttled is not a picture anybody is looking at, and the
stand-down would cost nothing.

**`inputsUnavailable`.** Set when `bitPerPixel` is `undefined` — no bitrate, no
frame size or no frame rate this tick — because nothing was observed about
picture quality, which is not the same as the picture being fine. See
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing). One
caveat the code does not handle: `bitPerPixel` is only recomputed on ticks where
`framesPerSecond` is truthy and never reset to `undefined`, so a stream that
stops reporting a frame rate keeps its last computed value, and the flag stays
`false` while the detector judges a stale number.

**What it deliberately does not claim.** Not *why* the picture is coarse — a
congested uplink, a sender-side encoder bottleneck, an SFU handing down a low
simulcast layer and a deliberately low-bitrate stream all look identical from
here. Not that the viewer minds: a small window, high motion or an efficient
codec can all make 0.02 bpp perfectly acceptable. And not a severity: the
payload carries the measurement and the span, and leaves the ranking to whoever
has the rest of the session.

## Visual — smoothness

**Question.** Does the picture move at a rate that reads as motion, and does it
move *evenly*?

### Why there is no `ChoppyVideoDetector`

A low or erratic frame rate is not a detector of its own any more. It is the
`choppy` state of `InboundVideoFlowStateDetector`, described under
[`video-flow-disrupted`](#inboundvideoflowstatedetector--video-flow-disrupted)
below.

The merge was the right cut. Both halves — a steady 8fps that is smooth-but-slow,
and 25fps swinging between 5 and 40 that is fast-but-lurching — are the same
complaint from the viewer ("it's juddery"), and they sit on a continuum with a
full freeze rather than beside it. Two issue types on one episode was noise: an
operator reading a failed session had to know that `video-choppy` and
`video-flow-disrupted` were the same subject at two depths. One type with a `state`
of `frozen` or `choppy` says it once.

`InboundRtpMonitor.ewmaFps` and `fpsVolatility` are still derived and published
for anyone who wants to trend them; nothing thresholds them on their own.

## Visual — continuity

**Question.** Is the picture moving at all?

### `InboundVideoFlowStateDetector` — `video-flow-disrupted`

**What it detects.** An inbound video track whose picture has stopped moving —
the freeze the person watching actually sees, with no claim about why.

**Signals.** `inboundRtp.freezeCount` (cumulative freeze *starts*),
`deltaFramesRendered`, `deltaTotalFreezesDuration` and `deltaTime`. It publishes
its own conclusion back as `inboundRtp.isFreezed`.

**Algorithm.** A freeze starts when `freezeCount` advances, and persists while
nothing renders:

```
frozen = 0 < newFreezes || (wasFrozen && deltaFramesRendered === 0)
```

The second clause is load-bearing by design: `freezeCount` counts freeze
*starts*, so its delta alone would declare a persistent freeze over after a
single tick. The state is derived on the first frozen tick — so the score
reflects it immediately — while the **issue** waits for `minConsecutiveTicks`
(default `2`) consecutive frozen observations. The counters are cumulative, so
one interval can say a freeze happened but never how long it lasted, and
`freezeCount` advances on any inter-frame gap past roughly
`max(3 × average, average + 150 ms)` — a sub-second hiccup nobody notices.
Surviving into a second observation is what separates that from a freeze worth
reporting.

**A gap that has to be recorded here rather than glossed.** All three stats
adapters in the tree document `inbound-rtp.framesRendered` as *never emitted* —
Chromium, Firefox and WebKit alike. `positiveDelta` returns `undefined` when
either side is missing, so on every browser the library ships an adapter for,
`deltaFramesRendered === 0` is false and the persistence clause cannot engage.
What remains is `0 < newFreezes`: the detector effectively requires
`freezeCount` to advance in each of `minConsecutiveTicks` consecutive
collections. Repeated freezing raises exactly as intended. A **single continuous
freeze**, which increments the counter once and then holds, does not — the
second tick sees no new freeze start, `frozen` goes false, and the episode ends
before it is confirmed. This is recorded as a defect, not documented as
behaviour; the fix is a persistence signal that exists on real browsers
(`deltaFramesDecoded`, or `deltaTotalFreezesDuration` continuing to accrue)
rather than one that does not. `VideoRecoveryFailedDetector` reads the same
field and shows what handling it looks like: it states in its own source that a
missing `deltaFramesRendered` counts as *rendering*, so the absence makes it
quieter rather than differently wrong.

**Raise.** Two consecutive frozen ticks, at which point the payload carries
`trackId` (the browser's `trackIdentifier`, `undefined` included rather than
substituted), `frozenTicks`, `observedSpanInMs` and `freezeTimeInMs`.

The last two are the part a local threshold cannot supply, and they are why the
payload is worth reading rather than counting. `observedSpanInMs` is the stats
time the frozen ticks actually spanned — `deltaTime` accumulated, not the
nominal collecting period — and `freezeTimeInMs` is the freeze time accrued over
that span, from `totalFreezesDuration` in seconds converted to milliseconds. A
server can then judge severity as a *frozen share of a measured window* even
when a collection ran late: the spec's worked case is a 2 s tick and a 7 s tick
reporting `observedSpanInMs: 9000` and `freezeTimeInMs: 8300`. `freezeTimeInMs`
is `undefined` where the browser reports no `totalFreezesDuration`, which is the
only honest answer — without it there is no way to know how much of the span was
frozen rather than merely that a freeze happened in it.

**Resolve.** Frames render again (`video freeze ended`), or a stand-down.

**Stand-downs.** Tab in the background (`tab in background`), consumer paused
(`consumer paused`), remote producer paused (`remote track paused`). All three
route through `_standDown()`, which does something the other classes do not:
it **swallows the monotonic counter** — `_lastFreezeCount` is set to whatever
the counter now reads — rather than skipping the tick. Without that, a tab
hidden for a minute would come back with `freezeCount` twenty higher and the
detector would replay a minute of browser throttling as a burst of freezes. A
throttled tab does not render, and its freeze accounting is the browser's doing,
not a media problem.

**What it deliberately does not claim.** Not the cause, and specifically not the
state of the repair loop around the freeze. Keyframes requested repeatedly with
none arriving (`video-recovery-failed`) is a different question with a
different audience — an SFU operator rather than a user-facing indicator — and
it lives in Pipeline Disruption, deriving its own condition from the same
raw counters rather than from this detector's verdict.

## Audio — clarity

**This sub-layer is empty, and the emptiness is a decision.**

Clarity for audio would mean intelligibility: can the listener make out the
words? That is the question users actually ask, it is the one MOS-style
estimators claim to answer, and **no client-side signal supports it.** The stats
report how much audio was concealed, how much was stretched, how deep the buffer
ran and how loud the signal was. None of those is a statement about
intelligibility, and the mapping from any of them to "could you understand it"
depends on the speaker, the language, the codec, the listener and the room.

Inventing a detector here was considered and rejected. The two candidate routes
both fail on the same ground:

- **A concealment-derived intelligibility score.** Concealment is *continuity* —
  the sound had holes, and NetEQ papered over them — and it is already owned,
  one sub-layer down as `invented-speech`. Recomputing
  it with a different threshold and calling the result clarity would be one
  condition wearing two names, which is exactly what the
  [known deviations](./DETECTOR_TAXONOMY.md#known-deviations) list exists to
  discourage.
- **A published MOS model (E-model and its relatives).** These are calibrated
  for fixed-rate telephony codecs over networks with stationary loss. Applied to
  Opus with in-band FEC, DTX and NetEQ adapting continuously, they produce a
  number with a decimal point and no defensible relationship to what anyone
  heard. A number nobody can verify is worse than an acknowledged gap, because
  it will be trended, alerted on and believed. The tree still carries an
  E-model helper from an earlier attempt — `calculateLatencyMOS` in
  `src/scores/CalculatedScore.ts`, taking jitter, RTT and loss — and it is
  called from nowhere. That is the right amount of use for it.

So the row in [the grid](#the-grid) reads *empty, deliberately*. If a signal
appears that genuinely measures intelligibility at the client, this is where it
goes.

## Audio — continuity

**Question.** Is the sound whole, or is the listener hearing holes in it?

### `InventedSpeechDetector` — `invented-speech`

**What it detects.** A listener being fed audio the sender never sent, for long
enough to be the thing behind a "they were breaking up" complaint. When packets
are missing or late NetEQ does not fall silent; it fabricates audio from what
came before so playout never stops. That is usually the right trade and usually
inaudible, which is exactly why packet loss is a poor proxy for how a call
sounded: Opus and NetEQ hide a great deal of loss perfectly, and audio falls
apart without dramatic loss when the jitter buffer misbehaves. What the listener
hears is the fabrication, so that is what this measures — and why this and
`transport-loss-sustained` are different findings rather than two readings of
one.

**Signals.** `inboundRtp.inventedSpeechRatio`, and `deltaTime` to integrate it
over. The ratio is `undefined` when the browser reports no concealment counters
or when no samples arrived this interval, and the detector treats that as an
abstention rather than as zero.

**Only audible invention counts.** `concealedSamples` climbs through ordinary
silence too — NetEQ has nothing to reproduce and the fabrication comes out as
silence or comfort noise nobody could distinguish from the real thing — so
`silentConcealedSamples` is subtracted on the monitor before the ratio is
formed:

```
inventedSpeechRatio = max(0, ΔconcealedSamples − ΔsilentConcealedSamples)
                      ÷ ΔtotalSamplesReceived
```

That subtraction is what keeps every quiet moment of every call from reading as
a fault, and the spec pins it: 5000 concealed samples of which 5000 are silent
move nothing.

**The accumulator.** One number, in milliseconds, is the whole of the detector's
state. Each tick contributes `inventedSpeechRatio × deltaTime` milliseconds of
invention and is credited `allowedInventedRatio × deltaTime` of tolerance; the
difference moves the accumulator, clamped between zero and
`raiseAfterInventedMs`. Above the allowance it fills, below it drains.

| Key | Default | Meaning |
|---|---|---|
| `allowedInventedRatio` | `0.05` | share of audio that may be invented without counting against the stream — and, being the same number, the rate at which the accumulator drains |
| `raiseAfterInventedMs` | `400` | invented milliseconds *beyond* the allowance that must accumulate before the issue is raised |

At the defaults that is 0.4 s of excess invention to open — two seconds of audio
at 25% invented, or two collections at 20% — and, because the allowance is also
the drain rate, `raiseAfterInventedMs / allowedInventedRatio` = 8 s of clean
audio to close. The 5% comes from RFC 7294, which calls a second with more than
5% concealment severely concealed.

**It does not care how often you poll.** This is the property the design exists
for, and the reason the class was rewritten in 4.9.0. The previous
implementation classified each tick as bad or good against a threshold and then
judged a ratio over a 15 s sliding window, which meant a bad second inside a
five-second collection was averaged down by five and the detector's sensitivity
moved with `collectingPeriodInMs`. Integrating a rate over elapsed time has no
such artefact: the same audio produces the same accumulator trajectory at any
collection period. The spec drives it directly — 4000 ms at 12.5% invented
delivered as one tick and as two lands on the same accumulator, and the same
finishing tick tips both over at the same moment.

**Brief pauses do not end an episode.** The second property, and the other half
of the point. A clean tick drains only the allowance, so at the defaults a
two-second gap costs a quarter of a full accumulator. Someone who breaks up,
pauses for breath and breaks up again keeps accumulating rather than starting
over, while genuinely recovered audio still closes the issue after about eight
seconds. A long silence does drain it to empty and resolve — which is right,
since there is no ongoing problem to report while nobody is speaking, and it
reopens within seconds if they resume badly.

**Raise.** The accumulator reaches `raiseAfterInventedMs`. Payload:
`peerConnectionId`, `trackId`, `inventedSpeechRatio` (the tick's own ratio, at
the moment the issue was raised) and `excessInventedMs` (the accumulator, so a
full `raiseAfterInventedMs`). The monitor event `invented-speech` carries the
track monitor and the ratio.

**Resolve.** The accumulator reaches zero (`audio recovered`), or a stand-down.

**Stand-downs.** Consumer paused (`consumer paused`) and remote producer paused
(`remote track paused`), both of which **discard the accumulator** rather than
draining it — nothing is being sent, so there is nothing to invent, and a paused
stretch must not leak into the next episode. That is the one case where the
continuity property is deliberately switched off.

**When the inputs are missing** the detector sets `inputsUnavailable` and
abstains, leaving the accumulator where it was. A browser that omits
`silentConcealedSamples` therefore reads as "I could not see whether anything is
wrong" rather than as a healthy stream — see
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing).

**What the accumulator cannot tell you** is the shape of what filled it. One
second at 25% invented and five seconds at 5% are both 200 ms of excess, and the
detector cannot distinguish them; a listener probably could. That is the price
of poll-independence, and it is the right trade for a finding with raise and
resolve semantics rather than a severity number. Note also that resolving takes
8 s of *stats time* at the defaults, so a `collectingPeriodInMs` longer than that
would let a single clean tick drain a full accumulator in one step — the one
configuration in which the continuity property quietly stops working.

**False positives.** Invention measures the *receiver's* repair work, so a
listener whose own machine is starved of CPU produces the same signal as a bad
network. Music and other non-speech audio conceals differently from speech, and
the allowance is speech-derived.

**What it deliberately does not claim.** Not intelligibility, which is
[the empty sub-layer above](#audio--clarity). Not loss: the packets that never
arrived are `transport-loss-sustained`'s subject, and the two co-fire or not
independently — heavy loss with inaudible concealment is Opus working, and
audible invention with no loss is the jitter buffer failing to hold a stream
together. And not RFC 7294's per-second classifier, which it does not claim to
be: it keeps the RFC's 5% meaning the same thing — the share of audio that was
invented — but applies it as a sustained rate rather than a per-second verdict,
because a cumulative counter sampled every few seconds cannot see inside a tick.

## Audio — naturalness

**Question.** Is what comes out of the speaker real audio, or audio the browser
invented?

### `AudioPlayoutSynthesisDetector` — `synthesized-audio`

**What it detects.** Concealment audio the browser generated because the jitter
buffer had nothing real left to play: robotic, warbling or stretched speech. The
signal is worth watching precisely because nothing upstream reports it as a
failure — concealment is the audio stack *succeeding* at keeping playback
continuous, so packet-level statistics can look unremarkable while the listener
hears something wrong.

**Signals.** `MediaPlayoutMonitor.deltaSynthesizedSamplesDuration`, differenced
from `RTCAudioPlayoutStats.synthesizedSamplesDuration`. The detector binds to
the playout monitor rather than to a track, because playout sits after the
jitter buffer and is not per-track.

**Algorithm.** One comparison, no state:

| Key | Default | Meaning |
|---|---|---|
| `minSynthesizedSamplesDuration` | `0` | strictly above this, report |
| `createEvent` | `true` | also add the `EXCESSIVE_SYNTHESIZED_AUDIO` client event |

It emits the `synthesized-audio` monitor event and, unless `createEvent` is
`false`, adds an `EXCESSIVE_SYNTHESIZED_AUDIO` client event carrying the
interval's `deltaSynthesizedSamplesDuration`. With the shipped default of `0`
that means it reports on **every tick that synthesized anything at all**, so a
consumer wanting only materially degraded audio should raise the threshold or
aggregate downstream.

Anyone doing that should know the unit is not what the config says. The config
documents `minSynthesizedSamplesDuration` as "the minimum duration (in
milliseconds)", while `synthesizedSamplesDuration` is specified in **seconds**
and nothing between the stats and the comparison converts it. The shipped `0`
makes the two readings identical, which is why the discrepancy has survived; a
threshold of `50` means fifty seconds of synthesized audio in one interval, not
fifty milliseconds.

**It raises `synthesized-audio` once the invented share crosses
`synthesizedRatioThreshold`.** A share of what was played rather than a duration
per collection, which is what the earlier `minSynthesizedSamplesDuration: 0` got
wrong: it reported on every tick that concealed anything at all, and its unit was
seconds while the config documented milliseconds.

It is priced alongside `invented-speech` rather than on top of it. The two are
the same fault seen from two places — the stream that concealed, and the playout
device that invented — so the pair is weighted so one episode is not charged
twice.

**Why it has not been.** Two reasons, and only one of them is about this
library.

The W3C statistics specification marks `RTCAudioPlayoutStats` as a **feature at
risk due to lack of consensus** — the working group's own statement that the
shape of these fields is not settled. Building a raise/resolve lifecycle,
thresholds and a public issue type on a stats object that may be renamed,
respecified or dropped means committing a contract the library cannot keep.

The second reason is measurable in this tree: `media-playout` reports do not
exist on Firefox or WebKit, both adapters say so explicitly, and neither
substitutes a guess. So the detector runs on Chromium and is silent everywhere
else — not because those calls sound better, but because nothing measured them.
Promoting it to an issue would put a Chromium-only condition in `activeIssues`,
where a fleet-wide dashboard would read its absence on Safari as health.

Promoting it **is** a recorded intention, held back by exactly that. If the
playout stats stabilise and spread, this sub-layer gets its issue and this
paragraph becomes history.

**What it deliberately does not claim.** Not how bad it sounded — the duration
of synthesized audio is not a perceptual scale — and, being stateless, not that
anything is ongoing. Two consecutive reports are two facts, not an episode.

## Synchronization

**Question.** Do the picture and the voice still agree about when things
happened?

### `AVDesyncPlayoutDetector` — `av-desync`

**What it detects.** Lip sync: one participant's voice and their lips playing
out at measurably different points in that participant's own timeline. A viewer
describes it as dubbing — the mouth finishes and the word arrives, or the word
arrives and the mouth catches up.

**This is the only detector in the library that compares two streams.** Every
other class in every category judges one object against a threshold: this track's
bit rate, this transport's loss, this buffer's depth. Synchronization is not a
property of a track at all. An audio track playing 200 ms of the sender's
timeline behind the wall clock is perfectly fine if the video is 200 ms behind
too, and badly broken if the video is current. There is no reading of the audio
track alone, however detailed, that contains the answer — which is why this
detector needs a second track, and why everything awkward about it follows from
that.

**Signals.** `inboundRtp.estimatedPlayoutTimestamp` on each of the two tracks,
subtracted:

```
linkedVideoPlayoutDiffInMs = audio.estimatedPlayoutTimestamp
                           − video.estimatedPlayoutTimestamp
```

Positive means audio is **ahead** — playing content from later in the sender's
timeline than the picture is showing. The subtraction lives on
`InboundTrackMonitor` and is refreshed in `update()` before the detectors run, so
the detector compares a number with a threshold and nothing more; see
[Where the arithmetic lives](#where-the-arithmetic-lives).

**Why the two values subtract directly.** This is the part worth being precise
about, because it looks too easy. `estimatedPlayoutTimestamp` is not a local
clock reading: the specification defines it as the **sender's NTP clock time** of
the last playable sample or frame, which the receiver obtains by resolving the
stream's RTP timestamps through the RTP-to-NTP mapping carried in that sender's
RTCP sender reports. Both tracks come from the same sender, so both values are
already expressed on the same clock, and their difference is the skew in
milliseconds. No third quantity relates them — no local capture time, no
round-trip estimate, no offset correction. The specification defines the field
for exactly this comparison and writes the subtraction out.

**Which video track, and why the library will not guess.** The pairing is the
application's to declare, through the inbound track context:

```ts
monitor.setInboundTrackContext(audioTrack.id, { linkedVideoTrackId: videoTrack.id });
```

The library cannot work it out for itself. An SFU forwards each participant's
audio and video as independent streams with no signalled relationship between
them; `MediaStream` grouping does not survive every topology and is not present
at all in some; and `trackIdentifier` says which track, never whose. The
alternatives to declaring it are worse than the burden: pairing by arrival order
is wrong the moment a participant joins mid-call, and pairing by "the only video
track" is wrong in any call with more than two people. A wrong pairing does not
fail loudly — it produces a confidently wrong number, one that looks exactly like
a measurement. So until the application declares the pair, this detector measures
nothing and says so through `inputsUnavailable`.

`getLinkedVideoTrack()` resolves the declared id against the peer connection's
inbound tracks and returns `undefined` three ways: nothing declared, the declared
track not present here, or the declared track present but **not video**. The last
of those matters because two audio tracks' playout timestamps subtract into a
perfectly plausible number that means nothing.

**The two directions are not symmetric, and that is the whole tuning.** Sound
arrives after light everywhere in the physical world — a metre of distance is
three milliseconds of delay, and a listener has spent a lifetime compensating.
Audio *leading* the picture has no natural analogue, so a viewer detects and
dislikes it far sooner. ITU-R BT.1359-1, the ITU's recommendation on relative
audio and video timing, puts the numbers at roughly +45 ms ahead for
detectability and +90 ms for unacceptability, against −125 ms and −185 ms behind
— a tolerance band about twice as wide in the lagging direction.

| Key | Default | Meaning |
|---|---|---|
| `audioAheadRaiseInMs` | `90` | audio ahead by at least this raises |
| `audioAheadResolveInMs` | `45` | audio ahead by less than this resolves |
| `audioBehindRaiseInMs` | `185` | audio behind by at least this magnitude raises |
| `audioBehindResolveInMs` | `125` | audio behind by less than this magnitude resolves |
| `sustainForInMs` | `3000` | stats time past a raise threshold before the issue opens |

The behind values are magnitudes, compared against `Math.abs(diff)`; the sign of
the difference selects which pair applies and which `direction` the payload
reports (`audio-ahead` or `audio-behind`).

Thresholding the absolute skew against a single number would be either too strict
on lag or too lax on lead — at ±150 ms it would have to call both objectionable
or neither, when in fact +150 ms is a complaint and −150 ms is ordinary. The spec
suite pins that case explicitly, because it is the one a later simplification
back to one threshold would break.

**Between resolve and raise, nothing changes.** An open issue stays open and a
closed one stays closed. That band is what stops a call sitting on the limit from
flapping, and it works in both directions independently.

**Duration comes from the stats.** `sustainForInMs` accumulates
`inboundRtp.deltaTime` while the skew is past the raise threshold, and the
accumulator is discarded — not drained — the moment the skew falls back inside
the resolve threshold, the inputs go missing, or the track pauses. Three seconds
is a deliberately long window for a value that can move sharply: the playout
timestamp is extrapolated between RTCP sender reports, which arrive on the order
of every five seconds, so the first readings after a track starts can swing while
the RTP-to-NTP mapping settles.

**Raise.** The first tick where the sustain window is met with a linked video
track resolvable. Payload: `peerConnectionId`, `trackId`, `linkedVideoTrackId`,
`playoutDiffInMs` (signed), `direction`, `sustainedForInMs`. The monitor event is
`av-desync`, carrying the same skew, direction and linked track id. Both fire
exactly once per episode, gated on the state transition rather than on the
condition.

**Resolve.** The skew falls inside the resolve threshold for its direction
(`tracks back in sync`), or a stand-down (`track paused`). The resolved payload
carries `durationInMs` — wall time, as everywhere.

**Stand-downs.** Consumer paused or remote producer paused: nothing is playing
out on one side or the other, so there is no relationship to measure.

**`inputsUnavailable`, and it is the common case.** The flag is set on any tick
where the skew could not be computed: no pairing declared, the linked track
missing or not video, or either `estimatedPlayoutTimestamp` absent. That last one
is not an edge case. `estimatedPlayoutTimestamp` is thinly implemented — Firefox
populates it, Chrome declares it but only when A/V sync is enabled internally,
Safari does not report it at all — so on a mixed fleet this detector spends much
of its time saying it cannot see. Which is the point of the flag: a dashboard
must be able to tell "these calls were in sync" from "we never measured these
calls", and counting the absence of `av-desync` issues as health would silently
do the second.

**What it deliberately does not claim.** Not that the viewer noticed — 90 ms is
where an attentive viewer *can* detect a lead, not where an average one
complains. Not which side drifted: the difference is signed, but nothing here
attributes it to the sender's capture, the network, or either jitter buffer. Not
desync that begins during a freeze — the specification allows
`estimatedPlayoutTimestamp` to be extrapolated between sender reports, so a
renderer that has stopped painting can keep reporting smooth playout, and this
detector will believe it. `InboundVideoFlowStateDetector` owns that condition, and
seeing a freeze is the cue to distrust a clean sync reading over the same
interval.

**What replaced what, and why.** Until 4.9.0 this sub-layer held
`AudioDesyncDetector`, which read `insertedSamplesForDeceleration` and
`removedSamplesForAcceleration` — NetEQ's accelerate and preemptive-expand
counters — formed a correction ratio from them, and called the result audio
desync. Those counters measure the jitter buffer time-stretching audio to reach
its target delay. That is buffer health, not synchronisation: the W3C definitions
place them among the jitter-buffer fields, and every published treatment of NetEQ
reads them the same way. Worse, the one real coupling between the two subjects
runs backwards. When a browser's A/V sync logic detects drift it *raises* NetEQ's
target delay, and NetEQ decelerates to reach it — so sustained deceleration is
frequently the sync **correction** working, not the fault. The old detector fired
on the repair. Meanwhile two devices with genuinely mismatched sample clocks
correct continuously with perfect lip sync and were reported as desynchronised.

Nothing of that measurement survives, and no tuning carries over: the old
thresholds were dimensionless fractions of samples, the new ones are
milliseconds of skew. The signal itself is not lost — `JitterBufferStressDetector`
reads it as `timeStretchRate`, under a name that says what it is, as one of the
two conditions it requires. The `audio-time-stretch` score penalty moved with it;
see [SCORE_CALCULATIONS.md](./SCORE_CALCULATIONS.md).

## Responsiveness

**Question.** Can the two people still take turns, or has the conversation gone
latent?

### `JitterBufferStressDetector` — `audio-jitter-buffer-stress`

**What it detects.** An audio jitter buffer fighting the network and losing. The
user-visible failure is conversation that has gone latent and slightly warped —
voices sped up or dragged out, replies landing on top of each other — rather
than the dropouts `InventedSpeechDetector` covers. The two are complements:
invented speech is what the buffer does when it has already run dry, and this is
the buffer straining before it gets there.

**Signals.** `inboundRtp.jitterBufferTargetDelayInMs` (what NetEQ is currently
aiming for) and `inboundRtp.timeStretchRate` (the share of samples stretched or
compressed to keep up). `avgJitterBufferDelayInMs` — what the buffer really
added per emitted sample — rides along in the payload as `actualDelayInMs`.

**Both conditions are required, because either alone is benign.** This is the
whole design of the class:

| Signal alone | What it actually means |
|---|---|
| Deep `jitterBufferTargetDelayInMs` | NetEQ is **succeeding** — it has bought latency to hide jitter, and the user hears nothing wrong |
| Raised `timeStretchRate` | Ordinary clock-drift correction between two devices whose sample clocks disagree |

It is the two *together* — the buffer already deep and still having to warp
audio to keep up — that a listener hears. A detector reading either signal alone
would spend its life reporting a healthy buffer doing its job, which is the
fastest way to train an operator to ignore a whole sub-layer. For the same
reason a tick missing **either** field is skipped rather than judged on the
other: half the evidence is worse than none.

**Algorithm and thresholds.**

| Key | Default | Meaning |
|---|---|---|
| `targetDelayThresholdInMs` | `200` | target delay strictly above this counts as deep |
| `timeStretchThreshold` | `0.02` | stretched share strictly above this counts as working hard |
| `minConsecutiveTicks` | `2` | collections both conditions must hold before raising |

Both comparisons are strict, both must hold on the same tick, and the streak
resets the moment either lapses — the spec has a case where a good tick between
two bad ones prevents the raise entirely.

**Raise.** `minConsecutiveTicks` consecutive stressed collections. Payload:
`peerConnectionId`, `trackId`, `targetDelayInMs`, `actualDelayInMs`,
`timeStretchRate`, `consecutiveTicks`.

**Resolve.** Either condition falls back (`jitter buffer recovered`), or a
stand-down: consumer paused (`consumer paused`), remote producer paused
(`remote track paused`). A buffer with no inbound audio to hold has no
meaningful target delay.

**Why this is genuine conversational latency, and why RTT does not capture it.**
`transport-delay-degraded` measures the round trip on the path — how long a
packet takes to get there and back. The delay a participant experiences before
they can reply is that, *plus* however long the receiver deliberately holds
audio before playing it, plus the playout pipeline. The jitter buffer's target
delay is the second term, it is often the largest, and it is invisible to any
transport measurement: a path with a flat 40 ms RTT and a receiver holding 400 ms
to smooth out bursty delivery produces a conversation nobody can take turns in,
while every network metric reads healthy. That term is measured here, on the
client, from the browser's own account of what its buffer is doing. It is the
only client-observable component of conversational delay the library reports.

**And why end-to-end conversational delay is deliberately not measured.** The
number an operator actually wants is mouth-to-ear: capture, encode, network,
buffer, decode, playout, on both legs. This endpoint can see its own receive-side
terms and nothing else. The far end's capture and encode latency, its own
buffering, and the render pipeline on the other machine are all outside
`getStats()`, and no combination of local fields substitutes for them.
Publishing a "total conversational delay" assembled from the terms we happen to
have would produce a figure that is confidently wrong, that nobody can verify,
and that would be trended and alerted on precisely because it looks like the
number everyone wanted. The honest alternative is what this detector does:
report the one term that is genuinely measured here, name it for what it is, and
leave the total to a correlation with the far end's own telemetry — which the
server has and the client does not.

**False positives.** An application that deliberately raises the buffer
(`jitterBufferMinimumDelay`, `playoutDelayHint`) gets a deep target delay by
configuration; this class does not read the minimum-delay field, so a deep
buffer chosen on purpose plus 2% ordinary clock correction satisfies both
conditions. Music and other high-quality audio streams are held deeper on
purpose for the same reason.

**What it deliberately does not claim.** Not a latency figure for the
conversation, as above. Not the cause: uneven delivery is the usual one, and
no detector at the transport layer owns it — see [Delivery
stability](./TRANSPORT_QUALITY_DETECTORS.md#delivery-stability) for why — and a
receiver that cannot schedule its audio thread reliably produces the same reading
with no network involvement at all.

## Issue taxonomy by sub-layer

| Sub-layer | Issue type | Detector | Monitor event |
|---|---|---|---|
| Visual — clarity | `pixelated-video` | `PixelatedVideoDetector` | `pixelated-video` |
| Visual — smoothness | `video-choppy` | `ChoppyVideoDetector` | `video-choppy` |
| Visual — continuity | `video-flow-disrupted` | `InboundVideoFlowStateDetector` | `video-flow-disrupted` |
| Audio — clarity | *(none — by design)* | — | — |
| Audio — continuity | `invented-speech` | `InventedSpeechDetector` | `invented-speech` |
| Audio — naturalness | *(none — recorded intention)* | `AudioPlayoutSynthesisDetector` | `synthesized-audio` |
| Synchronization | `av-desync` | `AVDesyncPlayoutDetector` | `av-desync` |
| Responsiveness | `audio-jitter-buffer-stress` | `JitterBufferStressDetector` | `audio-jitter-buffer-stress` |

Every issue here is keyed per track — `<issue-type>-track-<track.id>` — because
the experience is per track: one participant's video can be frozen while
everyone else's is fine, and an issue keyed per peer connection could not say
which. That key format is also, unfortunately, reconstructed as a string literal
inside `DefaultScoreCalculator` for two of the audio issues — `invented-speech`
and `audio-jitter-buffer-stress`, the second of them twice; see
[known deviations](./DETECTOR_TAXONOMY.md#known-deviations).

Every issue in the table answers the test each detector must pass: *what can an
engineer do differently after seeing this?* A frozen picture, a coarse picture
and a juddery picture send you to three different places — the repair loop, the
bitrate allocation, the arrival pattern — which is why they are three types and
not one `video-degraded` with a discriminator. Conversely `low-framerate` and
`unstable-framerate` send you to the same place, which is why they are one type
with a discriminator.

## How this category relates to its neighbours

The four issue-raising categories are the order to *read* a failed session in —
start at the lowest one that fired and treat the rest as consequences — and that
ordering is a reading convention, not a mechanism. Nothing in this category
waits for, checks, or is suppressed by anything in the others.

**Co-firing is independent evidence, never a chain.** The worked example is the
pair the config file itself names:

| | Issue | Detector | Reads | Level |
|---|---|---|---|---|
| Perceived | `audio-jitter-buffer-stress` | `JitterBufferStressDetector` | `jitterBufferTargetDelayInMs`, `timeStretchRate` on the inbound RTP monitor | per track |

**There is deliberately no transport-layer partner for this one.** A
`TransportJitterDetector` thresholding `avgInboundJitterInMs` was written during
4.9.0 development on the argument that a cause and a symptom measured separately
corroborate each other, and removed before release once that argument did not
survive inspection: NetEQ's target delay *is* the receiver's mechanical response
to inter-arrival jitter, so the two move together by construction and their
agreement confirms nothing. See [Delivery
stability](./TRANSPORT_QUALITY_DETECTORS.md#delivery-stability) for the full
reasoning, including why an unweighted mean of audio and video jitter is a poor
number to threshold in the first place.

What survives is the more useful half of that pairing: this detector reads the
receiver's *struggle* — deep target delay **and** audible time-stretching — not
the network condition behind it. That leaves the cause genuinely open, which is
the honest state of affairs, because a buffer can strain for reasons that have
nothing to do with the path: a starved audio thread, an overloaded renderer, a
capture device whose clock is drifting.

The same pattern holds across every boundary this category has:

- **Against Connectivity.** Perceived quality issues on a call that also raised
  `unstable-ice-path` say the reselections are audible; on a call that raised
  nothing in Connectivity they say the path is fine and something else is wrong.
- **Against Transport Quality.** `invented-speech` with
  `transport-loss-sustained` is loss the listener heard;
  `transport-loss-sustained` without it is loss Opus successfully hid, which is
  a different and much less urgent finding. `invented-speech` *without* loss
  points at the buffer rather than the wire.
- **Against Pipeline Disruption.** `video-flow-disrupted` with `stuck-decoder`
  names the component; `video-flow-disrupted` alone means the freeze is real and
  the break is upstream of anything this endpoint can see. `video-choppy` with
  `decoder-bottleneck` or `video-decoder-overloaded` says the local machine is
  why; `video-choppy` alone leaves the sender and the network as candidates.
- **Against Telemetry.** `video-resolution-changed` beside `pixelated-video` is
  usually the whole story — the SFU dropped a layer — and neither of them says
  so alone. `stats-collection-gap` beside anything in this category is a warning
  about the *measurement*: after a gap the next interval's rates are fiction,
  and a threshold crossed on that interval deserves less confidence.

Correlating any of these is the server's job, where the whole session is visible
and `peerConnectionId` plus a time window does the work properly.
[Detection is not correlation](./DETECTOR_TAXONOMY.md#detectors-are-independent):
a detector that asks "has anyone else noticed something?" has stopped detecting.

## What this model deliberately does not do

**No intelligibility or MOS detector.** [Audio — clarity](#audio--clarity) states
the reasoning in full: no client-side signal supports the judgement, and the
available substitutes are either a condition that is already owned wearing a
second name, or a telephony-era model applied to a codec it was never calibrated
for.

**No end-to-end conversational delay.** It needs the far end's playout timing,
which is not observable here. See
[Responsiveness](#responsiveness) — inventing a total nobody can verify would be
worse than the acknowledged gap.

**No per-content-type threshold tables.** Screen shares are *excluded* from both
video quality detectors rather than given a second set of numbers. A static
slide legitimately spends almost nothing per pixel and sits at 2 fps, and both
are correct behaviour; a threshold table for "screen share" would still be wrong
for the shared window that is playing a video, and it would be an opinion about
content the library cannot verify. The application declares content type through
`setInboundTrackContext` / `setOutboundTrackContext`, and undeclared inbound
screen shares are judged as camera video.

**No presentation-aware judgement.** `presentedResolution` and `motionType` are
carried on `InboundTrackMonitor`, refreshed from a `videoTag` every tick, and
read by **no detector** — only by `DefaultScoreCalculator`. So a frozen
thumbnail nobody is looking at raises the same issue as a frozen active speaker,
and a coarse 180p stream in a grid cell raises the same issue as one filling the
screen. Making the detectors presentation-aware is defensible and has not been
done; it would also make their findings depend on application-supplied context
that most applications never supply, which is the reason to be careful rather
than the reason not to.

**No composite experience score.** These detectors produce conditions, not a
number. Weighing a freeze against concealment against latency is the score
calculator's job and is documented in
[SCORE_CALCULATIONS.md](./SCORE_CALCULATIONS.md). A detector that started
ranking its own severity against another detector's would have to know about
that detector.

**No owner for dropped frames as a perceived condition.**
`dropped-video-frames` is a score reason with no detector counterpart — the one
entry in that list still lacking one. Frames dropped after arrival are watched by
`DecoderPerformanceDetector` as evidence that the *decoder* is overloaded, which
is a Pipeline Disruption finding about a component; nobody owns "the viewer is
losing frames" as an experience. It is recorded as a gap rather than documented
as covered.

**No sender-side perceived quality.** Everything here binds to an inbound
monitor. What the *far end* sees of our video is not observable from this
endpoint — `remote-inbound-rtp` carries loss, jitter and RTT, none of which is a
perceptual measurement — and a detector claiming to report the other
participant's experience would be inferring it from three network numbers.

## Observability horizon

Everything above is derived from two sources and nothing else: `getStats()`, and
the peer-connection events the source bindings forward. Four consequences are
specific to this category and worth stating plainly, because the temptation to
guess past this horizon is strongest exactly where the subject is a human
experience.

**Perception is not in the stats.** Nearly every value here is a proxy. Bits per
pixel is a proxy for blockiness, invented speech is a proxy for audible holes,
and a deep buffer plus stretching is a proxy for a conversation that has gone
latent. Each proxy is defensible and each has a documented failure mode, listed
with its detector. The playout skew behind `av-desync` is the one value in the
category that is not a proxy at all — it is the offset itself, in milliseconds —
and it still is not a measurement of what a person perceived: it says the two
tracks disagree by 130 ms, not that this viewer noticed. That gap does not close
with a better signal, and no threshold applied to a proxy or to a real
measurement turns either into perception.

**The receiver sees only what arrived.** These detectors cannot distinguish a
sender that encoded badly from a network that delivered badly from a decoder
that struggled — and deliberately do not try. That separation is what the other
three categories are for, and the correlation between them is the server's.

**Field support is uneven and the gaps are silent.** Three concrete cases in
this document: `qpSum` is optional and differently scaled per codec, which is
why clarity is judged on bits per pixel instead; `media-playout` reports do not
exist outside Chromium, which is why the naturalness sub-layer has an event and
not an issue; and `framesRendered` is documented as never emitted by any of the
three browsers the library adapts, which disables the persistence leg of the
freeze test as described under
[Visual — continuity](#visual--continuity). Where a field is absent the correct
response is a documented proxy or silence, never a guess downstream code cannot
distinguish from a measurement.

**Silence itself has to be reportable.** The public `inputsUnavailable` field
exists so that "nothing is wrong" and "I could not see whether anything is wrong"
are distinguishable from outside — see
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing). In
this category `PixelatedVideoDetector`, `ChoppyVideoDetector`,
`InventedSpeechDetector` and `AVDesyncPlayoutDetector` set it — the last two gained it
in 4.9.0. `InventedSpeechDetector` was the case the flag was written for: a
browser omitting `silentConcealedSamples` used to silence the detector
permanently and invisibly. `AVDesyncPlayoutDetector` is the case that makes it
unavoidable, because for that class silence is the *normal* state on much of a
fleet — no pairing declared, or no `estimatedPlayoutTimestamp` — and a detector
that is usually dark and never says so is worse than no detector at all.
`InboundVideoFlowStateDetector` and `JitterBufferStressDetector` still return quietly
when their counters are missing, so a browser that omits
`jitterBufferTargetDelay` produces a permanently, invisibly silent detector — and
a fleet dashboard counting issues reads that as a healthy session. Extending the
flag to those two is the smallest useful improvement this document can point
at.
