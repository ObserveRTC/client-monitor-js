# Detector sanity check — the method

This is the working method behind the 4.9.0 detector pass, written so it can be
continued in a fresh session, a fresh account, or by somebody else. It has three
parts: **the prompt to paste**, **the context that prompt needs**, and **the
method itself** — what to actually look for, which primary sources were worth
reading, and what "done" means.

It is not a description of the library. That is
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md) and the five category references.

- [The prompt](#the-prompt)
- [Context a fresh session needs](#context-a-fresh-session-needs)
- [The method, phase by phase](#the-method-phase-by-phase)
- [The defect catalogue](#the-defect-catalogue)
- [Primary sources worth reading](#primary-sources-worth-reading)
- [What "done" means](#what-done-means)
- [Progress ledger](#progress-ledger)

## The prompt

Paste this, substituting the class name. One detector per conversation — the
research is what makes the check worth anything, and it does not survive being
split across four detectors in one context.

> Sanity-check `<DetectorName>` in this repo.
>
> Do **not** change any code yet. First tell me:
>
> 1. **What it claims to detect**, in one paragraph, from the class doc and the
>    implementation — not from the name.
> 2. **What the stats it reads actually mean.** Go to the primary sources: the
>    W3C webrtc-stats definition of every field it touches, the RFC behind the
>    counter where there is one, and the browser implementation where the spec is
>    silent or the browsers disagree. Quote the definition rather than
>    paraphrasing it, and say where each one came from.
> 3. **Browser support for every stat it reads.** A detector that is silently
>    inert on a browser is a detector that reports a healthy fleet.
> 4. **Whether the measurement supports the claim.** This is the real question.
>    Does the arithmetic compute what the field name says? Would a domain expert
>    recognise this as the way to detect this condition, or is there a better
>    signal the browser already exposes?
> 5. **The defects**, as a numbered list, each with a concrete failure scenario —
>    the inputs, and what it wrongly concludes. Include innocent conditions that
>    produce the same signature. Label them Defect A, B, C… so I can rule on them
>    one at a time.
> 6. **Whether it obeys the five design rules** in `docs/DETECTOR_TAXONOMY.md`,
>    and whether its category and layer stamp is still right.
>
> Then stop and wait. I will tell you which defects to fix and how. Do not
> propose a rewrite in the same message as the analysis, and do not start
> editing.

The stop-and-wait clause is load-bearing. Every one of the three detectors done
so far changed direction on a ruling that could not have been guessed — the
invented-speech bucket only accumulating on invented audio, the A/V desync rebuild
onto `estimatedPlayoutTimestamp`, blocked transport refusing to infer rather than
falling back. A session that analyses and implements in one breath spends its
budget building the wrong thing.

## Context a fresh session needs

Point it at the repo and have it read these, in this order, before the detector
itself. Roughly 15 minutes of reading; skipping it produces a review that
re-litigates settled decisions.

| File | Why |
|---|---|
| `docs/DETECTOR_TAXONOMY.md` | The five categories, the five design rules, `inputsUnavailable`, the full map. The rules a rebuild has to satisfy are here |
| The category reference for this detector | `CONNECTIVITY_`, `TRANSPORT_QUALITY_`, `PIPELINE_DISRUPTION_`, `PERCEIVED_QUALITY_` or `TELEMETRY_DETECTORS.md`. Says what the detector is *supposed* to be doing and what its neighbours own |
| `src/detectors/Detector.ts` | The interface, the three cross-cutting conventions, and the `inputsUnavailable` contract |
| `src/detectors/<DetectorName>.ts` | The subject |
| `tests/detectors/<DetectorName>.spec.ts` | Read **adversarially** — see defect 10 |
| The monitor it binds to | `InboundRtpMonitor`, `PeerConnectionMonitor`, `IceTransportMonitor`… — the derived values already available, so the rebuild reads rather than re-derives |
| `tests/detectors/DetectorTaxonomy.spec.ts` | The machine-readable taxonomy and the tests that enforce the stamps and config ownership |
| `CHANGELOG.md`, the 4.9.0 section | What has already been decided and why. Prevents re-proposing something that was tried |

`README.md` has a per-detector section too, but it is long; let the session grep
it for the class name rather than reading it whole.

**Give it web access.** The single highest-value part of this method is reading
the spec text and the browser source instead of reasoning from the field name.
Without a fetch tool the check degrades into a code review, which is not what
finds these defects.

## The method, phase by phase

**Phase 1 — Establish what the stats mean.** Before looking at the logic, pin
down every field the detector reads. `concealedSamples` is not "bad audio";
`bytesSent` on a transport is not the same population as `bytesSent` on a
candidate pair; `packetsDiscardedOnSend` is specifically the socket refusing. Get
the definition from the spec, and where the spec is loose, from the
implementation. Where a browser disagrees with the spec, the browser wins,
because that is what ships.

**Phase 2 — Establish what the condition actually is.** Separately from the
code: how would somebody who understands this failure mode detect it? Often the
answer is a signal the browser already exposes and the detector was not using.
A/V desync had a purpose-built one — `estimatedPlayoutTimestamp`, differencing
which is the method the spec itself describes — while the detector was doing a
second normalization of two NetEQ counters that `timeStretchRate` had already
normalized once.

**Phase 3 — Compare the two.** This is where the defects fall out. The three
questions that produced every real finding so far:

- Does the arithmetic compute what the name promises? (`concealmentRate` counted
  silent concealment, so a call with no audible artefact at all could carry a
  high "concealment rate" — the fix was both a rename and a subtraction.)
- What innocent condition produces this same signature? (A send-only SFU publish
  transport. A remote peer who muted. A backgrounded tab. The first tick.)
- What happens when a stat is missing, rather than zero?

**Phase 4 — Enumerate defects with failure scenarios.** "This could be wrong" is
not actionable. "Transport with one inbound stream, remote peer mutes at t=0,
issue raised at t=5s and never resolved" is. Label them so they can be ruled on
individually; expect some rulings to be *we don't care*, which is a real answer
and worth writing into the class doc as an explicit non-claim.

**Phase 5 — Implement only what was ruled on.** Then rewrite the spec against
the new behaviour rather than patching the old one, because the old spec was
usually written from the implementation and encodes its assumptions in its mocks.

## The defect catalogue

What actually kept turning up. Run down this list explicitly — it is faster than
rediscovering each one.

1. **Metric/name mismatch.** The field name promises something the arithmetic
   does not deliver. Check the derived value on the monitor as well as the
   detector; renaming the metric is often half the fix.
2. **Missing-stat blindness.** The detector goes permanently silent on some
   browser and nothing says so. Every load-bearing stat needs a browser-support
   answer, and the ones without a substitute need `inputsUnavailable`.
3. **Absent conflated with zero.** `undefined` (the browser does not report it)
   and `0` (it reports zero) taking the same branch. These are different facts
   and almost always want different handling.
4. **Nominal clocks.** `collectingPeriodInMs` or `Date.now()` where stats time is
   meant. Check *every* clock in the class, including the interval underneath a
   rate — a bitrate computed over a configured period rather than a measured one
   is the same bug wearing a different hat.
5. **Innocent look-alikes.** Legitimate conditions with the detector's exact
   signature: send-only transports, muted or replaced tracks, paused tracks,
   backgrounded tabs, a peer who has not started sending, a stream that is
   simulcast-inactive by design.
6. **Cold start.** The first tick treated as though history existed — a freshness
   clock seeded at zero as if a response had just arrived, a latch assumed true,
   a delta computed against nothing.
7. **No hysteresis, no drain.** One tick raises, the next resolves, the next
   raises. Either a low/high watermark pair or an accumulator that drains, and
   the accumulator must have a ceiling or it takes minutes to unwind.
8. **Counter resets.** A counter going backwards (ICE restart, stream replaced)
   producing a garbage delta. `positiveDelta` exists for this.
9. **Inference.** Reconstructing a stat the browser did not supply. Design rule
   5: a different real measurement of the same traffic is fine, a reconstruction
   is not.
10. **The spec encodes the bug.** The existing tests were written from the
    implementation, so they pass on the wrong behaviour and will fight the fix.
    The 4.9.0 send-only false positive was *in the mocks* as expected behaviour.
    When a spec resists a correct change, suspect the spec.
11. **Design rule drift.** Two issue types in one class, a second collection, a
    borrowed config key, a value re-derived that the monitor already computes, a
    stale category/layer stamp.

## Primary sources worth reading

Which of these matters depends on the detector; the point is that the answer is
usually in one of them rather than in inference.

- **[W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)** — the definition of
  every field. The per-dictionary anchors (`#dom-rtcinboundrtpstreamstats-…`)
  are worth linking in the class doc when a field's meaning is surprising.
- **[W3C webrtc-pc](https://www.w3.org/TR/webrtc/)** — state machines: ICE, DTLS,
  transceiver directions, what `connected` actually guarantees.
- **RFCs behind the counters.** RFC 7294 (concealment metrics and the 5% severely
  concealed bar), RFC 7675 (STUN consent freshness), RFC 3550/3551 for the RTCP
  fields the remote-inbound reports carry.
- **Perceptual limits** where a threshold claims to be one — ITU-R BT.1359-1 for
  A/V sync detectability and acceptability, ITU-T G.114 for one-way delay.
- **Browser implementation.** Chromium and Firefox source, and their bug
  trackers, for the fields where the spec is silent or unimplemented. This is how
  the support gaps in the docs were established: `RTCTransportStats` byte
  counters absent on Firefox through 153, `responsesReceived` from Firefox 142,
  `estimatedPlayoutTimestamp` effectively Firefox-only.
- **The article that motivated the detector**, where there is one. webrtcHacks
  and BlogGeek.me were both load-bearing here — the NetEQ jitter buffer piece is
  what settled what the invented-speech detector was originally for, and reading
  it changed the design.

## What "done" means

A detector is finished when all of these hold:

- `npx tsc --noEmit` clean, and the **full** suite passes — not just this
  detector's spec. Changes to a monitor's derived values reach other detectors.
- The spec is rewritten against the new behaviour, with a named regression test
  for each innocent look-alike found in phase 3. Name them after the condition
  ("a remote peer who has never sent"), not after the code path.
- The class doc says what the detector **deliberately does not claim**, and ends
  with the four-line `Category:` / `Layer:` stamp.
- Its config block is its own, its type is exported from the detector file, and
  `ClientMonitorConfig` `import type`s it.
- `docs/<CATEGORY>_DETECTORS.md` and the README section match the new behaviour.
- `CHANGELOG.md` has an entry saying what changed *and what an application that
  matches on the old payload will now see*.
- The work is mirrored to wherever the working copy lives.

## Progress ledger

45 detector classes. Keep the list in `__CHECKED_DETECTORS` at the repo root
current as they are done.

**Checked and rebuilt:** `InventedSpeechDetector` (was `AudioConcealmentDetector`),
`AVDesyncPlayoutDetector` (was `AudioDesyncDetector`), `BlockedTransportDetector`.

**Remaining, in a reasonable order** — the ones with the most stat-semantics
risk first, since that is where the method pays:

| Group | Classes |
|---|---|
| Perceived quality | `JitterBufferStressDetector`, `AudioPlayoutSynthesisDetector`, `PixelatedVideoDetector`, `ChoppyVideoDetector`, `FrozenVideoTrackDetector`, `PlayoutDiscrepancyDetector`, `SilentAudioSourceDetector` |
| Transport quality | `TransportDelayDetector`, `TransportLossDetector`, `CongestionDetector` |
| Pipeline disruption | `FrameAssemblyStalledDetector`, `TransportDemuxStalledDetector`, `RtpSenderStalledDetector`, `DryInboundTrackDetector`, `DryOutboundTrackDetector`, `StuckDecoderDetector`, `VideoRecoveryFailedDetector` |
| Frame supply and performance | `DecoderBottleneckDetector`, `VideoCaptureBottleneckDetector`, `EncoderBottleneckDetector`, `DecoderPerformanceDetector`, `CpuPerformanceDetector` |
| Connectivity | `IceReachabilityDetector`, `IceTraversalDetector`, `IcePathEstablishmentDetector`, `IceEstablishmentFailedDetector`, `IceConnectionFailedDetector`, `IceDisconnectedDetector`, `IceTransportStalledDetector`, `UnstableIcePathDetector`, `IceRestartDetector`, `IceRestartRecommendationDetector`, `DtlsHandshakeFailedDetector`, `DtlsHandshakeStalledDetector` |
| Capture | `CaptureTrackEndedDetector`, `CaptureTrackMutedDetector` |
| Telemetry | `CodecChangeDetector`, `SimulcastLayerDetector`, `VideoResolutionChangeDetector`, `StatsGapDetector` |
