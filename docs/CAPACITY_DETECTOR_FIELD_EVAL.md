# Capacity detectors against captured sessions

`UplinkCongestionDetector` and `DownlinkCongestionDetector` replayed over two
captured mediasoup sessions, alongside the rule they replace. Reproduce with:

```bash
REPLAY_FILE=<capture>.jsonl OUT_FILE=/tmp/out.csv \
  npx jest tests/replay/CongestionReplay.spec.ts
```

The captures are ClientSample JSONL (the monitor's own output);
`tests/helpers/clientSampleToReplay.ts` turns them back into replayable stats.
Two sessions, 5s collecting period: 245 ticks × 3 connections, and 1604 × 3.

## What ground truth is here, and what it cannot be

Two labels, and only their conjunction is used:

- **A** — Δ`qualityLimitationDurations.bandwidth` covers more than half the
  collection. The browser's own accounting, and a *duration* rather than the
  instantaneous flag.
- **B** — delivered video bitrate below half this connection's own p90.

B alone is not congestion: one sender in the big capture spends 458 ticks under
half its p90 with the bandwidth counter flat — content-driven, exactly the
innocent case `DownlinkCongestionDetector`'s second gate exists to exclude. A
alone is not congestion either: it is the browser saying the encoder is not free,
which it says freely.

**The circularity to keep in mind.** Label A comes from the same family as
`qualityLimitationReason`, so the old detector's `high` sensitivity scoring well
against it means the browser is self-consistent, not that the browser is right.
The precision 0.53 measured for that signal during the 4.10.0 pass came from an
external ground truth — a `tbf` shaper we controlled. Nothing in a captured
session can reproduce that, so these numbers cannot adjudicate the browser's
verdict, only what is built on top of it.

## The bug that had to be fixed first

`PeerConnectionMonitor.dataChannelSendingBitrate` and
`dataChannelReceivingBitrate` were accumulated with `+=` every collection and
never zeroed, unlike every other per-round accumulator beside them. On a 20
minute call the signalling channel's real ~40 kbps read as **9.7 Mbps** by the
end — the cumulative byte count divided by one period.

`sendingBitrate` sums them, so `outgoingBitrateHeadroom = availableOutgoingBitrate
- sendingBitrate` fell without bound and `UplinkCongestionDetector` sat raised
for **206 of 245 ticks**. On the receiving side the same inflation pins a rolling
maximum to its own latest value, so `receivingBitrate < collapseRatio × max`
could never hold. Fixed, with a regression test in `CapacityFacts.spec.ts` that
runs the same 1000 bytes per second past the monitor twenty times and asserts the
rate does not climb.

Everything below is measured after that fix.

## Uplink: episode level

An alert a viewer would notice is an episode, not a tick.

**Severe sustained congestion** (245-tick capture, sending connection: video
35-200 kbps against a 300-660 kbps encoder target, bandwidth-limited on 234 of
244 ticks):

| rule | alerts | false | ground-truth episodes covered |
|---|---|---|---|
| **uplink-congestion** | **1** | **0** | **14 / 14** |
| old `high` | 3 | 2 | 14 / 14 |
| old `medium` | 12 | 4 | 4 / 14 |
| old `low` | 0 | 0 | 0 / 14 |

**Mostly healthy call with short episodes** (1604-tick capture, sending
connection, 10 ground-truth episodes):

| rule | alerts | false | ground-truth episodes covered |
|---|---|---|---|
| **uplink-congestion** | **4** | **0** | 4 / 10 |
| old `high` | 8 | 0 | 8 / 10 |
| old `medium` | 1 | 0 | 1 / 10 |
| old `low` | 0 | 0 | 0 / 10 |

Tick level against the same label: new P=0.650 R=0.924 on the first, P=0.750
R=0.450 on the second; old `high` P=0.617 R=1.000 and P=0.800 R=0.800.

**The reading.** The new detector raised nothing false across 3453 connection
ticks, and it collapses a whole congested call into one alert where the old rule
flaps into three. But it under-fires: it misses six of ten short episodes, and on
the severe one it opened at tick 31 where the browser had been reporting
bandwidth since tick 4 — roughly 135 seconds late. `old low` never fired once in
either capture, which is what a rule requiring 5% outbound loss does on real
traffic where the congestion controller backs off before the queue overflows.

## Why it under-fires

Attributing every ground-truth-positive tick the detector stayed silent on to the
gate that blocked it:

| binding gate | severe capture | healthy capture |
|---|---|---|
| pacer queue alone | 19 | 4 |
| queue + headroom | 8 | 3 |
| all three | 1 | 4 |

The pacer queue gate is the constraint. `MIN_PACKET_SEND_DELAY_IN_MS = 10` sits
above the whole normal range of this traffic — the mean queue time runs 0-7 ms
and spikes past 10 ms only occasionally. That constant was calibrated against a
`tbf` shaper, where packets queue because the shaper holds them. Here the
bandwidth estimator lowers the encoder target instead, so the pacer never fills
and the evidence the gate asks for is not produced by the failure mode it is
gating.

## Uplink, rebuilt against the captures

The three gates were replaced with what the captures say actually moves.

| | before | after |
|---|---|---|
| alerts | 5 | **9** |
| false | 0 | **0** |
| ground-truth episodes covered | 17 / 24 | **22 / 24** |
| onset on the severe capture | tick 31 | **tick 19** |

**What each candidate signal does during real congestion**, positives vs negatives,
ratio of medians:

| signal | severe capture | healthy capture | verdict |
|---|---|---|---|
| mean pacer queue time | 15.4 / 2.5 ms — **6.2x** | 11.6 / 0.5 ms — **21x** | keep, retune |
| far-end jitter on our video | 14.5 / 13.0 ms — 1.12x | 17.4 / 9.3 ms — **1.87x** | keep as second witness |
| RTCP round trip | 69 / 65 ms — 1.07x | 52 / 47 ms — 1.11x | **dead** |
| ICE round trip | 65 / 66 ms — 0.98x | 48.5 / 47 ms — 1.03x | **dead** |
| outbound loss fraction | 0 / 0 at p90 | 0 / 0 at p90 | **dead** |
| NACK rate | 0 / 0 at median | 0 / 0 at median | too sparse |
| audio far-end jitter | 1.00x | 0.98x | **dead** |

Loss and round trip cannot serve as evidence on this fleet: a congestion controller
doing its job backs off before the queue overflows, so nothing is lost and nothing
queues in the network. The rule requiring 5% outbound loss never fired once in 3449
collections.

**The pacer signal was fine; the calibration was wrong.** A 6-21x median separation
is the strongest of any candidate. What cost four episodes was the pair of constants
around it — a 10 ms absolute floor sitting above the entire normal range of the
traffic, and a 3x growth ratio. At `>= 2x` its EWMA with a 1 ms floor it costs one.

**Far-end jitter was tried as a second witness and dropped.** The idea was that a
bandwidth estimator lowering the encoder target queues nothing — less is produced
rather than held — so the pacer would stay empty and only the far end's ear would
move. Measured, that story is wrong once the pacer baseline is a median: on the
collections the browser calls bandwidth-limited, the pacer witness fires on 34.5% of
them in the severe capture against jitter's 19.6%, and is the sole witness on 53
collections against jitter's 18. The earlier claim that "on a real SFU uplink the
pacer is the one that stays empty" was a description of the broken 10 ms / 3x
calibration, not of the signal.

Removing it, measured A/B over both captures:

| witnesses | alerts | false | episodes covered | onset, severe capture |
|---|---|---|---|---|
| pacer + far-end jitter | 9 | 0 | 22 / 24 | tick 20 |
| **pacer alone** | **8** | **0** | **21 / 24** | tick 21 |
| far-end jitter alone | 9 | 0 | 22 / 24 | tick 20 |

Jitter is worth **one episode in twenty-four, one alert, and one collection of
latency** — and it was bought with the only threshold in the detector that is
knife-edged on this data (1.1 raises a false finding, 1.2 loses the episode, 1.15 is
the only value that does neither). A new stats field, a new per-connection fact, a new
config knob and a fitted constant, for 4% of recall. Dropped, along with everything
computed for it on `PeerConnectionMonitor`.

Worth noting what the same table says about the pacer: given jitter, the pacer adds
nothing at all here. Keeping the pacer rather than the jitter is a judgement that the
signal with a 6-21x median separation and a mechanism anyone can state is the one to
keep when both perform the same — not a claim the captures made.

**Headroom did not survive.** `availableOutgoingBitrate - sendingBitrate` reads well
in principle and badly in practice: a difference that hovers around zero on a busy
sender and passes through it exactly when things are worst, with an EWMA that chases
the collapse it is supposed to measure. Sweeping every window and ratio, a
headroom-collapse gate never removed a false finding and always removed true ones. It
stays in the payload as evidence and gates nothing.

**Thresholds swept rather than chosen.** Across windows of 3-20 samples and collapse
ratios of 0.4-0.8, every combination gated by the browser verdict produced 9-11 alerts
covering 22 of 24 episodes; without that verdict gate, precision collapsed to
225-390 false alerts. So `availableBitrateCollapseRatio: 0.4` over 5 samples is a
local optimum inside a broad plateau, not a knife-edge — and the verdict is doing
more of the discriminating than any evidence here can independently confirm, which is
the circularity noted above.

### Simplifying the state it keeps

The rolling maximum and both baselines were replaced with one number each.

**A decaying maximum instead of a window.** `max(previous x decay^elapsed, sample)`
— no array, no walk. Replayed at half-lives from one minute to six, every rate gave
the same findings, so the memory length is a plateau rather than a tuned number. It
decays per *second of stats time* rather than per collection: per collection, an
application collecting every second would forget five times faster than one
collecting every five, with nothing saying so — the same trap, inverted, as sizing a
window in milliseconds and getting two samples.

**A running median instead of an EWMA baseline.** This one is not cosmetic. The
quantities being compared against a baseline are spiky, and a mean of a spiky
quantity sits far above where the quantity usually is:

| series | true median | EWMA(0.1) settles at | streaming median settles at |
|---|---|---|---|
| pacer queue, healthy capture | 0.37 ms | **6.02 ms** | 0.75 ms |
| pacer queue, severe capture | 2.59 ms | 4.15 ms | 2.11 ms |
| far-end jitter, healthy capture | 9.37 ms | 14.90 ms | 14.09 ms |

On the pacer the EWMA lands **sixteen times** above the level the signal actually
sits at, because 111 of 1603 collections spike past 10 ms. A bar written as "twice
the baseline" then means twice a number the signal is almost never near — which is
why the pacer witness contributed to only six of eight findings before this change
and contributes to seven of eight after it. On far-end jitter the two estimators
agree closely, because RTCP jitter is already smoothed at the receiver; the median
buys nothing there beyond using one concept rather than two.

The estimator is `trackMedian` in `src/utils/common.ts`: one number of state, one
comparison per sample, clamped at zero because every quantity measured this way is a
duration.

**Nothing left is knife-edged.** The one threshold that was — the far-end jitter
ratio — went with the witness it belonged to. Across the two captures, every collapse
ratio from 0.4 to 0.8, every decay half-life from one minute to six, and every pacer
growth ratio from 1.5 to 2 gave the same findings.

The estimator generalises: `FrugalQuantileEstimator` in `src/utils/` puts its fixed
point wherever the two step sizes say — `2q` up, `2(1-q)` down — so any quantile is one
constructor argument. Checked against captured sessions, 74-76% of samples fell below a
`q = 0.75` estimate on every one. Everything built on it is named `estimatedMedian…`
rather than `median…`, because one number cannot hold an exact quantile and the name
should not pretend otherwise.

### One confidence instead of two thresholds

The two hard gates — a collapse ratio on the estimate and a growth ratio on the
pacer — became two ratios against the connection's own recent behaviour, combined by
their geometric mean:

```
narrowing  = 1 - available / recentMax     // 0 at the recent best, → 1 as it collapses
queueing   = 1 - baseline  / pacer         // 0 at the usual level, 0.5 at twice it
confidence = sqrt(narrowing × queueing)
```

The geometric mean is the point: it is zero unless *both* are moving, so no amount of
one can carry a finding, and a moderate reading on both outranks an extreme reading on
either. A path narrowing while packets back up behind it is congestion; a path
narrowing alone is an encoder asked for less, and a pacer backing up alone is a hiccup.

**It is not more accurate.** Replayed over both captures it reaches exactly the same
findings as the two gates it replaces — 8 alerts, 0 false, 21 of 24 episodes. What it
buys:

- **One knob instead of two.** `minConfidence` replaces `availableBitrateCollapseRatio`
  and `sendDelayGrowthRatio`.
- **A broader plateau.** Everything from 0.60 to 0.75 produced identical findings; the
  default sits at 0.65, one notch above the lower edge. Below 0.60 a marginal narrowing
  starts being admitted on the strength of a deep queue alone, and the first thing that
  lets in is a false finding.
- **A number in the payload.** `confidence`, with `narrowing` and `queueing` beside it
  so a reader can see which half carried it. The seven findings on the healthy capture
  score 0.816-0.866; the one on the severe capture scores 0.671.

How well it separates, per collection: on the healthy capture, confidence is **exactly
zero on every ground-truth-negative collection** and reaches 0.862 at the 90th
percentile of the positives. On the severe capture the negatives reach 0.598 at their
p90 against 0.754 for the positives — that call is congested almost end to end, so its
"negatives" are the less-bad stretches rather than healthy ones.

Treat it as a confidence and not a severity. Delivered bitrate falls only mildly across
the confidence bands on the severe capture (0.36 → 0.25 of the connection's p90) and
shows no trend at all on the healthy one, where there are too few findings to say.

Two guards turned out to be unreachable and were removed rather than left as decoration:
`narrowing` cannot go negative, because the decaying maximum folds in this collection's
own estimate before returning it, and the pacer noise floor belongs on the *baseline*,
where it makes a sub-floor queue score zero through the same clamp everything else uses.

### Does the estimate undershoot and the encoder follow late?

Yes, measurably — and it is not exploitable, which is worth recording so the idea is
not tried again.

**The lag is real and points the right way.** Cross-correlating the two rate-of-change
series, `log(available)` step against `log(sending)` step, the strongest correlation on
both sending connections is at **lag +1** — the send rate follows the estimate by one
collection. Every lag in the other direction is flat or negative.

| lag | severe capture | healthy capture |
|---|---|---|
| sending leads by 1-4 | −0.03 to −0.05 | −0.04 to −0.11 |
| same collection | +0.409 | +0.363 |
| **sending follows by 1** | **+0.672** | **+0.366** |
| sending follows by 2-4 | −0.04 to −0.13 | −0.08 to −0.19 |

**Aligned on congestion onset**, the healthy capture shows the overshoot directly. One
collection before onset the estimate has already halved while the encoder is still
sending four fifths of what it was:

| offset | available | sending | video only |
|---|---|---|---|
| −1 | **0.53** | 0.80 | 0.77 |
| 0 | 0.51 | 0.46 | 0.36 |
| +2 | 0.96 | 0.81 | 0.80 |

Recovery mirrors it: at +2 the estimate is back to 0.96 while the encoder is still at
0.81, ramping more slowly than the path re-opens.

**On the collection where the estimate drops sharply** (>25% in one step), the sender is
over-driving the path it has just been told it has:

| collections after a sharp drop | sending / available | over-sending |
|---|---|---|
| 0 | 1.22 / 1.00 | **95% / 50%** |
| +1 | 0.99 / 0.81 | 45% / 12% |
| +2 | 1.05 / 0.76 | 68% / 11% |

*(severe capture / healthy capture.)*

**Why it cannot be used.** The window is one collection wide — the median over-sending
run is exactly 1 collection in both captures. That is why headroom failed as a *level*:
by the next tick it has closed, and any smoothed baseline of it chases the very
excursion it is supposed to measure. Tried directly as an alternative `narrowing` term,
`1 - available / sending`:

| narrowing term | best alerts | false | covered |
|---|---|---|---|
| `1 - available / recentMax` (shipped) | 8 | 0 | **21 / 24** |
| `1 - available / sending` | 7 | 0 | 15 / 24 |
| `max` of the two | 8 | 0 | 21 / 24 |
| geometric mean of the two | 7 | 0 | 20 / 24 |

`max` being identical to the shipped term is the whole story: the over-send term never
fires on a collection the recent-maximum term has not already caught. It is a true
description of what the congestion controller does, and it carries no information the
detector does not already have.

## Downlink: structurally inert in this topology

**Zero raises across 1849 ticks.** The cause is not a threshold:

```
                          has qualityLimitationReason
has inbound video     no                yes
        no          4                  3205
        yes      1603                     0
```

Not one tick in either capture has both. mediasoup gives a client separate send
and receive transports, so the receiving connection carries no outbound RTP and
therefore no `qualityLimitationReason` — and the verdict the detector borrows to
gate itself does not exist on the connection where the inbound video it needs
lives. It sets `inputsUnavailable` on all 1603 inbound-video ticks.

The class doc names this risk ("a receive-only viewer … set `inputsUnavailable`
rather than reading as a healthy path"). What the capture adds is that it is not
an edge case in this deployment, it is every call.

Removing the gate would not rescue it. On the receiving connection:

- `receivingBitrate` is steady — p10 332k, median 393k, p90 446k — so the
  collapse gate holds on **0 of 1604** ticks.
- inbound video jitter buffer delay has a **median of 371 ms** (p90 424, max
  588). `MIN_BUFFER_DELAY_IN_MS = 100` is far below this fleet's normal, and
  `bufferElevationRatio: 2` against that baseline wants 742 ms — above the
  observed maximum. The buffer gate is simultaneously too low to filter anything
  and too high to ever fire.

## The rolling maximum is two samples

`RECENT_MAX_WINDOW_IN_MS = 10_000`, and this app collects every 5 s. The window
holds two observations, so what both detectors compare against is "the larger of
the last two ticks" rather than a recent healthy maximum. Any collapse that takes
longer than one collection to develop is invisible to it — which is most of them,
since a bandwidth estimator ramps down over seconds.

## Suggested next steps

1. Give the downlink detector evidence that exists on a receiving connection.
   The `qualityLimitationReason` gate has to go or become optional; what remains
   has to carry the weight, which means the buffer and bitrate thresholds need
   calibrating against captures like these rather than against a loopback.
2. ~~Express both windows in collections rather than milliseconds.~~ Done for the
   uplink, which now keeps a decaying maximum and no window at all. The downlink
   still has the ten-second window.
3. ~~Re-derive `MIN_PACKET_SEND_DELAY_IN_MS` from captured traffic.~~ Done, above.
4. Nothing else. The full suite is green with the fix above, and the replay was
   re-run against a fully synchronised tree to confirm every number here is
   unchanged by it — the CSVs are byte-identical.
