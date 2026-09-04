# Score Calculations — `DefaultScoreCalculator`

This document is the full reference for how the library's built-in score
calculator turns raw WebRTC stats into the `0.0 – 5.0` quality scores exposed
on the client, the peer connections and the tracks — and for every **reason
key** a score can carry, what it means, and when it fires.

For the surrounding API (the `ScoreCalculator` interface, replacing the
calculator, reading scores and reasons) see the *Score Calculation* section of
the [README](../README.md#score-calculation).

- [The score scale](#the-score-scale)
- [What each score is responsible for](#what-each-score-is-responsible-for)
- [Score hierarchy](#score-hierarchy)
- [How penalties work](#how-penalties-work)
  - [Stepped penalties](#stepped-penalties)
  - [Normalized penalty ramps](#normalized-penalty-ramps)
  - [Issue-gated penalties](#issue-gated-penalties)
  - [Smoothing](#smoothing)
- [Peer connection stability score](#peer-connection-stability-score)
- [Inbound audio track score](#inbound-audio-track-score)
- [Inbound video track score](#inbound-video-track-score)
- [Outbound audio track score](#outbound-audio-track-score)
- [Outbound video track score](#outbound-video-track-score)
- [Screen-share content type](#screen-share-content-type)
- [Reason reference](#reason-reference)
- [Where the reasons surface](#where-the-reasons-surface)
- [Tuning](#tuning)

## The score scale

Every score ranges from `0.0` (worst) to `5.0` (best), interpreted as:

| Range | Meaning |
| --- | --- |
| `4.0 – 5.0` | good |
| `3.0 – 4.0` | fair |
| `2.0 – 3.0` | poor |
| `1.0 – 2.0` | bad |
| `0.0 – 1.0` | very bad |

Scores are recalculated on every stats collection tick.

## What each score is responsible for

The single rule that decides where a penalty belongs:

> **A peer connection is scored for the state of the path. A track is scored for
> what the user perceived. Nothing is scored for both.**

Loss, jitter and RTT are properties of the *transport* — every stream riding it
shares them, and no single track owns them. They are subtracted **once**, on the
peer connection.

Freezes, low or volatile frame rates, dropped frames, pixelation, invented
speech, time-stretch, jitter-buffer delay: these are *measurements of
damage the user experienced*. They are subtracted on the **track**, and only
there.

The distinction is cause versus effect, and it matters because the two are not
interchangeable:

- **The same loss does different damage to different tracks.** 2% loss is
  inaudible on an Opus stream with FEC and PLC, and very visible on video
  without it. The loss figure cannot tell you which happened; the share of
  audio NetEQ had to invent and the freeze count can.
- **Damage happens without loss.** In a captured session, 754 of 772 intervals
  measured **zero** packet loss, and 31 of them still had audible invention
  above 0.5% — jitter-buffer underruns and late arrivals, not packets that never
  came. A path-only view calls that session clean, because by its own metric it
  was.
- **A clean path can carry a broken track, and a bad path can carry a fine one.**
  A camera that has stopped producing frames scores badly on a perfect network;
  a talking head on a lossy path can still look and sound fine.

So a degradation is attributed by *joining* the two, which a server can always
do because they arrive in the same sample: the track says what broke, the peer
connection says whether the network explains it.

### What this rules out

- A track score never subtracts `high-packetloss` or `high-jitter`. If you are
  looking for those on a track sample, look at its peer connection entry.
- A track is not charged twice for the same packets. The peer connection score
  still scales its tracks (see below) — what changed is that the loss and jitter
  penalties no longer *also* sit on the track, so the path is charged once.

## Score hierarchy

The peer connection **scales** its tracks rather than sitting beside them. Every
track rides the path, so a degraded path degrades what the viewer actually got
from each of them:

```
                    Σ(Track_Score × Track_Weight)        max(0, PC_Score)
PC_Contribution  =  ─────────────────────────────   ×   ─────────────────
                        Σ(Track_Weight)                         5

                    Σ(PC_Contribution × PC_Weight)
Client Score     =  ──────────────────────────────
                           Σ(PC_Weight)
```

| contributor | weight |
|---|---|
| peer connection | 1 |
| audio track | 1 |
| video track | 2 |

1. **Every track** computes its own score from what the user perceived on it —
   freezes, pixelation, invented speech, frame delivery. Never loss or jitter.
2. **Every peer connection** computes a *stability score* from path-level
   signals — RTT, jitter and packet loss.
3. **The client score** averages each peer connection's scaled track average,
   weighted by the peer connection.

The multiplication is deliberate and gives the client score a property the
additive alternative does not: **a call can never score better than the
connection carrying it.** A peer connection at 0 takes its tracks to 0 no matter
how healthy their own metrics look, which is the honest answer — media that
cannot traverse the path was not delivered, whatever the decoder thought.

A peer connection with no scoreable tracks contributes its own score alone (the
track average defaults to the maximum). A peer connection whose stability score
cannot be computed is skipped entirely, along with its tracks.

**Known asymmetry.** `Σ(PC_Weight)` is the only denominator, so track weights
normalize *within* a peer connection and never reach the client level. A send
peer connection with one outbound track therefore counts as much as a receive
peer connection with twenty inbound ones. Weighting each contribution by
`PC_Weight + Σ(Track_Weight)` would fix it without changing the multiplication.


## How penalties work

Each entity starts at the maximum (`5.0`) and **subtracts penalty points**.
Every subtraction is recorded under a **reason key** (the exported
`DefaultScoreCalculatorSubtractionReason` union), so the resulting score
always explains itself: `{ "frozen-video": 2.0, "pixelated-video": 0.4 }`.

There are three penalty shapes.

### No baseline, no judgement

Before any of them: **a penalty is only ever computed from stats the browser
actually reported.** Nothing is assumed, defaulted or approximated from a
neighbouring signal.

Concretely, no penalty in this calculator uses `?? 0` on the value it is judging.
A missing input is not zero — zero is a measurement, and a very consequential one
(zero loss, zero frames, zero quantizer all mean something specific). Where an
input is absent the calculation is skipped and the reason key **does not appear**.

That makes the reason keys readable in both directions:

- **key absent** — either nothing was wrong, or it could not be measured.
- **key present with a value** — it was measured, and this is what it cost.

The two are never conflated by a fabricated default, which is what lets a server
distinguish a healthy track from an unmeasurable one. Where the same distinction
matters for a *refinement* rather than the measurement itself — the display size
that tunes `pixelated-video`, for instance — the refinement is skipped and the
base measurement still stands, rather than the whole reason disappearing.

### Stepped penalties

A fixed number of points at a threshold. Used where the signal is
effectively binary (a frozen picture, a CPU-limited encoder) or where a
discrete severity tier reads better than a curve (path RTT tiers).

### Normalized penalty ramps

Most metric-driven penalties are **normalized to `0..1`**: the penalty is
`0` at or below an **activation threshold**, ramps up linearly, and saturates
at `1.0` at a **saturation point**:

```
penalty(value) = clamp((value − activation) / (saturation − activation), 0, 1)
```

Nothing is subtracted while the metric stays under the activation threshold —
the reason key only appears once the penalty is above `0`. All activation and
saturation points are `public static readonly` constants on
`DefaultScoreCalculator` (see [Tuning](#tuning)).

### Issue-gated penalties

The inbound-audio penalties reuse the audio detectors instead of re-deriving
their conditions per tick. The detector's windowed, hysteresis-guarded
**issue** gates *whether* the penalty applies at all; the current per-tick
metric then scales *how much*, as a normalized ramp whose activation is the
detector's own configured threshold. Two consequences worth knowing:

- A tick where the metric has dipped back under the threshold (or measured
  nothing) contributes **no penalty**, even while hysteresis keeps the issue
  open.
- When a detector is disabled (config key set to `null`), its issue never
  raises and the corresponding penalty never applies; the audio score then
  rests on the pure loss decay alone.

### Smoothing

The peer-connection stability score and the video track scores are smoothed
over the last `N` raw per-tick scores (at most 10, and at least 5 before a
value is produced at all — a freshly appeared track reports `undefined` for
its first few ticks). The average is **recency-weighted**: the newest sample
weighs the most, so the score follows a change quickly but a single noisy
tick cannot swing it. Audio track scores are direct per-tick values.

## Peer connection stability score

Path-level signals, measured across all streams of the connection. Jitter and
the loss fraction are **averaged over the streams that reported one** — one
stream at 10% loss and ten streams at 1% each are different situations, and a
raw sum would read both as 10%. Loss uses the per-interval `deltaFractionLost`
(both directions), so the penalty reflects the current interval, not lifetime
accumulation. RTT and jitter are penalized **separately**: a long path and a
jittery path are different problems with different fixes.

| Reason | Condition | Penalty |
| --- | --- | --- |
| `high-rtt` | average RTT 150 – 300 ms | −1.0 |
| `high-rtt` | average RTT > 300 ms | −2.0 |
| `high-jitter` | average jitter 30 – 100 ms | −1.0 |
| `high-jitter` | average jitter > 100 ms | −2.0 |
| `high-packetloss` | avg delta loss fraction 1 – 5% | −1.0 |
| `high-packetloss` | avg delta loss fraction 5 – 20% | −2.0 |
| `high-packetloss` | avg delta loss fraction > 20% | −5.0 |

## Inbound audio track score

The base score follows the received bitrate on a logarithmic scale — Opus
degrades gracefully, so the difference between 6 and 12 kbps matters far more
than between 26 and 32 kbps:

```
normalizedBitrate = log10(max(bitrate, 6000) / 6000) / log10(32000 / 6000)
baseScore         = min(5.0, 5 × normalizedBitrate)
```

**Packet loss is not subtracted here** — see
[What each score is responsible for](#what-each-score-is-responsible-for). It is
the peer connection's reason; what the loss *did* to this audio is measured
directly by the three penalties below.

Three **issue-gated, normalized** penalties
(see [Issue-gated penalties](#issue-gated-penalties)). Two of the three are gated
on the same issue: a stressed jitter buffer is charged both for how deep it had to
go and for how much audio it had to warp to hold that depth, which are separate
costs to a listener.

| Reason | Gating issue | Scaling metric | Activation | Saturation |
| --- | --- | --- | --- | --- |
| `invented-speech` | `invented-speech` | `inventedSpeechRatio` (audible share of the interval's audio NetEQ invented) | detector `allowedInventedRatio` (default 0.05) | 0.10 |
| `high-jitter-buffer-delay` | `audio-jitter-buffer-stress` | `jitterBufferTargetDelayInMs` | detector `targetDelayThresholdInMs` (default 200 ms) | 500 ms |
| `audio-time-stretch` | `audio-jitter-buffer-stress` | `timeStretchRate` (share of samples NetEQ stretched/compressed) | detector `timeStretchThreshold` (default 0.02) | 0.3 |

## Inbound video track score

| Reason | Shape | Activation → Saturation | Notes |
| --- | --- | --- | --- |
| `volatile-fps` | normalized 0–1 | 0.1 → 0.2 volatility | Volatility = std deviation of the last ≤10 fps readings over the EWMA fps. **Skipped for screen share.** |
| `low-fps` | step −1.0 | EWMA fps < 10 | Only while frames are actually flowing (`deltaFramesReceived > 0`) — a dry or paused track is `DryInboundTrackDetector`'s verdict, not a score matter. **Skipped for screen share.** |
| `dropped-video-frames` | normalized 0–1 | 0.1 → 0.2 dropped fraction | `framesDropped / (framesDropped + framesRendered)`. |
| `video-frame-corruptions` | normalized 0–1 | 0.05 → 0.5 probability | Per-interval average corruption probability (`deltaCorruptionProbability`). |
| `frozen-video` | step −2.0 | track currently frozen | From the freeze state `FrozenVideoTrackDetector` derives; a frozen picture dominates every other quality aspect. |
| `pixelated-video` | normalized 0–1 × **0.5 / 2.0 / 3.0** | codec activation QP → saturation QP | Average quantization parameter per decoded frame (`qpSum / framesDecoded`), the encoder stating how coarsely it had to quantize. Blur and blockiness long before anything freezes. The multiplier is chosen by how big the picture is presented — see below. This is the only reason whose range exceeds 2.0. |

QP scales are codec-specific and not comparable across codecs (H.264 runs
0–51, VP8 0–127, VP9/AV1 0–255), so the activation and saturation points come
from a per-codec, per-motion-type table (`VIDEO_QP_THRESHOLDS`). Motion type
defaults to `standard` for camera and `lowmotion` for screen share, and an
application can declare it with `setInboundTrackContext(id, { motionType })`. Where the browser
reports no `qpSum` for the codec in use, **the reason is absent entirely**
rather than modelled from bitrate.

### `pixelated-video` in full

Pixelation is the one video reason that measures what the picture *looks like*
rather than what the network did to it. It is worth walking through end to end,
because three separate inputs decide the number and each one can be absent.

#### 1. The measurement: what the encoder had to throw away

The quantization parameter is the encoder stating how coarsely it quantized a
frame — how much detail it discarded to fit the bits it was given. High QP is
visible as blocking, banding and mush. It is the only signal in `getStats()`
that describes the decoded picture itself.

`InboundRtpMonitor` derives it per interval:

```
deltaQpSum        = qpSum − qpSum(previous)
deltaFramesDecoded = framesDecoded − framesDecoded(previous)
avgQpPerFrame     = deltaQpSum / deltaFramesDecoded
```

**It is `undefined` unless both deltas exist and at least one frame decoded.**
Nothing is carried forward from the previous interval: a stale average would
describe media that is no longer on screen. Not every browser reports `qpSum`,
and none report it for every codec.

Bitrate is deliberately *not* used as a substitute. The same 500 kbps is
generous for a static talking head and starvation for a fast pan, and nothing
observable separates the two from bits alone. The reason this replaced
`low-bitrate-per-pixel` is that the old metric was wrong twice over: its floor
ignored resolution (required bitrate scales as roughly `pixels^0.75`, so one
floor cannot fit 180p and 1080p), and dividing by *measured* fps meant a track
halving its frame rate doubled its bits-per-pixel and shed the penalty — the
metric rewarded dropping frames.

#### 2. The band: what counts as too coarse, for this codec and this content

A QP value means nothing on its own. `VIDEO_QP_THRESHOLDS[codec][motionType]`
gives the pair it is judged against:

- **activation** — below this the picture is fine and nothing is subtracted.
- **saturation** — at or above this it is as bad as this reason gets.

Indexed by codec first because the scales are **not** comparable and must never
be normalized into a shared 0–1 range: H.264 runs 0–51, VP8 0–127, VP9 and AV1
0–255. Equal fractions of those ranges are not equal quality.

Then by motion class, because the same quantizer is not equally visible on all
content: movement masks compression artifacts, while a slide or a still face
shows every blocked edge. Note the bands run the **opposite** way to bitrate —
high-motion content needs more bits to reach a given QP, yet tolerates a higher
one once there.

| codec | scale | lowmotion | standard | highmotion |
| --- | --- | --- | --- | --- |
| vp8 | 0–127 | 32 → 64 | 40 → 80 | 50 → 100 |
| vp9 | 0–255 | 64 → 128 | 80 → 160 | 100 → 200 |
| h264 | 0–51 | 26 → 34 | 33 → 42 | 38 → 48 |
| h265 | 0–51 | 26 → 34 | 33 → 42 | 38 → 48 |
| av1 | 0–255 | 80 → 144 | 100 → 180 | 125 → 225 |

Motion class is application-declared (`setInboundTrackContext(id, { motionType })`).
Undeclared, screen share is judged as `lowmotion` — unreadable text is a hard
failure — and everything else as `standard`.

**An unrecognised codec yields no band, and therefore no judgement.**

#### 3. The size: where the band sits, and what saturation is worth

Blockiness is an artifact of a given angular size. The same quantizer is
punishing blown up to full screen and nearly invisible in a grid thumbnail,
because what the eye resolves is the coded block's size *on screen*, not its size
in the decoded frame. So when the application has said how big the picture is
presented, two things change — and **deliberately not symmetrically**. A large
pixelated video is what the viewer is actually complaining about; a pixelated
thumbnail is a curiosity.

```
magnification = sqrt((presentedW × presentedH) / (decodedW × decodedH))
                clamped to [0.5, 2.0]
```

Taken from the **areas**, so a presented box whose proportions differ from the
frame's does not read as magnification on width alone. Clamped because the raw
ratio is unbounded — 180p on a 4K screen is a factor of 10.7 — and neither
extreme should move the bar as far as it literally implies.

**The band moves**, by a fraction of its own width per doubling of magnification:

```
shift = (saturation − activation) × SHIFT_PER_OCTAVE × log2(magnification)
band  = { activation − shift, saturation − shift }

SHIFT_PER_OCTAVE = 0.6   when magnified   (PIXELATION_QP_SHIFT_PER_OCTAVE_UP)
                   0.15  when shrunk      (PIXELATION_QP_SHIFT_PER_OCTAVE_DOWN)
```

`log2` because magnification is a ratio; the two different fractions are the
asymmetry. One octave up drops the bar by 0.6 of the band's width, one octave
down raises it by only 0.15 — blowing a picture up makes every block bigger on
the retina and the bar has to come down hard, while shrinking hides the blocks
but a thumbnail bad enough to notice is still bad.

The shift is expressed as a fraction of the band width rather than in QP points
because QP points are not comparable between codecs — six points is a quantizer
doubling in H.264's 0–51 and almost nothing in AV1's 0–255 — while each codec's
own band already carries its scale. The moved band is then held inside
`VIDEO_QP_MAX[codec]`, since a saturation past the highest quantizer a codec can
emit would make the penalty *unreachable* rather than lenient: H.264's
high-motion band already sits at 48 of 51.

**And the weight changes** — what a fully saturated quantizer is worth:

| magnification | weight | constant |
| --- | --- | --- |
| ≥ 1.5 | **3.0** | `PIXELATION_MAX_PENALTY_LARGE` |
| 0.75 – 1.5 | 2.0 | `PIXELATION_MAX_PENALTY` |
| < 0.75 | **0.5** | `PIXELATION_MAX_PENALTY_SMALL` |

The two mechanisms do different jobs: the band decides *when* pixelation starts
costing anything, the weight decides *how much* it can cost at worst. `3.0` is
half again what `frozen-video` costs — a large picture gone to blocks is the
worst thing that can happen to a video track short of it stopping, and it should
not be possible to score that call well. `pixelated-video` is the only reason
whose range exceeds 2.0.

#### 4. The result

```
pixelated-video = normalizedPenalty(avgQpPerFrame, band) × weight
```

For vp8 at standard motion — shipped band 40 → 80 — the same stream, decoded
once, shown three ways:

| presented | mag | band | weight | QP 45 | QP 60 | QP 75 | QP 90 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| thumbnail, 160×90 CSS @2x | 0.50 | 46 → 86 | 0.5 | 0 | **0.18** | 0.36 | 0.50 |
| grid tile, 320×180 CSS @2x | 1.00 | 40 → 80 | 2.0 | 0.25 | 1.00 | 1.75 | 2.00 |
| 1.5× | 1.50 | 26 → 66 | 3.0 | 1.43 | 2.55 | 3.00 | 3.00 |
| speaker view, 1280×720 CSS @2x | 2.00 | 16 → 56 | 3.0 | 2.17 | **3.00** | 3.00 | 3.00 |

The QP-60 column is the point: identical encoded picture, **0.18** in a
thumbnail and **3.00** in speaker view — a factor of seventeen.

#### 5. Nothing is assumed

**Every input is either measured or absent, and an absent input never becomes a
default.** This is the rule the whole scoring path follows, and pixelation is
where it matters most, because three separate things can be missing:

| missing | consequence |
| --- | --- |
| `qpSum`, or no frame decoded this interval | **no reason at all** — the picture is not judged |
| the codec is not in `VIDEO_QP_THRESHOLDS` | **no reason at all** — there is no scale to judge against |
| `presentedResolution` not declared | the band is used as shipped, weight `2.0` |
| the stats report no `frameWidth`/`frameHeight` | the band is used as shipped, weight `2.0` |
| the codec is not in `VIDEO_QP_MAX` | the band is used as shipped (the weight still applies) |

Note the difference between the first two rows and the rest. Without a
quantizer, or without a scale to read it on, there is nothing to say and the
reason is **absent from the sample entirely** — not zero, not estimated from
bitrate. Without a presented size there is still a real measurement; only the
size-dependent refinement is skipped, and the track is judged exactly as it was
before that refinement existed.

A reason key that is absent means "not measured". A reason key present with a
value means "measured, and this is what it cost". The two are never conflated,
so a server can tell a healthy track from an unmeasurable one — which it could
not do if a missing input silently produced a zero.

#### Declaring the presented size

Declare it in **device pixels**, either directly or by handing over the element:

```typescript
monitor.setInboundTrackContext(trackId, { presentedResolution: { width: 1280, height: 720 } });
monitor.setInboundTrackContext(trackId, { videoTag });   // re-measured every tick
```

Two things about the `videoTag` route. It measures the element's **layout box**
(`clientWidth`/`clientHeight` × `devicePixelRatio`), never
`videoWidth`/`videoHeight` — those are the *intrinsic* decoded size, the same
number the stats already report, so measuring with them would make every
magnification exactly 1. And it fits the frame's aspect ratio into that box as
`object-fit: contain` does; an application using `object-fit: cover`, which crops
instead, should declare `presentedResolution` itself.

## Outbound audio track score

The same base-bitrate curve as inbound audio, on the sending bitrate. **Nothing
else is subtracted**: the loss the far end reported belongs to the peer
connection, and the send side has no perception to measure — there is no
decoder here, so there is no invented speech or time-stretch to observe. A track
whose source `audioLevel` is near zero is not scored at all (nothing meaningful
is being sent).

## Outbound video track score

Quality limitation applies to camera and screen share alike. It is judged on
the **interval duration shares** (`qualityLimitationDurationShares`) — the
instantaneous `qualityLimitationReason` flickers — with the instantaneous
reason as fallback for browsers that do not report duration totals:

| Reason | Shape | Condition |
| --- | --- | --- |
| `cpu-limitation` | step −2.0 | cpu-limited ≥ 30% of the interval |
| `bandwidth-limitation` | step −1.0 | bandwidth-limited ≥ 50% of the interval (milder: BWE adaptation is the system working) |

**Camera tracks** additionally get:

| Reason | Shape | Activation → Saturation | Notes |
| --- | --- | --- | --- |
| `high-deviation-from-target-bitrate` | normalized 0–1 | 5% → 15% under target | Only when the absolute shortfall also exceeds `max(20 kbps, 5% of target)` — a tiny absolute gap on a small target is noise. |
| `high-volatile-bitrate` | normalized 0–1 | 0.1 → 0.2 volatility | Std deviation of the last ≤10 bitrate deltas over the EWMA bitrate. |

**Screen-share tracks** skip both of the above — frame rate and bitrate
volatility are meaningless on mostly-static content (VBR drops to ~zero
between changes), and the encoder target swings by design. What actually
hurts a screen share is sharpness:

| Reason | Shape | Condition |
| --- | --- | --- |
| `downscaled-screenshare` | step −1.0 | encoded area < ½ of the captured surface |
| `downscaled-screenshare` | step −2.0 | encoded area < ¼ of the captured surface — the point where shared text stops being readable |

## Screen-share content type

Both track monitors carry an optional `contentType` (`'camera' |
'screenshare'`, video-only semantics) with the same API:

```typescript
monitor.getOutboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
monitor.getInboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
```

The decision is **never** taken from `track.contentHint` — applications set
`'detail'`/`'text'` on camera tracks too, so the hint is not a reliable
screen-share signal. On the **outbound** side the flag is auto-detected from
`track.getSettings().displaySurface`, which exists exclusively on display
capture. A received (**inbound**) track exposes no `displaySurface`, so the
application declares it — typically right after the track monitor appears
(e.g. from signaling metadata that told it the remote track is a share).

An undeclared video track is scored as camera content. For inbound tracks the
flag currently exempts the fps-based penalties (`low-fps`, `volatile-fps`);
for outbound tracks it switches the whole scoring branch (see above).

## Reason reference

Every key of the `DefaultScoreCalculatorSubtractionReason` union:

| Reason key | Entity | Media | Max | What it tells you |
| --- | --- | --- | --- | --- |
| `high-rtt` | peer connection | — | 2.0 | The path is long: average RTT above 150 ms delays conversation turn-taking, above 300 ms it suffers badly. |
| `high-jitter` | peer connection | — | 2.0 | Packet arrival timing is unstable across the streams (average measured jitter above 30 ms / 100 ms). |
| `high-packetloss` | peer connection | — | 5.0 | Packets are being lost on the path right now (per-interval loss fraction averaged across streams). |
| `low-fps` | inbound track | video | 1.0 | Sustained low frame rate (EWMA < 10 fps) while frames are flowing — motion is visibly choppy. Not applied to screen share. |
| `volatile-fps` | inbound track | video | 1.0 | The frame rate is fluctuating (volatility beyond 0.1 of the average) — playback feels unsteady even if the average fps looks fine. Not applied to screen share. |
| `dropped-video-frames` | inbound track | video | 1.0 | More than 10% of frames are dropped after arrival instead of rendered — usually a receive-side performance problem. |
| `video-frame-corruptions` | inbound track | video | 1.0 | Decoded frames carry visible corruption (per-interval corruption probability beyond 0.05). |
| `frozen-video` | inbound track | video | 2.0 | The picture is currently frozen (detector verdict). Dominates every other aspect of the track. |
| `pixelated-video` | inbound track | video | 1.0 | The decoder reports a high average QP — the encoder had to quantize coarsely, which the viewer sees as blur and blockiness before anything freezes. |
| `high-deviation-from-target-bitrate` | outbound track | video | 1.0 | The encoder is sending 5%+ less than its own target — it wants to send more but cannot. Not applied to screen share. |
| `high-volatile-bitrate` | outbound track | video | 1.0 | The sending bitrate is swinging (volatility beyond 0.1 of the average) — typically an unstable uplink or fighting congestion control. Not applied to screen share. |
| `cpu-limitation` | outbound track | video | 2.0 | The encoder spent ≥ 30% of the interval CPU-limited — the machine cannot keep up; expect resolution/fps degradation for every receiver. |
| `bandwidth-limitation` | outbound track | video | 1.0 | The encoder spent ≥ 50% of the interval bandwidth-limited — the uplink is the bottleneck and BWE is adapting down. |
| `downscaled-screenshare` | outbound track | video | 2.0 | A screen-share track is encoded well below the captured resolution — shared text becomes unreadable at the far end. |
| `invented-speech` | inbound track | audio | 1.0 | NetEQ is audibly inventing audio the sender never sent (issue-gated; scaled by the share of the interval it invented). The listener hears gaps, warbles or robotic artifacts. |
| `audio-time-stretch` | inbound track | audio | 1.0 | NetEQ is stretching/compressing a significant share of samples to keep up (issue-gated on `audio-jitter-buffer-stress`; scaled by the time-stretch rate). Audio may sound sped-up or slowed-down. It is **not** a lip-sync reason — `av-desync` is the issue that measures that, and it carries no score penalty. |
| `high-jitter-buffer-delay` | inbound track | audio | 1.0 | The jitter buffer's target delay adds noticeable latency (issue-gated; scaled by the target delay above the threshold). The audio plays cleanly, but late. |

## Where the reasons surface

- **The realtime `'score'` event** carries the client-level aggregate of the
  current tick's reasons (`currentReasons`) with their magnitudes.
- **Each monitor** (`pcMonitor.scoreReasons`, `trackMonitor.scoreReasons`)
  holds only its *own* reasons — a low track score is explained on the track,
  not on the peer connection.
- **The samples** carry `scoreReasons` as a record of reason key → subtracted
  points (`Record<string, number>`) per entity, magnitudes included. Set
  `sendScoreReasonsToServer: false` to drop the reasons from the wire.

See the README's [Score Reasons](../README.md#score-reasons) section for
examples.

## Tuning

All activation/saturation points of the normalized ramps are
`public static readonly` constants on `DefaultScoreCalculator`
(`INBOUND_VIDEO_JITTER_ACTIVATION_IN_MS`, `FPS_VOLATILITY_ACTIVATION`,
`DROPPED_FRAMES_FRACTION_ACTIVATION`,
`FRAME_CORRUPTION_PROBABILITY_ACTIVATION`,
`TARGET_BITRATE_DEVIATION_ACTIVATION`, `BITRATE_VOLATILITY_ACTIVATION`, the
matching `*_SATURATION` constants, and the audio saturations
`INVENTED_SPEECH_SATURATION`, `TIME_STRETCH_SATURATION`,
`JITTER_BUFFER_TARGET_DELAY_SATURATION_IN_MS`).

The **activation** thresholds of the issue-gated audio penalties come from
the corresponding detector's configuration
(`inventedSpeechDetector.allowedInventedRatio`,
`jitterBufferStressDetector.targetDelayThresholdInMs`,
`jitterBufferStressDetector.timeStretchThreshold`), so tuning a
detector tunes the score with it; the `DEFAULT_*` constants only fill in when
a detector config is absent. Configuring a saturation at or below its
activation degenerates that ramp into a binary 0/1 step.

`audio-time-stretch` reads the third of those as of 4.10.0. Until then it was
gated on the `audio-desync` issue and scaled against
`audioDesyncDetector.fractionalCorrectionAlertOnThreshold` — a threshold belonging
to a detector that formed a *different* ratio from the same two NetEQ counters, so
the penalty ramped from a point nothing in it had defined. Both halves now come
from `JitterBufferStressDetector`, which is the detector that actually owns
`timeStretchRate`. The practical effect is a penalty that starts much earlier: the
activation fell from 0.1 to 0.02, so a 5% stretch rate that used to cost nothing
now costs about 0.11, and a 20% one costs 0.64 rather than 0.5. Tune
`timeStretchThreshold` if that is too eager — it moves the detector and the
penalty together, which is the point.

For entirely different scoring logic, replace the calculator: see the
README's [Custom Score Calculator](../README.md#custom-score-calculator)
section.
