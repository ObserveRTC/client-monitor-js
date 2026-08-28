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

Freezes, low or volatile frame rates, dropped frames, pixelation, audio
concealment, time-stretch, jitter-buffer delay: these are *measurements of
damage the user experienced*. They are subtracted on the **track**, and only
there.

The distinction is cause versus effect, and it matters because the two are not
interchangeable:

- **The same loss does different damage to different tracks.** 2% loss is
  inaudible on an Opus stream with FEC and PLC, and very visible on video
  without it. The loss figure cannot tell you which happened; the concealment
  rate and the freeze count can.
- **Damage happens without loss.** In a captured session, 754 of 772 intervals
  measured **zero** packet loss, and 31 of them still had audible concealment
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
- The peer connection score is **not** a multiplier over its tracks. It used to
  be, which meant a path problem was charged once inside each track score and
  again as the factor over all of them — the same packets, counted twice.

## Score hierarchy

Scores compose as one weighted average over peer connections **and** tracks,
which are siblings rather than nested:

```
Client Score = Σ(PC_Score × PC_Weight) + Σ(Track_Score × Track_Weight)
               ───────────────────────────────────────────────────────
                       Σ(PC_Weight) + Σ(Track_Weight)
```

| contributor | weight |
|---|---|
| peer connection | 1 |
| audio track | 1 |
| video track | 2 |

1. **Every track** computes its own score from what the user perceived on it.
2. **Every peer connection** computes a *stability score* from path-level
   signals — RTT, jitter and packet loss — and contributes it directly.
3. **The client score** is the weighted average of all of them together, so
   each contribution is counted exactly once.

A track that is disabled or muted, or that has no RTP stream yet, has an
`undefined` score and is excluded. A peer connection without tracks simply
contributes its own stability score.

### Only streams carrying media measure the path

The peer connection averages jitter and loss across its streams, and skips any
stream that shows no sign of carrying media in the interval — under
`MIN_PATH_SAMPLE_BITRATE` (8 kbps) **and** under `MIN_PATH_SAMPLE_PACKETS` (25
packets) **and** delivering no frames.

This is not a micro-optimization. An SFU's bandwidth-probation stream —
mediasoup sends one on `mid: "probator"` — exists to be discarded, so its loss
ratio and jitter are not measurements of anything. Observed in a real session at
~2 kbps with ~50% "loss" and ~490 ms "jitter", beside real streams running at
0.00% loss and 2 ms jitter. Averaged in with an equal vote it produced
`high-jitter: 2` **and** `high-packetloss: 2` on 99% of samples and pinned a
healthy connection at the minimum score for the whole call. Excluding it moved
that connection's mean score from **1.08 to 4.92**, and the client's from
**2.93 to 4.86**.

## How penalties work

Each entity starts at the maximum (`5.0`) and **subtracts penalty points**.
Every subtraction is recorded under a **reason key** (the exported
`DefaultScoreCalculatorSubtractionReason` union), so the resulting score
always explains itself: `{ "frozen-video": 2.0, "pixelated-video": 0.4 }`.

