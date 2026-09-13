# Score Calculations — `DefaultScoreCalculator`

This document describes **the score calculator that ships with the library**, which
is a reference implementation and not a contract. It is here so that the numbers a
default monitor publishes can be understood and so that anyone writing their own
calculator has a worked example to start from.

Nothing in this document is public API. There is **no table of issue weights to
import**, no config key that retunes a charge, and nothing else in the library reads
the scores produced here. The library's own commitment is small:

```typescript
interface ScoreCalculator {
    update(): void;
}
```

`ClientMonitor.scoreCalculator` holds the implementation in use, `update()` is called
once per collection after the detectors have run, and `DefaultScoreCalculator` is
assigned at construction so a monitor scores something out of the box. To change the
policy, assign your own — see [Writing your own](#writing-your-own).

- [The score scale](#the-score-scale)
- [The score is a reading of the issues](#the-score-is-a-reading-of-the-issues)
- [Score hierarchy](#score-hierarchy)
- [What each score is responsible for](#what-each-score-is-responsible-for)
- [What the calculator charges](#what-the-calculator-charges)
- [What it does not charge](#what-it-does-not-charge)
- [Pixelation and the presented size](#pixelation-and-the-presented-size)
- [Where the reasons surface](#where-the-reasons-surface)
- [Writing your own](#writing-your-own)

## The score scale

Every score ranges from `0.0` (worst) to `5.0` (best), interpreted as:

| Range | Meaning |
| --- | --- |
| `4.0 – 5.0` | good |
| `3.0 – 4.0` | fair |
| `2.0 – 3.0` | poor |
| `1.0 – 2.0` | bad |
| `0.0 – 1.0` | very bad |

Scores are recalculated on every stats collection, with no smoothing window: the
published value is this collection's verdict, not a mean of recent ones.

## The score is a reading of the issues

**As of 4.9.0 the charges are the open issues and the monitors' own published
readings, and nothing else.** Every monitor starts at `5.0`, the charges below are
subtracted, and the result is clamped at `0.0`. The calculator re-derives no
threshold from raw stats: where a detector owns a verdict, the calculator prices it
and does not form a second opinion, so a fault is judged in one place and the score
cannot disagree with the issue list an operator is looking at.

This replaced the 4.7-era model, in which the calculator carried its own thresholds —
jitter ramps, per-codec quantizer tables — and could penalize a track no detector had
flagged. Those parallel thresholds are gone, along with the `VIDEO_QP_THRESHOLDS`
export; a blocky picture is now `PixelatedVideoDetector`'s verdict.

Two shapes of charge, and the difference matters when reading a score:

- **Gated on an open issue.** The charge applies only while the issue is open. What
  it is *worth* can still be a continuous reading, so `decoder-bottleneck` costs what
  the decoder actually fell behind by.
- **A continuous reading with no detector behind it.** `volatile-fps`,
  `dropped-video-frames`, `blocky-video`, `frozen-video`, `choppy-video`,
  `unstable-audio-playout`, `unstable-transport`, `downscaled-screenshare` and
  `high-deviation-from-target-bitrate` exist only in the calculator, and are named for
  what they measure rather than for an issue. They are what keep a merely mediocre
  call off a flat `5.0`, since a detector says nothing until its threshold is crossed.

A monitor holding no issues scores `5.0`, which is a real statement: its detectors ran
and raised nothing. That is not the same as `undefined`, which means too few
collections to judge yet, and which is left out of every aggregate above it.

## Score hierarchy

Three levels, and the top one is **not an average**.

1. **Every track** scores its own issues and readings into `calculatedScore`.
2. **Every peer connection** scores the state of its path into
   `calculatedStabilityScore`. Deliberately not an average of its tracks — it is a
   dimension in its own right.
3. **The client score** collapses five dimensions — the transport, and inbound and
   outbound audio and video — into one number.

Each dimension is the weighted mean of the monitors that make it up, using each
monitor's `calculatedScore.weight`, which is `1` for tracks and peer connections
alike unless an application changes it.

The five then combine as **`5 − RMSE`**, the root-mean-square distance from a perfect
call, rather than as a mean:

```
                       ┌──────────────────────────
                       │  Σ (5 − Dimension_Score)²
Client Score  =  5  −  │  ────────────────────────
                      \│      count(Dimensions)
```

Squaring the distances is what makes one collapsed dimension cost more than the same
shortfall spread evenly, which is how a call is actually experienced: nobody whose
video has died calls it two-thirds fine because the audio and the path are still good.
`[5, 5, 0]` scores `2.11` where an average would say `3.33`.

**A dimension nothing reported is absent, not zero.** A call that sends no video is not
a call whose video is broken. `undefined` and `null` are dropped before the mean; with
none left the client score is `undefined`, a different statement from `0`.

**The transport is one of the five, not a multiplier.** This replaced 4.8.0's model, in
which a peer connection scaled its tracks by `pcScore / 5`. A dead path now drags the
call score hard without silently zeroing tracks that raised nothing of their own — a
track with no issues still reads `5.0` while the call reads `1.46`. Both statements are
true and kept separate on purpose: the track number answers "was anything wrong with
this stream", the call number answers "how was the call".

## What each score is responsible for

> **A peer connection is scored for the state of the path. A track is scored for what
> the user perceived. Nothing is scored for both.**

Loss, delay and congestion are properties of the *transport* — every stream riding it
shares them, and no single track owns them. Their detectors raise on the peer
connection, so they are charged **once**, there.

Freezes, volatile frame rates, dropped frames, pixelation, invented speech,
jitter-buffer stress: these measure *damage the user experienced*. Their detectors
raise on the **track**, and only there.

The distinction is cause versus effect, and the two are not interchangeable:

- **The same loss does different damage to different tracks.** 2% loss is inaudible on
  an Opus stream with FEC and PLC, and very visible on video without it. The loss
  figure cannot tell you which happened; the share of audio NetEQ had to invent and
  the freeze count can.
- **Damage happens without loss.** In a captured session, 754 of 772 intervals measured
  **zero** packet loss, and 31 of them still had audible invention above 0.5% —
  jitter-buffer underruns and late arrivals, not packets that never came.
- **A clean path can carry a broken track, and a bad path a fine one.** A camera that
  has stopped producing frames scores badly on a perfect network.

So a degradation is attributed by *joining* the two, which a server can always do
because they arrive in the same sample: the track says what broke, the peer connection
says whether the network explains it. Because the calculator reads the issue registry,
this rule is kept by where each detector raises rather than by the calculator
remembering to skip a metric.

## What the calculator charges

Costs are points out of `5.0`. "Issue" means the charge applies only while that issue
is open; "reading" means it is continuous and has no detector behind it.

### Inbound video track

| Charge | Gate | Cost |
| --- | --- | --- |
| `dry-inbound-track` | issue | 5.0 |
| `stuck-decoder` | issue | 5.0 |
| `frame-assembly-stalled` | issue | 5.0 |
| `frozen-video` | reading — `frameFlowState === 'frozen'` | 5.0 |
| `choppy-video` | reading — `frameFlowState === 'choppy'` | 2.5 |
| `pixelated-video` | issue | `quantizationDegradation` × size weight × 2.5 |
| `decoder-bottleneck` | issue | `decodingDegradation` × 2 |
| `inbound-video-playout-discrepancy` | issue | `videoPlayoutSkew`, 0–1 |
| `video-decoder-overloaded` | issue | `decodeBudgetUtilization` ramped 0.8 → 1.0, 0–1 |
| `blocky-video` | reading — no `pixelated-video` open | `quantizationDegradation` × size weight, 0–1 |
| `volatile-fps` | reading — `interFrameDelayVariation` ramped 0.2 → 0.4 | 0–1 |
| `dropped-video-frames` | reading — `droppedFrameRatio` ramped 0.1 → 0.2 | 0–1 |

`volatile-fps` is skipped on screen share, which legitimately runs at a low and bursty
frame rate.

### Inbound audio track

| Charge | Gate | Cost |
| --- | --- | --- |
| `dry-inbound-track` | issue | 5.0 |
| `invented-speech` | issue | `inventedSpeechRatio`, 0–1 |
| `synthesized-audio` | issue | `synthesizedAudioRatio`, 0–1 |
| `audio-jitter-buffer-stress` | issue | `jitterBufferStressSeverity`, 0–1 |
| `unstable-audio-playout` | reading — no `invented-speech` open | `inventedSpeechSeverity` ramped 0.25 → 1.0, 0–1 |

`invented-speech` and `unstable-audio-playout` are the same measurement either side of
the detector's threshold, so they are mutually exclusive rather than additive.

### Outbound video track

| Charge | Gate | Cost |
| --- | --- | --- |
| `dry-outbound-track` | issue | 5.0 |
| `video-capture-bottleneck` | issue | `videoCaptureDegradation` × 2 |
| `encoder-bottleneck` | issue | `videoEncodingDegradation` × 2 |
| `high-deviation-from-target-bitrate` | reading — camera only, shortfall against `targetBitrate` ramped 0.05 → 0.15 | 0–1 |
| `downscaled-screenshare` | reading — screen share only, encoded area below the captured surface ramped 0.5 → 0.75 | 0–1 |

The two readings are exclusive by content type: a screen share is judged on sharpness,
because downscaled text is unreadable, and a camera on whether the encoder reached the
bitrate it was told to.

### Outbound audio track

| Charge | Gate | Cost |
| --- | --- | --- |
| `dry-outbound-track` | issue | 5.0 |
| `silent-audio-source` | issue | 5.0 |

### Peer connection

| Charge | Gate | Cost |
| --- | --- | --- |
| `uplink-congestion` | issue | `max(uplinkVideoCongestionSeverity, minSeverity)` × 2.5 |
| `downlink-congestion` | issue | `max(downlinkVideoCongestionSeverity, minSeverity)` × 2.5 |
| `transport-loss-sustained` | issue | 2.5 |
| `transport-delay-degraded` | issue | 2.5 |
| `unstable-transport` | reading — `2 × (1 − transportStability)` | 0–2 |

Congestion is floored at the detector's own `minSeverity` so that a finding at the
threshold still costs what the threshold says it is worth.

### When a charge is published as a reason

A charge of `0` is dropped rather than written, because a reason sitting at zero reads
as a fault that was found and never resolved. Beyond that, `reasons` is assigned on
every collection — never only the bad ones — so a connection back at a clean `5.0`
stops shipping last tick's keys.

Continuous readings alone have to come to more than one point before they are
published: `reasons` is read as what to act on, and a charge that did not move the
score by a point is not that. The score still carries it. Where a detector has raised,
its reason is always published, even if the continuous part came to nothing, so a
verdict is never contradicted by an empty reason list.

## What it does not charge

**19 of the 37 issue types carry no charge in this calculator.** An unpriced issue is
still raised, still emitted and still shipped in the sample — it just does not move a
score.

| Not charged | Why |
| --- | --- |
| `ice-connection-failed`, `ice-disconnected`, `ice-establishment-failed`, `ice-transport-stalled`, `no-available-ice-candidate`, `unstable-ice-path`, `dtls-handshake-failed`, `dtls-handshake-stalled` | Deliberate. A path carrying nothing leaves nothing to have an opinion about, and the tracks riding on it go dry — `dry-inbound-track` and `dry-outbound-track` already take their dimensions to zero. Charging the connection too would be the same fault counted twice, in the one situation where there is no media to judge. |
| `congestion` | Deliberate. The deprecated `CongestionDetector` raises it for the same episode `uplink-congestion` / `downlink-congestion` cover, so pricing it would charge one episode twice. |
| `capture-source-lost`, `rtp-sender-stalled`, `transport-demux-stalled`, `video-recovery-failed`, `av-desync`, `cpulimitation`, `blocked-inbound-media-transport`, `blocked-outbound-media-transport`, `blocked-stun-requests` | Not deliberate as far as the code says — these are findings a reference implementation would be expected to price, and do not appear in any charge above. Treat their absence as a gap in this implementation rather than a statement that they do not matter. |

This is one of the reasons the calculator is documented as a reference implementation:
a deployment that cares about any of the second group should price it in its own
calculator rather than wait for this one to.

## Pixelation and the presented size

`pixelated-video` is raised by `PixelatedVideoDetector` from the **quantizer** — the
mean QP of the interval as a fraction of the codec's own scale, derived from `qpSum`.
The detector decides *whether* the picture is blocky, which is a fact about the stream
and the same everywhere. How much that *matters* is a fact about this client: the same
stream is a thumbnail in one layout and full-screen in the next, and what the eye
resolves is the coded block's size on screen.

**`InboundTrackMonitor.displayMagnification`** says how magnified it is: the linear
factor `sqrt(presented area / decoded area)`, reported raw. Taken from the *areas*, so
a 16:9 frame letterboxed into a square tile is not read as magnification on width
alone. `undefined` — not `1` — when nothing declared a presented size or a `videoTag`,
or the stats carry no decoded frame size yet: "nobody measured" and "painted at its
decoded size" are different facts. There is no ceiling on it; a 320×180 stream on a 4K
screen really is magnified twelvefold.

That is a fact, so it lives on the monitor. What a magnification is *worth* is an
opinion about scoring, so it lives here:

| `displayMagnification` | Multiplier | Constant |
| --- | --- | --- |
| ≥ 1.5 | **×1.5** | `PIXELATION_WEIGHT_LARGE` |
| 0.75 – 1.5 | ×1.0 | — |
| < 0.75 | **×0.25** | `PIXELATION_WEIGHT_SMALL` |
| `undefined` | ×1.0 | — |

Deliberately asymmetric: blown up, the blocks are what the viewer complains about; in a
thumbnail nobody can see them. An unmeasurable magnification means "no adjustment"
rather than "no opinion", so a missing measurement never silences the finding. The size
only ever *weighs* a finding and never becomes one — a track with no open
`pixelated-video` issue is charged `blocky-video` from the same reading, and nothing at
all when the reading is absent.

### Declaring the presented size

Declare it in **device pixels**, either directly or by handing over the element:

```typescript
monitor.setInboundTrackContext(trackId, { presentedResolution: { width: 1280, height: 720 } });
monitor.setInboundTrackContext(trackId, { videoTag });   // re-measured every tick
```

Two things about the `videoTag` route. It measures the element's **layout box**
(`clientWidth`/`clientHeight` × `devicePixelRatio`), never `videoWidth`/`videoHeight` —
those are the *intrinsic* decoded size, the same number the stats already report, so
measuring with them would make every magnification exactly 1. And it fits the frame's
aspect ratio into that box as `object-fit: contain` does; an application using
`object-fit: cover`, which crops instead, should declare `presentedResolution` itself.

## Where the reasons surface

`scoreReasons` is keyed by issue type wherever an issue is behind the charge, and by
the name of the reading otherwise. The value is the points that charge took off.

- **The `'score'` event** carries the client-level aggregate of this collection's
  reasons as `currentReasons`, with magnitudes.
- **Each monitor** (`pcMonitor.scoreReasons`, `trackMonitor.scoreReasons`) holds only
  its *own* reasons — a low track score is explained on the track, not on the peer
  connection.
- **The samples** carry `scoreReasons` per entity as `Record<string, number>`. Set
  `sendScoreReasonsToServer: false` to drop them from the wire without changing any
  score.

## Writing your own

Assign it, and the monitor calls your `update()` from the next collection on. Nothing
else has to change: the monitors publish the same facts either way, and the sample
reads whatever the scores end up as.

```typescript
monitor.scoreCalculator = {
    update() {
        for (const pc of monitor.mappedPeerConnections.values()) {
            const lossy = pc.issues.hasType('transport-loss-sustained');

            pc.calculatedStabilityScore.value = lossy ? 2.5 : 5.0;
            pc.calculatedStabilityScore.reasons = lossy ? { lossy_path: 2.5 } : undefined;
        }

        for (const track of monitor.tracks) {
            track.calculatedScore.value = track.issues.size === 0 ? 5.0 : 3.0;
        }

        monitor.setScore(myClientScore);
    },
};
```

**What you read.** Each monitor's `issues` registry — `hasType(type)`,
`getByType(type)`, `getFirstPayloadByType(type)`, `size` — plus any derived field the
monitor publishes, all of which are documented in
[DERIVED_METRICS.md](./DERIVED_METRICS.md). Detector payloads reached through the
registry carry the measurements behind a finding.

**What you write.** `calculatedScore.value` and `.reasons` on the track monitors,
`calculatedStabilityScore` on the peer connections, and `ClientMonitor.setScore(score,
ownReasons?, aggregatedReasons?)` for the call. Leave `value` as `undefined` to mean
"not judged yet" — it is then left out of any aggregate. Reason keys are yours to
name; they ship verbatim in the sample.

**Retuning when a fault is raised at all** is a different job, and is an edit to that
detector's config rather than to any calculator: see
[CONFIGURATION.md](./CONFIGURATION.md). The two are independent — the detector config
decides whether the issue exists, the calculator decides what it costs.
