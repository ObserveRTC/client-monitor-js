# Transport Quality Detectors — the four properties of a working path

This document is the reference for how the library detects **transport
quality** problems: the four properties of a path that has already been
established, which detectors own each one, and what each one is allowed to
conclude.

It answers one question: *the path exists, ICE is connected, DTLS completed —
is the path carrying traffic well enough?* — and it exists because "the network
is bad" is four different faults with four different fixes, and until 4.10.0
the library could only name one of them.

This is the deep reference for **Category 2** of the library's five detector
categories. The parent map — the other four categories, what puts a detector in
one rather than another, and the rules that keep the boundaries stable — is
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md). The category below this one has
its own deep reference, the five-layer model in
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md). For the surrounding
API (listening to issues, the `ClientMonitorIssue` union, enabling and disabling
detectors) see the *Events and Issues* section of the
[README](../README.md#events-and-issues).

- [The sub-layers](#the-sub-layers)
- [Congestion is not loss, and neither is delay](#congestion-is-not-loss-and-neither-is-delay)
- [Where the numbers come from](#where-the-numbers-come-from)
- [The grid](#the-grid)
- [The shape three of them share: two thresholds and a stats clock](#the-shape-three-of-them-share-two-thresholds-and-a-stats-clock)
- [Capacity](#capacity)
- [Delay](#delay)
- [Delivery reliability](#delivery-reliability)
- [Delivery stability](#delivery-stability)
- [Issue taxonomy by sub-layer](#issue-taxonomy-by-sub-layer)
- [The neighbours: what is below and what is above](#the-neighbours-what-is-below-and-what-is-above)
- [What this model deliberately does not do](#what-this-model-deliberately-does-not-do)
- [Observability horizon](#observability-horizon)

## The sub-layers

```
Connectivity (the path exists and holds)   — see CONNECTIVITY_DETECTORS.md
        │
        ▼
Capacity              can the path carry what we want to send?
Delay                 how long does a round trip take?
Delivery reliability  does what we send actually arrive — some of it, any of it?
Delivery stability    does it arrive evenly?
        │
        ▼
Perceived Quality (what the user sees and hears)
```

**These four are not a ladder.** Connectivity's layers are ordered, because each
one begins where the previous one's success is proven and every issue belongs to
the *first* layer whose proof fails. Nothing of the sort applies here: a path can
be slow without being congested, congested without losing packets, lossy without
being jittery, and jittery while every other property reads perfect. The four are
**independent properties of the same object**, measured concurrently, and the
sub-layers are a vocabulary for reading a session rather than an escalation order.

The perspective the whole category is written from is a network engineer's. Each
sub-layer corresponds to a question that engineer would actually ask about a
link, in the order they would ask them: is it wide enough, is it short enough,
does it deliver, does it deliver on time.

**Membership.** A detector belongs here when every connectivity stage completed
and continues to hold — the candidate pair is `succeeded`, consent checks keep
passing, `iceConnectionState` reads `connected` — and the path is *still* the
reason the call is bad. If a stage never completed or stopped holding, it is
Connectivity. If the two things disagreeing are both inside this endpoint's
media chain, it is Pipeline Disruption. If the subject is what the user
perceives rather than what the path does, it is Perceived Quality.

## Congestion is not loss, and neither is delay

This is the most useful distinction in the document, and the one an operator
reading four co-firing issues most needs. The three are routinely spoken of as
one thing — "the network" — and they are three faults with three fixes.

**Congestion is the path being narrower than what is being put on it.** On the
sending side the evidence is the browser's own bandwidth estimate collapsing —
`availableOutgoingBitrate` falling away from what the same path was offering
seconds earlier, while this endpoint is still trying to use it. On the receiving
side there is no estimate to read at all, and the evidence is what arrived
collapsing while the jitter buffer deepens. Nothing has necessarily been lost, and
the round trip is not necessarily long. What is wrong is *capacity*, and the
remedy is on the sending side — fewer layers, a lower target, a smaller
resolution — or a wider path.

**Loss is packets vanishing, whether or not anyone backed off.** A well-behaved
congestion controller produces a congested path with very little loss, precisely
because it backed off before the queue overflowed. A lossy wireless link
produces loss with no congestion signal at all: the estimator is happy, the
encoder is unthrottled, and one packet in twenty is being eaten by radio
interference. The remedy is retransmission, FEC, or a different link — not a
lower bitrate.

**Delay is the round trip being long on a path that may be losing nothing.** A
relay allocated on the wrong continent gives a 400 ms round trip with zero loss
and no bandwidth limitation whatsoever; every packet arrives, and conversation
still fails because turn-taking needs the round trip to be short. The remedy is a
closer relay or a different route, and no amount of encoder backoff helps.

They co-fire when they genuinely co-occur, and **none of them consults another to
decide**. That is what makes the co-firing worth reading: three independent
measurements agreeing is evidence about the path, whereas a detector that only
fires when another detector already fired is an echo. It is also why
`uplink-congestion` and `transport-loss-sustained` together mean something
specific — a path narrow enough that the estimator noticed *and* overflowing
anyway — that neither means alone.

The fourth property, delivery stability, is orthogonal to all three: packets can
arrive complete, promptly on average, and still arrive in bursts.

## Where the numbers come from

Every threshold in this category is compared against a value that was computed
somewhere else. `PeerConnectionMonitor` owns the arithmetic and the detectors own
the opinion:

| Value | Meaning |
|---|---|
| `avgRttInSec` | `rtcpRttInSec ?? iceRttInSec` — the RTCP round trip when remote reports exist, the ICE/STUN one otherwise |
| `ewmaRttInSec` | The EWMA of *whichever of those two* `avgRttInSec` is currently reporting (α = 0.1) |
| `avgInboundFractionLost` | Mean interval loss fraction over inbound streams that received packets this tick |
| `avgOutboundFractionLost` | Mean interval loss fraction the far end reported for the streams we send |
| `avgInboundJitterInMs` | Mean inter-arrival jitter over inbound streams that received packets this tick |
| `deltaTime` | Milliseconds between this stats collection and the previous one, from the reports' own timestamps |
| `availableOutgoingBitrate` | The estimate summed over the selected pairs that reported one, `undefined` where none did — unlike `totalAvailableOutgoingBitrate`, which sums with `?? 0` and cannot tell a silent estimator from a zero one |
| `avgPacketSendDelayInMs` | Mean pacer queue time per packet this tick, Δ`totalPacketSendDelay` over Δ`packetsSent`, weighted by packets rather than averaged over streams |
| `avgInboundVideoJitterBufferDelayInMs` | Mean time a video frame spent in the jitter buffer this tick, Δ`jitterBufferDelay` over Δ`jitterBufferEmittedCount`. Video only: audio is a different scale and has its own detector |
| `outgoingBitrateHeadroom` | `availableOutgoingBitrate - sendingBitrate` — the room the encoder has left, negative at the moment a path narrows, with an EWMA beside it |
| `qualityLimitationReason` | The most limiting reason across the streams that sent anything this tick, in the specification's own priority order — streams that sent nothing do not vote |
| `hasInboundVideo` | Whether any inbound video stream was present this collection. Not the same question as `0 < receivingVideoBitrate`: a stream present and delivering nothing is a finding somewhere else |

Both capacity detectors read those and nothing else. Neither walks
`outboundRtps` or `inboundRtps`: the collection loop is already visiting every
stream to sum the bitrates, so the two queue sums and the two facts above are
accumulated there, and the getters that would have been walked build a fresh
array on every read.

The one piece of cross-tick state they do **not** get from the connection is the
rolling maximum each measures a collapse against — the last ten seconds of the
outgoing estimate, and of the arriving bitrate. Each detector keeps its own
window, because that is a yardstick for a judgement rather than a fact about the
connection: nothing else in the library has a use for it, and a second detector
wanting one would want its own length anyway. The bookkeeping is duplicated in the
two files rather than shared, per [design rule
2](./DETECTOR_TAXONOMY.md#the-five-design-rules).

This is [design rule 2](./DETECTOR_TAXONOMY.md#the-five-design-rules)'s one
boundary, and it is drawn here for two reasons. A derived value is a fact about
the connection that anything may want — a score calculator, an application, a
second detector — while a threshold is an opinion belonging to whoever is
judging; putting the arithmetic on the monitored object makes the fact available
without a detector in the way. And it is what keeps
`TransportDelayDetector`, `TransportLossDetector` and `TransportJitterDetector`
under forty lines of logic each, which is the whole reason they can be read
start to finish without reading anything else.

**The averages exclude streams that carried nothing.** `_updateTransportQualityAverages`
skips any inbound stream whose `deltaPacketsReceived` is zero or absent, and when
no stream qualifies the average is left `undefined` rather than set to `0`. That
distinction is load bearing: a call with eight muted tracks and one bleeding one
would otherwise average to a ninth of the real loss and read as healthy, and
"nothing arrived" would be indistinguishable from "nothing was lost". Every
detector reading these values stands down on `undefined` and says so through
`inputsUnavailable`.

The two means are counted differently on the two sides, and it is worth knowing
which: inbound is gated on packets having arrived this tick, while outbound
counts every `remote-inbound-rtp` report that carried a `deltaFractionLost` at
all. There is no `deltaPacketsReceived` gate on the outbound side because the
remote report *is* the measurement — if the far end sent a report, it measured
something.

## The grid

| Sub-layer | Class | Issue | Config key | Coverage |
|---|---|---|---|---|
| Capacity | `UplinkCongestionDetector` | `uplink-congestion` | `uplinkCongestionDetector` | Needs `candidate-pair.availableOutgoingBitrate` **and** `outbound-rtp.qualityLimitationReason` — reports `inputsUnavailable` where either is missing |
| Capacity | `DownlinkCongestionDetector` | `downlink-congestion` | `downlinkCongestionDetector` | Needs inbound video `jitterBufferDelay` / `jitterBufferEmittedCount` **and** `outbound-rtp.qualityLimitationReason` — so it is blind on a receive-only connection |
| Delay | `TransportDelayDetector` | `transport-delay-degraded` | `transportDelayDetector` | RTCP or ICE round trip — available everywhere |
| Delivery reliability | `TransportLossDetector` | `transport-loss-sustained` | `transportLossDetector` | Inbound everywhere; outbound needs `remote-inbound-rtp.packetsReceived` |
| Delivery reliability | `BlockedTransportDetector` | `blocked-transport` | `blockedTransportDetector` | Needs the pair's `responsesReceived`, plus transport or candidate-pair byte counters |
| Delivery stability | `TransportJitterDetector` | `transport-delivery-unstable` | `transportJitterDetector` | Inbound RTP `jitter` — available everywhere |

Every class here binds to `PeerConnectionMonitor`. Nothing in this category lives
at a track monitor, which follows from the subject: a path is a property of a
peer connection, and a per-track loss figure would be a statement about one
stream rather than about the transport carrying all of them.

The detector `name` strings — the lookup key for `Detectors.getByName()` /
`disable()` / `enable()` — are `uplink-congestion-detector`,
`downlink-congestion-detector`, `transport-delay-detector`,
`transport-loss-detector`, `blocked-transport-detector` and
`transport-jitter-detector`. `congestion-detector` is retired: it was one class
answering for both directions and it became the first two, which is why there is
no alias — an old spelling could only ever have pointed at one of them.

**Each config key owns exactly one class** — the library-wide rule now ([design
rule 4](./DETECTOR_TAXONOMY.md#4-one-detector-one-config-block)), and one this
category has always obeyed. Passing `null` for one of these five keys unregisters
precisely one detector. There is no way to disable "transport quality" as a block,
and there does not need to be: the five findings have nothing in common
operationally except the object they describe.

## The shape three of them share: two thresholds and a stats clock

`TransportDelayDetector`, `TransportLossDetector` and `TransportJitterDetector`
are the same detector three times over a different number, and the shape is
worth describing once rather than three times.

Each reads one value, compares it against a **raise threshold** and a **recovery
threshold**, and accumulates time above the raise threshold in **stats time**
until a **duration** is satisfied:

```
value < recoveryThreshold     → accumulator = 0, resolve any standing issue
recoveryThreshold ≤ value < threshold → do nothing (hold whatever state exists)
threshold ≤ value             → accumulator += deltaTime; raise once it reaches durationInMs
```

**What the gap between the two thresholds buys.** A call parked exactly on the
line — 300 ms of round trip, when 300 raises and anything under it does not —
would flap the issue open and shut on every collection if one number governed
both directions, and a dashboard would show twenty `transport-delay-degraded`
episodes for one continuously mediocre network. The band between recovery and
raise is a hold zone: nothing accumulates in it, and nothing resolves in it. A
value that is *bad* has to reach the raise threshold; a value that has *recovered*
has to fall genuinely below the recovery threshold. The specs pin the inclusive
edges — a round trip of exactly `recoveryThresholdInMs` is still inside the band
and does not resolve, and only one genuinely below it clears the issue.

One consequence of the band deserves stating, because it is not obvious from the
diagram: the accumulator is cleared **only** by falling below the recovery
threshold. A path that oscillates between the band and above the raise threshold
keeps its accumulated time across the dips and eventually raises. That is
deliberate — an intermittently terrible path is a terrible path — but it means
`sustainedForInMs` is time spent above the threshold, not necessarily one
unbroken stretch of it.

**What stats time buys.** The accumulator adds `PeerConnectionMonitor.deltaTime`,
the gap between the two stats reports this tick came from, and never wall-clock
elapsed. A backgrounded tab, a saturated main thread or a throttled timer makes
collections run late or be skipped; measured against the wall clock, a tab hidden
for a minute would have "watched" a minute of high round trip on evidence nobody
observed, and all three duration thresholds would cross at once on the tick the
tab came back. Measured in stats time, only what the collector actually sampled
counts. The rule cuts the other way too: a collection that ran late means the
condition held for longer than one nominal period, and `deltaTime` credits it
with exactly that. Each spec pins the behaviour from both ends — ten ticks with
`deltaTime` of `undefined` raise nothing at all, and one tick carrying a
9-second gap counts as nine seconds.

The accounting is one interval coarse, and honestly so. A tick reports a value
measured at the end of an interval and credits the condition with the *whole*
interval, so a round trip that went bad halfway through gets credited with the
first half as well. At a 2-second collecting period that is at most two seconds
of over-credit against a six-second duration, which is inside the noise of a
threshold that is itself a starting point rather than a measurement.

**The defaults are round numbers meant to be tuned**, and the source says so in
as many words. Only the delay threshold has an external reference behind it
(ITU-T G.114 puts one-way "generally acceptable" at 150 ms, and turn-taking
starts to break down around a 300 ms round trip). The rest are starting points
for a fleet to calibrate, not findings.

## Capacity

**Question.** Can the path carry what is being sent over it?

Two detectors, one per direction, because the evidence is not the same evidence.
The sending side can read the browser's own bandwidth estimate; the receiving
side has none to read and has to rebuild the verdict from what arrived. They
replaced the single `CongestionDetector` in 4.10.0, which answered for both
directions from one signal and carried two permanently-zero fields for the other.

### `UplinkCongestionDetector` — `uplink-congestion`

**What it reads** is the room left on the path:
`availableOutgoingBitrate - sendingBitrate`, kept on the connection as
`outgoingBitrateHeadroom` with an EWMA beside it. On a healthy call it is
comfortably positive and fairly steady — the encoder asks for less than the path
offers. When a path narrows the estimate drops immediately and the encoder takes a
beat to follow it down, so the headroom falls through zero and goes sharply
negative for a collection or two. **That moment is the signal**: not a level, but a
sender pressed against a ceiling that just moved.

Three things must hold together, and each covers what the others cannot:

- `qualityLimitationReason` is `bandwidth` — the browser's own congestion verdict.
- the headroom is `headroomDropRatio` (0.25) of the recent maximum estimate below
  its own EWMA — the maximum being the highest estimate of the last ten seconds of
  stats time, from a window the detector keeps itself. Measured against the path
  rather than against the headroom itself, because a difference that passes through
  zero cannot be a denominator.
- mean pacer queue time is `sendDelayGrowthRatio` (3×) of its own EWMA and above a
  10 ms noise floor — Δ`totalPacketSendDelay` over Δ`packetsSent`, the only reading
  of a counter whose specification says the total is "added to totalPacketSendDelay
  when packetsSent is incremented".

That is a change of anchor from 4.9.0, and it was measured rather than argued.
Against a loopback call throttled to 500 kbit on Chromium 141:

| Signal | Healthy | Throttled | Verdict |
|---|---|---|---|
| `qualityLimitationReason === 'bandwidth'` | true | true | precision 0.53 — useless alone |
| `availableOutgoingBitrate` | 1161 kbps | ~400, recovering to 1025 | tracks cleanly |
| `packetsDiscardedOnSend` | 0 | 0 throughout | a socket-error counter, not congestion |

The old detector's anchor was the browser saying the encoder is not free to do as
it likes, which on a real call is nearly always true — it read `bandwidth` on all
34 collections of that run, including all 6 healthy ones. Here it is one of three,
which is a filter rather than a claim and the only honest use of a signal that
eager.

**The look-alike this shape rules out by construction.** A muted camera, a
replaced track and a screen share of a still slide all drag the estimate down —
the estimator cannot probe above what is being sent — and a detector watching the
estimate alone reads that as a narrowing path. All three make the *headroom grow*:
the encoder is asking for less while the path keeps offering what it did. The
earlier draft needed a `minUtilizationRatio` guard for exactly this case; the
headroom shape does not need one.

**How it recovers.** When the browser stops reporting a bandwidth limitation, and
on nothing else. There is no recovery threshold on any bitrate, because nothing
knows what the path can carry after it narrows — a link that settles at half its
old capacity has recovered, and a ratio against its old maximum would hold the
finding open for the rest of the call. The eagerness that makes the verdict
useless as an anchor is exactly what makes its absence worth trusting: it is
nearly always true under congestion, so it going false says something that it
going true does not.

`peerConnectionMonitor.uplinkCongested` moves with the finding, never with a
collection. Two thresholds, no windows, no counters, and every value it reads is a
fact the connection already derived — the downlink detector below has the same
shape and the same three-part test, on the evidence a receiver can get.

**What it does not claim.** Not that packets were lost — a congestion controller
doing its job backs off before the queue overflows. Not that the round trip is
long. Not where the narrow part of the path is. Nothing about the receiving
direction, and nothing about what the far end sees.

**Coverage.** `availableOutgoingBitrate` "only exists when the underlying
congestion control calculated either a send-side bandwidth estimation … or
received a receive-side estimation via RTCP", and `qualityLimitationReason` "must
not exist for audio" and is unimplemented on some browsers. Missing either is
reported as `inputsUnavailable` rather than as a healthy path — the one behaviour
of the old detector that made a whole browser population look like the best
behaved on a fleet.

### `DownlinkCongestionDetector` — `downlink-congestion`

**Why it cannot read an estimate.** `availableIncomingBitrate` is specified and on
Chrome it is not zero but absent — measured on both nominated pairs of a call with
both peers sending, `availableIncomingBitrate=undefined` on each. That is
structural: Chrome's congestion control is send-side, so the estimate for your
downlink is computed at the far end's sender and never reaches you. A receiver
never computes one. The old detector carried it in two payload fields that were
permanently zero on the dominant browser; it is used here in no form.

**How it decides.** Three things must hold together, and each covers what the
others cannot:

- `qualityLimitationReason` is `bandwidth` — the browser's own congestion verdict.
  Alone it means almost nothing: over the throttled run it read `bandwidth` on all
  34 collections including all 6 healthy ones, precision 0.53. As one of three it
  is a filter rather than a claim, which is the only honest use of a signal that
  eager.
- `receivingBitrate` is below `collapseRatio` (0.6) of its rolling maximum — less
  is arriving than was arriving.
- `avgInboundVideoJitterBufferDelayInMs` is at `bufferElevationRatio` (2×) of its
  own pre-episode baseline and above a 100 ms noise floor — packets are queueing
  rather than simply not being sent. This is what separates "the link cannot carry
  it" from "the sender had less to send": a static screen share, a muted camera or
  a dropped simulcast layer collapses the bitrate with the buffer perfectly normal.

The baseline is the smoothed level from the last collection with nothing to
report, latched rather than re-read, so an EWMA already climbing under a deepening
buffer cannot raise the bar the episode has to clear.

**How it recovers.** Exactly as the uplink does, and for the same reason: when the
browser stops reporting a bandwidth limitation. Neither direction has anything
that says what the path can carry *after* it narrows, so a recovery threshold on
a bitrate would measure against a number nobody can know — a link that settles at
half its old capacity has recovered, and a ratio against its old maximum would
hold the finding open for the rest of the call.

**What it borrows, and what that costs.** `qualityLimitationReason` describes this
endpoint's *encoder*, so this is a sending-side verdict being read about a
receiving-side condition. On a shared last mile — home wifi, a mobile link, a
saturated access network — both directions cross the same bottleneck and the
verdict is about the link they share. Where they do not share one (an SFU with an
asymmetric problem, a relay congested in one direction only) the gate can be shut
while the downlink is genuinely congested, and this detector stays quiet. And a
connection that sends nothing has no verdict at all, so a **receive-only viewer**
— a webinar attendee, a spectator — sets `inputsUnavailable` rather than reading
as a healthy path. That is the largest coverage gap in this category and it is
recorded in [Known deviations](./DETECTOR_TAXONOMY.md#known-deviations).

**Loss is recorded and not read.** It travels on the payload as how much was being
lost when the finding opened and decides nothing. Measured on the same throttle:

| phase | recv kbps | availIn | loss% | nack | fps |
|---|---|---|---|---|---|
| healthy | 1849 | null | 0 | 0 | 29 |
| THROTTLED | 504 | null | 39.3 | 16 | 8 |
| THROTTLED | 425 | null | 47.5 | 49 | 0 |
| THROTTLED | 419 | null | 2.8 | 17 | 25 |
| THROTTLED | 349 | null | 0 | 0 | 8 |
| THROTTLED | 215 | null | 0 | 0 | 36 |
| recovering | 704 | null | 0 | 0 | 30 |

Loss is an onset event, not a state: it burns for about six seconds and then reads
zero for the rest of an unchanged throttle, because the far end's estimator has
adapted down and stopped overshooting. Anything resting on it raises and then
resolves while the viewer is still pinned at a quarter of their bandwidth. What
stayed elevated through the sustained stretch was jitter (0–2 ms → 600 ms) and
per-frame jitter buffer delay (5–20 ms → 3109 ms), which is why the buffer is the
half that decides.

An earlier draft required a loss burst within a recency window to *open* an
episode, on the reasoning that a collapse beginning with a burst is a collapse the
link caused. It was cut for two knobs and two pieces of state that the conjunction
above already covers — the buffer half rules out the same look-alikes on its own.
Restoring it is a small change if a fleet shows it earning its place.

**The neighbour it must not echo.** `JitterBufferStressDetector` also reads a
jitter buffer under strain. It is audio, per track, and reports what the listener
hears; this is video, per connection, reports capacity, and counts the buffer only
when the bitrate has already collapsed underneath it. If the two are ever found
firing on the same episodes, this one has not earned its place.

**What it does not claim.** Not that the far end is at fault rather than the path.
Not that the sender is being throttled — that is the far end's own
`uplink-congestion` to raise, on evidence this endpoint cannot see. Not that the
picture is degraded, which is `InboundVideoFlowStateDetector`'s subject. And
nothing at all about a stream that has stopped emitting frames altogether: that is
a stall rather than a narrow path.

### The `congestion` event, and why there is no `congestion` issue

Two issue types, because two questions answered from two sets of evidence are two
findings — the rule the whole library is organised on. But "is this connection
capacity-limited at all" is a fair thing to want in one word, so both detectors
also emit **`congestion`**, discriminated on `direction`, carrying the whole
payload of whichever one fired. `PeerConnectionMonitor.congested` is the same
reading as an attribute: `uplinkCongested || downlinkCongested`, and read-only,
because a single writable boolean could not say which direction it meant.

The convenience stops at the event. There is no combined issue type and no
combined issue key, because an issue is a condition with a start and an end and
the two directions start and end independently — one key would have to pick a
lifetime, and it would be wrong for whichever direction was still congested. A
connection congested both ways emits `congestion` twice, as the two findings open;
that is two independent verdicts rather than one restated, since neither detector
reads the other to decide.

## Delay

**Question.** Does a round trip over this path take too long?

### `TransportDelayDetector` — `transport-delay-degraded`

A path that works and takes too long: the round trip stays high enough, for long
enough, that conversation stops being conversation and becomes turn-taking.

**The signal it reads** is `ewmaRttInSec`, already smoothed on the peer
connection, which is the right input for a reason worth stating — a single
inflated RTT sample is common and means nothing. One retransmission, one
scheduling hiccup at the far end, one RTCP report that sat in a queue, and an
instantaneous round trip doubles. What this detector adds on top of the smoothing
is duration.

**Algorithm and thresholds.** The shared shape above, over
`ewmaRttInSec × 1000`:

| Config | Default | Meaning |
|---|---|---|
| `thresholdInMs` | `300` | At or above this, the path counts as slow |
| `recoveryThresholdInMs` | `200` | Below this, the issue resolves |
| `durationInMs` | `6000` | Stats time the round trip must stay high before raising |

At the default 2-second collecting period that is three consecutive qualifying
collections. The payload carries `rttInMs` at the moment of raising and
`sustainedForInMs`, the accumulated stats time that earned it.

**False positives.** The measurement is a mean across selected candidate pairs
and across RTCP-reporting streams, so a peer connection without BUNDLE, or one
talking to two destinations at very different distances, produces a mean that
describes neither. Relay paths — TURN/TCP and TURN/TLS especially — legitimately
add tens of milliseconds and can sit near a 300 ms threshold while working
exactly as designed; the path kind is on the connectivity issues' payloads rather
than this one, so correlating the two is a server-side job.

**What it deliberately does not claim.** *It is not end-to-end latency.* In an
SFU topology the ICE round trip is measured to whatever terminates ICE — the SFU
— and the RTCP round trip spans the media path to whatever originates the RTCP
reports, which in most SFU deployments is also the SFU. Either way this is a
half-path measurement, blind to the far leg, and a 150 ms reading here is
perfectly compatible with a listener 400 ms away. The monitor keeps `rtcpRttInSec`
and `iceRttInSec` separate and never averages them for exactly this reason, and
an application presenting this number to a user as "latency" is overstating what
was measured.

It also does not claim congestion. A path can be uncongested and slow (a long
physical route, a relay on the wrong continent) or congested and short, and the
two detectors decide independently.

## Delivery reliability

**Question.** Does what we send actually arrive — some of it, or any of it at
all?

Two classes, and the pairing is the point: `transport-loss-sustained` is a path
dropping a *share* of what crosses it, and `blocked-transport` is a path dropping
*all* of it for a reason that is policy rather than capacity. They are the two
ends of the same axis.

### `TransportLossDetector` — `transport-loss-sustained`

A path that is persistently dropping a material share of what is sent over it.
The path is up, the path is stable, and packets are simply not all arriving.

**What is new about it** is not the measurement. Loss has always been visible to
this library — it gated the retired `CongestionDetector`'s low-sensitivity mode,
and it stands `DecoderPerformanceDetector` down so a decoder is never blamed for a
network fault. Neither of those makes a claim *about the loss*: they are guards
on somebody else's condition. Nothing could raise loss, resolve it, or count it
until this class existed.

**The signals it reads** are `avgInboundFractionLost` and
`avgOutboundFractionLost`. Both directions are watched with one threshold, and
whichever is worse is reported — one issue type, with `direction` in the payload,
because the engineer's next step is the same either way. An exact tie breaks
towards `inbound`, which the spec pins so nobody reads a tie as evidence about
the send path.

Where one direction is absent the other is still judged: a publish-only peer
connection has no inbound RTP at all, so `avgInboundFractionLost` is legitimately
`undefined` and the outbound mean carries the verdict alone. `inputsUnavailable`
is set only when **both** are absent, which is the genuine no-measurement case.

| Config | Default | Meaning |
|---|---|---|
| `threshold` | `0.05` | Mean interval loss fraction (`0..1`) at or above which loss counts as material |
| `recoveryThreshold` | `0.01` | Loss fraction below which the issue resolves |
| `durationInMs` | `6000` | Stats time loss must stay high before raising |

**False positives.** *Loss at low packet rates is noisy*, and the mean does
nothing to fix it. An audio stream at 50 packets per second contributes 100
packets to a two-second interval, so a single lost packet is 1% and three are 3%;
a stream that has just started, or one recovering from a keyframe request, can
produce a double-digit fraction from a handful of packets. The
`deltaPacketsReceived` gate keeps streams that carried *nothing* out of the mean
but does nothing about streams that carried very little, and there is no minimum
packet count in this detector. The six-second duration is the only thing standing
between it and that noise, which is why the duration matters more here than the
threshold does.

The mean across streams is also a real simplification. Nine healthy streams and
one at 40% average to 4% and raise nothing, while the one stream is unusable.
This detector is a statement about the *path*, and per-stream loss is a different
question that the score calculator and the inbound track monitors answer.

**What it deliberately does not claim.** It does not claim congestion — see
[above](#congestion-is-not-loss-and-neither-is-delay). It does not claim the loss
is unrecovered: RTX and FEC repair a good deal of what this counts, so a path
losing 6% may still deliver every frame, later. It does not name a cause; loss on
a TURN/TCP path and loss on a bad radio link look identical from here.

**Coverage.** Inbound loss is derived from `inbound-rtp.packetsLost` /
`packetsReceived` and works everywhere. The outbound half is derived from
`remote-inbound-rtp`, and needs *both* `packetsLost` and `packetsReceived` to
compute a fraction — WebKit has never filled `remote-inbound-rtp.packetsReceived`
(through Safari 26, per `SafariStatsAdapter`), so on Safari
`avgOutboundFractionLost` stays `undefined` and this detector judges the inbound
direction alone. It does not set `inputsUnavailable` in that state, because one
direction genuinely was measured; a Safari session reporting `direction:
'inbound'` should not be read as evidence that the send path was fine.

### `BlockedTransportDetector` — `blocked-transport`

The signature of a firewall — or any policy middlebox — that lets ICE and STUN
through while blocking the media itself: the candidate pair is `succeeded`,
consent checks keep passing, `iceConnectionState` reads `connected`, and the call
carries nothing.

**Why it is here and not in Connectivity.** It used to be filed as a sixth
connectivity layer, "media flow", on the reasoning that the network is the
subject. That reasoning proves too much — the network is the subject of this
entire category — and applying the two membership tests settles it in opposite
directions.

Connectivity's test is *the failure is a stage that never completed or stopped
holding*. Run it against this detector's own preconditions and it fails
immediately, because the detector **requires** every stage to have completed:
ICE must read `connected` or `completed`, the selected pair must be `succeeded`,
and STUN consent responses must have arrived within `stunFreshnessInMs` or the
detector stands down and hands the session to the ICE detectors. Nothing in the
ladder failed. Nothing in the ladder is even allowed to have failed.

Transport Quality's test is *every stage completed, and the path is still the
reason the call is bad*. That is this condition word for word: the path is
established, the path is holding, and the path is not delivering. Under the
delivery-reliability heading it also sits where it belongs relative to its
neighbour — reliability zero, on a path reporting perfect health, is the extreme
end of the same axis `transport-loss-sustained` measures the middle of.

The move retired connectivity layer 6 and returned that model to five layers in
4.10.0. The `blocked-transport` issue type, its payload, its
`blockedTransportDetector` config key and its detector `name` are all unchanged:
this was a classification, and what moved is where it is registered and
documented. `tests/detectors/DetectorTaxonomy.spec.ts` is the machine-readable
copy that keeps it from drifting back.

**Why nothing else can see it.** STUN consent responses count into the candidate
pair's `bytesReceived`, so the pair never looks dry and
`IceTransportStalledDetector`'s inbound-stall check never fires. The dry-track
detectors watch producer-side `outbound-rtp` counters, which keep advancing
because the encoder is doing its job perfectly well. The gap between "STUN says
the path is alive" and "no media traverses it" is visible only to something
comparing those two facts.

**The algorithm.** Each tick, on the transport's selected pair:

| Gate | Config | Default | Why |
|---|---|---|---|
| ICE brought the path up | — | — | `IceTransportMonitor.everConnected` and the pair reading `succeeded`. Liveness is the consent counter's job below; what ICE is needed for is the one thing consent cannot say — that the path came up at all |
| STUN is alive | `stunFreshnessInMs` | `10000` | `responsesReceived` advanced recently; otherwise this is ordinary connectivity loss and the ICE detectors own it. Consent runs roughly every 5 s, so the window comfortably exceeds one interval |
| Something is being sent | — | — | At least one outbound RTP stream attributed to this transport. No bitrate bar: see below |
| Media is not traversing | `maxSendShare` | `0.1` | The transport's send counter moving at under a tenth of what those senders produce |

The discrepancy holding for `thresholdInMs` (default `5000`) raises the issue; any gate
breaking resolves it. The outbound streams come from
`IceTransportMonitor.getOutboundRtps()`, a plain `transportId` lookup — restoring that
reference where a browser omits it is the stats adapters' job, not a monitor's.

**Nothing is gated on media having flowed successfully first.** A blocked transport is
normally blocked from its first packet: the user is behind a corporate firewall, nothing
gets out, and reloading puts them behind the same wall. Any bar of the form "it was
carrying media and then stopped" would switch the detector off in exactly the case it
exists to explain. The send side needs no such bar anyway — the encoder produces whether
or not anything escapes, so "we are being asked to send" is self-evident from the
outbound streams existing.

**Only the send side is judged, and that is a deliberate limit.** There the client holds
both halves of the proof: it produced the bytes and it reads what the transport put on
the wire. On the receive side it holds one half — what *should* have arrived is a fact
about the far end that no client stat reports, so a middlebox eating media, an SFU that
stopped forwarding, a producer the far end paused and a speaker who muted are the same
reading in `getStats()`. A dry return path is
[`dry-inbound-track`](./PIPELINE_DISRUPTION_DETECTORS.md)'s finding, not this one's, and a
block in the receive direction surfaces on the remote peer's own sending side.

The two `evidence` values split the send-side fault by where it happened:

| `evidence` | What was observed | Where the fault is |
|---|---|---|
| `media-discarded-on-send` | The selected pair's `packetsDiscardedOnSend` is advancing: the operating system refused the packets | On this machine — a socket error, a host firewall rejecting at the socket, a full send buffer |
| `media-not-leaving-transport` | No discard counter advancing, either because the browser reports none or because it reports zero | Beyond this machine: the packets left as far as this endpoint can tell |

They have entirely different remedies, and reporting them as one thing sent people to
read packet captures for a problem in their own send buffer. `packetsDiscardedOnSend` is
the specification's purpose-built counter for exactly that question, so where a browser
reports it the answer is not a guess. Where it reports nothing the detector does **not**
read the silence as proof of a local fault — an unreported counter and a zero one fall on
the same side, or the verdict would depend on which browser was looking ([design rule
5](./DETECTOR_TAXONOMY.md#5-a-detector-never-infers-the-raw-stats-it-needs)).

**Every clock accumulates the ICE transport's own `deltaTime`** — how long the
discrepancy has held, how long since STUN last answered, and the interval under the
fallback bitrate. That matters more here than anywhere else in the category, because a
saturated main thread is a plausible *cause* of the delayed collections and would
otherwise credit the firewall with time the library merely spent not looking, while aging
out a perfectly fresh STUN response for the same reason.

**One instance judges one transport**, and lives on `IceTransportMonitor.detectors` — a
transport-level registry alongside the ones on the client monitor, the peer connection,
the track monitors and the media playout monitor. That is why the class holds no map: its
state is plain fields, a replaced transport gets a detector whose clocks start at zero,
and a transport that goes away takes its detector with it, leaving the issue open as
every monitor-bound detector does. Reaching it means
`iceTransport.detectors.getByName('blocked-transport-detector')`, not the peer
connection's registry; the `blockedTransportDetector` config key gates construction on
every transport at once.

One more guard, on the STUN gate rather than the discrepancy: a consent counter that has
not advanced *since this detector started watching* is not a stale response, it is no
response. The clock stays unstarted until the first one lands rather than being seeded at
zero, because seeding it would treat a path that has never answered as STUN-verified for
a full freshness window — long enough to blame a firewall for a path that is simply dead,
which is the ICE detectors' finding. The cost is at most one consent interval before a
new transport is judged.

**What it deliberately does not claim.** "Firewall" is the best available explanation
rather than a proven one: the detector observes a discrepancy between production and
traversal, not a policy.

**Coverage, and why this one sets `inputsUnavailable`.** Two stats are load-bearing and
neither is universal, which makes this the detector where [design rule
5](./DETECTOR_TAXONOMY.md#5-a-detector-never-infers-the-raw-stats-it-needs) bites hardest.
One has a substitute; the other does not.

*The transport send bitrate* has one. `IceTransportMonitor.sendingBitrate` is derived
solely from `RTCTransportStats.bytesSent`, which Firefox still does not populate as of
153. Before 153 there is no `transport` report at all and `FirefoxStatsAdapter`
reconstructs one from the candidate pair the browser marks `selected`; from 153 on a
native report is present without those counters filled, and the detector falls back to
the pair's own `deltaBytesSent` over the transport's measured `deltaTime`. That is a
different real measurement of the same traffic, not a reconstruction of a missing one.

*The consent counter has no substitute, and none is invented.* `responsesReceived`
reached Firefox only in 142, and without it there is no telling a firewall from a dead
path — so the transport is not judged at all rather than reading ICE's `connected` as
consent. Note what this is *not*: `deltaResponsesReceived === 0` is a reported fact and
the detector sees fine, ageing the freshness clock as it should. Only `undefined` is
blindness. The two used to take the same branch, which made a Firefox 141 session
indistinguishable from a path that had stopped answering.

`inputsUnavailable` is what makes the resulting silence legible: `true` means this
transport could have been judged and could not be read, `false` means the evidence was
there. It describes one transport, because the detector judges one — before 4.10.0's move
to the transport monitor it was OR-ed across every transport on the connection. A
transport sending nothing, or one where ICE never verified or STUN has not yet confirmed,
leaves it `false`: that is *not applicable*, a different statement about a different
thing. Nothing about the detector's behaviour changes with the flag.

## Delivery stability

**Question.** Do packets arrive evenly, or in bursts?

### `TransportJitterDetector` — `transport-delivery-unstable`

A path whose packets arrive, but not evenly — bursty delivery that forces the
receiver to buffer more than it should. Capacity is fine, loss may be zero; what
is wrong is the timing.

Until this class existed, inter-arrival jitter was the only transport signal in
the library that **no detector read at all**. `DefaultScoreCalculator` deducted
points for it and nothing else ever looked, so a session could be scored down for
jitter without any issue naming it.

**The signal it reads** is `avgInboundJitterInMs`: the mean of
`inbound-rtp.jitter` (seconds, converted to milliseconds) over inbound streams
that received packets this tick.

| Config | Default | Meaning |
|---|---|---|
| `thresholdInMs` | `100` | At or above this, delivery counts as unstable |
| `recoveryThresholdInMs` | `30` | Below this, the issue resolves |
| `durationInMs` | `6000` | Stats time jitter must stay high before raising |

Recovery sits at under a third of the raise threshold, which is appropriate:
jitter is the noisiest of the four measurements, and a single reordered burst
can spike the browser's estimate on its own.

**False positives.** The same low-rate noise that affects loss affects this, and
more so — the browser's jitter estimate is a running filter, so a stream that has
just started or has just resumed after a pause carries an estimate built from
very few inter-arrival times. Screen share and video streams with long
keyframe-driven bursts produce genuinely uneven arrival that the receiver handles
without any user-visible effect.

**What it deliberately does not claim.** RTP jitter is *a browser-smoothed
inter-arrival estimate*, not a measurement of the delay variation a user
experiences. It is computed per the RFC 3550 filter over packet arrival times
against RTP timestamps, it is smoothed by the implementation, and it says nothing
about what the jitter buffer did with the unevenness — a deep buffer absorbs a
great deal of it inaudibly. Treat it as **directional evidence about the path**,
not as a user-facing number.

It also watches one direction only. `remote-inbound-rtp.jitter` — the far end's
view of the jitter on what *we* send — is collected by the monitor and read by
nothing, so there is no outbound counterpart to this issue today. That is a gap
rather than a decision.

## Issue taxonomy by sub-layer

| Sub-layer | Issue type | Detector | Payload discriminator |
|---|---|---|---|
| Capacity | `uplink-congestion` | `UplinkCongestionDetector` | — |
| Capacity | `downlink-congestion` | `DownlinkCongestionDetector` | — |
| Delay | `transport-delay-degraded` | `TransportDelayDetector` | — |
| Delivery reliability | `transport-loss-sustained` | `TransportLossDetector` | `direction`: `inbound` \| `outbound` |
| Delivery reliability | `blocked-transport` | `BlockedTransportDetector` | `evidence`: `media-discarded-on-send` \| `media-not-leaving-transport` |
| Delivery stability | `transport-delivery-unstable` | `TransportJitterDetector` | — |

Every issue here is raised on `PeerConnectionMonitor`, and every one emits a
monitor event of the same name alongside the issue. Four of the five key their
issue per peer connection; `blocked-transport` keys per transport, because a peer
connection without BUNDLE has several and they can be blocked independently.

The two discriminators are payload fields rather than separate issue types by the
test [design rule 1](./DETECTOR_TAXONOMY.md#the-five-design-rules) applies to
every near miss: *what does an engineer do differently?* Loss inbound and loss
outbound are the same investigation on a different leg, and both blocked-transport
evidences send the same engineer looking for the same middlebox. Congestion and
loss, by contrast, are different investigations entirely — which is why they are
two detectors and not one issue with a `kind` field.

## The neighbours: what is below and what is above

**Below: Connectivity.** Everything in this document presupposes that the path
exists. Every detector here is silent, or meaningless, on a connection that never
established — there is no round trip to average, no stream carrying packets, and
`BlockedTransportDetector` explicitly refuses to judge a transport whose ICE is
not verified. When a session raises both a connectivity issue and a transport
quality one, read the connectivity issue first: the lowest category that fired is
the diagnosis.

**Above: Perceived Quality.** The clearest pairing in the whole taxonomy is
`transport-delivery-unstable` and `audio-jitter-buffer-stress`.
`TransportJitterDetector` measures the network delivering unevenly, on the peer
connection. `JitterBufferStressDetector` measures the *jitter buffer* straining —
deep target delay plus audible time-stretching — on one inbound audio track. One
is the cause and lives on the path; the other is the symptom and lives in the
user's ear.

**They are not a chain, and that is the point.** Neither detector reads the
other's issue, neither is enabled or disabled by the other, and neither's
threshold refers to the other's. They will frequently co-fire, and the co-firing
is informative *precisely because* they decided independently: cause and symptom
confirmed by two separate measurements is evidence, whereas a symptom detector
that only fires when a cause detector already fired adds nothing to what the
cause detector said. The same holds for `congestion` alongside `pixelated-video`
or `video-choppy`, and for `transport-loss-sustained` alongside
`invented-speech`. Correlating them is the server's job, where the whole
session is visible — see
[Detectors are independent](./DETECTOR_TAXONOMY.md#detectors-are-independent).

The one place the library still violates this is documented under
[Known deviations](./DETECTOR_TAXONOMY.md#known-deviations): `DefaultScoreCalculator`
re-derives `high-rtt`, `high-jitter` and `high-packetloss` from raw stats with its
own thresholds, in parallel with the three detectors that now own those
conditions. Two sets of thresholds for one condition, with no guarantee they
agree.

## What this model deliberately does not do

**No composite "network quality" verdict.** There is no `TransportQualityState`,
no single score in this category, and no detector that fires when "enough" of
the four properties are bad. A composite would have to weigh four independent
measurements against each other, and the weighting that is right for a
conversational audio call is wrong for a screen share. What the model provides
instead is four named findings that a consumer can weigh for its own use case;
`DefaultScoreCalculator` is one such consumer and its weighting is
[documented separately](./SCORE_CALCULATIONS.md).

**No detector consults another.** Congestion does not check whether loss fired,
loss does not check whether the path is congested, and jitter does not check the
buffer. Where two of them need the same input — `DownlinkCongestionDetector` reads
inbound loss as the burst an episode opens with, and `TransportLossDetector`
judges the same figure as a condition in its own right — they read the raw value,
not each other's conclusion. Configuration may be shared;
conclusions never are.

**No per-track transport issue.** Loss and jitter are averaged across streams and
raised on the peer connection, because the subject is the path. A single stream
that is far worse than its peers is a real condition and this category does not
detect it — the per-stream numbers are on the inbound RTP monitors for anything
that wants them.

**No asymmetry detector.** `UplinkCongestionDetector` closed half of what
used to be recorded here — the collapsing bandwidth estimate now *is* the
condition rather than context for one detected some other way — but nothing
watches the asymmetry between what a path could carry and what the application
asked of it. The uplink detector's utilization guard recognises that
gap only well enough to refuse to judge, and a sender persistently asking for a
fraction of a wide path is a fact nobody reports.

**No congestion detector that works without the browser's verdict.** Congestion
could in principle be inferred from a rising round trip and a falling send rate
without `qualityLimitationReason` — which is what a Firefox-capable
implementation would need. Nothing does this today, and the honest reason is
that the inference is much weaker than the estimator's own report and would
produce a detector whose behaviour differed by browser in ways consumers could
not see.

## Observability horizon

Everything above is derived from `getStats()` and nothing else. Three
consequences are worth stating plainly, because the temptation to reach past them
is what produces unreliable detectors.

**Half a path is all there is.** Every measurement here describes the leg between
this endpoint and whatever terminates the transport. In an SFU topology that is
the SFU, and the far participant's leg is entirely invisible: a session showing
120 ms of round trip, no loss and even delivery is fully compatible with a
listener who cannot understand a word. Client-side transport quality is *evidence
about one leg*, and only a server correlating both endpoints' samples can say
anything about the path between two users. Presenting any number from this
category as an end-to-end measurement is a misrepresentation of what was
measured.

**Some evidence is an estimate the browser chose to publish.** `jitter` is a
smoothed inter-arrival filter, `qualityLimitationReason` is a summary of a
bandwidth estimator's internal state, and `roundTripTime` on a remote-inbound
report is derived from an RTCP timestamp the far end controlled. None of them is
a direct measurement of a physical property, all of them differ between
implementations, and a detector that treats them as ground truth will disagree
with itself across browsers. The thresholds in this category are tuned against
what browsers report, not against what networks do.

**Silence needs to be readable, and here it now is.** Every detector in the
category exposes a public `inputsUnavailable` field — `TransportDelayDetector`,
`TransportLossDetector` and `TransportJitterDetector` when their measurement is
absent, `BlockedTransportDetector` when neither transport nor candidate-pair
bitrates were reported for a transport it could otherwise have judged, and the
two capacity detectors when the bandwidth estimate or the jitter buffer counters
they judge are not reported. See
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing) for
what the flag means and what it deliberately does not cover.

The exception used to be `CongestionDetector`, and it was the one where the flag
mattered most: its anchor signal is unimplemented on an entire browser engine, so
its silence there was permanent and, from the outside, identical to a healthy
path — a fleet dashboard counting `congestion` per browser read Firefox as the
network's best-behaved population. `UplinkCongestionDetector` replaced both the
anchor and that silence.
