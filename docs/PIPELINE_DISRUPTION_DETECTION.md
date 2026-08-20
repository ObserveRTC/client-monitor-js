# Pipeline-Stage Disruption Detection

Research notes on detecting *where* in the WebRTC media pipeline a disruption happens, what
`getStats()` exposes per stage, which stage boundaries the existing detectors already cover,
and a proposal for a stage-attributing detector. Written against the monitor/detector
architecture of this library (2026-08).

## 1. The pipeline model

Media on the sending side moves through a fixed chain of components, and each component
leaves its own fingerprint in the stats. The receiving side is the same chain mirrored.

```
SENDER
  capture source ──► encoder ──► RTP sender / pacer ──► ICE transport ──► wire
  (media-source)     (outbound-rtp:                     (transport /
                      framesEncoded,                     candidate-pair:
                      totalEncodeTime,   packetsSent,    packetsSent,
                      targetBitrate)     bytesSent,      bytesSent)
                                         headerBytesSent

RECEIVER
  wire ──► ICE transport ──► RTP receiver / jitter buffer ──► decoder ──► playout
          (transport /       (inbound-rtp:                   (inbound-rtp:  (inbound-rtp:
           candidate-pair:    packetsReceived, bytesReceived, framesDecoded, framesRendered;
           packetsReceived,   jitterBuffer*,                  totalDecodeTime) media-playout:
           bytesReceived)     framesReceived,                                synthesized*,
                              framesAssembledFromMultiplePackets)            totalSamplesCount)
```

The essential property: **every stage has a monotonic counter that proves it is making
progress**, and this library's monitors already turn all of them into per-tick deltas
(`OutboundRtpMonitor.deltaFramesEncoded`, `IceTransportMonitor.deltaBytesSent`,
`InboundRtpMonitor.deltaFramesDecoded`, …). A disruption is therefore locatable as the
*first* stage boundary at which the upstream counter advances and the downstream counter
does not.

## 2. Progress evidence per stage

### Sending side

| Stage | Progress counter(s) | Monitor / derived field |
|---|---|---|
| Capture source | `media-source.frames`, `framesPerSecond`, `totalAudioEnergy` | `MediaSourceMonitor.sourceFps`, `rmsAudioLevel` |
| Encoder | `outbound-rtp.framesEncoded`, `totalEncodeTime`, `qualityLimitationDurations` | `OutboundRtpMonitor.deltaFramesEncoded`, `encodeTimePerFrameInMs`, `qualityLimitationDurationShares` |
| RTP sender / pacer | `outbound-rtp.packetsSent`, `bytesSent`, `totalPacketSendDelay` | `OutboundRtpMonitor.deltaPacketsSent`, `deltaBytesSent`, `avgPacketSendDelayInMs` |
| ICE transport (out) | `transport.packetsSent`, `bytesSent`; `candidate-pair.bytesSent`, `packetsDiscardedOnSend` | `IceTransportMonitor.deltaBytesSent`, `sendingBitrate`; `IceCandidatePairMonitor.deltaBytesSent` |
| Wire / far end | `remote-inbound-rtp.packetsReceived`, `fractionLost`, report freshness | `RemoteInboundRtpMonitor.deltaPacketsReceived`, `deltaFractionLost` |

### Receiving side

| Stage | Progress counter(s) | Monitor / derived field |
|---|---|---|
| ICE transport (in) | `transport.bytesReceived`; `candidate-pair.bytesReceived` | `IceTransportMonitor.deltaBytesReceived`, `receivingBitrate` |
| RTP receiver / depacketizer | `inbound-rtp.packetsReceived`, `bytesReceived` | `InboundRtpMonitor.deltaPacketsReceived`, `deltaBytesReceived`, `bitrate` |
| Frame assembly | `inbound-rtp.framesReceived`, `framesAssembledFromMultiplePackets` | `InboundRtpMonitor.deltaFramesReceived` |
| Decoder | `inbound-rtp.framesDecoded`, `totalDecodeTime` | `InboundRtpMonitor.deltaFramesDecoded`, `decodeTimePerFrameInMs` |
| Playout | `inbound-rtp.framesRendered`; `media-playout.totalSamplesCount`, `synthesizedSamplesDuration` | `InboundRtpMonitor.deltaFramesRendered`, `renderRatio`; `MediaPlayoutMonitor` deltas |

Audio replaces the frame counters with sample counters (`totalSamplesReceived`,
`concealedSamples`, `insertedSamplesForDeceleration`, playout `synthesizedSamplesDuration`),
but the boundary logic is identical.

## 3. Stage-boundary invariants

Each adjacent pair of stages carries an invariant. The violated invariant *is* the
diagnosis; everything downstream of the first violation is noise.

Sending side, in order:

1. **source → encoder**: if `sourceFps` is healthy, encoded fps of the highest active
   layer should track it. Violation = encoder bottleneck. *(Covered:
   `SourceEncoderBottleneckDetector`, which also owns the converse — the source itself
   starving.)*
2. **encoder → RTP sender**: if `deltaFramesEncoded > 0`, then `deltaPacketsSent > 0`
   in the same interval (an encoded frame always packetizes). Violation = a wedged
   sender/pacer — rare, but it has been observed in the wild after `replaceTrack` races
   and simulcast reconfigurations. *(Not covered today — the honest gap in the chain.)*
3. **RTP sender → ICE transport**: if outbound RTP is producing bytes, the transport's
   own send counter must move proportionally. Violation = packets produced but never
   making it onto the wire (host firewall, blocked socket, dead route). *(Covered:
   `BlockedTransportDetector`, `media-not-leaving-transport` evidence.)*
