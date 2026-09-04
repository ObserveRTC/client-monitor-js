# Congestion detector restructure — handoff

Written to be picked up cold. Read
[DETECTOR_SANITY_CHECK.md](./DETECTOR_SANITY_CHECK.md) first — this assumes the
method in it and only records what is specific to congestion: the decision
already taken, the measurements behind it, and the two questions still open.

- [The prompt](#the-prompt)
- [Where the work stands](#where-the-work-stands)
- [What was measured, and how to measure it again](#what-was-measured-and-how-to-measure-it-again)
- [The three detectors](#the-three-detectors)
- [Open questions](#open-questions)
- [House rules this session ran on](#house-rules-this-session-ran-on)

## The prompt

Paste this whole section.

> You are continuing a detector pass on `ObserveRTC/client-monitor-js` toward
> 4.10.0. Read `docs/DETECTOR_SANITY_CHECK.md` for the method, then
> `docs/CONGESTION_RESTRUCTURE_HANDOFF.md` (this file) for what has already been
> settled. `src/detectors/InboundVideoFlowStateDetector.ts` and its spec are the
> worked example of what a finished detector looks like here — read both before
> writing anything.
>
> The task: replace `CongestionDetector` with three detectors, per the design in
> the handoff. Build them one at a time, in this order — uplink, downlink,
> unreliable path — each finished (`tsc` clean, full suite green, spec rewritten,
> class doc, config block, taxonomy row, docs, changelog) before the next begins.
>
> Rules that are not negotiable in this repo:
>
> - **Do not trust a green test run.** After each detector, mutate it — invert a
>   comparison, force a computed field to a constant, delete a guard — and confirm
>   a test fails for each. A mutation that survives means the test is decorative;
>   fix the test, not the mutation. Report which mutations you ran and what caught
>   them.
> - **Adapters normalise, monitors derive facts, detectors threshold facts.** A
>   detector that computes a rate or a rolling maximum inline is doing a monitor's
>   job. Put derived values on `PeerConnectionMonitor` / `OutboundRtpMonitor` /
>   `InboundRtpMonitor` and have the detector read them.
> - **Quote the spec, do not paraphrase it.** Every stat you rely on: the W3C
>   webrtc-stats definition verbatim, whether it is cumulative or a delta, and
>   whether Chrome actually populates it. The handoff records one field that is
>   specified and simply absent in Chrome — assume there are others.
> - **Verify browser behaviour rather than reasoning about it.** The recipe for a
>   real throttled call is in the handoff and takes about three minutes to run.
>   Any claim about what a counter does under congestion should come from that,
>   not from the name of the counter.
> - `tests/detectors/DetectorTaxonomy.spec.ts` enforces that
>   `configKeyOf(detector.name)` matches the config block and that every detector
>   has a category and layer row. It will tell you what a new detector is missing.
>
> Before you write code, tell me: which stats each of the three will read, which
> of them you have confirmed Chrome populates, what each detector deliberately
> does **not** claim, and where the three could double-report the same episode.
> Then build the uplink one.

## Where the work stands

**Detectors 1 and 2 are built.** `CongestionDetector` is deleted, and
`UplinkCongestionDetector` (`uplink-congestion`) and
`DownlinkCongestionDetector` (`downlink-congestion`) are registered in its place,
each with its own config block, spec, taxonomy row, docs and changelog entry.
Both follow the design below; where they add to it, they add:

- The uplink detector sets `inputsUnavailable` where the browser computed no
  estimate, which is the deviation the old detector was recorded for.
- A utilization guard: an endpoint sending less than 70% of what the path offers
  is not judged, because the estimator cannot probe above what is being sent and a
  muted camera drags it down on a perfectly healthy path. A module constant rather
  than config, like the downlink's 100 ms buffer floor — the config holds the
  ratios an operator would tune, and noise floors are not among them.
- Both latch the reference maximum when the finding opens, so an episode
  outlasting the ten-second rolling window cannot close itself by forgetting what
  healthy was. The downlink one latches its buffer baseline for the same reason.
- **The downlink gates on `qualityLimitationReason` and resolves on it.** The design
  below rules it out as an *anchor* on the measured precision of 0.53, and that
  still holds — it decides nothing by itself. What it does here is bound the other
  two: an episode opens only where the browser also calls the path bandwidth
  limited, and closes when it stops. The reasoning for the resolve is that nothing
  at a receiver knows what the path can carry now, so a recovery ratio on the
  arriving bitrate measures against a number that does not exist — a link settling
  at half its old capacity has recovered and would never say so. A signal that is
  nearly always true under congestion is worth little when it goes true and a great
  deal when it goes false.

  The cost: `qualityLimitationReason` is a *sending-side* field, so a receive-only
  connection has no verdict and the detector reports `inputsUnavailable`. A webinar
  attendee is not covered. On a shared last mile the sending verdict describes the
  link both directions cross; where they do not share a bottleneck the gate can be
  shut on a genuinely congested downlink.

- **The loss/NACK onset trigger is not implemented.** The design below required a
  burst within a recency window to open a downlink episode; it was cut once the
  conjunction above was doing the same work. Loss is carried on the payload as
  evidence. Restoring it is a small change if a fleet shows it earning its place.
- Neither detector counts collections. The gap between `collapseRatio` and
  `recoveryRatio`, against a maximum latched when the finding opens, is the
  hysteresis a confidence floor would otherwise have provided — so an episode opens
  on the collection its condition holds, and neither detector carries a window, a
  tick counter or a duration accumulator. Three thresholds uplink, four downlink.

Monitor-side facts added for them, all on `PeerConnectionMonitor`:
`availableOutgoingBitrate` (undefined-preserving, unlike
`totalAvailableOutgoingBitrate` beside it), `outgoingBitrateHeadroom` and its EWMA,
`avgPacketSendDelayInMs` and its EWMA,
`avgInboundVideoJitterBufferDelayInMs` and its EWMA, `qualityLimitationReason`
(most limiting across the streams that sent, in the spec's priority order) and
`hasInboundVideo`. `peerConnection.congested` is now a read-only getter over
`uplinkCongested || downlinkCongested`, and both detectors also emit a
direction-agnostic `congestion` event.

The rolling maximum each detector measures a collapse against lives in the
detector, not on the monitor: it is a yardstick for a judgement rather than a fact
about the connection, and nothing else in the library reads it. The window
bookkeeping is duplicated across the two files rather than shared, per design
rule 2.

**Neither detector iterates the RTP monitors.** Everything above is accumulated in
the collection loop that was already visiting every stream to sum the bitrates —
`outboundRtps` / `inboundRtps` build a fresh array on every read, and a detector
walking them is doing a monitor's job in a slower place. A capacity detector reads
`sendingBitrate`, `receivingBitrate` and the facts above; that is all.

Two of the traps listed below were fixed on the way: the stale RTCP round trip is
no longer re-counted every collection, and `IceCandidatePairMonitor` no longer
keeps an `availableOutgoingBitrate` the browser has stopped reporting.

**Detector 3, the unreliable path, is not written**, and the open question about
it is still open.

Mutation testing: 9 mutations against the uplink detector, 10 against the
downlink one, 9 against the monitor facts. Two survived the first pass — a
downlink baseline that kept following the buffer during an episode, and the
inbound collapse boundary — and both specs were fixed rather than the mutations
tolerated.

Finished in the session this handoff comes from, for context on house style:
`InboundVideoFlowStateDetector` — the merge of `ChoppyVideoDetector` and
`FrozenVideoTrackDetector` into one detector with two mutually exclusive states,
a track attribute (`InboundTrackMonitor.frameFlowState`) that moves only when a
finding opens or closes, and a spec whose every boundary is mutation-checked.

The progress ledger at the end of `DETECTOR_SANITY_CHECK.md` is stale: it still
lists `ChoppyVideoDetector` and `FrozenVideoTrackDetector` as remaining, and
`BlockedTransportDetector` under its old name. Worth correcting on the way past.

### Defects in the current `CongestionDetector`

Measured:

- **The anchor is eager.** `qualityLimitationReason === 'bandwidth'` was true on
  **all 34 ticks of a throttle run, including all 6 healthy ones** — precision
  0.53. It is the browser saying "the encoder is not free to do as it likes",
  which is nearly always true on a real call.
- **`availableIncomingBitrate` does not exist in Chrome.** So
  `PeerConnectionMonitor.totalAvailableIncomingBitrate` is permanently 0, and two
  of the seven payload fields (`availableIncomingBitrate`,
  `maxAvailableIncomingBitrate`) are dead on the dominant browser.

Read from the code and worth confirming:

- `rttDiffInS` is `|avg − ewma|`, which is symmetric — RTT *recovering* quickly
  scores the same as RTT climbing.
- `medium` returns early when `ewmaRttInSec` is falsy, so it cannot report
  congestion before the first RTCP report arrives.
- The running maxima are zeroed on every raise, so a second episode's "before"
  picture is whatever accumulated during the healthy gap — near nothing if the
  gap was short.
- `peerConnection.congested` is mutated as a side effect of `update()`, and the
  event is emitted before the issue is raised.

## What was measured, and how to measure it again

All figures below: Chromium 141, loopback peer connection, `tbf` throttle.

### The recipe

`netem` is unavailable in the sandbox (`Specified qdisc kind is unknown`); `tbf`
works.

```bash
apt-get install -y iproute2
tc qdisc add dev lo root tbf rate 500kbit burst 8kb latency 300ms
# ... run the probe ...
tc qdisc del dev lo root          # always, including in the catch block
```

The probe is `playwright-core` driving `/opt/pw-browsers/chromium` against a page
served over `http://localhost` — `about:blank` has no secure context, so
`navigator.mediaDevices` and `captureStream` are unavailable there. Two
`RTCPeerConnection`s, a canvas `captureStream(30)` between them, and
`getStats()` sampled once a second. Paint **high-entropy noise** into the canvas,
not a flat colour: the encoder will otherwise compress a static frame down under
the cap and the throttle will do nothing.

### Uplink, throttled to 500 kbit

| signal | healthy | throttled | verdict |
|---|---|---|---|
| `qualityLimitationReason === 'bandwidth'` | true | true | precision 0.53 — useless alone |
| `availableOutgoingBitrate` | 1161 kbps | ~400, recovering to 1025 | tracks cleanly |
| `packetsDiscardedOnSend` | 0 | **0 throughout** | a socket-error counter, not congestion |

Rules tested against that run:

- `availableOutgoingBitrate < 75% of its rolling max over 10 ticks` — **precision
  1.00, recall 0.67**.
- same-tick AND of rising send delay and falling available bitrate — precision
  1.00, **recall 0.17**. Too strict: the two move on different clocks.

`totalPacketSendDelay`, spec verbatim: *"The total number of seconds that packets
have spent buffered locally before being transmitted onto the network."* It is
cumulative and *"added to totalPacketSendDelay when packetsSent is incremented"*,
so the only meaningful reading is `Δ / ΔpacketsSent` — mean pacer queue time per
packet.

### Downlink, throttled to 500 kbit

```
phase       | recv kbps | availIn | availOut(tx) | loss% | nack | fps
healthy     |      1849 |    null |         3432 |     0 |    0 |  29
THROTTLED   |       504 |    null |          739 |  39.3 |   16 |   8
THROTTLED   |       425 |    null |          390 |  47.5 |   49 |   0
THROTTLED   |       426 |    null |          398 |  37.8 |   42 |  10
THROTTLED   |       419 |    null |          410 |   2.8 |   17 |  25
THROTTLED   |       349 |    null |          412 |     0 |    0 |   8
THROTTLED   |       215 |    null |          412 |     0 |    0 |  36
THROTTLED   |       375 |    null |          527 |     0 |    0 |  33
THROTTLED   |       450 |    null |          433 |     0 |    0 |  14
recovering  |       704 |    null |          858 |     0 |    0 |  30
```

The thing to take from this table: **loss is an onset event, not a state.** It
burns for about six seconds and then reads zero for the rest of an unchanged
throttle, because the far end's estimator has adapted down and stopped
overshooting. A detector keyed on loss raises and then resolves while the viewer
is still pinned at a quarter of their bandwidth.

What *stayed* elevated through the sustained stretch, from an earlier run of the
same shape: `jitter` 0–2ms → 600ms, and per-frame jitter buffer delay
(`jitterBufferDelay / jitterBufferEmittedCount`) 5–20ms → 3109ms.
`packetsDiscarded` was null for video throughout.

Confirmed absent rather than merely zero:

```
SENDER   pair state=succeeded nominated=true availableIncomingBitrate=undefined hasIncomingKey=false
RECEIVER pair state=succeeded nominated=true availableIncomingBitrate=undefined hasIncomingKey=false
```

Both peers sending media, both nominated pairs. This is structural, not a gap
someone will fill: Chrome's congestion control is send-side (transport-cc), so
the estimate for *your downlink* is computed at the far end's sender. A receiver
never computes one.

### Other traps found

- `jitterBufferTargetDelay` is **cumulative**, like `jitterBufferDelay` — divide
  by `jitterBufferEmittedCount`. Read raw it climbs monotonically; 3224 ms → 65965
  ms was observed on a healthy call.
- `PeerConnectionMonitor` pushes `monitor.roundTripTime` into the RTT average
  every tick regardless of whether a new RTCP report arrived, so stale samples are
  re-counted. Gate on `0 < (monitor.deltaTime ?? 0)`. Fix this first if any of the
  three detectors reads the RTT average.

## The three detectors

### 1. Uplink congestion

Our own sending path cannot carry what the encoder wants to produce.

- **State, decides:** `availableOutgoingBitrate` below a fraction of its rolling
  maximum. This is the signal that was precision 1.00 in the run above.
- **Event, corroborates:** mean pacer queue time (`Δ totalPacketSendDelay /
  Δ packetsSent`) rising against its own baseline.
- **Support only, never decisive:** round-trip time climbing. It confirms queue
  build-up; it is far too noisy to gate on, and it is unavailable until the first
  RTCP report.
- **Do not use:** `qualityLimitationReason` as the anchor (precision 0.53),
  `packetsDiscardedOnSend` (measured 0 through real congestion).

### 2. Downlink congestion

**This is settled** — the shape below is the answer to the question that was open
when the handoff was written.

A receiver has no bandwidth estimate to read, so the uplink shape has to be
rebuilt from receiver-side evidence:

- **State, decides — both halves:** `receivingBitrate` below a fraction of its
  rolling maximum, **and** per-frame jitter buffer delay elevated over its own
  baseline. The second half is what separates "the link cannot carry it" from
  "the sender had less to send" — a static screen share or a muted camera drops
  the bitrate with the buffer perfectly normal.
- **Event, triggers:** a loss or NACK burst. Onset only, by the measurement
  above — it must not be what keeps the finding open.
- **Support only:** `framesDecoded` rate, and `InboundTrackMonitor.frameFlowState`
  from `InboundVideoFlowStateDetector`.
- **Do not use:** `availableIncomingBitrate` in any form. It does not exist.

The risk to watch: the jitter-buffer half sits close to
`JitterBufferStressDetector` (buffer strain as a perceived symptom). What keeps
this from being an echo of it is that the buffer evidence only counts when
conditioned on the bitrate collapse, and the finding reports capacity rather than
strain. If the finished detector fires on essentially the same episodes as
`JitterBufferStressDetector`, it has not earned its place — check that before
shipping it.

### 3. Unreliable path

Not "is it congested" but "is this link worth staying on" — an unstable Wi-Fi
link or a path that keeps degrading and recovering. Distinct from both above:
capacity may be fine and the path still not worth keeping.

Candidate inputs: variance rather than level in RTT and jitter, repeated
short degradation episodes rather than one sustained one, ICE candidate-pair
churn, `IceCandidatePairMonitor` state transitions.

The one thing to decide before building it is in the next section.

## Open questions

**Should the unreliable-path detector consume `UnstableIcePathDetector`'s switch
count as an input, or stay strictly independent?**

Independent is cleaner by this codebase's own rule — see the note in
`TransportJitterDetector`'s class doc: *a symptom detector that only fires when a
cause detector already fired is just an echo*, and the value of two detectors
co-firing comes from their having reached the verdict separately. Consuming the
switch count is more accurate, since path churn is genuinely strong evidence.

**And a prior question: should #3 exist at all?**
[NETWORK_CLASSIFICATION.md](./NETWORK_CLASSIFICATION.md) proposes a telemetry
classifier whose `flapping` class answers nearly the same question from the same
inputs. If that is built, an unstable path becomes a *fact about the session*
rather than a finding — which is why `ice-restart` is telemetry — and #3 is
retired along with the question above it.

Ask the maintainer (Balazs) before building #3. #1 and #2 do not depend on the
answer, so start there.

## House rules this session ran on

- **Mutation testing is the acceptance test**, not the green run. Several tests
  in this repo were found passing vacuously — one asserted a payload field that
  had been renamed, so both sides were `undefined`; another built a window that
  could never contain what it claimed to test.
- `grep -E "●.*›"` **hides suite-level jest failures** — `● Test suite failed to
  run` has no `›`. Always read the `Test Suites:` line too.
- `Math.max(2, undefined)` is `NaN`, and `x < NaN` is false, so a floor written
  that way fails **open**. Bad config in a spec will silently disable a guard.
- Run the suite with `npx jest --roots ./tests`. Files delivered into the working
  copy can land in a `Claude outputs/` folder inside the repo, and jest will
  otherwise pick up any `*.spec.ts` in it.
- When mirroring files back to a working copy over a file bridge, always pass the
  expected modification time. A blind write cost this session one of the
  maintainer's own edits, unrecoverable from git.
- Global find-and-replace across this repo is dangerous: `stalledForInMs` is a
  legitimate field on `FrameAssemblyStalledDetector`,
  `VideoRecoveryFailedDetector`, `IceTransportStalledDetector`,
  `DtlsHandshakeStalledDetector` and `IceRestartRecommendationDetector`. A rename
  aimed at one detector broke two others this way.

### Outstanding, unrelated to congestion

- **Docs debt, now actively wrong.** 38 references to `frozen-video-track` /
  `choppy-video` remain: `README.md` (13), `docs/PERCEIVED_QUALITY_DETECTORS.md`
  (9), `docs/PIPELINE_DISRUPTION_DETECTORS.md` (7), `docs/DETECTOR_TAXONOMY.md`
  (5), `CHANGELOG.md` (4). Those detectors no longer exist; the issue is
  `video-flow-disrupted`, the config key `inboundVideoFlowStateDetector`, and the
  payload is discriminated on `state`. This is a breaking API change for 4.10.0
  and needs a changelog entry saying what an application matching on the old
  payload will now see.
- `BlockedStunRequestsDetector` wire naming is inconsistent: payload
  `BlockedTransportIssuePayload`, emits `blocked-transport`, raises
  `blocked-stun-requests`.
- `DefaultScoreCalculator` line ~455 gates on `inboundRtp.framesRendered`, which
  no browser emits — that branch is dead everywhere.
- Inbound track monitors are deleted eagerly on the `ended` event.
- `OutboundRtpMonitor` and the other stats monitors still use `Object.assign`;
  the latent staleness this causes was fixed only for `InboundRtpMonitor`.