There are three penalty shapes:

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
| `very-high-rtt` | average RTT > 300 ms | −2.0 |
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
(see [Issue-gated penalties](#issue-gated-penalties)):

| Reason | Gating issue | Scaling metric | Activation | Saturation |
| --- | --- | --- | --- | --- |
| `audio-concealment` | `audio-concealment` | `concealmentRate` (audible share of samples concealed) | detector `onThreshold` (default 0.03) | 0.10 |
| `high-jitter-buffer-delay` | `audio-jitter-buffer-stress` | `jitterBufferTargetDelayInMs` | detector `targetDelayThresholdInMs` (default 200 ms) | 500 ms |
| `audio-time-stretch` | `audio-desync` | `timeStretchRate` (share of samples NetEQ stretched/compressed) | detector `fractionalCorrectionAlertOnThreshold` (default 0.1) | 0.3 |

## Inbound video track score

| Reason | Shape | Activation → Saturation | Notes |
| --- | --- | --- | --- |
| `volatile-fps` | normalized 0–1 | 0.1 → 0.2 volatility | Volatility = std deviation of the last ≤10 fps readings over the EWMA fps. **Skipped for screen share.** |
| `low-fps` | step −1.0 | EWMA fps < 10 | Only while frames are actually flowing (`deltaFramesReceived > 0`) — a dry or paused track is `DryInboundTrackDetector`'s verdict, not a score matter. **Skipped for screen share.** |
| `dropped-video-frames` | normalized 0–1 | 0.1 → 0.2 dropped fraction | `framesDropped / (framesDropped + framesRendered)`. |
| `video-frame-corruptions` | normalized 0–1 | 0.05 → 0.5 probability | Per-interval average corruption probability (`deltaCorruptionProbability`). |
| `frozen-video` | step −2.0 | track currently frozen | From the freeze state `FreezedVideoTrackDetector` derives; a frozen picture dominates every other quality aspect. |
| `pixelated-video` | normalized 0–1, scaled ×0.5–×2.0 | codec activation QP → saturation QP | Average quantization parameter per decoded frame (`qpSum / framesDecoded`), the encoder stating how coarsely it had to quantize. Blur and blockiness long before anything freezes. Scaled by display magnification when the presented resolution is known — see below — so the ceiling is 2.0, not 1.0. |

QP scales are codec-specific and not comparable across codecs (H.264 runs
0–51, VP8 0–127, VP9/AV1 0–255), so the activation and saturation points come
from a per-codec, per-motion-type table (`VIDEO_QP_THRESHOLDS`). Motion type
defaults to `standard` for camera and `lowmotion` for screen share, and an
application can declare it with `setInboundTrackContext(id, { motionType })`. Where the browser
reports no `qpSum` for the codec in use, **the reason is absent entirely**
rather than modelled from bitrate.

### Magnification: the quantizer is judged at the size the picture is shown

QP says how coarsely the frame was coded. It does not say how large those coded
blocks end up on the viewer's screen, and that is the other half of whether they
are visible — the same QP is punishing blown up to full screen and nearly
invisible in a grid thumbnail. Judging the picture at display size rather than
decode size is what reference metrics do (VMAF scales to the display before
scoring); this is the crude version.

When the application has declared `presentedResolution` on the inbound track and
the stats report a decoded `frameWidth`/`frameHeight`, the penalty is multiplied
by the **linear** ratio between them:

```
magnification = sqrt((presentedWidth * presentedHeight) / (decodedWidth * decodedHeight))
pixelated-video = normalizedPenalty(avgQpPerFrame, activation, saturation) * clamp(magnification, 0.5, 2.0)
```

The ratio comes from the areas rather than one axis, so a presented box whose
proportions differ from the frame's does not read as magnification on width
alone. It is clamped because it is unbounded in both directions — 180p on a 4K
screen is a factor of ~10.7, 1080p in a 96px avatar is ~0.07 — and neither
extreme is worth the score swing. `PIXELATION_MAGNIFICATION_MIN` and
`PIXELATION_MAGNIFICATION_MAX` are mutable statics on `DefaultScoreCalculator`;
setting both to `1.0` disables the adjustment.

**No presented resolution, no adjustment.** Where the application has not
declared one, or the stats carry no decoded resolution, the quantizer is judged
alone exactly as before — nothing is substituted for the missing number.

Declare it in **device pixels**, either directly or by handing over the element:

```typescript
monitor.setInboundTrackContext(trackId, { presentedResolution: { width: 1280, height: 720 } });
monitor.setInboundTrackContext(trackId, { videoTag });   // re-measured every tick
```

Two things to know about the `videoTag` route. It measures the element's
**layout box** (`clientWidth`/`clientHeight` × `devicePixelRatio`), never
`videoWidth`/`videoHeight` — those are the *intrinsic* decoded size, the same
number the stats already report, so measuring with them would make every
magnification exactly 1. And it fits the frame's aspect ratio into that box, as
`object-fit: contain` does; an application using `object-fit: cover`, which crops
instead, should declare `presentedResolution` itself.

## Outbound audio track score

The same base-bitrate curve as inbound audio, on the sending bitrate. **Nothing
else is subtracted**: the loss the far end reported belongs to the peer
connection, and the send side has no perception to measure — there is no
decoder here, so there is no concealment or time-stretch to observe. A track
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
| `high-rtt` | peer connection | — | 1.0 | The path is long: average RTT above 150 ms. Expect delayed conversation turn-taking. |
| `very-high-rtt` | peer connection | — | 2.0 | Average RTT above 300 ms — interactive conversation suffers badly. |
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
| `audio-concealment` | inbound track | audio | 1.0 | NetEQ is audibly concealing missing audio (issue-gated; scaled by the audible concealment rate). The listener hears gaps, warbles or robotic artifacts. |
| `audio-time-stretch` | inbound track | audio | 1.0 | NetEQ is stretching/compressing a significant share of samples to keep up (issue-gated; scaled by the time-stretch rate). Audio may sound sped-up, slowed-down or drift against video. |
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
`AUDIO_CONCEALMENT_SATURATION`, `TIME_STRETCH_SATURATION`,
`JITTER_BUFFER_TARGET_DELAY_SATURATION_IN_MS`).

The **activation** thresholds of the issue-gated audio penalties come from
the corresponding detector's configuration
(`audioConcealmentDetector.onThreshold`,
`jitterBufferStressDetector.targetDelayThresholdInMs`,
`audioDesyncDetector.fractionalCorrectionAlertOnThreshold`), so tuning a
detector tunes the score with it; the `DEFAULT_*` constants only fill in when
a detector config is absent. Configuring a saturation at or below its
activation degenerates that ramp into a binary 0/1 step.

For entirely different scoring logic, replace the calculator: see the
README's [Custom Score Calculator](../README.md#custom-score-calculator)
section.