4. **ICE transport → wire/far end**: if the transport is sending and STUN answers,
   *something* must come back — RTCP receiver reports at minimum, and
   `remote-inbound-rtp` must keep refreshing. Violation = media eaten in the network
   while STUN survives. *(Covered: `BlockedTransportDetector` `no-return-traffic`
   evidence; the plain both-directions-dead case is `IceConnectivityDetector`'s
   stall/disconnect.)*

Receiving side, in order:

5. **transport → RTP receiver**: transport `bytesReceived` advancing while every
   `inbound-rtp` of that transport is flat means traffic arrives that never demuxes into
   any stream (SSRC mismatch after renegotiation, consumer created against a dead
   producer). *(Partially covered: per-track dryness is `DryInboundTrackDetector`, but
   nothing today cross-references transport-level inbound bytes to say "the pipe is
   alive, the demux is not".)*
6. **RTP receiver → assembly**: `deltaPacketsReceived > 0` with `deltaFramesReceived == 0`
   sustained = depacketizer/assembly wedge. *(Covered: `StuckDecoderDetector`, variant
   `assembly`.)*
7. **assembly → decoder**: `deltaFramesReceived > 0` with `deltaFramesDecoded == 0`
   sustained = decode wedge; decode time per frame over budget or frames dropped
   post-arrival = decoder overload. *(Covered: `StuckDecoderDetector` variant `decode`
   for the wedge, `DecoderPerformanceDetector` for the overload.)*
8. **decoder → playout**: `deltaFramesDecoded` healthy but `deltaFramesRendered`
   lagging = playout starvation. *(Covered: `PlayoutDiscrepancyDetector`; audio playout
   sibling is `SynthesizedSamplesDetector` / `AudioConcealmentDetector`.)*

## 4. Coverage map and the actual gaps

Mapping the existing detectors onto the boundaries shows the chain is mostly covered by
*symptom-named* detectors; what is missing is small and specific:

- **Gap A — encoder → sender (boundary 2).** No detector asserts "frames encode but
  packets do not leave the RTP sender". Cheap to add: both deltas already exist on
  `OutboundRtpMonitor`.
- **Gap B — transport → demux (boundary 5).** No detector asserts "the transport
  receives, yet no inbound-rtp accounts for it". Cheap to add:
  `IceTransportMonitor.deltaBytesReceived` versus the sum of
  `InboundRtpMonitor.deltaBytesReceived` on that transport (allow slack for RTCP, FEC
  and probes).
- **Gap C — a unifying stage verdict.** Each detector fires independently and names a
  symptom. When several fire at once (they legitimately do — a firewall block makes
  inbound tracks dry too), nothing states which stage broke *first*, which is the only
  question an operator actually asks.

## 5. Proposal: a pipeline classifier, not another detector

The recommendation is **not** to replace the symptom detectors with one mega-detector.
Their per-symptom hysteresis, thresholds and payloads are well tuned, and a single
detector holding eight boundaries' worth of guards would be unmaintainable.

Instead, add a lightweight `MediaPipelineDetector` per peer connection that runs *after*
the others (detectors run in registration order) and does pure classification:

```
for each direction (send / receive):
    walk the boundaries in pipeline order (1..4 / 5..8)
    stage = first boundary whose upstream delta advances and downstream does not,
            applying the same guards the specialist detectors use
            (track live+unmuted, layer active, loss below quiet threshold, ...)
    if stage found and sustained for thresholdInMs:
        raise 'media-pipeline-stalled' issue
        payload: { direction, stage, upstreamCounter, downstreamCounter,
                   suspectedIssueTypes: [...types of specialist issues active now] }
```

Design points, in order of importance. First, the classifier reads only deltas the
monitors already compute — zero new stats plumbing. Second, its payload cross-references
the specialist issues that are currently active (`clientMonitor.activeIssues`), so the
server receives one entry that both localizes the stage and links the detailed evidence.
Third, the two genuine gaps (A and B above) get their checks implemented *here* rather
than as two more single-purpose detectors, since neither has meaningful tuning beyond a
duration threshold. Fourth, it stays observation-shaped: one issue type with a `stage`
discriminator, mirroring how `SelectedIcePath` classifies while `IceTupleChangeDetector`
detects.

### Guards the classifier must respect

The chain-walk is only sound when "no progress" is abnormal, so every boundary inherits
the specialist guards: a paused producer / `track.muted` / `readyState !== 'live'`
silences the whole send chain; an inactive simulcast layer is not a stalled encoder; a
static screen share legitimately encodes ~0 fps (compare against `sourceFps`, never
against wall clock); loss above the quiet threshold reassigns blame to the network
before any receive-side stage is accused; and a stats collection gap
(`StatsGapDetector`) invalidates the tick entirely.

### Browser caveats

Firefox reconstructs the transport report and omits several counters (the adapters
already normalize what they can), so boundary 3/5 checks must treat missing transport
byte counters as "cannot judge", falling back to candidate-pair deltas — the same
fallback `BlockedTransportDetector` uses. Safari lags on `framesRendered` and playout
stats; boundary 8 should no-op when the counters are absent rather than report a stall.

## 6. Suggested implementation order

1. `BlockedTransportDetector` + `NoAvailableIceCandidateDetector` (done — drafts under review).
2. Gap A and Gap B as boundary checks inside a new `MediaPipelineDetector`, raising
   `media-pipeline-stalled` with `stage: 'rtp-sender'` / `stage: 'transport-demux'`.
3. Extend the classifier to the already-covered boundaries as pure *classification*
   (never raising when a specialist already raised, only linking), so the sample gains
   the "first broken stage" verdict without duplicate issues.
