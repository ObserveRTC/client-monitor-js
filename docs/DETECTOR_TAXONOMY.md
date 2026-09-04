# Detector Taxonomy

This document is the **map and the rules**: the five categories every detector
belongs to, what puts a detector in one rather than another, the rules that keep
the boundaries from drifting, and an index of all 46 classes.

It is deliberately not the detail. Each category has its own deep reference, and
that is where the algorithms, thresholds, payloads, stand-downs and failure modes
live:

| Category | Deep reference | The chair it is written from |
|---|---|---|
| 1 Connectivity | [CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md) | A network engineer's — the five layers a connection climbs |
| 2 Transport Quality | [TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md) | A network engineer's — the four properties of a working path |
| 3 Pipeline Disruption | [PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md) | A WebRTC engineer's, with a broken call in front of them |
| 4 Perceived Quality | [PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md) | The participant's — what they see and hear |
| 5 Telemetry | [TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md) | An application engineer's — what this session *was* |

It exists because "the call was bad" is not a diagnosis. Each category answers one
question about a session, and each detector answers one condition within its
category — so that an engineer reading a failed session knows which of four
completely different investigations to start, and which facts to read alongside
them.

The score system that consumes some of these issues is documented in
[SCORE_CALCULATIONS.md](./SCORE_CALCULATIONS.md). For the API around issues and
events, see the *Events and Issues* section of the
[README](../README.md#events-and-issues).

- [The five categories](#the-five-categories)
- [What decides the category: the shape of the detection](#what-decides-the-category-the-shape-of-the-detection)
- [The five definitions](#the-five-definitions)
- [The overlap rule](#the-overlap-rule)
- [Category is not subject](#category-is-not-subject)
- [The five design rules](#the-five-design-rules)
- [Detectors are independent](#detectors-are-independent)
- [Issue, event, metric or attribute](#issue-event-metric-or-attribute)
- [When inputs are missing](#when-inputs-are-missing)
- [The full map](#the-full-map)
- [Renamed and split detectors](#renamed-and-split-detectors)
- [Known deviations](#known-deviations)

## The five categories

```
1  CONNECTIVITY          Can this endpoint establish and keep the path?
        │
        ▼
2  TRANSPORT QUALITY     The path exists — is it carrying traffic well enough?
        │
        ▼
3  PIPELINE DISRUPTION   Did the media chain stop, or do two components disagree?
        │
        ▼
4  PERCEIVED QUALITY     Is what the user actually sees and hears degraded?

        ┌───────────────────────────────────────────────────────────┐
        │  5  TELEMETRY   What is this session's shape, and what     │
        │                 changed about it?  (beside, not below)     │
        └───────────────────────────────────────────────────────────┘
```

**Categories 1–4 are ordered; category 5 sits beside them.** The first four are
the ladder — each raises issues, and a failure low down usually produces symptoms
above it. Telemetry has no rung: it raises nothing, so there is no "start at the
lowest telemetry that fired". It is the context you read *alongside* the ladder.

The arrows are the order to read a failed session in, not a dependency: **start at
the lowest category that raised an issue** and treat the rest as consequences.
They are not, however, causally chained inside the library — see
[Detectors are independent](#detectors-are-independent).

## What decides the category: the shape of the detection

The categories are not "where in the stack" — that cut fails, because the same
place in the stack produces completely different kinds of failure. The
discriminator is **what the detection algorithm actually looks for**.

That is worth insisting on because it is mechanically checkable. A new detector
sorts itself: ask whether it watches for something to **stop** (disruption) or for a
number to **get bad and stay bad** (quality), and whether the subject is the
**path**, the **endpoint's media chain** or the **user's experience**. A taxonomy
built on "cause versus symptom" instead needs a judgement call every time, and
drifts within a year.

### The five definitions

Each category is one question, one detection shape, and one membership test.

| | Question | Detection shape — reads like | Membership test |
|---|---|---|---|
| **1 Connectivity** | Can this endpoint establish and keep the communication path the session needs? | A stage's proof of progress is missing altogether: ICE never nominated a pair; DTLS never completed | The subject is the path itself, and the failure is a stage that never completed or stopped holding |
| **2 Transport Quality** | The path is established and stable — is it carrying traffic well enough? | A continuously-measured property of a *working* path is bad: round trip above 300 ms for six seconds; loss above 5% | Every stage completed, and the path is still the reason the call is bad |
| **3 Pipeline Disruption** | Did the media chain stop somewhere, or do two adjacent components disagree? | A monotonic counter went flat, or two adjacent ones disagree: frames encode, no packets leave | You can name the boundary at which progress stopped |
| **4 Perceived Quality** | Is what the user sees and hears degraded, badly enough and long enough to matter? | A perceptual value is severely degraded and *stays* degraded: 0.4 s of audio invented beyond the allowance, and not yet drained | Everything is still running, and it is still bad |
| **5 Telemetry** | What is this session's shape, and what changed about it? | A fact changed, and no threshold on it would ever be right: the codec switched; the selected tuple moved | Would raising an issue here *ever* be the right thing to do? If no, it is Telemetry |

Telemetry's test is deliberately counterfactual — *would it ever be right to*, not
*does it today*. That phrasing is what stops the category becoming a bucket for
detectors nobody got around to finishing. **A detector never lands in Telemetry
because of a bug.**

## The overlap rule

Some conditions are discrepancies where **the network is one of the two
disagreeing components** — the sender produces bytes the wire does not carry, or
the transport receives bytes no RTP stream accounts for. Their detection shape
says Pipeline Disruption; their subject says something else.

> **If one side of the disagreement is the network, it is not Pipeline
> Disruption. If both sides are inside this endpoint's media chain, it is.**

What settles it is what an engineer does next. `blocked-transport` compares what the
senders produce against what the ICE transport puts on the wire: the fix is a
network fix — relay over TLS, change networks — and nothing local is broken, so it
is Transport Quality. `rtp-sender-stalled` compares counters either side of the RTP
sender, and `transport-demux-stalled` compares the transport against the inbound RTP
streams that should demux from it: both fixes are local or signaling, so both are
Pipeline Disruption. `transport-demux-stalled` is the closest call in the library
and lands there because the transport is not the *subject* — bytes arrive perfectly
well, and this endpoint's receiver does not know what to do with them.

The same rule retired connectivity layer 6, where `BlockedTransportDetector` was
filed as "media flow" on the reasoning that the network is the subject — which
proves too much, since the network is the subject of all of Transport Quality.

## Category is not subject

**The single most confusing thing about the map, so it gets its own rule: a
class's category is decided by the question it answers, not by what it is about
and not by where it is documented.**

Three classes make the point. `IceTraversalDetector`, `IceRestartDetector` and
`IceRestartRecommendationDetector` are **Telemetry**. Their subject is
connectivity, their configuration lives under the connectivity keys, every fact
they read is a connectivity fact, and all three are documented in
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md) beside the ladder they
describe. They are still Telemetry, because each fails the counterfactual test:
needing TURN is a cost rather than a fault, a path that moved once is a handover,
and a restart is what a healthy application *does* when the network changes
underneath a call — so an issue would flag the recovery rather than the problem.
Forcing category and location to agree would move them away from the ICE model
they only make sense inside.

The rule runs the other way too. **"Raises no issue" is not "is Telemetry."** Ten
classes emit only events; eight are Telemetry and two are not:

| Class | Category | Why it is not Telemetry |
|---|---|---|
| `IcePathEstablishmentDetector` | Connectivity, layer 3 | "Establishment is taking a long time" is not yet a claim that establishment *failed*. That claim is a separate class with a separate threshold — `IceEstablishmentFailedDetector`, raising `ice-establishment-failed`. The event-only shape is the design, not a gap |
| `AudioPlayoutSynthesisDetector` | Perceived Quality | It *fails* the counterfactual test: a listener hearing invented speech across a sustained window is a fault worth raising. A Category 4 detector with a missing issue, not a fact about the session |

Filing either under Telemetry would put a genuine finding somewhere nobody looks
for findings.

## The five design rules

These are the rules the implementations follow, as distinct from the rules that
decide which category a detector lands in. They are what makes the map hold
together: a taxonomy that says one detector answers one condition is worth nothing
if the classes are free to answer three. Each deep reference shows its own category
obeying them; what follows is the statement of the rule.

### 1. One detector class raises exactly one issue type

A detector that would raise two different issues is two detectors. As a corollary
it generally keeps at most **one collection** — one map, set or array — for the
thing it tracks, because a second collection is almost always the second issue
trying to get back in.

The reasons are practical. `Detectors.update()` wraps each `update()` in its own
try/catch, so a class owning four findings loses all four to one malformed stats
report while four classes lose one. `disabled` and `includeIssueInSample` are per
detector, so four findings in one class can only be silenced as a block. And four
conditions in one class accumulate shared state that couples them, which is what
made splitting the ICE stability findings hard.

What the rule explicitly does **not** do is rename issues. The issue type is the
public contract that `observer-js` and dashboards consume; the class is an
implementation unit. `IcePathStabilityDetector` became six classes and not one
issue type changed.

A detector may still carry a **payload discriminator** where one condition has two
forms an engineer would investigate the same way — `blocked-transport`'s
`evidence`, `video-choppy`'s `evidence`, `transport-loss-sustained`'s `direction`.
The test is the one every issue type must pass, applied one level down: "nothing,
but I would want to know which" is a field; "an entirely different investigation"
is a second detector. `IceRestartRecommendationDetector` is the one standing
exception, holding four recommendation reasons — legitimately, because they produce
one *event* type rather than four issue types and because rate limiting across them
only means anything if it is shared.

### 2. Implementations stay deliberately simple

There is no shared base class, no `AbstractThresholdDetector`, no helper for
"accumulate a duration and raise past a threshold" — even though roughly half the
detectors do exactly that. **Duplicated straightforward bookkeeping is preferred to
a shared abstraction.**

What is bought is that each file reads start to finish without reading any other,
and that no detector can be broken by a change made for a different one. A shared
threshold helper would grow a parameter per variation — this one resets on restart,
that one does not; this one needs a maturity guard, that one judges from the first
tick — until it is harder to reason about than the twenty lines it replaced.

#### The one boundary: derived values live on the monitored object

**The monitor computes the fact; the detector holds the opinion.** `bitPerPixel`,
`ewmaFps`, `fpsVolatility`, `avgFramesPerSec`, `timeStretchRate` and the
jitter-buffer delays live on `InboundRtpMonitor`; `avgInboundFractionLost`,
`avgOutboundFractionLost`, `avgInboundJitterInMs`, `avgRttInSec` and `ewmaRttInSec`
on `PeerConnectionMonitor`; `sourceFps` and `rmsAudioLevel` on
`MediaSourceMonitor`. Detectors compare them against thresholds and time how long
the answer stayed bad.

A derived value is a fact about the stream that anything may want — a score
calculator, an application, a second detector — while a threshold is an opinion
belonging to whoever is judging. Putting the arithmetic on the monitored object
makes the fact available without a detector in the way, and it is why the video
quality and transport threshold detectors are each well under a hundred lines: they
hold no window, no ring buffer and no statistics. As of 4.10.0 no detector
re-derives a value the monitor also computes. The last two both stopped that
release: `InventedSpeechDetector` had the better reason — it judged a ratio over a
sliding window, and summing per-tick ratios is not the ratio of the sums — and its
rewrite integrates a rate over elapsed time instead, so it now reads
`inventedSpeechRatio` off the monitor; `AudioDesyncDetector` had the weaker one, a
second normalization of the two NetEQ counters behind `timeStretchRate`, and was
deleted outright.

One derived value sits a level higher than the rest and has to.
`linkedVideoPlayoutDiffInMs` — this audio track's `estimatedPlayoutTimestamp` minus
that of the video track the application paired it with — lives on
`InboundTrackMonitor`, because it is the library's only fact computed from **two**
streams and neither RTP monitor owns the pair. `AVDesyncPlayoutDetector` reads it and holds
only the opinion about how much skew is too much, which is the rule working rather
than an exception to it.

### 3. Condition duration is measured in stats time

A detector measuring how long something has held accumulates the monitored object's
**`deltaTime`** — the difference between consecutive stats reports' `timestamp`s —
rather than wall-clock elapsed. Where what it needs is a *timeline* rather than a
duration — a window with a beginning and an end, rather than "how long has this
been true" — it reads the monitored object's **`statsClockTime`**, which is that
same `deltaTime` already accumulated: every monitor that computes one carries it,
it starts at zero, it never goes backwards, and only differences between two
readings mean anything. The two capacity detectors age their rolling windows on
it. A detector keeping its own accumulator of the same quantity is doing a
monitor's arithmetic; the exception is `InboundVideoFlowStateDetector`, which
deliberately counts only the collections it could *read* rather than all the time
that passed — see its class doc. `Date.now()` survives for the issue lifecycle only:
`raisedAt`, the `durationInMs` computed at resolution, and `resolvedAt`. Emission
rate limiting (the ICE restart recommendation cooldowns) is wall clock too, because
it is about how often to speak, not how long a condition held.

This matters most in exactly the conditions these detectors fire under. A saturated
main thread, a backgrounded tab or a throttled timer makes collections run late or
be skipped; measured against the wall clock, a tab hidden for a minute has
"watched" a minute of failing gathering, blocked media and stalled handshake, and
every duration threshold crosses at once on the tick it comes back, on evidence
nobody observed. The rule cuts the other way as well, which is the half that is
easy to miss: a late collection means the condition held *longer* than one nominal
period, and `deltaTime` credits it with that. Each clock reads the `deltaTime` of
the object whose counters it compares, never a global one.

**Every detector in the tree follows the rule**, including the three that used to
measure establishment and gathering against the wall clock. Two exceptions are
documented rather than tolerated, and both measure the *instrument* rather than the
call: `CpuPerformanceDetector`'s `durationOfCollectingStatsInMs` signal, and
`StatsGapDetector` entirely — **how late the library ran is exactly what the latter
exists to measure**, and stats time is by construction the clock that cannot see it.

Four detectors count **collections** rather than milliseconds, through a
`minConsecutiveTicks`. That is a confidence floor — one noisy stats read cannot open
an issue — rather than a persistence bar, and unlike a duration it scales with
`collectingPeriodInMs`.

### 4. One detector, one config block

Every detector reads a block of its own, keyed by its `name` in camelCase:
`frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector` and nothing
else. **No key is shared between detectors, and no detector reads a neighbour's
block.** The type of each block is declared in the detector's own file — `export
type <ClassName>Config` — and `ClientMonitorConfig` imports it with `import type`
and declares the key as `<ClassName>Config | null`.

This is the config counterpart of rule 1. If one detector answers one condition,
then one detector is what an operator should be able to tune or switch off, and a
key shared by six classes makes that impossible: `null` meant to silence one
finding takes five neighbours with it, silently, and nothing in the config says so.
Borrowing is the same failure without the `null` — a threshold read out of another
detector's block means tuning that detector retunes this one, invisibly, and it
also makes the verdict depend on whether the other detector was registered at all.

Where two detectors genuinely want the same tunable, **each carries its own copy
with its own default**. The duplication is the point: two detectors asking
different questions of the same measurement should be able to disagree about where
the line is. The defaults may be equal today — `createEvent` on the two capture
detectors and on the two restart detectors, `thresholdInMs` on the two
stage-boundary detectors, `encoderPerformanceDetector.sourceSupplyRatioThreshold`
against `sourceCaptureBottleneckDetector.captureFpsRatioThreshold` — and they are free
to move apart without either detector noticing the other.

Declaring the type beside the detector follows from the same idea. The key belongs
in `ClientMonitorConfig`, because that is the object an application writes; the
shape of what goes in it belongs next to the code that reads it, so adding a
tunable is one file's worth of edit and a field's doc comment sits beside the logic
it governs rather than in a list of forty-five blocks. The block-level comment —
what the detector is for, that `null` disables it — stays in `ClientMonitorConfig`.
The import has to be `import type`: detector files reach monitors, monitors reach
`ClientMonitor`, and `ClientMonitor` reaches `ClientMonitorConfig`, so a value
import would close that cycle at runtime.

**A test enforces both halves.** `tests/detectors/DetectorTaxonomy.spec.ts` reads
`src/detectors/` and checks that every detector source touches only its own config
block, and that every config type is exported from the detector's own file,
`import type`d by `ClientMonitorConfig` and used to type that detector's key —
plus that nothing is left declaring a block inline. It reads the directory rather
than a list, so a detector added tomorrow is in scope the moment its file exists. A
companion test sets each key to `null` in turn and asserts that **exactly one**
detector disappears from the registries, which is the behaviour the rule exists to
give and the half that used to fail. There are eight registries — the client
monitor's, the peer connection's, each ICE transport's, one per track direction and
kind, and the media playout monitor's — and the test compares all eight, so a
detector that moved between them cannot slip through.

A detector with nothing to tune still gets a key. `dtlsHandshakeFailedDetector`,
`iceConnectionFailedDetector` and `iceTraversalDetector` are typed
`Record<string, never>` — `{}` enables, `null` disables — because a terminal state
needs no threshold and a telemetry report needs no bar, and "nothing to tune" is
not a reason to make a detector the one nobody can switch off.

### 5. A detector never infers the raw stats it needs

**And neither does a monitor.** The rule is really about a layering the whole library
keeps: *adapters* make the stats spec-conformant, *monitors* read spec-conformant stats
and derive facts from them, *detectors* threshold those facts. Compensating for a browser
that omits or misreports a spec-required field belongs in the adapter — `inferTransportId()`
restoring `transportId`, `FirefoxStatsAdapter` reconstructing a transport report from the
selected candidate pair — and nowhere else.

A monitor that patches a missing field puts the same rule at two layers, and the monitor's
copy is the one nothing tests against real browser output. So at monitor level an
undefined field stays undefined, and every value derived from it is undefined too: the
adapter already had its chance to infer it, and if it could not, there is nothing left to
know. Two fixes in 4.10.0 came from applying this: `IceTransportMonitor.getOutboundRtps()`
/ `getInboundRtps()` are a plain `transportId` lookup, and `IceCandidateMonitor.isRelay`
reads `candidateType` alone rather than falling back to `relayProtocol`.


**A detector detects where the browser supplies the stats, and declines to judge
where it does not.** It does not reconstruct a missing counter from unrelated ones,
and it does not assume a plausible value for one.

Reading a *different real measurement of the same traffic* is not inference and is
fine: `BlockedTransportDetector` falls back from `RTCTransportStats.bytesSent` to
the selected candidate pair's own byte delta, which is the same bytes counted at a
neighbouring point. What the rule forbids is manufacturing the observation —
deriving "STUN must still be answering" from the fact that ICE reads `connected`,
say, or treating an unreported `packetsDiscardedOnSend` as proof that nothing was
discarded.

The reason is that an inferred input makes a finding mean something different
depending on which browser produced it, and nothing downstream can tell the two
apart. A `blocked-transport` issue raised on a real consent counter and one raised
on an assumption about consent arrive at the server identically; a fleet-wide count
of them then mixes measurements with guesses, and the guess rate varies by browser
version. **A detector that guesses is worse than one that stays quiet**, because
quiet is honest and legible — which is what
[`inputsUnavailable`](#when-inputs-are-missing) exists to make it.

The rule has teeth mostly where a load-bearing stat is not universal, and several
are not: `RTCTransportStats` byte counters (absent on Firefox through 153),
`responsesReceived` (Firefox 142+), `estimatedPlayoutTimestamp` (Firefox only),
`packetsDiscardedOnSend`. Each of those is a place where a detector could have been
made to work everywhere by inventing the number, and none of them is.

Where a detector cannot substitute and cannot judge, the tick is unavailable rather
than healthy, and the detector says so. `BlockedTransportDetector` is the worked
example: without `responsesReceived` there is no proof the path still answers, no
substitute exists, and it declines to judge that transport at all rather than
reading ICE's `connected` as consent.

## Detectors are independent

**Every detector reaches its verdict from raw observations alone.** It must not
depend on another detector firing, being enabled, or having an issue active.

This is not a style preference. `Detectors.update()` already wraps each detector in
its own try/catch, so they fail independently; making them *decide* independently is
what lets any of them be disabled, reordered or replaced without silently changing
another's behaviour. Two detectors firing at once for the same underlying cause is
expected and fine — an overloaded encoder and a frozen picture are two true
observations, and **correlating them is the server's job, not a detector's**.
Detection is not correlation: a detector that asks "has anyone else noticed
something?" has stopped detecting.

As of the current tree **no built-in detector reads another detector's issue**, and
**registration order carries no meaning between detectors** — the order the
`PeerConnectionMonitor` constructor lists them in documents the layer model and
nothing more. So any detector may be disabled at runtime without changing what
another concludes, and a custom detector may be inserted anywhere without side
effects.

Where one detector genuinely should stand down on a condition another also watches,
it evaluates that condition **from the same raw inputs**. Three worked
re-derivations, all of which used to be cross-detector reads:

- **`EncoderPerformanceDetector`** stands down on a short capture source, derived
  from `mediaSource.sourceFps` against `track.getSettings().frameRate` rather than
  from `SourceCaptureBottleneckDetector`'s `capture-bottleneck` issue. Reading the
  conclusion made the verdict depend on whether that detector was registered at all,
  and on which of the two `OutboundTrackMonitor` happened to construct first. They
  still agree on defaults, because they read the same two numbers — but the ratio
  each compares them against is its own field, `sourceSupplyRatioThreshold` here
  and `captureFpsRatioThreshold` there, per [design rule
  4](#4-one-detector-one-config-block). Sharing one field was the last thread
  between them: raising the bar for blaming the camera silently widened the range
  in which the encoder was excused.
- **`IceRestartRecommendationDetector`** spells out the whole transport-stall
  condition itself rather than asking `IceTransportStalledDetector`, at a cost of
  about twenty duplicated lines.
- **`VideoRecoveryFailedDetector`** derives "the picture is stuck" from
  `deltaFramesRendered` and `deltaKeyFramesDecoded` rather than from
  `inboundRtp.isFreezed`, which is `FrozenVideoTrackDetector`'s conclusion and
  vanishes if `frozenVideoTrackDetector` is `null` — and which is a broader claim
  than this detector needs.

The same discipline removed `suspectedIssueTypes`, which annotated
`media-pipeline-stalled` payloads with every other issue active on the peer
connection — making one detector's output a function of every other detector's
verdicts and of the order they ran in. One deviation remains, outside the detectors
themselves: see [Known deviations](#known-deviations).

## Issue, event, metric or attribute

Not every useful observation is a problem, and the fastest way to make a category
worthless is to fill it with things nobody can act on. Before adding a detector,
classify the observation:

| | Meaning | Lifecycle | Example |
|---|---|---|---|
| **ISSUE** | A condition an engineer would act on differently from its neighbours | Raised, held, resolved | ≥3 selected-pair changes in 30 s |
| **EVENT** | Something happened, with a timestamp and a from/to | Fires once, gone | A candidate pair changed once; an ICE restart |
| **METRIC** | A number useful trended, meaningless as a single reading | Sampled | `selectedCandidatePairChanges`; relay time share |
| **ATTRIBUTE** | A property of the session, constant until it changes | On the sample, re-sent when it changes | The selected path is TURN/TLS; the codec in use |

Needing TURN is an ATTRIBUTE — a relay call works, and it costs latency, not
correctness. Falling back to TURN/TCP is an EVENT. The share of a session's bytes
that went over a relay is a METRIC. A path that changes three times in thirty
seconds is an ISSUE, because no path survived even a few consent intervals and that
is oscillation rather than migration. The damage a mis-filed issue does is not the
false alarm but the reflex: an issue firing on a third of a healthy fleet's sessions
trains operators to filter the whole category out.

The test every proposed issue must pass: **what does an engineer do differently
after seeing this, that they would not do for the issue next to it?** If there is no
answer, it is telemetry — or a payload field on the issue next to it, which is the
answer design rule 1 gives for the near misses.

One raw signal may legitimately feed both a telemetry record and an independent
detector — the selected candidate pair changing yields two events *and* an
`unstable-ice-path` issue, derived from the same stats without either reading the
other's conclusion. That is the difference between recording a fact and judging it.

## When inputs are missing

A detector that stays quiet is saying one of two completely different things:
*nothing is wrong*, or *the browser did not report the stats I need, so I cannot
see whether anything is wrong*. From the outside those look identical, and a
dashboard counting issues without distinguishing them reads the second as a healthy
session.

`inputsUnavailable` — a public boolean field on the detector classes that can
compute it, set per tick and only for missing **evidence** — is the distinction.
It is deliberately *not* on the `Detector` interface. That contract carries only
what the registry needs to run a detector and what an application needs to toggle
one, and nothing in the library reads the flag yet; it moves onto the interface if
and when something actually decides on it. Reading it therefore means naming the
class — `detectors.getByName<TransportDelayDetector>('transport-delay-detector')`,
or a cast.

The case is not hypothetical. Firefox still does not populate `bytesSent` /
`bytesReceived` on `RTCTransportStats` as of 153, so `BlockedTransportDetector` and
`TransportDemuxStalledDetector` — which rest their whole verdict on a transport
bitrate — set the flag on a tick without one. `BlockedTransportDetector` sets it
for a second stat as well, and that one has no substitute: without the candidate
pair's `responsesReceived` (Firefox 142+) there is no proof the path still answers,
so it declines to judge that transport rather than reading ICE's `connected` as
consent — [design rule
5](#5-a-detector-never-infers-the-raw-stats-it-needs) in its sharpest form. Eight others set it for the
measurement each depends on: `TransportDelayDetector`, `TransportLossDetector`,
`TransportJitterDetector`, `PixelatedVideoDetector`, `ChoppyVideoDetector`,
`FrameAssemblyStalledDetector`, `InventedSpeechDetector` and `AVDesyncPlayoutDetector`.

**`AVDesyncPlayoutDetector` is the clearest illustration of why the flag exists**, because
for that class being unable to see is the *ordinary* state rather than the
exception. It needs two things it cannot produce itself: a video track the
application has declared as this audio track's pair, and an
`estimatedPlayoutTimestamp` on both — a field Firefox populates, Chrome exposes only
when A/V sync is enabled internally, and Safari does not report at all. Miss either
and there is no skew to judge. Without the flag, an application that never declared
a pairing and a fleet running mostly Safari would both look exactly like a fleet
with perfect lip sync, and the second reading is the one a dashboard would take.
With it, "no `av-desync` issues" and "no `av-desync` measurements" are two different
answers.

**The flag changes nothing about the verdict.** Without evidence a detector still
raises nothing; the flag only makes the silence legible.

A detector standing down because a track is paused, a tab is backgrounded or a
sender is muted **is not** unavailable. That is *not applicable*, a different
statement about a different thing: the detector could judge, and there is nothing to
judge. Only a missing measurement sets the flag.

Twelve of the 46 classes set it, which is not enough — see
[Known deviations](#known-deviations).

## The full map

**46 detector classes, 36 issue types, 10 event-only classes.** One class, one
issue type — so within each table the class column and the issue column are the
same list read twice, which is the point of the arrangement.

The tables are grouped strictly by **category**, which for three classes is not
where they are documented; see [Category is not subject](#category-is-not-subject).
The config-key column is a one-to-one mapping in both directions, per [design rule
4](#4-one-detector-one-config-block): each class reads that key and no other, and
each key governs that class and no other. Passing `null` for one leaves exactly one
class unregistered — that is how a detector is turned off, by key and never by name.

Every detector class also carries a `Category:` / `Layer:` stamp in its own source
doc comment, naming where it sits in these tables. `tests/detectors/DetectorTaxonomy.spec.ts`
holds `DETECTOR_CATEGORIES` and `DETECTOR_LAYERS`, the machine-readable copy of the
category and layer columns, and enforces four things against them: every registered
detector has a row, every file in `src/detectors/` carries both halves of the stamp,
every stamped category agrees with the row, and **every stamped layer agrees with it
word for word**. So the source, this document and the spec cannot drift apart — a
detector added without a stamp, or stamped with a category or a layer that disagrees
with the map, fails the test rather than quietly becoming uncategorised.

The layer text is one spelling everywhere, and it is the **`##` sub-layer heading of
the category's deep reference** — `Send — capture to frame supply`, not the `S1
capture → frames` grid code the same document uses as shorthand. Each deep reference
remains the authority on its own layer names; a grid code is useful inside the
document that defines it and meaningless in the column here. Connectivity's rows drop
the leading word because the stamp supplies it: `Layer: 5 — Path continuity` reads
back as that document's heading, *Layer 5 — Path continuity*.

### Category 1 — Connectivity

> **Deep reference: [CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md)**

Five layers, each beginning where the previous one's success is proven, with every
issue belonging to the **first** layer whose proof fails. It says nothing about how
*well* a working path carries traffic; that is Category 2.

**9 classes, 8 issue types**, all bound to `PeerConnectionMonitor`.

| Class | `name` | Raises | Layer | Config key |
|---|---|---|---|---|
| `IceReachabilityDetector` | `ice-reachability-detector` | `no-available-ice-candidate` | 1 — Reachability | `iceReachabilityDetector` |
| `IcePathEstablishmentDetector` | `ice-path-establishment-detector` | *event only* — `ice-path-establishment-slow` | 3 — Path establishment | `icePathEstablishmentDetector` |
| `IceEstablishmentFailedDetector` | `ice-establishment-failed-detector` | `ice-establishment-failed` | 3 — Path establishment | `iceEstablishmentFailedDetector` |
| `DtlsHandshakeFailedDetector` | `dtls-handshake-failed-detector` | `dtls-handshake-failed` | 4 — Secure transport | `dtlsHandshakeFailedDetector` |
| `DtlsHandshakeStalledDetector` | `dtls-handshake-stalled-detector` | `dtls-handshake-stalled` | 4 — Secure transport | `dtlsHandshakeStalledDetector` |
| `IceDisconnectedDetector` | `ice-disconnected-detector` | `ice-disconnected` | 5 — Path continuity | `iceDisconnectedDetector` |
| `IceConnectionFailedDetector` | `ice-connection-failed-detector` | `ice-connection-failed` | 5 — Path continuity | `iceConnectionFailedDetector` |
| `IceTransportStalledDetector` | `ice-transport-stalled-detector` | `ice-transport-stalled` | 5 — Path continuity | `iceTransportStalledDetector` |
| `UnstableIcePathDetector` | `unstable-ice-path-detector` | `unstable-ice-path` | 5 — Path continuity | `unstableIcePathDetector` |

Layer 2 holds no connectivity class: `IceTraversalDetector` sits there and is
Telemetry, as are `IceRestartDetector` and `IceRestartRecommendationDetector` beside
the ladder. All three are documented in the connectivity deep reference; their rows
are in the Telemetry table below.

### Category 2 — Transport Quality

> **Deep reference: [TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md)**

The path exists, ICE is connected, DTLS completed, and the transport is still the
reason the call is bad. Four **independent** properties of one working path — not a
ladder: a path can be slow without being congested, congested without losing
packets, lossy without being jittery. Because none consults another, their co-firing
is evidence rather than an echo.

**6 classes, 6 issue types**, all bound to `PeerConnectionMonitor`.

| Class | `name` | Raises | Sub-layer | Config key |
|---|---|---|---|---|
| `UplinkCongestionDetector` | `uplink-congestion-detector` | `uplink-congestion` | Capacity | `uplinkCongestionDetector` |
| `DownlinkCongestionDetector` | `downlink-congestion-detector` | `downlink-congestion` | Capacity | `downlinkCongestionDetector` |
| `TransportDelayDetector` | `transport-delay-detector` | `transport-delay-degraded` | Delay | `transportDelayDetector` |
| `TransportLossDetector` | `transport-loss-detector` | `transport-loss-sustained` | Delivery reliability | `transportLossDetector` |
| `BlockedTransportDetector` | `blocked-transport-detector` | `blocked-transport` | Delivery reliability | `blockedTransportDetector` |
| `TransportJitterDetector` | `transport-jitter-detector` | `transport-delivery-unstable` | Delivery stability | `transportJitterDetector` |

The two delivery-reliability classes share a sub-layer because they are the two ends
of one axis: `transport-loss-sustained` is a path dropping a *share* of what crosses
it, `blocked-transport` a path dropping *all* of it by policy rather than capacity.

### Category 3 — Pipeline Disruption

> **Deep reference: [PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md)**

Media moves through two chains — `capture → frame supply → encoder → RTP sender`
and `RTP receiver → frame assembly → decoder → renderer` — and every stage carries a
monotonic counter proving progress. A disruption is **locatable**: the boundary
where the upstream counter advances and the downstream one does not. That is what
makes the category worth having separately from Perceived Quality — it does not say
the call is bad, it says *where* it broke.

**16 classes, 16 issue types** — the largest category.

| Class | `name` | Raises | Boundary | Config key |
|---|---|---|---|---|
| `CaptureTrackEndedDetector` | `capture-track-ended-detector` | `capture-track-ended` | Send — the source | `captureTrackEndedDetector` |
| `SilentAudioSourceDetector` | `silent-audio-source-detector` | `silent-audio-source` | Send — the source | `silentAudioSourceDetector` |
| `SourceCaptureBottleneckDetector` | `source-capture-bottleneck-detector` | `capture-bottleneck` | Send — capture to frame supply | `sourceCaptureBottleneckDetector` |
| `EncoderPerformanceDetector` | `encoder-performance-detector` | `encoder-bottleneck` | Send — frames to encoder | `encoderPerformanceDetector` |
| `RtpSenderStalledDetector` | `rtp-sender-stalled-detector` | `rtp-sender-stalled` | Send — encoder to RTP sender | `rtpSenderStalledDetector` |
| `DryOutboundTrackDetector` | `dry-outbound-track-detector` | `dry-outbound-track` | Send — RTP sender to the wire | `dryOutboundTrackDetector` |
| `TransportDemuxStalledDetector` | `transport-demux-stalled-detector` | `transport-demux-stalled` | Receive — transport to RTP streams | `transportDemuxStalledDetector` |
| `DryInboundTrackDetector` | `dry-inbound-track-detector` | `dry-inbound-track` | Receive — the wire to the track | `dryInboundTrackDetector` |
| `FrameAssemblyStalledDetector` | `frame-assembly-stalled-detector` | `frame-assembly-stalled` | Receive — packets to frames | `frameAssemblyStalledDetector` |
| `DecoderBottleneckDetector` | `decoder-bottleneck-detector` | `decoder-bottleneck` | Receive — frames to decoder | `decoderBottleneckDetector` |
| `DecoderPerformanceDetector` | `decoder-performance-detector` | `video-decoder-overloaded` | Receive — frames to decoder | `decoderPerformanceDetector` |
| `StuckDecoderDetector` | `stuck-decoder-detector` | `stuck-decoder` | Receive — frames to decoder | `stuckDecoderDetector` |
| `PlayoutDiscrepancyDetector` | `playout-discrepancy-detector` | `inbound-video-playout-discrepancy` | Receive — decoder to renderer | `playoutDiscrepancyDetector` |
| `KeyframeStormDetector` | `keyframe-storm-detector` | `keyframe-storm` | Beside the receive chain — the repair loop | `keyframeStormDetector` |
| `VideoRecoveryFailedDetector` | `video-recovery-failed-detector` | `video-recovery-failed` | Beside the receive chain — the repair loop | `videoRecoveryFailedDetector` |
| `CpuPerformanceDetector` | `cpu-performance-detector` | `cpulimitation` | Across both chains — the machine | `cpuPerformanceDetector` |

**Send — processing to encoder input, the boundary between the capture callback and
the encoder, has no detector**, because no browser statistic sits there; its
failures are attributed to *Send — frames to encoder*, which is the sharpest
instance of the naming debt the deep reference records.

The two repair-loop classes are here rather than in Perceived Quality because
neither says the picture is bad — `frozen-video-track` says that. They say the
mechanism that exists to *fix* a bad picture is misbehaving or has stopped working,
which is a locatable break whose owner is an SFU operator.

`CpuPerformanceDetector` is the documented strain: its evidence is boundary
evidence, but `cpulimitation` names *why* rather than *where*, and causes are not
pipeline stages. It stays because a "Resource" category would have exactly one
member and would become the place every hard-to-classify detector goes — the same
gravity well connectivity layer 6 was.

### Category 4 — Perceived Quality

> **Deep reference: [PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md)**

Nothing stopped. Every counter is advancing, every component agrees — and the call
is still bad. Two properties are load-bearing here. **Sustained, not
instantaneous:** every class is windowed, tick-counted or hysteretic, because users
do not perceive ticks. **Aggressively pause-aware:** without stand-downs on pause,
mute and backgrounded tabs this would be the noisiest category rather than the most
actionable.

**7 classes, 6 issue types.** All bind to `InboundTrackMonitor` except
`AudioPlayoutSynthesisDetector`, which binds to `MediaPlayoutMonitor`. Perception
happens at the receiver, so a sender-side detector reporting the far end's
experience would be guessing.

| Class | `name` | Raises | Sub-layer | Config key |
|---|---|---|---|---|
| `PixelatedVideoDetector` | `pixelated-video-detector` | `pixelated-video` | Visual — clarity | `pixelatedVideoDetector` |
| `ChoppyVideoDetector` | `choppy-video-detector` | `video-choppy` | Visual — smoothness | `choppyVideoDetector` |
| `FrozenVideoTrackDetector` | `frozen-video-track-detector` | `frozen-video-track` | Visual — continuity | `frozenVideoTrackDetector` |
| `InventedSpeechDetector` | `invented-speech-detector` | `invented-speech` | Audio — continuity | `inventedSpeechDetector` |
| `AudioPlayoutSynthesisDetector` | `audio-playout-synthesis-detector` | *event only* — `synthesized-audio` | Audio — naturalness | `audioPlayoutSynthesisDetector` |
| `AVDesyncPlayoutDetector` | `av-desync-playout-detector` | `av-desync` | Synchronization | `avDesyncPlayoutDetector` |
| `JitterBufferStressDetector` | `jitter-buffer-stress-detector` | `audio-jitter-buffer-stress` | Responsiveness | `jitterBufferStressDetector` |

**Audio — clarity has no detector and the emptiness is a decision**, not a gap: no
client-side signal supports a claim about intelligibility, and the two candidate
substitutes are a condition already owned one sub-layer down wearing a second name,
or a telephony-era MOS model applied to a codec it was never calibrated for.

### Category 5 — Telemetry

> **Deep reference: [TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md)**

These classes record facts. They emit events, never raise issues, and have no
thresholds, severity, recovery condition or raise/resolve lifecycle, because what
they report is not a fault. What they buy is the missing column in most
investigations: *which* codec the bad calls were using, *when* the layer stopped
being sent, *whether* the path moved just before the complaint.

**8 classes, 0 issue types.**

| Class | `name` | Emits | Sub-layer | Config key |
|---|---|---|---|---|
| `IceTraversalDetector` | `ice-traversal-detector` | `ice-tuple-changed` | Transport | `iceTraversalDetector` |
| `IceRestartDetector` | `ice-restart-detector` | `ice-restart` / `ICE_RESTART` | Transport | `iceRestartDetector` |
| `IceRestartRecommendationDetector` | `ice-restart-recommendation-detector` | `ice-restart-recommended` / `ICE_RESTART_RECOMMENDED` | Transport | `iceRestartRecommendationDetector` |
| `CodecChangeDetector` | `codec-change-detector` | `codec-changed` / `CODEC_CHANGED` | Media | `codecChangeDetector` |
| `VideoResolutionChangeDetector` | `video-resolution-change-detector` | `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | Media | `videoResolutionChangeDetector` |
| `SimulcastLayerDetector` | `simulcast-layer-detector` | `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Media | `simulcastLayerDetector` |
| `CaptureTrackMutedDetector` | `capture-track-muted-detector` | `capture-track-muted` / `CAPTURE_TRACK_MUTED` | Lifecycle | `captureTrackMutedDetector` |
| `StatsGapDetector` | `stats-gap-detector` | `stats-collection-gap` / `STATS_COLLECTION_GAP` | Lifecycle | `statsGapDetector` |

The first three are documented in
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md), because their subject is
connectivity's; the other five are in
[TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md), which also covers the Session
and Endpoint sub-layers no detector carries at all. `IceTraversalDetector` used to
be the one detector registered unconditionally, silenceable only by name; it now
has a key like every other, `iceTraversalDetector`, carrying no tunables —
`{}` enables it, `null` disables it. So does `CaptureTrackMutedDetector`, which
used to come and go with the two capture classes that *do* raise issues.

`StatsGapDetector` is the odd member: its subject is the **measurement** rather than
the call, and it is the only signal that changes how you read the *others* — after a
collection gap the next interval's rates are fiction. Filing it in the ladder would
invite a reader to mistake a backgrounded tab for a processing failure.

## Renamed and split detectors

Detector `name` strings are the lookup key for `Detectors.getByName()` /
`disable()` / `enable()` / `has()` / `isEnabled()`, and **lookup is exact**. There
is no alias table: a name that no longer exists returns `undefined` from
`getByName()` and `false` from `has()`, `disable()` and `enable()`.

**An alias could only ever have pointed at one part of a split.** A name resolves
to exactly one detector, so an old spelling for a class that became several would
have picked one of the parts — an application toggling `ice-path-stability-detector`
by its old name would have kept working while quietly governing one of the six
classes it used to cover. A failed lookup is an answer the caller can act on; a
silently narrowed one is not.

The table is migration guidance, not resolution. It records what each retired name
became; every one of them now fails the lookup.

| Retired name | What it became |
|---|---|
| `ice-path-stability-detector` | `ice-disconnected-detector`, `ice-connection-failed-detector`, `ice-transport-stalled-detector`, `unstable-ice-path-detector`, `ice-restart-detector`, `ice-restart-recommendation-detector` |
| `ice-connectivity-detector` | as above |
| `dtls-handshake-detector` | `dtls-handshake-stalled-detector`, `dtls-handshake-failed-detector` |
| `capture-failure-detector` | `capture-track-ended-detector`, `silent-audio-source-detector`, `capture-track-muted-detector` |
| `media-pipeline-detector` | `rtp-sender-stalled-detector`, `transport-demux-stalled-detector` |
| `ice-tuple-change-detector` | `ice-traversal-detector` (a straight rename) |
| `no-available-ice-candidate-detector` | `ice-reachability-detector` |
| `long-pc-connection-establishment-detector` | `ice-path-establishment-detector` |
| `audio-concealment-detector` | `invented-speech-detector` (a straight rename, of a class rewritten around it) |
| `audio-desync-detector` | `av-desync-playout-detector` (a different detector, measuring a different quantity — see below) |
| `freezed-video-track-detector` | `frozen-video-track-detector` (a spelling fix; the issue type moved with it) |
| `synthesized-samples-detector` | `audio-playout-synthesis-detector` (a straight rename) |
| `inbound-frame-supply-detector` | `decoder-bottleneck-detector` (a straight rename) |
| `outbound-frame-supply-detector` | `source-capture-bottleneck-detector` (a straight rename) |
| `congestion-detector` | `uplink-congestion-detector`, `downlink-congestion-detector` (a split into one class per direction, both rebuilt around different evidence — see below) |

An application still calling `detectors.disable('capture-failure-detector')`
therefore silences nothing and gets `false` back. Switching a detector off never
went through names in the first place: pass `null` for its **config key**, which
decides whether the class is constructed at all. Every class in the right-hand
column has one of its own — `iceDisconnectedDetector: null`,
`captureTrackMutedDetector: null` — so a group that used to go with one key now
goes with each of its members'.

### Retired config keys

**The group keys went with the classes.** Ten keys are no longer members of
`ClientMonitorConfig`, split where a class had already become several, renamed where
the key was a different word from the detector, and replaced where the detector
behind it was, per [design rule 4](#4-one-detector-one-config-block):

| Retired config key | What to use instead |
|---|---|
| `captureFailureDetector` | `captureTrackEndedDetector`, `silentAudioSourceDetector`, `captureTrackMutedDetector` |
| `dtlsHandshakeDetector` | `dtlsHandshakeStalledDetector`, `dtlsHandshakeFailedDetector` |
| `icePathStabilityDetector` | `iceDisconnectedDetector`, `iceConnectionFailedDetector`, `iceTransportStalledDetector`, `unstableIcePathDetector`, `iceRestartDetector`, `iceRestartRecommendationDetector` |
| `mediaPipelineDetector` | `rtpSenderStalledDetector`, `transportDemuxStalledDetector` |
| `videoRecoveryDetector` | `keyframeStormDetector`, `videoRecoveryFailedDetector` |
| `videoFreezesDetector` | `frozenVideoTrackDetector` *(rename)* |
| `congestionDetector` | `uplinkCongestionDetector`, `downlinkCongestionDetector` |
| `syntheticSamplesDetector` | `audioPlayoutSynthesisDetector` *(rename)* |
| `audioConcealmentDetector` | `inventedSpeechDetector` *(rename — and a different shape; none of the four old fields has an equivalent)* |
| `audioDesyncDetector` | `avDesyncPlayoutDetector` *(replacement — a skew in milliseconds, not a correction fraction; neither old field has an equivalent)* |
| `freezedVideoTrackDetector` | `frozenVideoTrackDetector` *(spelling fix; same fields)* |
| `synthesizedSamplesDetector` | `audioPlayoutSynthesisDetector` *(rename; same fields)* |
| `inboundFrameSupplyDetector` | `decoderBottleneckDetector` *(rename; same fields)* |
| `outboundFrameSupplyDetector` | `sourceCaptureBottleneckDetector` *(rename; same fields)* |

Three keys retired earlier, in the same release, went the other way — they were
shims rather than groups. 4.9.0 kept `iceConnectivityDetector`,
`noAvailableIceCandidateDetector` and `longPcConnectionEstablishmentDetector` alive
in `ClientMonitor`'s normalizer, folded onto their current keys; 4.10.0 deleted
both the members and the folding, so the library holds no legacy name of any kind:

| Retired config key | Current key |
|---|---|
| `iceConnectivityDetector` | `icePathStabilityDetector`, then split as above |
| `noAvailableIceCandidateDetector` | `iceReachabilityDetector` |
| `longPcConnectionEstablishmentDetector` | `icePathEstablishmentDetector` |

A config object still using any of these twelve no longer type-checks. Should one
reach the constructor regardless — untyped JavaScript, or a cast — the key is
ignored and the detectors that used to read it run on their defaults, so a `null`
written against the old spelling disables nothing. For a key that was *split*
there is no mechanical migration either: a caller has to decide which of the new
blocks they meant.

Splitting a class never renames an issue type — `media-pipeline-stalled` is the one
that disappeared rather than being renamed, becoming `rtp-sender-stalled` and
`transport-demux-stalled`, and one type cannot alias onto two. Payloads and monitor
event names are unchanged across every split and rename above, with two exceptions,
both in 4.10.0 and both for the same reason — the detector stopped measuring what
the old name claimed.

`audio-concealment` became `invented-speech`, taking its monitor event, its payload
type and its score reason with it: the finding is now the share of audio that was
*invented*, not the share of samples that were concealed.

`audio-desync` became `av-desync`, taking the monitor event (`audio-desync-track` →
`av-desync`) and the payload type (`AudioDesyncIssuePayload` → `AVDesyncPlayoutIssuePayload`)
with it. This one is a replacement rather than a rename: the old detector inferred
lip sync from NetEQ's accelerate and preemptive-expand counters, which measure
jitter-buffer adaptation and — because sync logic corrects drift by *raising*
NetEQ's target delay — tended to fire on the correction rather than the fault. The
new detector measures the offset between the two tracks' `estimatedPlayoutTimestamp`
directly. Nothing about the thresholds carries over, since the quantity itself
changed from a fraction of samples to milliseconds of skew, and the new detector
requires a piece of context the old one did not: `linkedVideoTrackId` on the audio
track. Both are genuine breaks of the public contract.

## Known deviations

Things in the current tree that do not match this document, recorded here rather
than quietly tolerated. Three earlier entries are gone because they are genuinely
fixed — every detector now measures condition duration in stats time, the two
detectors resting a verdict on a transport bitrate now set `inputsUnavailable`, and
the source comments describing the pre-4.10.0 arrangement have been rewritten. Nor
is shared configuration on the list any more: every detector reads a block of its
own, and the one borrowed threshold — `EncoderPerformanceDetector` reaching into
`sourceCaptureBottleneckDetector` — is now a field of its own. What follows is what is
still true.

**`DownlinkCongestionDetector` is blind on a receive-only connection.** It gates on
`outbound-rtp.qualityLimitationReason` — the browser's own congestion verdict, and the
only one either direction gets — which describes this endpoint's *encoder*. A connection
that sends nothing reports none, so a webinar attendee or a spectator gets
`inputsUnavailable` rather than a verdict, and the same holds for an audio-only sender
(the field "must not exist for audio") and for browsers that do not implement it. On a
shared last mile the sending verdict is about the link both directions cross, which is
what makes the gate worth having; where the two directions do not share a bottleneck it
can be shut while the downlink is genuinely congested. The silence is at least readable,
which is the part that used to be missing.

**`peerConnection.outboundFractionLost` is a sum wearing a fraction's name.** It is
`deltaFractionLost` added up across every `remote-inbound-rtp` report, beside
`avgOutboundFractionLost`, which is the mean of the same deltas and what
`TransportLossDetector` judges. On a connection sending one stream the two coincide;
on one sending six, six streams losing a little over 0.8% each sum past a 5% bar
while no individual stream is in any trouble. It gated the retired
`CongestionDetector`'s low-sensitivity branch and nothing reads it now, but it is
still public and still misnamed.

**`DefaultScoreCalculator` reads two detectors' issues.** It calls `isIssueActive`
with keys it reconstructs as string literals — `invented-speech-track-<id>` and
`audio-jitter-buffer-stress-track-<id>`, the second of them for two separate
penalties — to gate additional audio penalties. This is the last place in the
library where one component depends on another's verdict, on its key format, and on
it being enabled: disable the audio detectors and the score quietly stops penalising
audio degradation that is still happening.

One instance of it got better in 4.10.0 rather than worse. The `audio-time-stretch`
penalty used to be gated on `audio-desync` and then scaled `timeStretchRate` against
`fractionalCorrectionAlertOnThreshold` — a threshold belonging to a detector that
measured a different normalization of the same counters. It is now gated on
`audio-jitter-buffer-stress` and scaled against that detector's own
`timeStretchThreshold`, so the penalty, the signal and the detector that owns the
signal are finally the same three things. The string-literal key reconstruction
remains.

**Six conditions still exist as score reasons in parallel with the detectors that
own them.** `pixelated-video`, `low-fps`, `volatile-fps`, `high-rtt`, `high-jitter`
and `high-packetloss` are all `DefaultScoreCalculatorSubtractionReason` keys
computed by the score calculator from raw stats, while `PixelatedVideoDetector`,
`ChoppyVideoDetector`, `TransportDelayDetector`, `TransportJitterDetector` and
`TransportLossDetector` derive the same conditions independently with their own
thresholds. Two sets of thresholds for one condition, with no guarantee they agree.

For pixelation it is worse than duplication, because the two do not measure the same
thing: the detector reads `bitPerPixel` against a flat threshold, the score
calculator reads `avgQpPerFrame` against a per-codec, per-motion-type band from
`VIDEO_QP_THRESHOLDS` scaled by presented size. A session can carry a
`pixelated-video` issue and no `pixelated-video` score penalty, or the reverse, and
both are working as written. `dropped-video-frames` is the one reason in that list
with no detector counterpart at all. And `FrozenVideoTrackDetector` runs the
derived-values convention backwards for the same consumer, computing the freeze
state and writing `isFreezed` back onto `InboundRtpMonitor` because nothing else
does — so `frozenVideoTrackDetector: null` quietly stops the score penalising
freezes.

**Silence is still not readable across most of Perceived Quality.** Twelve of the 46
classes set `inputsUnavailable`, four of them in Category 4:
`PixelatedVideoDetector`, `ChoppyVideoDetector`, `InventedSpeechDetector` and
`AVDesyncPlayoutDetector`, the last two added in 4.10.0. `FrozenVideoTrackDetector` and
`JitterBufferStressDetector` still return quietly when their counters are missing,
so a browser omitting `jitterBufferTargetDelay` produces a permanently and invisibly
silent detector. No telemetry detector sets it either, least defensibly
`SimulcastLayerDetector`, whose activity rule rests on `deltaBytesSent`.

---

The intended direction is unchanged and still **not yet implemented**: **detectors
observe conditions, and scores are computed from what the detectors found** — rather
than the score calculator independently re-deriving conditions that detectors
already own. Doing it would remove the string-literal key reconstruction, the
duplicated thresholds and the `isFreezed` write-back in one move. It remains the
single largest structural change this taxonomy implies.
