# Network classification — design memo

**Nothing of this is built.** It is the design for one telemetry class that answers
"what kind of path is this call on", written to be ruled on before anything is
written. It assumes the method in [DETECTOR_SANITY_CHECK.md](./DETECTOR_SANITY_CHECK.md)
and the map in [DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md).

- [Why it is telemetry and not a detector](#why-it-is-telemetry-and-not-a-detector)
- [The signal that makes it possible](#the-signal-that-makes-it-possible)
- [The classes](#the-classes)
- [Telling random loss from bursty loss](#telling-random-loss-from-bursty-loss)
- [What is deliberately not a class](#what-is-deliberately-not-a-class)
- [What the browser will not tell us](#what-the-browser-will-not-tell-us)
- [The open measurement: ECN](#the-open-measurement-ecn)
- [Windows and confidence](#windows-and-confidence)
- [Monitor-side facts it would need](#monitor-side-facts-it-would-need)
- [Questions to rule on before building](#questions-to-rule-on-before-building)

## Why it is telemetry and not a detector

Run it through the counterfactual test the taxonomy uses: *would raising an issue
here ever be the right thing to do?* No. "This call is on a lossy Wi-Fi link" is
context an engineer reads **alongside** a finding, never the finding itself — the
finding is the freeze, the congestion, the delay. A classification that raised
issues would flag every coffee-shop call on the fleet as a fault.

So it lands in **Telemetry**, beside the ladder rather than on it, in the company of
`CodecChangeDetector` and `IceTraversalDetector` — whose subject is connectivity and
whose category is still telemetry, because a fact about the session is not a fault.

That gives it a shape this codebase already has:

- **One class**, `NetworkClassificationDetector`, bound to `PeerConnectionMonitor`.
  It answers one question with several answers, which is the payload-discriminator
  case in [design rule 1](./DETECTOR_TAXONOMY.md#the-five-design-rules) rather than
  the second-detector case.
- **One event**, `network-classification-changed`, emitted on a *transition* and not
  on every collection.
- **One attribute**, `PeerConnectionMonitor.networkClass`, moving only when the
  classification moves and `undefined` while the detector is not judging — exactly
  what `InboundTrackMonitor.frameFlowState` does for the video flow state.

## The signal that makes it possible

Media loss confounds two different things: a link dropping packets, and this
endpoint overfilling a queue. That confusion is the whole reason bandwidth
limitation is excluded below — loss under congestion is a property of what was
being sent, not of the network.

**STUN consent checks separate them.** `requestsSent`, `responsesReceived` and
`consentRequestsSent` on the selected candidate pair are small, uniformly paced,
low-rate packets that keep flowing whatever the encoder does. They are the closest
thing to a ping series `getStats()` has, and `IceCandidatePairMonitor` already keeps
the deltas.

| Probe loss | Media loss | Reading |
|---|---|---|
| high | high | the link drops packets whatever the load — **a lossy path** |
| ~zero | high | packets die only when bitrate is pushed — **a bottleneck**, and by the rule below not a network class at all |
| high | ~zero | the path is dropping our checks while media flows — suspect asymmetry, or a middlebox treating STUN differently |

`avgRoundTripTimeInSec` on the same pair is the second clean series: a round trip
measured on probes rather than on media, so its variance describes the path instead
of the pacer. Both are already derived; nothing new is needed to start.

## The classes

Each is a statement about a stretch of the call, judged over a long window (see
below). They are mutually exclusive: the detector reports one, and reports
`undefined` rather than guessing when the evidence does not separate them.

| Class | What decides it | The confounder it has to survive |
|---|---|---|
| `clean` | probe loss ~0, jitter low and steady, no retransmission | — |
| `lossy-random` | loss present in *most* collections, low variance across them, probe loss agreeing | the same mean loss arriving in bursts |
| `lossy-bursty` | most collections clean with occasional spikes — high coefficient of variation, high clean-tick fraction | as above, from the other side |
| `jittery` | loss ~0 while `avgInboundJitterInMs` and `interFrameDelayVariation` stay high | Wi-Fi power save, aggregating links, VPNs — the path delivers everything, unevenly |
| `distant` | round trip high, variance low, loss ~0 | a relay on the wrong continent. Not a fault; it explains everything else |
| `flapping` | path switches, repeated brief disconnects, step changes in round trip | see the overlap question below |
| `constrained` | TURN over TCP (`usingTURN` and `usingTCP` together) | TCP head-of-line blocking reads as jitter and is not the path's doing |

`constrained` is worth stating even though it is read straight off the selected
path rather than measured: it changes how every other number on the call should be
interpreted, and an engineer who does not know the media is riding TCP will
misread all of them.

## Telling random loss from bursty loss

This is the interesting one, and it is reachable at a one-second collecting period
even though the structure being described lives inside the second.

**You cannot see inside a collection. You can see across them.** For the same mean
loss, the two shapes look completely different as a series:

- random loss — interference, a marginal radio, a lossy tunnel — arrives at a
  stable nonzero rate in nearly every collection. Low variance, few clean ticks.
- bursty loss — a queue overflowing, a handover, retry exhaustion — arrives as a
  spike in one or two collections with clean ones on either side. High coefficient
  of variation, high clean-tick fraction.

So the discriminator is the *dispersion* of `deltaFractionLost` over the window,
plus the share of collections with no loss at all.

**And there is a second, independent one, from the consequence side.** A burst
destroys a whole frame; scattered loss is largely repaired by retransmission. So
for the same mean loss, bursty paths cost far more freezes and PLIs per lost
packet than random ones. `pliRate`, `nackRate`, `frozenTimeRatio` and
`retransmissionRatio` are all already derived per stream.

Two independent measurements agreeing is worth something, in exactly the way the
transport quality reference argues co-firing is worth something. One of them alone
is a guess.

## What is deliberately not a class

**Bandwidth limitation is not a network class.** A path that cannot carry what the
encoder wants is a capacity finding, and it has two detectors already. Folding it
in here would make the classifier report the sender's ambition as a property of the
link.

**CPU strain is not a network class either.** An encoder limited by `cpu` produces
collapsing bitrate, rising send delay and a stuttering picture with a perfectly
healthy path underneath.

Both must therefore be *excluded* rather than classified: while
`qualityLimitationReason` is `bandwidth` or `cpu`, the loss and jitter of those
collections describe a loaded endpoint rather than a path, and the classifier
should drop them from its window rather than reason about them. It reads the raw
field, never another detector's conclusion.

## What the browser will not tell us

`RTCIceCandidateStats.networkType` — wifi / cellular / ethernet — **is gone**, and
deliberately: it was removed as a fingerprinting vector
([w3c/webrtc-stats#374](https://github.com/w3c/webrtc-stats/issues/374)) and is
absent from the current specification. Do not plan around it, and do not infer it
from timing signatures: reconstructing a stat the browser declined to give is
exactly what [design rule 5](./DETECTOR_TAXONOMY.md#the-five-design-rules) forbids,
and a "cellular" verdict derived from jitter shape would be a guess wearing a
measurement's clothes.

If link type is genuinely wanted, `navigator.connection.effectiveType` is a
separate API the client monitor could read and carry as an attribute — clearly
labelled as not a statistic, the way `activeTab` already is.

## The open measurement: ECN

The schema already carries four ECN counters and the monitors already pass them
through. **Nothing reads them.** The specification is unambiguous about what they
would mean:

- `packetsReceivedWithCe` — "Total number of RTP packets received for this SSRC
  marked with the "CE" marking." The network saying it is congested *before* it
  drops anything.
- `packetsReceivedWithEct1` — "Total number of RTP packets received for this SSRC
  marked with the "ECT(1)" marking."
- `packetsWithBleachedEct1Marking` — "Number of packets that were sent with ECT(1)
  markings per [RFC3168] section 3, but where an [RFC8888] report gave information
  that the packet was received with a marking of "not-ECT"." A middlebox stripping
  ECN, which is itself a fact about the path.

If Chrome populates them, two things follow: an `actively-managed` class nobody
else reports, and a congestion signal that arrives earlier than loss does.

**Do not assume it does.** `packetsReportedAsLostButRecovered`, defined in the same
dictionary, carries the warning: "Only exists if support for the "ccfb" feedback
mechanism has been negotiated." That is the same shape as `availableIncomingBitrate`
— specified, plausible, and absent in practice on the browser that matters. This
needs the throttle probe in
[CONGESTION_RESTRUCTURE_HANDOFF.md](./CONGESTION_RESTRUCTURE_HANDOFF.md#the-recipe),
which takes about three minutes to run, and the answer is a fact rather than an
opinion. **Measure it before designing anything on top of it.**

## Windows and confidence

A classification describes a stretch of a call, not a collection, so its window is
far longer than any detector in the tree: **30 to 60 seconds of stats time**, with a
minimum number of usable collections before it says anything at all. Under that, it
reports `undefined` — which is the honest answer for the first minute of every call
and is what stops a classifier from renaming the network every time a car passes
the window.

`PeerConnectionMonitor.statsClockTime` makes the window cheap: the clock is already
derived, so the detector keeps a series and a cutoff and no accumulator of its own.

Transitions need hysteresis of their own. A class that flips between
`lossy-random` and `lossy-bursty` every window is worse than one that says
`undefined`, because it will be trended.

## Monitor-side facts it would need

Following the boundary rule — the monitor computes the fact, the detector holds the
opinion — most of this exists. What does not:

| Fact | Where | Why the monitor and not the detector |
|---|---|---|
| probe loss fraction (`deltaRequestsSent` + `deltaConsentRequestsSent` against `deltaResponsesReceived`) | `IceCandidatePairMonitor` | a real measurement of the path anything might want, and the arithmetic is the pair's own counters |
| probe round-trip series | already `avgRoundTripTimeInSec` | — |
| media loss, jitter, PLI/NACK/freeze rates | already on `InboundRtpMonitor` | — |
| the *dispersion* of those over a window | **the detector** | a yardstick for a judgement, not a fact about the stream — the same call as the capacity detectors' rolling maxima |

## Questions to rule on before building

1. **Does this subsume the unreliable-path detector?** `flapping` as a class and
   detector #3 in the congestion handoff answer nearly the same question from the
   same inputs, and building both is how an echo happens. The argument for
   subsuming: an unstable path is a *fact about the session*, which is why
   `ice-restart` is telemetry rather than a fault. Ruling this way retires #3 and
   the open question attached to it.
2. **How many classes are worth having?** Seven is proposed; `distant` and
   `constrained` are read almost directly off the selected path and could be
   attributes instead of classes.
3. **One classification per connection, or per direction?** Loss and jitter are
   measured on what arrives; the probe series is bidirectional. A single verdict is
   simpler and is what an operator wants on a dashboard; a per-direction one is
   more honest on an asymmetric link.
4. **Does the ECN measurement come first?** If Chrome populates the CE counters,
   the class list gains a member and the loss classes gain a much earlier signal.
