# Score Calculations — `DefaultScoreCalculator`

This document is the full reference for how the library's built-in score
calculator turns the **open issues** each monitor holds into the `0.0 – 5.0`
quality scores exposed on the client, the peer connections and the tracks — and
for what every issue type costs, and why.

For the surrounding API (the `ScoreCalculator` interface, replacing the
calculator, reading scores and reasons) see the *Score Calculation* section of
the [README](../README.md#score-calculation).

- [The score scale](#the-score-scale)
- [The score is a reading of the issues](#the-score-is-a-reading-of-the-issues)
- [The four categories](#the-four-categories)
- [What each score is responsible for](#what-each-score-is-responsible-for)
- [Score hierarchy](#score-hierarchy)
- [How a fault is priced](#how-a-fault-is-priced)
  - [Weights](#weights)
  - [Detector-reported severity](#detector-reported-severity)
  - [Capping versus subtracting](#capping-versus-subtracting)
  - [Smoothing](#smoothing)
- [Per-track and per-connection scores](#per-track-and-per-connection-scores)
- [Pixelation and the presented size](#pixelation-and-the-presented-size)
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

## The score is a reading of the issues

**As of 4.9.0 the score is the open issues, and nothing else.** Every monitor
starts at `5.0` and is reduced by the findings its own detectors raised, read
from that monitor's issue registry. The calculator re-derives no threshold from
raw stats: the detectors already decided what is wrong, so a fault is judged in
exactly one place and the score can never disagree with the issue list an
operator is looking at.

This replaces the 4.7-era model, in which the calculator carried its own
thresholds — jitter ramps, FPS volatility bands, per-codec quantizer tables — and
could therefore penalize a track no detector had flagged, or stay silent on one
every detector had. Those parallel thresholds are gone. If you tuned
`DefaultScoreCalculator.*_ACTIVATION` / `*_SATURATION` constants or
`VIDEO_QP_THRESHOLDS`, that tuning now lives in the detector configs and in
[`ISSUE_SCORING`](#tuning).

A monitor holding no issues scores `5.0`, which is a real statement: its
detectors ran and raised nothing. That is not the same as a score of
`undefined`, which means too few collections to judge yet, and which is left out
of every aggregate above it.

## The four categories

`ISSUE_SCORING` assigns every issue type exactly one category, mirroring the four
detector categories. The category decides *how* the fault counts; the weight
decides *how much*.

| Category | What it means | What it does to the score |
| --- | --- | --- |
| **connectivity** | The path is down, failing or unusable. | **Zero** while the issue is open. Nothing else is consulted — nothing riding on an unusable path can be good. |
| **pipeline-disruption** | Media stopped moving somewhere between the capture device and the renderer. | **Caps** the score in proportion to its weight. A weight of `1` means zero; a lighter weight leaves a ceiling. |
| **perceived-quality** | Media is flowing and a person can tell it is wrong. | **Subtracts**, so several mild faults accumulate the way a viewer experiences them. |
| **transport-quality** | The path carries media, badly. | **Subtracts from the connection**, which already scales everything riding on it. |

## What each score is responsible for

The single rule that decides where a penalty belongs:

> **A peer connection is scored for the state of the path. A track is scored for
> what the user perceived. Nothing is scored for both.**

Loss, jitter and RTT are properties of the *transport* — every stream riding it
shares them, and no single track owns them. The detectors that measure them raise
their issues on the peer connection, so they are subtracted **once**, there.

Freezes, low or volatile frame rates, dropped frames, pixelation, invented
speech, jitter-buffer stress: these are *measurements of damage the user
experienced*. Their detectors raise on the **track**, and only there.

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

Because the score now reads the issue registry, this rule is kept by where each
detector raises rather than by the calculator remembering to skip a metric.

## Score hierarchy

Three levels, and the top one is **not an average**.

1. **Every track** scores its own pipeline-disruption and perceived-quality
   issues.
2. **Every peer connection** scores its own connectivity and transport-quality
   issues into a *stability score*. Deliberately not an average of its tracks —
   it is a dimension in its own right.
3. **The client score** collapses five dimensions — the transport, and inbound
   and outbound audio and video — into one number.

Each dimension is the weighted mean of the monitors that make it up:

| contributor | weight |
|---|---|
| peer connection | 1 |
| audio track | 1 |
| video track | 2 |

The five then combine as **`5 − RMSE`**, the root-mean-square distance from a
perfect call, rather than as a mean:

```
                       ┌──────────────────────────
                       │  Σ (5 − Dimension_Score)²
Client Score  =  5  −  │  ────────────────────────
                      \│      count(Dimensions)
```

Squaring the distances is what makes one collapsed dimension cost more than the
same shortfall spread evenly, which is how a call is actually experienced: nobody
whose video has died calls it two-thirds fine because the audio and the path are
still good. `[5, 5, 0]` scores `2.11` where an average would say `3.33`.

**A dimension nothing reported is absent, not zero.** A call that sends no video
is not a call whose video is broken, and counting it as zero would be the same
statement. `undefined` and `null` are dropped before the mean; with none left
there is no distance to measure and the client score is `undefined`, which is a
different statement from `0`.

**The transport is one of the five, not a multiplier.** A dead path therefore
drags the call score hard without silently zeroing tracks that raised nothing of
their own — a track with no issues still reads 5.0, and the call reads 1.46. Both
statements are true and they are kept separate on purpose: the track-level number
answers "was anything wrong with this stream", the call-level number answers "how
was the call".

## How a fault is priced

### Weights

A rule's `weight` is a `0..1` share of the full score: `1` is all five points,
`0.4` is two of them. Weights are **starting points, not measurements** — they
say how much of a score a fault is worth at full severity, and are meant to be
retuned against your own corpus.

An issue type with no rule in `ISSUE_SCORING` costs nothing. That is deliberate:
a new detector never gets a price guessed for it. `unscoredIssueTypes()` is what
turns that silence into a visible hole, and a test in this repository fails when
any detector's `ISSUE_TYPE` is missing from the table.

### Detector-reported severity

Most detectors only ever say yes or no, and for those the weight is the whole
story. The few that measure how deep their finding is declare a `severityField` —
a `0..1` field on the payload:

| Issue type | Field | Meaning |
| --- | --- | --- |
| `cpulimitation` | `minUtilization` | How occupied the codecs are, `min(encoder, decoder)` |
| `uplink-congestion` | `severity` | How deep the congestion is |
| `downlink-congestion` | `severity` | How deep the congestion is |

The reported severity **scales** the weight rather than replacing it, so a
detector's own severity says *how much of its worst case* this is and the table
still decides what that worst case costs. A missing field, a non-finite value, or
one outside `0..1` falls back to the weight rather than scoring nothing.

### Capping versus subtracting

The order is not the order the issues happen to arrive in:

1. A **connectivity** issue short-circuits the whole monitor to `0.0`.
2. The **pipeline-disruption** caps are taken as a *minimum* — the deepest one
   wins, and two of them do not stack.
3. The **subtractions** come off whatever ceiling survived.

Two broken pipelines are not twice as bad as one, because there is no media
either way — but two quality faults really are worse than one. Running all of
them into a single total would let a mild quality fault push an already-capped
score below its cap, which would read as the pipeline being *more* broken because
the picture was also blocky.

The result is clamped to `0.0` at the bottom, so no pile-up of issues produces a
negative score.

### Smoothing

Each monitor keeps the last `lastNScoresMaxLength` (10) per-tick values and
publishes their mean, so one collection cannot swing a call's score. Below
`lastNScoresMinLength` (5) ticks the published score is `undefined` rather than a
guess from one or two collections, and an `undefined` score is left out of every
aggregate above it.

One consequence worth knowing: a track that goes dry mid-call does not read `0.0`
on the next tick — it slides there over the following ticks as the window fills
with zeros.

## Per-track and per-connection scores

One code path, not one per kind. `_scoreFromIssues` walks a monitor's
`IssueRegistry`, looks each open issue up in `ISSUE_SCORING`, and applies the
category rules below. A track and a peer connection differ only in which issues
they are holding.

There is exactly one seam, for the rule that cannot live in the table because it
depends on *this client* rather than on the fault: inbound video passes an
adjuster that reweighs `pixelated-video` by how large the picture is being shown.

An issue type the table does not price is skipped, so a detector added without a
rule is silent here rather than arbitrary.

## Pixelation and the presented size

`pixelated-video` is raised by `PixelatedVideoDetector` from bits per pixel: the
detector decides **whether** the picture is blocky, which is a fact about the
stream and the same everywhere. How much that *matters* is a fact about this
client — the same stream is a thumbnail in one layout and full-screen in the
next, and what the eye resolves is the coded block's size on screen.

Three parties, split along the line that runs through the rest of the library.

**The detector** says whether the picture is blocky, from `bitPerPixel`.

**`InboundTrackMonitor.displayMagnification`** says how magnified it is: the linear
factor `sqrt(presented area / decoded area)`, reported raw. It is derived beside
the presented size it depends on — every tick, and again on any `setContext()`
that changes that size, so an application declaring a size and reading the
magnification in the same breath does not get the previous layout's answer. Taken
from the *areas*, so a 16:9 frame letterboxed into a square tile is not read as
magnification on width alone. `undefined` — not `1` — when nothing declared a
presented size or a `videoTag`, or the stats carry no decoded frame size yet:
"nobody measured" and "painted at its decoded size" are different facts.

There is no ceiling or floor on it. A 320x180 stream on a 4K screen really is
magnified twelvefold, and whether that is meaningfully worse than fourfold is a
judgement for whoever reads the number — which is the table below, and which
could be something else entirely in a custom `ScoreCalculator`.

Both of those are facts, so they live on the objects that own them. **What a
magnification is *worth* is an opinion about scoring**, so it lives here with
every other such opinion:

| `displayMagnification` | Multiplier on the table price | Constant |
| --- | --- | --- |
| ≥ 1.5 | **×1.5** | `PIXELATION_WEIGHT_LARGE` |
| 0.75 – 1.5 | ×1.0 | — |
| < 0.75 | **×0.25** | `PIXELATION_WEIGHT_SMALL` |
| `undefined` | ×1.0 | — |

Deliberately asymmetric: blown up, the blocks are the thing the viewer complains
about; in a thumbnail nobody can see them. An unmeasurable magnification means
"no adjustment" rather than "no opinion", so a missing measurement never silences
the finding.

The size only ever *weighs* a finding, and never becomes one — a track with no
open `pixelated-video` issue is charged nothing however large it is shown.

### Declaring the presented size

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

## Reason reference

`scoreReasons` is keyed by **issue type** throughout, so the reason a score fell
is the name of the finding that caused it — the same string the issue carries,
and the same string in the sample. The value is the points that issue took off.

"Full cost" below is the points at full severity, out of `5.0`.

### Connectivity — scores the connection zero while open

| Issue type | Weight | Full cost | Severity from |
| --- | --- | --- | --- |
| `ice-connection-failed` | 1 | 5.00 | — |
| `ice-establishment-failed` | 1 | 5.00 | — |
| `ice-disconnected` | 1 | 5.00 | — |
| `ice-transport-stalled` | 1 | 5.00 | — |
| `no-available-ice-candidate` | 1 | 5.00 | — |
| `dtls-handshake-failed` | 1 | 5.00 | — |
| `dtls-handshake-stalled` | 1 | 5.00 | — |
| `unstable-ice-path` | 0.6 | 3.00 | — |

`unstable-ice-path` is the one that is not an outage: the path works between
reselections, and the churn is what costs.

### Pipeline disruption — caps the score

| Issue type | Weight | Full cost | Severity from |
| --- | --- | --- | --- |
| `dry-inbound-track` | 1 | 5.00 | — |
| `dry-outbound-track` | 1 | 5.00 | — |
| `capture-source-lost` | 1 | 5.00 | — |
| `silent-audio-source` | 1 | 5.00 | — |
| `stuck-decoder` | 1 | 5.00 | — |
| `rtp-sender-stalled` | 1 | 5.00 | — |
| `transport-demux-stalled` | 1 | 5.00 | — |
| `frame-assembly-stalled` | 1 | 5.00 | — |
| `video-recovery-failed` | 0.9 | 4.50 | — |
| `decoder-bottleneck` | 0.7 | 3.50 | — |
| `video-capture-bottleneck` | 0.7 | 3.50 | — |
| `encoder-bottleneck` | 0.7 | 3.50 | — |
| `inbound-video-playout-discrepancy` | 0.7 | 3.50 | — |
| `cpulimitation` | 0.6 | 3.00 | `minUtilization` |
| `video-decoder-overloaded` | 0.5 | 2.50 | — |

The full-weight eight are cases where there is no media at all. Below them,
`video-recovery-failed` is a freeze the repair loop could not end; the three
bottlenecks and the playout discrepancy are frames arriving and being lost, so
the picture stutters rather than stops; `video-decoder-overloaded` is the earlier
warning that decoding is expensive but still keeping up; it is a
repair loop eating the path while the picture may still be moving.

`cpulimitation` is the machine, not one stream — it is the only pipeline issue
that reports its own severity.

### Perceived quality — subtracts from the track

| Issue type | Weight | Full cost | Severity from |
| --- | --- | --- | --- |
| `video-flow-disrupted` | 0.8 | 4.00 | — |
| `invented-speech` | 0.6 | 3.00 | — |
| `pixelated-video` | 0.5 | 2.50 | — |
| `av-desync` | 0.4 | 2.00 | — |
| `synthesized-audio` | 0.4 | 2.00 | — |
| `audio-jitter-buffer-stress` | 0.3 | 1.50 | — |

`invented-speech` and `synthesized-audio` are the same fault seen from two
places — the stream that concealed and the playout device that invented — and
are priced so the pair is not double-weighted. `video-flow-disrupted` covers both
`frozen` and `choppy` — the complaint behind
most "you're breaking up" reports. `pixelated-video` is additionally weighted by
[the presented size](#pixelation-and-the-presented-size).

### Transport quality — subtracts from the connection

| Issue type | Weight | Full cost | Severity from |
| --- | --- | --- | --- |
| `blocked-inbound-media-transport` | 1 | 5.00 | — |
| `blocked-outbound-media-transport` | 1 | 5.00 | — |
| `blocked-stun-requests` | 1 | 5.00 | — |
| `uplink-congestion` | 0.8 | 4.00 | `severity` |
| `downlink-congestion` | 0.8 | 4.00 | `severity` |
| `transport-loss-sustained` | 0.7 | 3.50 | — |
| `transport-delay-degraded` | 0.5 | 2.50 | — |
| `congestion` | 0 | 0.00 | — |

`congestion` is priced at zero on purpose. The deprecated `CongestionDetector`
still raises it, and both directional detectors emit the event of that name too,
so pricing it would charge the same episode twice. Read `uplink-congestion` and
`downlink-congestion` instead.

The three `blocked-*` issues are media being dropped outright while signalling
survives. Both congestion detectors measure how deep the trouble is, so both are
read rather than assumed.

## Where the reasons surface

- **The realtime `'score'` event** carries the client-level aggregate of the
  current tick's reasons (`currentReasons`) with their magnitudes.
- **Each monitor** (`pcMonitor.scoreReasons`, `trackMonitor.scoreReasons`)
  holds only its *own* reasons — a low track score is explained on the track,
  not on the peer connection.
- **The samples** carry `scoreReasons` as a record of issue type → subtracted
  points (`Record<string, number>`) per entity, magnitudes included. Set
  `sendScoreReasonsToServer: false` to drop the reasons from the wire.
- **`calculator.totalReasons`** accumulates the same keys across the whole call,
  which is what to read for "what dominated this session".

See the README's [Score Reasons](../README.md#score-reasons) section for
examples.

## Tuning

**Retuning what a fault costs is an edit to one table.** `ISSUE_SCORING` is
exported and mutable:

```typescript
import { ISSUE_SCORING } from '@observertc/client-monitor-js';

// this deployment cares more about blocky video than about lip-sync
ISSUE_SCORING['pixelated-video'].weight = 0.8;
ISSUE_SCORING['av-desync'].weight = 0.2;
```

**Retuning when a fault is raised at all** is an edit to that detector's config,
which is where every threshold now lives. The two are independent: the detector
config decides whether the issue exists, and the table decides what it costs.

**Checking for holes:**

```typescript
import { unscoredIssueTypes } from '@observertc/client-monitor-js';

console.warn(unscoredIssueTypes(myIssueTypes));   // [] in a healthy build
```

The pixelation size tiers are `public static` fields on `DefaultScoreCalculator`
(`PIXELATION_WEIGHT_LARGE`, `PIXELATION_WEIGHT_SMALL`,
`PIXELATION_LARGE_MAGNIFICATION`, `PIXELATION_SMALL_MAGNIFICATION`), as are the
smoothing lengths (`lastNScoresMaxLength`, `lastNScoresMinLength`).

For entirely different scoring logic, replace the calculator: see the
README's [Custom Score Calculator](../README.md#custom-score-calculator)
section.
