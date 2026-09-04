# Telemetry Detectors — the session's shape

This document is the reference for how the library records **telemetry**: the
facts that describe what a session *was*, which classes and mechanisms carry
each kind of fact, and — the part that is easy to get wrong — why none of them
raises an issue.

It answers one question: *what is this session's shape, and what changed about
it?* — asked from an application or frontend engineer's chair rather than a
network engineer's. Nothing here judges the call. The question is not "is this
bad" but "what was this": which codec, which path, which layers, which device,
and when each of those stopped being what it started as.

This is the deep reference for **Category 5** of the library's five detector
categories. The parent map — the other four categories, what puts a detector in
one rather than another, and the rules that keep the boundaries stable — is
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md). The sibling deep references are
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md),
[TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md),
[PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md) and
[PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md). For the
surrounding API (listening to events, `addEvent`, `addMetaData`, enabling and
disabling detectors) see the *Events and Issues* section of the
[README](../README.md#events-and-issues).

- [The sub-layers](#the-sub-layers)
- [What makes something telemetry](#what-makes-something-telemetry)
- ["Raises no issue" is not "is telemetry"](#raises-no-issue-is-not-is-telemetry)
- [The grid](#the-grid)
- [The shape they share: first observation is a baseline](#the-shape-they-share-first-observation-is-a-baseline)
- [Session](#session)
- [Endpoint](#endpoint)
- [Media](#media)
- [Transport](#transport)
- [Lifecycle](#lifecycle)
- [Every telemetry event and its payload](#every-telemetry-event-and-its-payload)
- [Issue, event, metric or attribute](#issue-event-metric-or-attribute)
- [Telemetry opportunities](#telemetry-opportunities)
- [What this model deliberately does not do](#what-this-model-deliberately-does-not-do)
- [Observability horizon](#observability-horizon)

## The sub-layers

```
        ┌──────────────────────────────────────────────────────────────┐
        │  1-4  the ladder: CONNECTIVITY → TRANSPORT QUALITY →          │
        │       PIPELINE DISRUPTION → PERCEIVED QUALITY                 │
        └──────────────────────────────────────────────────────────────┘
                                    beside
        ┌──────────────────────────────────────────────────────────────┐
        │  5  TELEMETRY                                                 │
        │                                                               │
        │  Session     who, what call, what scope                       │
        │  Endpoint    what machine, browser and devices                │
        │  Media       what is being encoded, sent and decoded          │
        │  Transport   what path the media is travelling on             │
        │  Lifecycle   what happened, and when — including to the       │
        │              instrument itself                                │
        └──────────────────────────────────────────────────────────────┘
```

**These five are not a ladder, and neither is the category.** Categories 1–4 are
ordered — you read a failed session from the lowest one that fired — and
Telemetry has no rung in that ordering at all, because it never fires. It is the
context you read *alongside* the ladder, and the five sub-layers are a vocabulary
for what kind of context you are reading, not an escalation order. A session has
all five at once, and none of them becomes true only after another one does.

**Several of these layers are not carried by detectors.** Session and Endpoint
have no detector at all: they are sample fields, client meta items and
peer-connection lifecycle events. Transport is carried half by a detector and
half by `SelectedIcePath`, which is a monitor. This document covers those
mechanisms too, because a reader asking "how do I find out what kind of path
this call used" needs the answer regardless of which mechanism happens to
provide it, and a document organized strictly by detector class would answer
"there is no detector for that" to a question the library can in fact answer.

## What makes something telemetry

The membership test in
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#the-five-definitions) is
deliberately counterfactual:

> **Would raising an issue here *ever* be the right thing to do? If no, it is
> Telemetry.**

Not "does it raise one today" — *would it ever be right to*. That phrasing is
what stops the category from becoming a bucket for detectors nobody got around
to finishing. Worked through the members:

**`IceTraversalDetector`.** The fact is "the selected network tuple moved". A
threshold on tuple changes is exactly what `UnstableIcePathDetector` already
owns at connectivity layer 5, and it is a different claim — *this path is
oscillating* — reached from the same raw signal by a different class. What is
left after that claim is removed is a single path move, which is what happens
when Wi-Fi hands over to cellular, and reporting a successful handover as a
fault would be wrong at any threshold. Telemetry.

**`CodecChangeDetector`.** H264 is not a fault. VP8 is not a fault. A mid-call
switch between them is not a fault either — it is renegotiation, or a hardware
encoder falling back to software, both of which are the system working. There is
no value of "codec" that deserves an issue, and no rate of codec change that
does. Telemetry.

**`VideoResolutionChangeDetector`.** The adaptation ladder moving *is* the
adaptation ladder working. A resolution drop under bandwidth pressure is the
correct behaviour, and the condition where the picture is genuinely too poor to
watch already has an owner in `PixelatedVideoDetector`
([Perceived Quality](./PERCEIVED_QUALITY_DETECTORS.md)), judged on bits per
pixel rather than on pixel count. Telemetry.

**`SimulcastLayerDetector`.** Layers are *meant* to come and go. An encoder that
stops producing the high layer under a constrained uplink is doing its job. The
consequence — a participant who looks blurry to everyone — is a perceived-quality
question about the receiving side. Telemetry.

**`CaptureTrackMutedDetector`.** `track.muted` covers the deliberate system mute
and the accidental device grab with one flag, and the library cannot tell them
apart. Raising an issue would file thousands of correct mutes as call failures.
Telemetry — and see [Lifecycle](#lifecycle) for the split from the capture
detectors that *do* raise.

**`StatsGapDetector`.** The subject is not the call, it is the measurement. An
issue would say something is wrong with the session when what actually happened
is that the user switched tabs. Telemetry.

**`IceRestartDetector` and `IceRestartRecommendationDetector`.** A restart is
what a healthy application *does* when the network changes underneath a call, so
an issue would flag the recovery rather than the problem; and a recommendation
is advice about what to do next, which is not a finding about anything.
Telemetry, and documented in
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md#restarts-the-telemetry-alongside-the-ladder)
— see [Transport](#transport) for why the category and the document differ.

The authoritative, machine-readable copy of this membership list is
`DETECTOR_CATEGORIES` in `tests/detectors/DetectorTaxonomy.spec.ts`. A detector
registered without a row there fails the test rather than quietly becoming
uncategorised, which is what stops this document and the taxonomy from drifting
apart.

## "Raises no issue" is not "is telemetry"

This is the single easiest mistake to make with this category, and it is worth
stating as its own rule:

> **Category is decided by the question a class answers, not by whether it
> raises an issue.** Ten classes in the library emit only events. Eight of them
> are Telemetry. Two are not.

An event-only class in another category is a class whose finding is real but not
yet a claim, or a class with a missing issue. Neither is telemetry, and filing
either one here would put a genuine finding somewhere nobody looks for findings.

| Class | Category | Why it is not Telemetry |
|---|---|---|
| `IcePathEstablishmentDetector` | Connectivity, layer 3 | "Establishment is taking a long time" is not yet a claim that establishment *failed* — that claim is a separate class with a separate threshold, `IceEstablishmentFailedDetector`, raising `ice-establishment-failed`. The event-only shape here is the design, not a gap. Documented in [CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md#layer-3--path-establishment) |
| `AudioPlayoutSynthesisDetector` | Perceived Quality | It would **fail** the counterfactual test: a listener hearing invented speech across a sustained window is a fault worth raising. It is a Category 4 detector with a missing issue, not a fact about the session. Documented in [PERCEIVED_QUALITY_DETECTORS.md](./PERCEIVED_QUALITY_DETECTORS.md) |

Read the other way round, the rule also explains why two classes that *are*
Telemetry are documented outside this file. `IceRestartDetector` and
`IceRestartRecommendationDetector` pass the membership test and are categorised
`telemetry` in the taxonomy spec, but their subject is the ICE path, every fact
they read is a connectivity fact, and their config blocks sit among the
connectivity ones. They are documented beside the ladder they describe. **Category and
location are different axes**, and forcing them to agree would either move two
restart classes away from the ICE model they only make sense inside, or file
`IcePathEstablishmentDetector` here where nobody investigating a failed join
would find it.

## The grid

| Layer | What carries it | Class or mechanism | Event | Config key |
|---|---|---|---|---|
| Session | Sample fields | `ClientMonitor.createSample()` — `clientId`, `callId`, `attachments`, `timestamp` | *(none — sample fields)* | `clientId`, `callId` |
| Session | Client events | `ClientMonitor.addClientJoinEvent()` / `addClientLeftEvent()` | `CLIENT_JOINED`, `CLIENT_LEFT` | `addClientJointEventOnCreated`, `addClientLeftEventOnClose` |
| Endpoint | Client meta items | `Sources.fetchUserAgentData()` | `USER_AGENT_DATA` *(meta)* | *(always, on monitor creation)* |
| Endpoint | Client meta items | `watchMediaDevices()` | `MEDIA_DEVICE`, `MEDIA_DEVICES_SUPPORTED_CONSTRAINTS`, `USER_MEDIA_ERROR` *(meta)* | `integrateNavigatorMediaDevices` |
| Media | Detector | `CodecChangeDetector` | `codec-changed` / `CODEC_CHANGED` | `codecChangeDetector` |
| Media | Detector | `VideoResolutionChangeDetector` | `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | `videoResolutionChangeDetector` |
| Media | Detector | `SimulcastLayerDetector` | `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | `simulcastLayerDetector` |
| Transport | Detector | `IceTraversalDetector` | `ice-tuple-changed` *(monitor event only)* | `iceTraversalDetector` |
| Transport | Monitor | `SelectedIcePath` | `ice-path-changed` / `PEER_CONNECTION_ICE_PATH_CHANGED` | *(always)* |
| Transport | Detector | `IceRestartDetector` | `ice-restart` / `ICE_RESTART` | `iceRestartDetector` |
| Transport | Detector | `IceRestartRecommendationDetector` | `ice-restart-recommended` / `ICE_RESTART_RECOMMENDED` | `iceRestartRecommendationDetector` |
| Transport | Sample fields | `IceTransportMonitor.createSample()` — roles, ciphers, ufrag | *(none — sample fields)* | `sendIceTransportMetadataOnChangeOnly` |
| Lifecycle | Detector | `CaptureTrackMutedDetector` | `capture-track-muted` / `CAPTURE_TRACK_MUTED` | `captureTrackMutedDetector` |
| Lifecycle | Detector | `StatsGapDetector` | `stats-collection-gap` / `STATS_COLLECTION_GAP` | `statsGapDetector` |
| Lifecycle | Source binding | `watchTabVisibility()` | `TAB_VISIBILITY_CHANGED` | `watchTabVisibility` |
| Lifecycle | Source bindings | peer connection and track bindings | `PEER_CONNECTION_OPENED`, `MEDIA_TRACK_ADDED`, `ICE_CANDIDATE_ERROR`, … | *(per binding)* |

One column worth reading twice. **Every detector row now names a key of its own**
([design rule 4](./DETECTOR_TAXONOMY.md#4-one-detector-one-config-block)), so
`null` on it leaves exactly that class unregistered. Two of these used to be the
awkward cases and no longer are. `IceTraversalDetector` was the one detector in
the library registered unconditionally, silenceable only by name; it now has
`iceTraversalDetector`, which carries no tunables — `{}` enables it, `null`
disables it. And `CaptureTrackMutedDetector` used to come and go with the two
capture detectors that *do* raise issues, which is rarely what an application
silencing mute noise actually wants; `captureTrackMutedDetector: null` now removes
that one class.

`StatsGapDetector` is the only member bound to `ClientMonitor` itself rather than
to a peer connection or a track. The Media three bind to track monitors —
`CodecChangeDetector` to both directions, `VideoResolutionChangeDetector` to
video tracks in both directions, `SimulcastLayerDetector` to outbound video only
— and the Transport classes bind to `PeerConnectionMonitor`.

## The shape they share: first observation is a baseline

Every change-reporting class here treats the first value it sees as a baseline
and reports nothing for it. `CodecChangeDetector` returns on
`previousMimeType === undefined`; `VideoResolutionChangeDetector` on
`previousWidth === undefined`; `SimulcastLayerDetector` on
`_previousActiveKeys === undefined`; `CaptureTrackMutedDetector` on
`_lastMuted === undefined`; `StatsGapDetector` on
`_previousCollectionStartedAt === undefined`; `IceTraversalDetector` skips the
tick where its tuple set grows from empty. `SelectedIcePath` is the deliberate
exception, and the next section explains why.

The reason is the same in every case and it is not subtle: without it, **every
session would report a change in its first seconds**, for every track, for
nothing. A codec that was VP8 from the first tick did not change to VP8. A track
that was already muted when monitoring attached may have been muted since before
the call, and putting a mute event at the start of every session that joined
that way would make the event useless for finding the sessions where a mute
actually happened. The first collection has nothing to be late relative to.

**What it costs is worth stating plainly.** A change stream tells you every
transition and never tells you the starting state. A consumer that only reads
`codec-changed` events cannot answer "what codec was this call using" for the
overwhelming majority of calls, because most calls change codec zero times. The
starting state is not missing from the library — it is on the sample, and that
is where a consumer must read it:

| Fact | Change event | Where the initial state is |
|---|---|---|
| Codec | `codec-changed` | `PeerConnectionSample.codecs`, resolved through `inboundRtps[].codecId` / `outboundRtps[].codecId` |
| Resolution | `video-resolution-changed` | `inboundRtps[].frameWidth` / `frameHeight`, `outboundRtps[].frameWidth` / `frameHeight` |
| Simulcast layers | `simulcast-layer-changed` | `outboundRtps[]` — one row per encoding, with `rid`, `active`, `scalabilityMode` |
| Selected ICE path | `ice-tuple-changed` | `iceCandidatePairs[]` + `iceCandidates[]`, resolved from `iceTransports[].selectedCandidatePairId` |
| Muted capture | `capture-track-muted` | `MEDIA_TRACK_ADDED`'s `muted` field, and `MEDIA_TRACK_MUTED` / `MEDIA_TRACK_UNMUTED` from the track binding |

**Sample plus events is the complete picture; either alone is not.** That is a
coherent design — the sample carries state, the events carry sub-sample
transitions the periodic sample would otherwise miss — but it is a design a
consumer has to know about, because reading only one of the two streams produces
answers that look complete and are wrong.

One further caveat about the event half. `ClientMonitor.addEvent()` returns
immediately when the monitor is not sampling and `bufferingEventsForSamples` is
false (the default): with `samplingPeriodInMs` unset or zero, **no client event
is recorded at all**, and the `'client-event'` monitor event does not fire
either. The detector's own monitor event (`codec-changed` and friends) is emitted
before that call and is unaffected. So a monitor configured to collect but not
sample still has working telemetry on the event emitter and an empty client-event
stream, which is easy to mistake for a detector that is not working.

## Session

**Question.** What call is this, whose endpoint is it, and what application-level
scope does it belong to?

No detector. Session identity is carried by the sample itself:
`ClientSample.clientId`, `ClientSample.callId`, `ClientSample.timestamp`, and
`ClientSample.attachments` — a free-form `Record<string, unknown>` the
application sets for the things the library cannot know, typically `roomId`,
`userId` and `displayName`. `PeerConnectionSample.attachments` and each track
sample's attachments do the same one level down.

`clientId` and `callId` are settable at any time (`monitor.clientId = …`), which
matters for the common shape where the client monitor is constructed before the
application knows which room the user is joining. Samples created before they
are set carry `undefined` and a server-side correlation has to stitch them.

The two lifecycle bookends are client events rather than sample fields:
`CLIENT_JOINED` is added on construction when `addClientJointEventOnCreated` is
true, and `CLIENT_LEFT` on `close()` when `addClientLeftEventOnClose` is true —
both default true. `close()` creates one final sample after adding the leave
event, so it ships rather than dying in the buffer; that final sample is only
created when sampling was configured at all, which is the same condition under
which `addEvent()` recorded the event in the first place.

## Endpoint

**Question.** What machine, browser and devices is this session running on?

No detector. Two mechanisms, both emitting **client meta items** rather than
client events — `ClientSample.clientMetaItems`, a separate array from
`clientEvents`, for facts that describe the endpoint rather than things that
happened to it.

`Sources.fetchUserAgentData()` runs once on monitor construction, parses the user
agent, and adds a single `USER_AGENT_DATA` meta item carrying the parsed browser,
engine, OS, device and CPU records. The same call sets `monitor.browser`, which
is not merely descriptive: setting it installs the per-browser stats adapters
(`FirefoxStatsAdapter` and its siblings) on every peer connection, so what the
endpoint *is* changes what the library can *see*. Browsers outside the recognised
set (`chrome`, `firefox`, `safari`, `edge`) are set to `unknown` rather than
guessed at.

`watchMediaDevices()`, under `integrateNavigatorMediaDevices` (default true),
wraps `navigator.mediaDevices` and reports `MEDIA_DEVICE` per enumerated device,
`MEDIA_DEVICES_SUPPORTED_CONSTRAINTS` once, and `USER_MEDIA_ERROR` when a
`getUserMedia` call rejects. The last of those is the one worth noticing: a
permission denial or an `OverconstrainedError` is the reason a great many
"nothing worked" sessions have no media at all, and it is invisible in
`getStats()` because no track was ever created to have stats about.

## Media

**Question.** What is actually being encoded, sent and decoded — and when did
that stop being what it started as?

Three detectors, all bound to track monitors, all reporting a changed fact about
a stream that is otherwise working.

### `CodecChangeDetector`

**What it reports.** Which codec a track is using, and when that changes. The
codec in use is the missing column in nearly every aggregate quality question —
why the bad calls cluster on H264, whether AV1 is being negotiated anywhere at
all, whether a hardware encoder quietly fell back to software mid-call — and
none of it is answerable without a record of what was in use and when.

**Signals read.** `getInboundRtp()?.getCodec()` on an inbound track,
`getHighestLayer()?.getCodec()` on an outbound one; from the codec, `mimeType`
and `sdpFmtpLine`. Nothing else.

**Change detection.** A change is a difference in **either** `mimeType` **or**
`sdpFmtpLine`. Comparing the mime type alone would miss an H264
`profile-level-id` switch, which is a real codec change with real consequences —
a different profile is a different decoder path and a different bitrate
efficiency — and would otherwise be completely invisible. A codec with no
`mimeType` is skipped entirely rather than treated as a change to nothing.

**First observation.** Baseline. The first codec seen updates the stored state
and returns.

**Emits.** Monitor event `codec-changed` with `{ trackMonitor, from: { mimeType,
sdpFmtpLine }, to: { mimeType, sdpFmtpLine } }`. Client event `CODEC_CHANGED`
unless `createEvent` is false, carrying `peerConnectionId`, `trackId`,
`direction`, `kind`, `fromMimeType`, `fromSdpFmtpLine`, `mimeType`,
`sdpFmtpLine`, `payloadType`, `clockRate`, `channels`.

**Config.** `codecChangeDetector: { createEvent?: boolean }`, default
`{ createEvent: true }`. `null` leaves the detector unregistered on both
inbound and outbound track monitors.

The cost is genuinely negligible, which is why this is on by default: a codec
changes once or twice in a call if it changes at all, unlike a per-tick metric.

### `VideoResolutionChangeDetector`

**What it reports.** When the frame size of a video track changes, on either
direction, with the reason attached where a reason exists.

**Signals read.** `frameWidth` and `frameHeight` from the inbound RTP or, on an
outbound track, from `getHighestLayer()`. On an outbound track it additionally
reads `qualityLimitationReason` at the moment of the change.

**Change detection.** Direction is classified by pixel count: `upgrade` when the
count rises, `downgrade` when it falls, and `reshape` when the count is unchanged
but the dimensions are not — an orientation change on mobile, typically. A zero
or absent frame size is a stream that has not produced a frame yet rather than a
downgrade to nothing, and is refused (`width < 1 || height < 1`). On an outbound
simulcast track only the highest layer is followed, since the track legitimately
carries several resolutions at once and reporting each one moving would be noise
about a working encoder.

**Why `qualityLimitationReason` is the point of the event.** From the resolution
alone, "the encoder dropped resolution because of bandwidth or CPU" and "the
application changed its constraints" are identical, and confusing them sends an
investigation in exactly the wrong direction. The field is only meaningful
outbound; on the receive side a resolution change usually means the SFU switched
which simulcast layer it forwards, and the client has no visibility into why.

**First observation.** Baseline.

**Emits.** Monitor event `video-resolution-changed` with `{ trackMonitor,
direction, from: { width, height }, to: { width, height }, qualityLimitationReason }`.
Client event `VIDEO_RESOLUTION_CHANGED` unless `createEvent` is false — note that
the monitor event's field is `direction` (the `upgrade`/`downgrade`/`reshape`
classification) while the client event calls that field `change` and uses
`direction` for `inbound`/`outbound`. They are different names for different
things in the two payloads, and reading one shape into the other is a mistake the
naming invites.

**Config.** `videoResolutionChangeDetector: { createEvent?: boolean }`, default
`{ createEvent: true }`. Registered on video tracks only, both directions.

### `SimulcastLayerDetector`

**What it reports.** When the set of simulcast layers an outbound video track is
*actually sending* changes. This is a fact about encoder behaviour under
bandwidth and CPU pressure, and it is otherwise completely invisible: an
SFU-side "why is this participant blurry" investigation has no client-side
record that the high layer stopped being produced at all.

**Signals read.** `getOutboundRtps()` — every encoding on the track — and per
encoding `active`, `deltaBytesSent`, `rid`, `ssrc`, `encodingIndex`, `bitrate`,
`frameWidth`, `frameHeight`, `framesPerSecond`, `scalabilityMode`.

**Change detection.** A layer counts as active only when the encoding is not
explicitly disabled **and** it actually sent bytes in the interval
(`outboundRtp.active !== false && 0 < (outboundRtp.deltaBytesSent ?? 0)`).
Trusting `active` alone would hide exactly the transition worth reporting:
`active: true` with no bytes is the common real-world shape of a layer the
encoder has quietly given up on. The active set is compared as a sorted,
comma-joined key, so the comparison is order-insensitive.

Layers are named by `rid` where the application sets one and by SSRC otherwise.
Naming them meaningfully — `high`, `low` — is the application's RID convention,
not something this library can infer, so a track without RIDs produces layer ids
that are only correlatable within one session.

A track with fewer than two encodings is not simulcast and is left alone.

**First observation.** Baseline — and additionally, **while the producer is
paused the baseline is discarded entirely** (`_previousActiveKeys = undefined`),
so resuming re-establishes it rather than reporting the pause and the resume as
two layer changes. This is the only member of the category with a pause gate, and
it is there because a paused producer sends no bytes on any layer, which under
the byte-based activity rule would otherwise read as every layer going quiet at
once.

**Emits.** Monitor event `simulcast-layer-changed` with `{ trackMonitor,
activeLayerIds: string[], previousActiveLayerIds: string[], layers:
SimulcastLayerState[] }`. Client event `SIMULCAST_LAYER_CHANGED` unless
`createEvent` is false — and here the two payloads genuinely differ in *type*,
not only in field names: the client event's `activeLayerIds` and
`previousActiveLayerIds` are comma-separated **strings**, and `layers` is a
JSON-serialised string. The source comment attributes this to schema 3.5.0's
flat-primitive payload rule; that rule was relaxed in 3.7.0 (see
`ClientEventPayloadRecord`, and `PEER_CONNECTION_ICE_PATH_CHANGED`, which now
nests structured records), so this is one payload still shaped by a constraint
that no longer applies.

`scalabilityMode` rides along in the per-layer snapshot and is worth having —
it is what separates true simulcast from SVC, and L1T3 from L3T3 — but it is
**absent on Safari**, which does not report the field. A consumer must treat
`undefined` as "not reported" rather than as "no scalability mode configured".

**Config.** `simulcastLayerDetector: { createEvent?: boolean }`, default
`{ createEvent: true }`. Registered on outbound **video** tracks only.

## Transport

**Question.** What path is the media travelling on, and how has that path
changed?

This is the layer with the most interesting split between mechanisms, and the
one with the largest recorded gap. Two detectors, one monitor, and a set of
sample fields all describe the same object from different angles.

### `IceTraversalDetector`

**What it reports.** That the set of selected ICE candidate pairs changed — the
network path underneath the call moved, which is what a user experiences as the
brief cut-out when Wi-Fi hands over to cellular, a VPN comes up, or a NAT
rebinding forces a new pair.

**Signals read.** `pcMonitor.selectedIceCandidatePairs`, and from each pair its
`tuple` — `localAddress:localPort:remoteAddress:remotePort:protocol`, built by
the candidate pair monitor itself. Because the tuple is computed in one place,
this detector and the connectivity detectors can never disagree about what the
selected path is.

**Change detection.** It holds a `Set<string>` of tuples and diffs it both ways
each tick: a tuple present now and not before, or before and not now, is a
change. A peer connection without BUNDLE has one selected pair per media
transport, so the set legitimately holds several tuples at once and growing from
one to two is a change like any other.

**First observation.** The tick where the set grows from empty is skipped
(`wasEmpty`). Establishment is not a change, or every call would report a path
move in its first seconds.

**Emits.** Monitor event `ice-tuple-changed`, carrying only `{ clientMonitor,
peerConnectionMonitor }` — no from/to, no tuple, no path kind. **No client
event.** This fact does not reach the sample through this detector at all.

**Config.** `iceTraversalDetector`, with nothing in it: no threshold on tuple
changes would be defensible, so the block exists only to decide whether the class
is constructed — `{}` enables it, `null` disables it. Until 4.10.0 it had no key at
all and was the one detector in the library registered unconditionally.

It stays deliberately the low-level primitive. The classification of *what kind*
of change happened belongs to `SelectedIcePath`, and the issue raised when a path
will not settle belongs to `UnstableIcePathDetector` at connectivity layer 5. The
detector's own spec asserts this by giving it a mock client monitor whose
`raiseIssue` and `addIssue` throw.

**This is the worked example of one raw signal feeding two categories.** The
selected candidate pair changing is a single observation. Read once, it is a
fact about the session: the path moved, here is when. Read as a rate — three or
more switches inside thirty seconds — it is a claim that the path is
oscillating rather than migrating, which is an ISSUE with a threshold, a
severity and a resolve condition, raised by a different class that derives the
count from the same stats independently. Neither reads the other's conclusion.
That is not duplication; it is the difference between recording a fact and
judging it, and collapsing the two would force a threshold onto telemetry that
should not have one.

### `SelectedIcePath` — the path monitor

Not a detector. `SelectedIcePath` is a monitor object, one per ICE transport with
a selected candidate pair, held in `PeerConnectionMonitor.mappedSelectedIcePaths`
and reachable as `pcMonitor.selectedIcePaths` (or `selectedIcePath` for the
BUNDLE case). It is the single authoritative interpretation of "what path is this
peer connection actually using", and it holds no copies of candidate data: every
descriptive getter reads through the linked `IceCandidatePairMonitor` and its
candidate monitors, so the path can never disagree with the stats it was built
from.

**The path classification.** `IcePathKind` is `direct`, `turn-udp`, `turn-tcp`,
`turn-tls` or `turn-unknown`, derived candidate-type-first — a `relay` candidate
is by definition obtained from TURN — with `relayProtocol` as the fallback for
stats that omit the type. `turn-unknown` means TURN is definitely in use but the
browser did not expose how the endpoint reaches the TURN server.

**Transitions.** Each tick it compares the selected pair and classifies what kind
of change happened: `initial-selection`, `direct-to-relay`, `relay-to-direct`,
`relay-protocol-changed`, `turn-server-changed`, or a plain `path-changed`. Unlike
`IceTraversalDetector`, **it does report the initial selection** — as a transition
with no `from` — which is what makes the event stream able to answer "what path
did this call start on" at all.

**What it computes and does not ship.** These are facts, not verdicts; the
client does not judge whether TURN usage was appropriate. All of them are live
on the object and none of them reaches the sample:

| Field | What it holds |
|---|---|
| `durations` | Milliseconds spent in each `IcePathKind`, attributed at each transition |
| `relayDurationInMs` | The four relay kinds' durations summed |
| `timeToFirstRelayInMs` | From path creation to the first relay selection; `undefined` if never |
| `pathSwitches` | Every switch after the initial selection |
| `directToRelaySwitches` | Fell back to a relay |
| `relayToDirectSwitches` | Recovered to a direct path |
| `relayProtocolSwitches` | Same TURN server, different transport — UDP to TCP to TLS |
| `turnServerSwitches` | A different TURN server entirely |
| `totalBytesSent` / `Received`, `totalPacketsSent` / `Received` | Traffic observed across the path's life |
| `relayBytesSent` / `Received`, `relayPacketsSent` / `Received` | The portion of the above that travelled over a relay |
| `relayBytesRatio` | Share of observed traffic that went over a relay, `0..1` |
| `getSwitchCountSince(timestamp)` | Switches at or after a wall-clock instant, from a bounded 64-entry ring |

**Emits.** Monitor event `ice-path-changed` with `{ peerConnectionMonitor,
selectedIcePath, transition, from?, to }`, where `from`/`to` are `IcePathEvidence`
records — `kind`, `pairId`, `transportId`, candidate ids and types, `protocol`,
`relayProtocol`, `turnUrl`, `turnServer`, and the local and remote address and
port. Client event `PEER_CONNECTION_ICE_PATH_CHANGED` carrying
`peerConnectionId`, `transition`, and the same `from`/`to` as nested records.
There is no `createEvent` flag on this one — the client event is unconditional.

The class's own comment explains the decision not to ship the accumulators: the
sample already carries `iceTransports`, `iceCandidatePairs` and `iceCandidates`,
so a server can resolve the selected pair and derive the same facts, and the
sub-sample transitions it would otherwise miss arrive as
`PEER_CONNECTION_ICE_PATH_CHANGED` events. That reasoning is sound as far as it
goes. See [Telemetry opportunities](#telemetry-opportunities) for where it stops
going.

### The restart classes

`IceRestartDetector` (`ice-restart`, outcomes `detected` / `recovered` /
`failed`, inferred from a changed ICE local username fragment) and
`IceRestartRecommendationDetector` (`ice-restart-recommended`, four reasons with
shared rate limiting) are both Telemetry by category and both documented in
[CONNECTIVITY_DETECTORS.md § Restarts](./CONNECTIVITY_DETECTORS.md#restarts-the-telemetry-alongside-the-ladder),
because their subject and their configuration are connectivity's. They are
listed here so that a reader working from the category rather than from the
subject can find them, and so that the count in this document matches the
taxonomy spec: **eight classes are categorised `telemetry`**, six of them
documented here.

### What the sample already carries

Not everything about the transport is missing from the sample.
`IceTransportMonitor.createSample()` ships `iceRole`,
`iceLocalUsernameFragment`, `localCertificateId`, `remoteCertificateId`,
`tlsVersion`, `dtlsCipher`, `dtlsRole` and `srtpCipher` as **static metadata**:
under `sendIceTransportMetadataOnChangeOnly` (default true) they are emitted in
the first sample and again only when one of them changes, which for the username
fragment is exactly at an ICE restart. So negotiated ciphers, DTLS and ICE roles
and the certificate ids *are* ATTRIBUTES on the sample already, and the
change-only emission is the correct shape for them.

What is not there is the path *characterisation* — and that is the subject of
the next-to-last section.

## Lifecycle

**Question.** What happened to this session over time — including to the
instrument measuring it?

### `CaptureTrackMutedDetector`

**What it reports.** The moment something outside the application took the
capture device away: `track.muted` flipped to true. The OS grabbed the
microphone for a system call, another application claimed exclusive camera
access, the laptop lid closed, the privacy shutter moved, the device slept.

This is **not** the application's own mute. That is `track.enabled`, which the
application sets and therefore already knows about. `track.muted` is the
browser's statement that the source has stopped delivering data.

**Signals read.** `trackMonitor.track.muted`. Nothing from the stats at all —
this detector reads the DOM track object, which makes it one of the few that
would still work with no `getStats()` output whatsoever.

**Change detection.** Only the `false → true` transition. The transition back to
unmuted is deliberately not reported: this class exists to mark where capture
stopped, and its sibling detectors observe the recovery directly.

**First observation.** Refused. A track already muted when monitoring began says
nothing about a change — it may have been muted since before the call — and
reporting it would put a spurious mute event at the start of every session that
joined that way.

**Emits.** Monitor event `capture-track-muted` with `{ trackMonitor }` only.
Client event `CAPTURE_TRACK_MUTED` unless `createEvent` is false, carrying
`peerConnectionId`, `trackId`, `kind` and `deviceLabel`.

**Config.** `captureTrackMutedDetector: { createEvent?: boolean }`, default
`true`. It used to share `captureFailureDetector` with two detectors that are
**not** telemetry, so silencing mute noise took both of them with it; each of the
three now has a key of its own. The split is still worth understanding:

| Class | Category | Raises | Because |
|---|---|---|---|
| `CaptureTrackMutedDetector` | Telemetry | *(event only)* | `track.muted` covers the deliberate system mute and the accidental device grab with one flag, and the library cannot separate them. Most mutes are correct. |
| `CaptureTrackEndedDetector` | Pipeline Disruption | `capture-track-ended` | `readyState: 'ended'` is terminal and never intentional mid-call: the device is gone and the track will never produce another frame |
| `SilentAudioSourceDetector` | Pipeline Disruption | `silent-audio-source` | A live, unmuted, enabled microphone producing digital silence for a sustained span is a broken capture chain, not a user choice |

Three findings, three classes, three config keys. What separates them is not where
they sit in the stack — all three watch the same capture stage — but whether the
observation could ever be the user doing something correct. Ended and silent
could not; muted routinely is. Both raising classes are documented in
[PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md).

The value of the mute event is a **timestamp**: the record of when capture
stopped, next to which the silence and dry-track findings that follow stop
looking mysterious. Whoever reads the session decides what it means.

### `StatsGapDetector`

**What it reports.** That stats collection itself ran late. This is telemetry
about the *instrument*, not about the call, and it is the only signal in the
library that changes how you read the other signals.

**Why it matters.** Every rate this library reports is a delta divided by an
elapsed time, and all of them assume collection happened roughly on schedule.
When the tab is backgrounded, the device sleeps, or the main thread is blocked
long enough, that assumption breaks: counters keep advancing while the monitor is
not looking, and the first tick afterwards attributes a large accumulation to a
short window, which reads as a network event that never happened. Rather than
trying to correct for it — the counters genuinely cannot say *when within the
gap* the traffic happened — the gap is reported so a consumer can discount that
interval instead.

**Signals read.** `clientMonitor.lastCollectingStatsAt` and
`config.collectingPeriodInMs`. It also passes
`clientMonitor.durationOfCollectingStatsInMs` into the client event, which is a
different number and worth not confusing: how long the collection *took*, as
against how late it *started*.

**Change detection.** An overrun must clear **both** a ratio and an absolute
floor: `expectedPeriodInMs * gapRatioThreshold < actualPeriodInMs` **and**
`minGapInMs < actualPeriodInMs`. The ratio catches a proportionally large
overrun; the floor keeps a fast collecting period from reporting ordinary
scheduling jitter. With the default 5-second floor and a 200 ms collecting
period, a 500 ms tick is 2.5× over and correctly says nothing. A
`collectingPeriodInMs` below 1 disables the check entirely, since there is no
schedule to be late against.

**First observation.** Baseline — the first collection has nothing to be late
relative to.

**It is deliberately the one detector that measures wall-clock time.** Design
rule 3 in [DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#the-five-design-rules)
says condition duration is measured in stats time — the monitored object's
`deltaTime` — precisely so that a backgrounded tab does not credit itself with a
minute of "watching" a condition nobody observed. Applying that rule here would
be meaningless, and not as a tolerated exception: **how late the library ran is
exactly what this detector exists to measure**, and stats time is by construction
the clock that cannot see it. `deltaTime` is the difference between stats
timestamps, so a gap in collection either does not appear in it at all or appears
as the very quantity being measured. The rule and this detector are not in
tension; the rule protects verdicts about the *call* from the monitor's own
scheduling, and this detector reports that scheduling as its subject.

Filing it under one of the first four categories would invite a reader to
mistake a backgrounded tab for a processing failure — a `stats-collection-gap`
next to a burst of pipeline issues is very often the explanation for the burst
rather than a co-symptom of it.

**Emits.** Monitor event `stats-collection-gap` with `{ expectedPeriodInMs,
actualPeriodInMs, gapInMs }`. Client event `STATS_COLLECTION_GAP` unless
`createEvent` is false, with the same three fields plus
`durationOfCollectingStatsInMs`.

**Config.** `statsGapDetector: { gapRatioThreshold, minGapInMs, createEvent? }`,
default `{ gapRatioThreshold: 2, minGapInMs: 5000, createEvent: true }`. Bound to
`ClientMonitor`, registered unless the key is `null`.

### The client-event stream

Most of the Lifecycle layer is not detectors at all. The source bindings forward
peer-connection and track events into `ClientMonitor.addEvent()` as they happen:
`PEER_CONNECTION_OPENED` / `CLOSED`, `MEDIA_TRACK_ADDED` / `REMOVED` /
`MUTED` / `UNMUTED`, `ICE_GATHERING_STATE_CHANGED`,
`ICE_CONNECTION_STATE_CHANGED`, `PEER_CONNECTION_STATE_CHANGED`,
`SIGNALING_STATE_CHANGE`, `NEGOTIATION_NEEDED`, `ICE_CANDIDATE`,
`ICE_CANDIDATE_ERROR`, the data-channel events, and the mediasoup producer and
consumer events where a mediasoup transport is bound.

`TAB_VISIBILITY_CHANGED` sits with them, under `watchTabVisibility` (default
true), and does double duty: it keeps `monitor.activeTab` in sync so the
pause-aware detectors can stand down, and it puts every transition in the sample
stream so a reader can see exactly when the tab went to the background and came
back. Where no usable `document` exists — SSR, workers, react-native — the
watcher logs and leaves `activeTab` at `true`, because a missing watcher must
never look like a hidden tab.

This stream is telemetry by every part of the definition, and it answers a large
share of the questions people bring to this category. It is not a detector
because there is nothing to detect: the browser already said it.

## Every telemetry event and its payload

Monitor events (the `EventEmitter` surface) and client events (the sample
surface) are different objects with different fields, and the difference is not
cosmetic — monitor events carry live monitor references that cannot cross the
wire, client events carry ids.

| Monitor event | Payload | Client event | Payload |
|---|---|---|---|
| `ice-tuple-changed` | `peerConnectionMonitor` | *(none)* | — |
| `ice-path-changed` | `peerConnectionMonitor`, `selectedIcePath`, `transition`, `from?`, `to` | `PEER_CONNECTION_ICE_PATH_CHANGED` | `peerConnectionId`, `transition`, `from?`, `to` (nested `IcePathEvidence` records) |
| `ice-restart` | `peerConnectionMonitor`, `transportId`, `iceGeneration`, `outcome` | `ICE_RESTART` | `peerConnectionId`, `transportId`, `iceGeneration`, `outcome`, `iceState?`, `evidence`, `timestamp` |
| `ice-restart-recommended` | `peerConnectionMonitor` + the recommendation payload | `ICE_RESTART_RECOMMENDED` | `peerConnectionId`, `transportId?`, `reason`, `conditionDurationInMs`, `iceGeneration`, `recommendationCount`, `iceState?`, `dtlsState?`, `selectedCandidatePairId?` |
| `codec-changed` | `trackMonitor`, `from: { mimeType, sdpFmtpLine? }`, `to: { … }` | `CODEC_CHANGED` | `peerConnectionId`, `trackId`, `direction`, `kind`, `fromMimeType?`, `fromSdpFmtpLine?`, `mimeType`, `sdpFmtpLine?`, `payloadType?`, `clockRate?`, `channels?` |
| `video-resolution-changed` | `trackMonitor`, `direction` (`upgrade`/`downgrade`/`reshape`), `from: { width, height }`, `to: { … }`, `qualityLimitationReason?` | `VIDEO_RESOLUTION_CHANGED` | `peerConnectionId`, `trackId`, `direction` (`inbound`/`outbound`), `change` (`upgrade`/`downgrade`/`reshape`), `fromWidth`, `fromHeight`, `width`, `height`, `framesPerSecond?`, `qualityLimitationReason?` |
| `simulcast-layer-changed` | `trackMonitor`, `activeLayerIds: string[]`, `previousActiveLayerIds: string[]`, `layers: SimulcastLayerState[]` | `SIMULCAST_LAYER_CHANGED` | `peerConnectionId`, `trackId`, `activeLayerIds` (comma-separated **string**), `previousActiveLayerIds` (string), `layers` (**JSON string**) |
| `capture-track-muted` | `trackMonitor` | `CAPTURE_TRACK_MUTED` | `peerConnectionId`, `trackId`, `kind`, `deviceLabel?` |
| `stats-collection-gap` | `expectedPeriodInMs`, `actualPeriodInMs`, `gapInMs` | `STATS_COLLECTION_GAP` | `expectedPeriodInMs`, `actualPeriodInMs`, `gapInMs`, `durationOfCollectingStatsInMs?` |

Every payload also carries `clientMonitor` on the monitor-event side and a
`timestamp` on the client-event side. `SimulcastLayerState` is `{ rid, ssrc,
encodingIndex?, active, bitrate?, frameWidth?, frameHeight?, framesPerSecond?,
scalabilityMode? }`.

Two rows deserve a second look. **`ice-tuple-changed` has no client event**: the
only path information reaching the server is `PEER_CONNECTION_ICE_PATH_CHANGED`
from `SelectedIcePath`, which is the richer of the two and reports the initial
selection as well — so nothing is actually lost, but an application listening on
the monitor emitter and an application reading samples see two different streams
with two different shapes. And **`SIMULCAST_LAYER_CHANGED` is the only telemetry
client event still using pre-3.7.0 string encoding** for what are structurally
arrays and records.

## Issue, event, metric or attribute

The classification in
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#issue-event-metric-or-attribute)
is what keeps this category from swallowing observations that belong elsewhere,
and what keeps the other four from swallowing observations that belong here:

| | Meaning | Lifecycle | Example from this category |
|---|---|---|---|
| **ISSUE** | A condition an engineer would act on differently from its neighbours | Raised, held, resolved; has severity | ≥3 selected-pair changes in 30 s → `unstable-ice-path` |
| **EVENT** | Something happened, with a timestamp and a from/to | Fires once, gone | `codec-changed`; `direct-to-relay`; `capture-track-muted` |
| **METRIC** | A number useful trended, meaningless as a single reading | Sampled | `selectedCandidatePairChanges`; `SelectedIcePath.relayBytesRatio` |
| **ATTRIBUTE** | A property of the session, constant until it changes | Carried on the sample, re-sent when it changes | `dtlsCipher`; the codec in use; the selected path is TURN/TLS |

**Not every interesting WebRTC observation should become an issue**, and the
fastest way to make a category worthless is to fill it with things nobody can act
on. The library's most-repeated example is the right one: **a TURN path is a
cost, not a fault.** A relay call works. It costs latency and loss resilience,
and a fleet should absolutely count how many of its calls need one — but a call
that works is not a failure, and an issue that fires on a third of a healthy
fleet's sessions trains operators to filter the whole category out. That is the
real damage a mis-filed issue does: not a false alarm, but the reflex it builds.

The test every proposed issue must pass is *what does an engineer do differently
after seeing this, that they would not do for the issue next to it?* If there is
no answer, it is telemetry — or it is a payload field on the issue next to it,
which is the answer design rule 1 gives for the near misses. Falling back to
TURN/TCP is an EVENT. Being on TURN/TCP is an ATTRIBUTE. The share of a session's
bytes that went over a relay is a METRIC.

**One raw signal can legitimately feed both a telemetry record and an
independent detector.** The selected candidate pair changing is the worked
example, and it produces three distinct outputs from one observation: an
`ice-tuple-changed` event (the primitive), a classified `ice-path-changed`
transition with a from/to (the fact, with context), and — from the same stats,
derived independently, never by reading either of the above — an
`unstable-ice-path` issue when the switch rate crosses a threshold. The same
shape appears elsewhere in the library: `capture-track-muted` and
`silent-audio-source` both read the capture stage, and `video-resolution-changed`
and `pixelated-video` both read the frame the encoder produced.

The rule that keeps this from becoming duplication is
[detector independence](./DETECTOR_TAXONOMY.md#detectors-are-independent): each
of them reaches its conclusion from raw observations, so disabling the telemetry
does not silence the issue and disabling the issue does not lose the record.

## Telemetry opportunities

Things the library already computes or could compute cheaply, that a consumer
cannot get at today. Recorded as opportunities with specifics rather than as
complaints — each one has a known shape and a known home.

### The Transport layer is the real gap, and it is a shape problem

The facts exist. The classification is computed. The accumulators are
maintained. What is wrong is the **shape** they are exposed in.

Path characteristics — relay versus direct, which TURN transport, which TURN
server, the selected pair's 5-tuple — are emitted as **events at the moment they
change**. So a consumer asking the most ordinary question in this whole document,
*was this session on TURN, and on TCP or TLS?*, must replay
`PEER_CONNECTION_ICE_PATH_CHANGED` from the beginning of the session, find the
`initial-selection` transition, and then fold every subsequent transition over
it. That is a stateful reconstruction over an event stream, on every consumer,
for a fact that is constant for most of the call.

These are ATTRIBUTES by the table above — properties of the session, constant
until they change — and they should be on the sample, re-sent when they change,
exactly as `dtlsCipher` and `iceRole` already are through
`sendIceTransportMetadataOnChangeOnly`. The mechanism for doing it right is
already in the tree, applied to the neighbouring fields, on the same object.

The `SelectedIcePath` comment gives the reasoning for the current arrangement:
the sample carries `iceTransports`, `iceCandidatePairs` and `iceCandidates`, so
a server can resolve `selectedCandidatePairId` to a pair, resolve the pair to its
local candidate, and derive the same facts. That is true, and it is also a
non-trivial three-hop join that every consumer has to implement identically, and
that produces `IcePathKind` only if the consumer reimplements the
candidate-type-first-with-relay-protocol-fallback derivation correctly — a
derivation subtle enough that the source has a comment explaining why the naive
version is wrong (a `srflx` candidate discovered *through* a TURN server's STUN
function also carries a `turn:` URL). Shipping a derived enum is not duplicating
derivable state in any meaningful sense; it is publishing the library's own
authoritative answer instead of asking every consumer to re-derive it.

Concretely, what `SelectedIcePath` computes today and drops on the floor:

- **`durations`** — milliseconds in each of `direct`, `turn-udp`, `turn-tcp`,
  `turn-tls`, `turn-unknown`, plus `relayDurationInMs` and
  `timeToFirstRelayInMs`. The answer to "what fraction of our fleet's minutes are
  relayed", which is a TURN bill.
- **The five switch counters** — `pathSwitches`, `directToRelaySwitches`,
  `relayToDirectSwitches`, `relayProtocolSwitches`, `turnServerSwitches`. These
  are already split by *kind* of switch, which is the split that matters: a
  handover is not a TURN failover is not a TURN server outage, and
  `selectedCandidatePairChanges` alone conflates all three.
- **Relay traffic accounting** — `relayBytesSent` / `relayBytesReceived`,
  `relayPacketsSent` / `relayPacketsReceived` and the derived `relayBytesRatio`.
- **The classified transition types themselves** — the `IcePathTransition` union
  is a better vocabulary than "the pair id changed", and it exists only inside
  event payloads.

Two smaller instances of the same shape problem sit beside it.
`PeerConnectionMonitor.usingTURN` and `usingTCP` are booleans recomputed every
tick from the selected pairs, live on the monitor, and absent from
`PeerConnectionSample` — the single cheapest version of the fix. And
`IceCandidateMonitor.addressFamily`, which distinguishes IPv4 from IPv6 and
returns `undefined` for an mDNS-obscured `<uuid>.local` address, is not sampled;
`IceCandidateStats.address` is, so this one is genuinely derivable server-side,
and the case for shipping it is convenience rather than the correctness argument
that applies to `IcePathKind`.

### Elsewhere

**`ice-tuple-changed` never reaches a sample.** In practice
`PEER_CONNECTION_ICE_PATH_CHANGED` covers the same ground more richly, so the
right resolution may well be to leave the detector as a monitor-emitter
primitive — but the asymmetry should be a decision rather than an accident, and
today nothing records which it is.

**`SIMULCAST_LAYER_CHANGED` still serialises.** Its `layers` is a JSON string and
its two layer-id fields are comma-separated strings, shaped by schema 3.5.0's
flat-primitive rule. Schema 3.7.0 relaxed that rule and
`PEER_CONNECTION_ICE_PATH_CHANGED` already ships nested records. Unpacking it
would make the payload queryable without a parse step on the server.

**No detector reports a change in `scalabilityMode`.** `SimulcastLayerDetector`
carries it in the snapshot but keys its change detection on the active layer set
alone, so an encoder switching from L1T3 to L1T1 under CPU pressure — a real
temporal-layer change with real consequences for what an SFU can forward — is
invisible unless it happens to coincide with a layer going quiet. The field is
also absent on Safari, which is a reason to report it carefully rather than a
reason not to report it.

**The endpoint layer stops at the user agent string.** `USER_AGENT_DATA` is
emitted once and `MEDIA_DEVICE` items enumerate what exists, but nothing records
*which* device a track is actually capturing from over time, and nothing reports
a mid-call device change. `deviceLabel` appears on the capture events and nowhere
else. A session where the user switched headsets midway looks identical to one
where they did not.

## What this model deliberately does not do

**No thresholds, anywhere.** Not one class in this category has a tunable that
decides whether a fact is worth reporting — `statsGapDetector`'s two numbers
decide what counts as *late*, which is the definition of the fact, not a judgement
about it. If a proposed telemetry class needs a threshold to decide whether to
speak, it is not telemetry.

**No severity, no lifecycle, no `activeIssues` entry.** Telemetry never appears
in `monitor.activeIssues`, never resolves, and never contributes to the score.
A dashboard reading "what is wrong with this session right now" correctly sees
nothing from this category, and that is the intended behaviour, not a coverage
gap.

**No correlation.** `capture-track-muted` immediately before `silent-audio-source`
is almost certainly the explanation for it, and this library will not say so.
Detection is not correlation, and correlating two true observations is the
server's job — see
[Detectors are independent](./DETECTOR_TAXONOMY.md#detectors-are-independent).
The same applies to the most tempting one in this category: a
`stats-collection-gap` next to a burst of pipeline issues almost always explains
the burst, and nothing in the library marks the burst as suspect. The gap event
exists so a consumer can do it.

**No interpretation of what a fact means for the user.** A `downgrade` to 320×180
may be an encoder correctly protecting a call on a bad uplink, or an application
bug in its constraints. The event carries `qualityLimitationReason` so the reader
can tell, and takes no position itself.

**No verdict on TURN.** The client does not judge whether relay usage was
appropriate. It records how much there was.

## Observability horizon

Everything in this category comes from four sources and nothing else:
`getStats()`, the peer-connection and track events the source bindings forward,
the DOM `MediaStreamTrack` objects themselves, and the monitor's own clock.
That horizon is what makes some proposals impossible, and it bites this category
harder than the others, because telemetry is the category most tempted to
"just record what happened" for things the browser never announced.

Four consequences worth remembering.

**Inference is not report, and the difference must survive to the reader.** The
library cannot see an ICE restart; it infers one from a changed username
fragment, which is why `ICE_RESTART` carries an `evidence` field naming the
inference. The same discipline is why `CaptureTrackMutedDetector` reports
`track.muted` rather than "the OS took the microphone" — the flag is the
observation, the cause is a guess, and only one of them is reportable.

**A field the browser does not report is not a fact about the session.**
`scalabilityMode` is absent on Safari; `relayProtocol` is absent often enough
that `IcePathKind` needs a dedicated `turn-unknown` value rather than defaulting
to UDP; Firefox's transport report is reconstructed by `FirefoxStatsAdapter` and
carries no ICE username fragment. In each case the correct response is a
documented "not reported" value or silence, never a guess a consumer cannot
distinguish from a measurement.

**Silence is ambiguous here too, and this category does not currently resolve
it.** The public `inputsUnavailable` field eight detectors elsewhere carry exists
so that "nothing changed" and "I could not see whether anything changed" are
distinguishable from the outside — see
[When inputs are missing](./DETECTOR_TAXONOMY.md#when-inputs-are-missing). **No
telemetry detector sets it.** For most of them that is defensible: a codec that
is not reported means no RTP flowed, which the pipeline detectors own, and
`CaptureTrackMutedDetector` reads a DOM property that is always present. It is
least defensible for `SimulcastLayerDetector`, whose activity rule depends on
`deltaBytesSent` — a browser or a first tick that does not report it makes every
layer read as inactive, which is indistinguishable from an encoder that gave up
on all of them.

**Everything above the media stack is invisible.** Signaling health, the SFU's
own view of which layer it is forwarding, whether the user could hear anything,
what the far end negotiated — none of it is in `getStats()`. Session and Endpoint
telemetry is where the application's own knowledge enters, through
`attachments` and `addMetaData()` — `config.appData` is local to the monitor and
never sampled — and a session's real shape is the library's telemetry joined with
the application's. This document describes one half of that join.
