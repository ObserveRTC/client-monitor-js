# Connectivity Detectors — the layer model

This document is the reference for how the library organizes **connectivity**
failure detection: the five layers a WebRTC connection climbs before media
flows, which detectors own each one, and what each one is allowed to conclude.

It answers one question: *if a user cannot establish or maintain a working
connection, where exactly did it fail?* — and it exists because the alternative
is five issue types that all mean approximately "ICE didn't work".

This is the deep reference for **Category 1** of the library's five detector
categories. The parent map — the other four categories, what puts a detector
in one rather than another, and the rules that keep the boundaries stable — is
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md). For the surrounding API
(listening to issues, the `ClientMonitorIssue` union, enabling and disabling
detectors) see the *Events and Issues* section of the
[README](../README.md#events-and-issues).

- [The layers](#the-layers)
- [The rule: one class per issue, not one class per layer](#the-rule-one-class-per-issue-not-one-class-per-layer)
- [The grid](#the-grid)
- [Layer 1 — Reachability](#layer-1--reachability)
- [Layer 2 — Discovery and traversal](#layer-2--discovery-and-traversal)
- [Layer 3 — Path establishment](#layer-3--path-establishment)
- [Layer 4 — Secure transport](#layer-4--secure-transport)
- [Layer 5 — Path continuity](#layer-5--path-continuity)
- [Restarts: the telemetry alongside the ladder](#restarts-the-telemetry-alongside-the-ladder)
- [Issue taxonomy by layer](#issue-taxonomy-by-layer)
- [What this model deliberately does not do](#what-this-model-deliberately-does-not-do)
- [Observability horizon](#observability-horizon)

## The layers

```
Application / signaling      (not observable here — see Observability horizon)
        │
        ▼
1  Reachability              can we reach the ICE infrastructure at all?
        │
        ▼
2  Discovery / traversal     what candidates could we produce, and what path do they permit?
        │
        ▼
3  Path establishment        did any candidate pair actually win?
        │
        ▼
4  Secure transport          did DTLS complete on the path ICE found?
        │
        ▼
5  Path continuity           does the established path persist, and how much does it move?
```

**A layer begins where the previous layer's success is proven, and every issue
belongs to the *first* layer whose proof fails.** That single sentence is what
keeps the taxonomy from collapsing: a connection that never gathered a relay
candidate is not a "path establishment" failure that happens to have no
candidates, it is a layer-1/2 failure, and layer 3 must stay quiet about it.

The layers are also the escalation order for an engineer reading a session:
start at the lowest layer that raised an issue, because everything above it is
downstream of that failure.

**There used to be a sixth layer, "media flow", holding
`BlockedTransportDetector`.** It has been retired, and the detector moved to
**Transport Quality → Delivery reliability**. The reasoning that put it here was
that the network is the subject; the reasoning that moves it is the membership
test each category actually states. Every connectivity stage completed and
*holds* — the pair is `succeeded`, consent checks keep passing, `iceState` reads
`connected` — and the path simply is not delivering. "Every stage completed and
the path is still the reason the call is bad" is Transport Quality word for
word. See
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#category-2--transport-quality);
that finding is now three classes — `BlockedStunRequestsDetector`,
`BlockedOutboundMediaDetector` and `BlockedInboundMediaDetector` — with a config
key each, and the `blocked-transport` *event* is emitted by the first of them.

## The rule: one class per issue, not one class per layer

Detectors bind to exactly one monitor, and the library has several monitor
levels — `ClientMonitor`, `PeerConnectionMonitor`, and each track monitor —
each with its own `Detectors` registry. This model used to add its own
invariant, *one detector class per layer per monitor level*. That rule is
**superseded** by the library-wide rule that is stricter:

> **One detector class raises exactly one issue type.** A layer holds as many
> classes as it has distinct findings, and a layer with nothing to say gets no
> class at all.

Three of the five layers now hold several classes. Layer 5 holds four, because
a path that is down, a path the browser has given up on, a path that is up and
delivering nothing, and a path that will not settle are four conditions with
four different fixes. Layer 4 holds two, because a terminal `dtlsState:
'failed'` and a handshake that never answers have different evidence and
different thresholds. Layer 3 holds two, because "establishment is slow" and
"establishment failed" are not the same claim.

The reasons are in
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#the-five-design-rules), but the
one that matters most here is operational: `Detectors.update()` wraps each
detector's `update()` in its own try/catch, so a class owning four findings
loses all four to one malformed stats report. Splitting them means a throw costs
one verdict for one tick. Each is also independently disableable, and each has
its own `includeIssueInSample` flag.

Two consequences follow.

**Registration order no longer carries meaning.** It used to: with one class per
layer, the constructor listed the ladder top to bottom so a lower layer could
record a verdict the later ones consulted. No detector reads another's
conclusion any more — every one of them decides from raw transport and
connection state — so the order in `PeerConnectionMonitor`'s constructor is
documentation of this model for whoever reads the file, and nothing depends on
it. The four layer-5 classes and the two layer-4 classes may be reordered,
disabled or replaced freely.

**Send and receive sides do not fork the model.** Where a layer genuinely
differs by direction, the difference lands in one of two places, never in a new
layer: on a different *monitor level* (an inbound track monitor and an outbound
track monitor each get their own class), or as a payload discriminator (the
`direction` field on `ice-transport-stalled`, the `evidence` field on
`blocked-transport`).

The issue type remains the public contract that `observer-js` and dashboards
consume; the detector class is an implementation unit. Reorganizing classes
never renames issues — the split from `IcePathStabilityDetector` into six
classes changed no issue type at all. What it does change is the detector `name`
strings applications pass to `detectors.disable()`. Lookup by name is exact and
there is no alias for a retired spelling, so `disable('ice-path-stability-detector')`
now returns `false` and silences nothing; the retired names and what each became
are listed under
[Renamed and split detectors](./DETECTOR_TAXONOMY.md#renamed-and-split-detectors).
It changes the config keys too: each class here now reads a block named after it,
and the `icePathStabilityDetector` and `dtlsHandshakeDetector` keys that used to
cover a whole layer are retired along with the classes they were named for.

## The grid

| Layer | Class | Issue | Config key |
|---|---|---|---|
| 1 Reachability | `IceReachabilityDetector` | `no-available-ice-candidate` | `iceReachabilityDetector` |
| 2 Discovery / traversal | `IceTraversalDetector` | *(none, by design)* | `iceTraversalDetector` |
| 3 Path establishment | `IcePathEstablishmentDetector` | *(event only)* | `icePathEstablishmentDetector` |
| 3 Path establishment | `IceEstablishmentFailedDetector` | `ice-establishment-failed` | `iceEstablishmentFailedDetector` |
| 4 Secure transport | `DtlsHandshakeFailedDetector` | `dtls-handshake-failed` | `dtlsHandshakeFailedDetector` |
| 4 Secure transport | `DtlsHandshakeStalledDetector` | `dtls-handshake-stalled` | `dtlsHandshakeStalledDetector` |
| 5 Path continuity | `IceDisconnectedDetector` | `ice-disconnected` | `iceDisconnectedDetector` |
| 5 Path continuity | `IceConnectionFailedDetector` | `ice-connection-failed` | `iceConnectionFailedDetector` |
| 5 Path continuity | `IceTransportStalledDetector` | `ice-transport-stalled` | `iceTransportStalledDetector` |
| 5 Path continuity | `UnstableIcePathDetector` | `unstable-ice-path` | `unstableIcePathDetector` |
| *(beside)* | `IceRestartDetector` | *(event only)* | `iceRestartDetector` |
| *(beside)* | `IceRestartRecommendationDetector` | *(event only)* | `iceRestartRecommendationDetector` |

Every class here binds to `PeerConnectionMonitor`; no connectivity layer has
anything to say at a track monitor. **Each class reads that key and no other**
([design rule 4](./DETECTOR_TAXONOMY.md#4-one-detector-one-config-block)), so
passing `null` leaves exactly that class unregistered and turning a whole layer
off means naming each of its keys. `dtlsHandshakeFailedDetector`,
`iceConnectionFailedDetector` and `iceTraversalDetector` carry no tunables at all
— a terminal state needs no threshold and a telemetry report needs no bar — so
`{}` enables them and `null` disables them, and that is the whole block.

## Layer 1 — Reachability

**Question.** Can the client reach the ICE infrastructure it was configured
with? **Ends when** gathering reports `complete`, or the connection gives up.

`IceReachabilityDetector` raises `no-available-ice-candidate`, the floor of the
whole model: ICE gathering produced **zero** local candidates, which means there
was nothing to connect *with* — no interface up, airplane mode, a VPN that tore
down every route, or a network locked down so tightly the sockets cannot bind.

Every other ICE issue describes a path that existed and stopped working; this
one says no path was ever possible. A healthy client gathers at least one host
candidate within milliseconds, since any interface that is up yields one even
with no internet, so an empty candidate list is not a slow start but an absent
network. `getStats()` keeps working throughout; it simply returns no
`local-candidate` entries.

Three guards keep it honest, and each rules out a distinct false positive.
Zero candidate rows count as evidence only once `iceGatheringState` reads
`complete` — before that they mean gathering is still running, and where the
field is absent they mean nothing was measured, which is not the same as
"gathering produced nothing". Falling to `disconnected`/`failed` with zero
candidates raises immediately, since the browser has already given its verdict
and the empty list explains it; merely sitting in `new`/`connecting` has to
outlast `thresholdInMs`, which is what keeps the detector off an un-negotiated
peer connection, since that has zero candidates too. And it never fires on a
connection that once reached `connected` — mid-call network loss is layer 5.

It cannot separate "no network" from "every candidate type forbidden by policy",
and does not try: operationally both mean this client cannot do WebRTC here.

**What this layer does not do.** There is no per-server reachability finding.
Distinguishing an unreachable STUN server from a TURN credential the server
rejected is genuinely valuable — one is an outage, the other hits every client
at once — and the evidence for it exists in `icecandidateerror` verdicts (`701`
for unreachable, `401`/`438`/`403` for auth) and in candidate-class absence
measured against the configuration. No detector consumes any of it today, and
the earlier revisions of this document described an `ice-servers-unreachable`
issue that was never implemented. It is recorded here as a gap rather than
documented as behaviour.

**User symptom.** Cannot join, or joins and then fails when relay would have
been needed.

## Layer 2 — Discovery and traversal

**Question.** What kind of path do the gathered candidates permit, and what did
the endpoint have to use? **Ends at** gathering complete with a classified
candidate inventory.

`IceTraversalDetector` **raises no issues** — deliberately. Needing TURN is not
a fault; it is a cost. A relay path works, and reporting it as a problem would
train operators to ignore the layer. Traversal reports context as events:
`ice-tuple-changed` when the selected local:remote tuple set changes, and the
classified `ice-path-changed` transitions that `SelectedIcePath` produces —
`direct-to-relay`, `relay-to-direct`, `turn-server-changed`,
`relay-protocol-changed`, `path-changed`.

The detector stays deliberately the low-level primitive: it reports only *that*
the tuple set changed. `SelectedIcePath` classifies what kind of change it was,
and `UnstableIcePathDetector` at layer 5 owns the issue raised when a path keeps
switching. Establishment itself is not a change — growing from an empty set is
skipped, or every call would report a path move in its first seconds.

The normalized path classification is `IcePathKind`: `direct`, `turn-udp`,
`turn-tcp`, `turn-tls`, `turn-unknown`. It is derived `candidateType`-first —
a `relay` candidate is by definition obtained from TURN — with `relayProtocol`
as the fallback for stats that omit the type, because a `srflx` candidate
discovered *through* a TURN server's STUN function also carries a `turn:` URL
and would otherwise be misread as relay.

The path kind rides along on the payload of every issue that carries a
candidate pair, so any higher-layer issue can be read as "…and it happened on a
TURN/TLS path" without a separate signal.

**User symptom.** None directly. TURN/TCP and TURN/TLS paths add latency and
behave worse under loss, which shows up as quality, not as connectivity.

## Layer 3 — Path establishment

**Question.** Did any candidate pair reach `succeeded` **and** `nominated`?
**Ends at** first nomination.

Two classes, because slow and failed are two claims.

### `IcePathEstablishmentDetector` — establishment is dragging

Reports how long a peer connection has been trying to connect, and — the part
that makes the report actionable — which stage of connecting it is stuck in.
Nothing else in the library can answer that second question, because
`connectionState: 'connecting'` deliberately covers ICE gathering, ICE checking
and the DTLS handshake alike, and the three have nothing in common except that
the connection is not ready yet.

`ice-path-establishment-slow` goes out as an **event** once setup
outlasts `thresholdInMs`, with `stalledStage` naming where the connection is
stuck: `ice-gathering` before any transport exists, `ice-checking` while a
transport is still negotiating connectivity, `dtls` once a transport's ICE side
is done yet the connection still is not `connected`, and `unknown` when the
stats give no verdict. Where the browser reports no per-transport `iceState`,
the selected pair being `succeeded` stands in as proof the ICE side finished.

The trigger is `connectionState` rather than any transport's ICE state precisely
because of that coverage: a connection whose ICE side finished and whose DTLS
handshake is hanging has every transport reading `connected` while the call
still does not work, and a detector watching ICE alone would call it healthy.

It re-arms on **any** exit from `connecting`, not only on `connected`. Resetting
on success alone would silence every attempt after the first failure, and a
retry that is also taking too long is more interesting than the first attempt
was, not less.

It raises no issue on purpose: saying establishment is slow is not yet a claim
that it has failed.

### `IceEstablishmentFailedDetector` — establishment demonstrably did not work

`ice-establishment-failed` is the call that never connected — by a wide margin
the most common connectivity failure a user actually reports, and until this
class existed the one thing the library could not put in `activeIssues`. Layer 3
emitted an event when establishment dragged on and recommended a restart, but an
event is a notification: it is gone the moment it fires, it does not resolve,
and nothing asking "what is wrong with this session right now" could see it. So
the single most user-visible failure produced an empty issue list, which reads
as a healthy call.

The condition is three facts together, none sufficient alone. **Local candidates
exist**, so this is emphatically not the no-network case — layer 1 owns that,
and the two are mutually exclusive by construction rather than by suppression.
**The peer connection has never reached `connected`**, so this is establishment
failing rather than a working call that later broke, which layer 5 owns. And
**no candidate pair has ever been nominated or reached `succeeded`**, which
separates "checks are still running and might yet win" from "nothing ever won";
a connection where a pair succeeded and DTLS is what stalled is layer 4's fault
with layer 4's owner. All three must hold for the whole of `thresholdInMs`,
accumulated from the peer connection's own `deltaTime`, because ICE checking
legitimately takes seconds and a threshold measured in wall time would punish a
slow collection rather than a slow connection. The nomination check is
**latched**, not sampled: a pair that won once is proof establishment got there,
however the pair looks on any later tick.

The default threshold (15 s) sits well past
`icePathEstablishmentDetector.thresholdInMs` (5 s) on purpose — a connection
that is merely slow has to be given time to stop being merely slow.

The payload carries what was tried rather than only that it failed, which is
where the candidate types and the pair `nominated`/`state` fields — collected by
this library since forever and read by nothing — finally earn their place:

| `localCandidateCounts` shows | Reading |
|---|---|
| host only | Gathering never reached a STUN server |
| host + srflx, no relay | TURN was never configured or never answered — the most common cause of a call that fails only between certain networks |
| relay present, every pair `in-progress` or `failed` | The relay is unreachable, or the far end never answered the checks |

That is the difference between a misconfiguration, a firewall and a dead peer,
and it is all in the stats already. `candidatePairStates` is every distinct pair
`state` seen, deduplicated and sorted.

What it deliberately does not claim: which side is at fault. Every fact here is
local — what this endpoint gathered and how its own checks went — and a far end
that never sent an answer looks exactly like a far end whose candidates cannot
be reached. The counts are evidence for a human or a server-side correlation to
work with, not a verdict.

The `never-established` ICE restart recommendation used to live in this layer's
detector; it now belongs to `IceRestartRecommendationDetector` along with the
other three restart reasons, so that the rate limiting across all four is
shared.

**User symptom.** Cannot join the call.

## Layer 4 — Secure transport

**Question.** Did DTLS complete on the path ICE established? **Ends at**
`dtlsState: 'connected'`.

This layer separates "the network path failed" — every other ICE layer's
territory — from "the secure media transport never negotiated", which nothing
owned before it existed. A certificate fingerprint mismatch, DTLS version
intolerance, or a middlebox that passes STUN but eats DTLS all used to present
as a generically slow `connecting`.

Two classes, because the browser announcing a verdict and the browser saying
nothing at all are different problems.

### `DtlsHandshakeFailedDetector`

`dtls-handshake-failed` raises on the first tick reporting `dtlsState: 'failed'`.
There is nothing to wait for and nothing to average: `failed` is the browser's
terminal verdict on this key exchange, so there is no maturity guard and no
duration threshold, and the issue is raised once per transport rather than once
per tick.

Only a later `connected` resolves it, which in practice means an ICE restart
re-ran the handshake and the new generation succeeded. A transport that drops
back to `new`/`connecting` after a restart is not yet evidence of anything — the
second handshake may fail exactly like the first — so the issue stays open until
one actually completes, or until the transport disappears.

Its config block is empty by design: `failed` is not a matter of degree, so there
is nothing here to tune. `dtlsHandshakeFailedDetector: {}` enables it and
`dtlsHandshakeFailedDetector: null` leaves it unregistered. Its sibling's
`stalledThresholdInMs` lives under `dtlsHandshakeStalledDetector`, where disabling
one no longer disables the other.

### `DtlsHandshakeStalledDetector`

`dtls-handshake-stalled` raises when the ICE side is **proven healthy** while
`dtlsState` sits in `new` or `connecting` past `stalledThresholdInMs`. This is
the half with no verdict to read: a handshake being eaten by a middlebox and one
that is a few hundred milliseconds from completing look identical in a single
stats report, and only duration separates them.

The stall is only meaningful once ICE is out of the picture, since DTLS cannot
complete over a path that is not yet usable and reporting it would mean
re-reporting whatever the ICE detectors already own. That proof has two forms,
and the payload's `iceEvidence` field records which one carried it — a finding
resting on the weaker of them is worth less to whoever reads it:

| `iceEvidence` | Meaning |
|---|---|
| `transport-ice-state` | The transport reported `iceState` `connected`/`completed` |
| `selected-pair-succeeded` | No `iceState` reported (Safari, and the transport reconstructed for Firefox < 153); the selected pair being `succeeded` stood in |

The clock is stats time: each qualifying tick adds the transport's own
`deltaTime`, so a collection that ran late still credits the handshake with
exactly the time it spent quiet. Anything that ends the condition resets that
accumulator — ICE health lost, DTLS reaching `connected` or `failed`, a `closed`
transport — and so does a changed ICE local username fragment, since an ICE
restart re-keys DTLS and the new generation deserves the full threshold rather
than inheriting the old one's.

A transport is never judged on its first observed tick. Firefox 153/154 report
pre-negotiation transport values that only 155 makes trustworthy, and a detector
that believed them would raise on every peer connection at birth. `dtlsState:
'closed'` is a shutdown and not a failure, and is refused outright.

**User symptom.** Appears stuck connecting even though the network path exists.

## Layer 5 — Path continuity

**Question.** Does the established path persist, and how much does it move?
**Active for** the connection's whole life after nomination.

Four classes, one per finding, each keeping its own per-ICE-transport state —
because a peer connection without BUNDLE has several transports and they fail
independently. All four read the ICE local username fragment themselves to
notice a new ICE generation, rather than asking `IceRestartDetector`, so none
depends on another or on the order they run in. That is about twenty duplicated
lines per class and it is deliberate; see
[design rule 2](./DETECTOR_TAXONOMY.md#the-five-design-rules).

### `IceDisconnectedDetector` — `ice-disconnected`

A transport that has been `disconnected` long enough that it is no longer going
to fix itself. `disconnected` on its own is never worth an issue: it is what a
browser says when consent checks have missed for a moment, and a Wi-Fi roam, a
brief radio dropout or a busy CPU produce it several times in an ordinary call
while ICE quietly recovers. Only duration separates the blip from the outage,
which is what `disconnectedThresholdInMs` measures — in stats time, so a late
collection credits the outage with the time it actually lasted rather than the
time the library spent not looking.

A new ICE generation resolves the standing issue and restarts the clock; the new
generation deserves to be judged on its own. Falling from `disconnected` into
`failed` does **not** resolve it — that transport has not recovered, it has got
worse — and the issue is left standing for its sibling to raise alongside.

It deliberately does not claim the media path is gone. A `disconnected`
transport frequently comes back, which is why the issue resolves rather than
being terminal.

### `IceConnectionFailedDetector` — `ice-connection-failed`

A transport the browser has given up on. Unlike `disconnected`, `failed` is
terminal for the ICE generation — the browser will not retry candidates on its
own — so there is nothing to wait out and the issue is raised on the first tick
that reports it. Its `iceConnectionFailedDetector` block decides only whether the
class is registered — `{}` or `null` — since a terminal state has no threshold to
tune.

**The payload carries `everConnected`**, and that field is the reason this class
is worth reading rather than just counting. `IceTransportMonitor.everConnected`
is a latch set the first time the transport reads `connected` or `completed` and
never cleared afterwards — the transport's own record, not an inference. `failed`
on its own conflates two faults that share a state and share nothing else:

| `everConnected` | Meaning | Where to look |
|---|---|---|
| `false` | The path **never worked**: no candidate pair ever won | What was tried and what was reachable — symmetric NAT with no TURN, a firewall eating the checks, a TURN credential the client never got |
| `true` | The path **worked and was lost**: connectivity that existed and then stopped | The network underneath — the interface changed, the NAT binding expired, the route died |

The evidence to gather and the fix are different in each case, and a reader with
only `failed` cannot tell which one they are looking at. The distinction also
keeps the layer boundary crisp from the other side: an `everConnected: false`
failure is layer 5 reporting the end of a story layer 3 was already telling, and
seeing both `ice-establishment-failed` and an `everConnected: false`
`ice-connection-failed` in one session is coherent rather than contradictory.

A changed username fragment resolves the standing issue so the next `failed`
under the new generation raises again with `iceGeneration` incremented.

It deliberately does not claim a cause. `failed` says candidate checking ended
without a usable pair; it does not say whether that was the network, the TURN
configuration or the far end.

### `IceTransportStalledDetector` — `ice-transport-stalled`

The quiet failure: every state still reads healthy — ICE `connected`, the
selected pair `succeeded`, no error anywhere — while the transport keeps sending
and receives nothing back. No state machine will ever report this, because as
far as the browser is concerned nothing has gone wrong; the only evidence is the
asymmetry between what leaves and what arrives.

Our own outbound traffic is what makes the expectation defensible. A live ICE
path returns at least STUN consent responses and RTCP for whatever we send, so
bytes going out with nothing coming back is anomalous no matter what the
application intended to receive. The mirror case — silence in **both**
directions — is deliberately not reportable: it cannot be told apart from a
legitimately idle connection, and a detector that guessed would spend its life
reporting muted calls. That is why the payload's `direction` is `'inbound'` and
only `'inbound'`.

Two guards keep it off paths where receiving nothing is the healthy state, and
both are load bearing. Inbound traffic must have been seen on this transport
before, so a path that never delivered anything is left to the detectors that
own establishment. And inbound RTP must be attributed to this transport at all:
a send-only publish transport — the ordinary shape of a mediasoup or SFU uplink
— receives only consent responses and RTCP arriving in bursts seconds apart, so
between two of them its inbound delta is legitimately zero for longer than the
threshold, and there is no inbound media for it to be stalling in the first
place. If such a path really dies, consent stops and `ice-disconnected` owns it.

An inferred ICE restart zeroes the inbound-traffic latch as well as the clock:
the new generation has proven nothing yet and must earn the guard again.

### `UnstableIcePathDetector` — `unstable-ice-path`

A transport whose selected path will not settle. This is a different failure
from a path that is down, and a worse one to experience: each reselection is a
fresh round of consent checks over a new tuple, so media stutters, the encoder's
bandwidth estimate is thrown away and rebuilt, and the call sounds broken while
every state field reports `connected` throughout. The usual causes are a device
with two live interfaces fighting over which one wins, a NAT rewriting bindings
underneath a live flow, or a TURN allocation that keeps being re-established.

Switches are counted as the larger of two sources, because neither alone is
sufficient. Diffing `selectedCandidatePairId` from tick to tick is portable and
works everywhere, but it is blind to a flap that departs and returns inside one
collecting period — two switches that look like none. The browser's own
`selectedCandidatePairChanges` delta sees exactly those and is the ground truth
for *how many* happened, but Safari does not report it at all and neither does
Firefox before 155. Taking the maximum uses the better evidence where it exists
and still works where it does not; the payload carries the native count
separately as `nativePairChanges`.

The window is **tumbling**, not sliding: each tick adds the transport's own
`deltaTime`, and once the accumulated time passes `pathSwitchWindowInMs` both
counters reset and a new window starts. A sliding window would need a timestamp
per switch and the bookkeeping to age them out, and would buy nothing here — the
question being asked is "is this path flapping right now", where the difference
is at worst a threshold reached one window later.

The threshold — three switches in thirty seconds — is reasoned, not arbitrary.
A legitimate network handover produces one switch, occasionally two if the new
path bounces once. Consent checks run roughly every five seconds, so three or
more switches inside thirty seconds means no path survived even a few consent
intervals: that is oscillation, not migration.

It deliberately does not claim which path is better, or that the switching
itself is the fault rather than a symptom of the network underneath.

**User symptom.** `ice-disconnected` / `ice-connection-failed`: audio and video
suddenly stop. `ice-transport-stalled`: the call looks connected and nothing
arrives. `unstable-ice-path`: intermittent freezes and reconnections.

## Restarts: the telemetry alongside the ladder

Two classes sit beside the ladder rather than on it. Neither raises an issue,
and neither ever will: a restart is a fact about the connection, not a fault,
and recommending one is advice rather than a finding. Both are Telemetry by the
counterfactual test in
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#category-5--telemetry).

### `IceRestartDetector` — `ice-restart`

Reports that a transport started a new ICE generation, and how that generation
turned out. The evidence is a changed ICE local username fragment, which is
renegotiated per generation and is therefore the one field a restart cannot
leave alone. That is an inference, not a report: the browser exposes no "a
restart happened" signal, and stats alone cannot separate a restart the
application asked for from one the browser started by itself. It is also not
universally available — Firefox's transport report is reconstructed by
`FirefoxStatsAdapter` and carries no fragment, so the detector falls back to the
selected local candidate's `usernameFragment` and stays silent when neither
exists. An application wanting certainty should instrument its own
`restartIce()` calls.

Three outcomes are emitted rather than one, because "a restart was attempted"
and "the restart worked" are different facts and only the pair is worth reading.
`detected` goes out when the fragment changes; the generation is then followed
until the transport reaches `connected`/`completed` (`recovered`) or `failed`
(`failed`). A generation still checking has no outcome yet, and none is invented
for it.

### `IceRestartRecommendationDetector` — `ice-restart-recommended`

The one place that says "restart ICE". It recommends and never performs: only
the application knows whether renegotiation is safe at this moment, whether the
signalling channel is even up, and what an SFU on the other end expects.

Four conditions warrant one, and they are together in one class — the exception
to one-class-per-issue, and legitimate because they produce one event type
rather than four issue types — because they answer one question, *would starting
ICE over help?*, and because the rate limiting only means anything if it is
shared. Two detectors each politely waiting out their own cooldown produce twice
the nagging.

| `reason` | Scope | Waits for |
|---|---|---|
| `ice-failed` | per transport | Nothing — ICE never self-heals from `failed` |
| `ice-disconnected` | per transport | `iceRestartRecommendationThresholdInMs` |
| `transport-stalled` | per transport | `iceRestartRecommendationThresholdInMs` |
| `never-established` | per peer connection | `restartRecommendationThresholdInMs` |

`never-established` is measured against `connectingStartedAt` rather than any
transport clock, because the fault is the absence of a working transport: there
may be no transport in a reportable state, or no transport at all. It yields to
`ice-failed` and `ice-disconnected` — a transport in either state names what
went wrong, where "it never connected" only names what did not happen — and
because both reasons now live in one class, that is precedence between two
verdicts rather than coordination between two detectors.

Every verdict here is reached from raw transport and connection state, never by
asking the layer-5 detectors what they concluded. The stall condition and all
its guards are written out a second time in this class for exactly that reason.
A restart already in flight suppresses recommendations until it resolves, since
asking for a second restart while the first is still negotiating is how an
application ends up in a restart loop. `recommendationCount` rising against a
flat `iceGeneration` is what tells a reader the advice is not being taken — or
is not working.

**All four conditions are configured in one block of its own**,
`iceRestartRecommendationDetector`, holding `createEvent`,
`iceRestartRecommendationThresholdInMs` and `iceRestartRecommendationCooldownInMs`
for the three per-transport reasons, and `restartRecommendationThresholdInMs` and
`restartRecommendationCooldownInMs` for `never-established`. It used to read those
last two out of the layer-3 block and the first three out of the layer-5 block, so
each half of the class was gated by a different neighbour's key — an
`icePathEstablishmentDetector: null` meant to switch off the slow-establishment
event also silenced every `never-established` recommendation. Both halves now run
whenever this key is set, and `iceRestartRecommendationDetector: null` is the one
way to silence any of it.

The thresholds being its own rather than borrowed from the detectors that raise
the corresponding issues is the point: recommending a renegotiation is a different
decision from reporting a fault, and it is normal to want the recommendation to
wait longer than the issue did. Disabling `iceDisconnectedDetector` or
`icePathEstablishmentDetector` no longer silences the matching recommendation, and
vice versa.

## Issue taxonomy by layer

| Layer | Issue type | Detector |
|---|---|---|
| 1 | `no-available-ice-candidate` | `IceReachabilityDetector` |
| 2 | *(events only)* | `IceTraversalDetector` |
| 3 | *(event only)* | `IcePathEstablishmentDetector` |
| 3 | `ice-establishment-failed` | `IceEstablishmentFailedDetector` |
| 4 | `dtls-handshake-failed` | `DtlsHandshakeFailedDetector` |
| 4 | `dtls-handshake-stalled` | `DtlsHandshakeStalledDetector` |
| 5 | `ice-disconnected` | `IceDisconnectedDetector` |
| 5 | `ice-connection-failed` | `IceConnectionFailedDetector` |
| 5 | `ice-transport-stalled` | `IceTransportStalledDetector` |
| 5 | `unstable-ice-path` | `UnstableIcePathDetector` |

Every issue in this table is raised on `PeerConnectionMonitor`, and every one of
them answers the test each detector must pass: *what can an engineer do
differently after seeing this?* An issue that cannot be acted on differently
from its neighbour does not deserve its own type — and, by the same rule read
backwards, one that can does not deserve to be folded into a neighbour's payload.

`blocked-transport` is no longer in this table: it is Transport Quality. Neither
are `rtp-sender-stalled`, `transport-demux-stalled`, `dry-inbound-track` or
`dry-outbound-track` — those are Pipeline Disruption.

## What this model deliberately does not do

**No `ConnectivityState` enum.** A single current state cannot represent a peer
connection whose two transports are in different states, and the detector
architecture already keeps independent per-transport state for exactly that
reason. What the model provides instead is ordering: the lowest layer that
raised an issue is the diagnosis, and the layers above it are consequences.

**No detector for what the monitor cannot see.** DNS resolution, signaling
health, SFU reachability and captive portals are invisible to `getStats()`.
"Signaling works but RTC infrastructure does not" is the layer-1 verdict
*combined with* the application's own signaling telemetry — and a session that
reached the monitor at all is already evidence that signaling worked.

**No issue for a working fallback.** TURN required, TURN/TCP fallback and
TURN/TLS fallback are events. They cost latency and loss resilience, and the
fleet should count them, but a call that works is not a fault.

**No duplication of the quality axis.** Packet loss, RTT, jitter, congestion,
blocked media, decoder and encoder performance, CPU limitation, capture and
playout problems all have their own detectors and their own model. A
connectivity detector that starts reasoning about quality has left its layer —
which is precisely the reasoning that moved `BlockedTransportDetector` out of
this document.

## Observability horizon

Everything above is derived from two sources and nothing else: `getStats()`,
and the peer-connection events the source bindings forward. That horizon is
what makes some proposals impossible and it is worth stating plainly, because
the temptation to guess beyond it is what produces unreliable detectors.

Three consequences worth remembering when extending this model. Mediasoup
transports expose a narrower surface than a raw `RTCPeerConnection` — there is
no `icecandidateerror` equivalent — so any detector relying on peer-connection
events must degrade to a stats-only evidence tier rather than fall silent. And
browsers differ in what they report at every layer; where a field is absent the
correct response is a documented proxy (the selected pair's state standing in
for `iceState`, for instance) or silence, never a guess that downstream code
cannot distinguish from a measurement.

The third is that silence itself needs to be reportable. A detector that cannot
see its inputs and a detector that sees healthy inputs both say nothing, and
the public `inputsUnavailable` field the detectors that can compute it carry
exists so that the two are distinguishable from the outside — see
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing). None
of the connectivity detectors sets it today; ICE and DTLS state fields are among
the best-supported in the specification, and where they are absent these
detectors have documented proxies rather than blind spots.
