# Connection and client health detectors

The detectors bound to a peer connection, its ICE transports, and the client as a
whole: connectivity, transport quality, and the machine underneath.

For the same detectors organised by *detection shape* rather than by subject, see
[DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md); the deep references are
[CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md) and
[TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md).

## Connection & client health

> This group spans three categories. The transport-quality four are in
> [docs/TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md),
> the ICE and DTLS detectors in
> [docs/CONNECTIVITY_DETECTORS.md](./CONNECTIVITY_DETECTORS.md), and the two
> stage-boundary detectors at the end in
> [docs/PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md).
>
> **The connectivity layer model.** The ICE and DTLS detectors below are not an
> assorted pile — they are the five layers a WebRTC connection climbs before
> media flows (reachability → discovery/traversal → path establishment → secure
> transport → path continuity), where **an issue belongs to the first layer
> whose proof fails**. That is what keeps "the user cannot connect" from
> producing five issues that all mean approximately the same thing. A layer holds
> **one class per issue**, not one class per layer: layer 5 holds four classes,
> layers 3 and 4 two each, and the order they are registered in carries no
> meaning, because no detector reads another's conclusion.
>
> There is no longer a sixth "media flow" layer.
> The blocked-media detectors moved to **Transport
> Quality**, because every connectivity stage completes and holds while it fires
> — the path is simply not delivering, which is Transport Quality's membership
> test rather than Connectivity's.
>
> **Category is not subject**, which is the one thing to know before reading the
> map: [`IceTraversalDetector`](#icetraversaldetector) and the two in
> [the restart loop](#the-restart-loop) are **Telemetry** even though their
> subject is connectivity and they are documented with the layer model, because a
> restart is what a healthy application *does* and a relay path is a cost rather
> than a fault. See
> [docs/DETECTOR_TAXONOMY.md](./DETECTOR_TAXONOMY.md#category-is-not-subject).
>
> Reading a failed session: **start at the lowest layer that raised an issue**;
> everything above it is downstream of that failure.


### UplinkCongestionDetector

Reports this endpoint's **sending** path running out of room — the cause behind collapsing outgoing resolution and the far end saying you are breaking up. Use it to tell "this user's upload is the problem" apart from a decoder, a camera, or the far end's own link.

The browser reporting the encoder bandwidth limited decides *whether* this is congestion. Two witnesses decide how deep it is, each already a fraction of this connection's own normal, so neither needs a scale configured:

- `undershoot` — how far `availableOutgoingBitrate` has fallen below the highest it recently reached.
- `pacerBloating` — how far mean pacer time per packet sits above its own running median, with four times the median as the top of the scale.

They combine as a **geometric mean**, so a witness at its healthy level takes the severity to zero rather than merely failing to add. That is what rules out the look-alike: a muted camera, a replaced track or a still screen share drags the estimate down — an estimator cannot probe above what is being sent — but the pacer stays empty, so the severity stays at zero.

**Use the result:** reduce what you send — lower simulcast layers or cap the bitrate — and show a network-quality indicator. The payload carries the estimate now and the maximum it fell away from, which sizes *how much* to back off.

```javascript
uplinkCongestionDetector: {
    minSeverity: 0.65,   // how deep the trouble has to be before reporting it, 0..1
}
```

```typescript
monitor.on('uplink-congestion', ({ availableOutgoingBitrate, recentMaxAvailableBitrate, severity }) => {
    sender.capBitrate(availableOutgoingBitrate * 0.8);
    ui.setNetworkIndicator(severity > 0.8 ? 'bad' : 'poor');
});
```

**It never rests on `qualityLimitationReason` alone, and that is the point.** The browser saying the encoder is bandwidth limited is nearly always true on a real call, so as a gate it is a filter rather than a claim. Its *absence* is what closes the finding, and there is no recovery threshold on any bitrate: nothing knows what the path can carry after it narrows, so a link that settles at half its old capacity has recovered, and a ratio against its old maximum would never say so. The recent maximum forgets instead — it decays on a half-life, and fades faster for 30 seconds after an episode closes, since a path rarely gives back all of what one took.

Where the browser computed no estimate, or reports no limitation verdict, the detector sets [`inputsUnavailable`](./DETECTORS.md#when-a-detector-cannot-see-its-inputs) rather than reading as a healthy path. `PeerConnectionMonitor.uplinkCongested` moves with the finding, and `uplinkVideoCongestionSeverity` carries the continuous reading beside it.

### DownlinkCongestionDetector

The receiving counterpart, and it had to be rebuilt rather than mirrored: **there is no bandwidth estimate on a receiver.** `availableIncomingBitrate` is specified but absent on Chrome, whose congestion control is send-side — the estimate for your downlink is computed at the far end's sender and never reaches you. It is used here in no form.

Two witnesses again, from what actually arrived:

- `undershoot` — how far `receivingBitrate` has fallen below the highest it recently reached.
- `bufferBloating` — how far the per-frame video jitter buffer delay sits above its own running median.

Same geometric mean, and it separates the same two conditions: a far end that was **asked for less** — a muted camera, a dropped simulcast layer, a screen share of a still slide — undershoots with the buffer flat.

```javascript
downlinkCongestionDetector: {
    minSeverity: 0.65,   // opens at this severity, closes when it falls back under half of it
}
```

**Nothing here gates on `qualityLimitationReason`**, unlike the uplink detector. That verdict describes this endpoint's *encoder*, so reading it would make a receive-only connection — a webinar attendee, a spectator — permanently blind, which is the population most in need of a downlink verdict.

`PeerConnectionMonitor.downlinkCongested` and `downlinkVideoCongestionSeverity` publish the verdict and the reading. Where there is no inbound video, or no frame left the buffer to measure, the detector says so rather than reading as healthy.

### CongestionDetector *(deprecated)*

The single whole-connection detector both of the above replace. It is still registered, still raises `congestion`, and still reads `congestionDetector.sensitivity` — but it answers for both directions from one signal, which a receiver cannot support: Chrome computes no incoming bandwidth estimate, so its incoming fields read zero there rather than absent. It is also permanently silent on Firefox, which does not implement `qualityLimitationReason`, and unlike its replacements it does not set `inputsUnavailable` — so that silence is indistinguishable from a healthy path, and a dashboard counting `congestion` per browser reads Firefox as the best-behaved population on the fleet.

```javascript
congestionDetector: null,   // switch it off and read the two directional detectors instead
```

**The `congestion` event survives the split.** Both new detectors emit it alongside their own event, discriminated on `direction` (`'uplink'` | `'downlink'`) and carrying the whole payload of whichever fired — so an application that only dims a network badge keeps one listener, while one that acts on the cause reads the direction-specific event. A connection congested both ways fires it twice, once per direction.

### Transport quality detectors

The path is established, ICE is connected, DTLS completed — and the transport is still the reason the call is bad. Congestion was the only detector here for a long time; it is now one per direction, and three more cover the properties of a working path that had no owner at all.

> Full reference for all of them — where each number is derived, the shared two-threshold shape, the false positives and what each one refuses to claim: [docs/TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md).

| Property | Detector | Issue | The question |
|---|---|---|---|
| Capacity, sending | [`UplinkCongestionDetector`](#uplinkcongestiondetector) | `uplink-congestion` | Is this endpoint's upload running out of room? |
| Capacity, receiving | [`DownlinkCongestionDetector`](#downlinkcongestiondetector) | `downlink-congestion` | Is its download? |
| Delay | `TransportDelayDetector` | `transport-delay-degraded` | Does the round trip take too long? |
| Delivery reliability | `TransportLossDetector` | `transport-loss-sustained` | Are packets being dropped? |
| Delivery, at all | [`BlockedInboundMediaDetector`](#the-blocked-media-detectors), [`BlockedOutboundMediaDetector`](#the-blocked-media-detectors), [`BlockedStunRequestsDetector`](#the-blocked-media-detectors) | `blocked-inbound-media-transport`, `blocked-outbound-media-transport`, `blocked-stun-requests` | Are they being dropped *completely*, by policy? |

**`transport-delay-degraded`** reads the mean round trip over `pcMonitor.slicedWindow` — `totalRoundTripTime` over the measurements that produced it — because a single inflated RTT sample is common and means nothing. It prefers the RTCP round trip and falls back to ICE, deciding that per reading rather than latching it, so an RTCP stream that stops being reported does not leave the detector thresholding a frozen number. The detection window is the sustain and the recovery window behind it is the hysteresis: the mean must reach `thresholdInMs` to raise, and the preceding span must read below `recoveryThresholdInMs` to clear, so a call sitting on the line does not flap the issue open and shut. Round trip around 300 ms is where turn-taking starts to break down; ITU-T G.114 puts one-way "generally acceptable" at 150 ms. Note that **RTT to an SFU is a half-path measurement** and never sees the far leg — this is evidence about *this endpoint's* path and must not be presented as end-to-end latency.

**`transport-loss-sustained`** watches both directions with one threshold and reports whichever is worse, with the direction in the payload. Loss has always been visible to this library, but only as somebody else's qualifier: it gated the old `CongestionDetector`'s low-sensitivity mode and stands `DecoderPerformanceDetector` down so it does not blame a decoder for a network fault. Neither makes a claim *about the loss*, so nothing could raise it, resolve it, or count it. The means it reads — `avgInboundFractionLost` and `avgOutboundFractionLost` — exclude streams that carried nothing this tick rather than counting them as healthy; without that gating, a call with eight muted tracks and one bleeding one looks fine.

**There is no jitter detector here, deliberately.** Inter-arrival jitter is the one transport measurement in this category with no opinion attached to it: `PeerConnectionMonitor.avgInboundJitterInMs` is published for anyone who wants it, and nothing thresholds it. A `TransportJitterDetector` did exist during 4.9.0 development and was removed before release, because NetEQ's target delay is the receiver's mechanical response to jitter — so it and [`audio-jitter-buffer-stress`](./DETECTORS.md#jitterbufferstressdetector) move together by construction, and co-firing confirmed nothing — and because an unweighted mean of audio and video jitter is a poor number to threshold, video's being inflated by frame bursting. Uneven delivery is reported where it is actually felt: [`audio-jitter-buffer-stress`](./DETECTORS.md#jitterbufferstressdetector) for a listener, `downlink-congestion`'s buffer-bloating witness for a viewer.

```javascript
transportDelayDetector: {
    thresholdInMs: 300,          // mean RTT at or above which the path counts as slow
    recoveryThresholdInMs: 200,  // RTT below which it resolves
},
peerConnectionWindow: {
    numberOfSamples: {
        detection: 2,            // the collections the raise mean is taken over ...
        recovery: 2,             // ... and the ones behind them that have to agree to clear
    },
    maxAllowedGapInMs: 4000,     // longer than this between collections and the run restarts
},
transportLossDetector: {
    threshold: 0.05,             // mean interval loss fraction (0..1)
    recoveryThreshold: 0.01,
    durationInMs: 6000,
},
```

```typescript
monitor.on('transport-delay-degraded',    ({ rttInMs })              => ui.setNetworkIndicator('slow', rttInMs));
monitor.on('transport-loss-sustained',    ({ fractionLost, direction }) => metrics.gauge(`loss.${direction}`, fractionLost));
```

**None of the three reads any other.** They will co-fire when several are true, and that is the honest answer: a path can be uncongested and slow (a long physical route, a relay on the wrong continent) or congested and short; a well-behaved congestion controller produces a congested path with very little loss, while a lossy wireless link produces loss with no congestion signal at all.

Both new detectors set `inputsUnavailable` when the browser reports nothing to judge, so "no issue" and "no measurement" stay distinguishable.

**Threshold caveat.** These are round starting points meant to be tuned against a real fleet, not measurements of anything.

**Sources:** [ITU-T G.114 (one-way transmission time)](https://www.itu.int/rec/T-REC-G.114) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### CpuPerformanceDetector

> Filed under **Pipeline Disruption** even though it names a cause rather than a boundary — the one strained member of that category, and [the taxonomy says why it is kept there anyway](./PIPELINE_DISRUPTION_DETECTORS.md#across-both-chains--the-machine).

Client-wide CPU pressure, read as **codec utilization**: the share of stats time this endpoint spent inside encoders and decoders, summed across streams. One number, one threshold — a machine whose media pipeline is spending `utilizationThreshold` of the clock in codec work is a machine with nothing left for anything else.

**Use the result:** shed load in order of user impact — disable background blur/effects first, then reduce rendered remote videos, then lower capture resolution. Resolve restores them.

```javascript
cpuPerformanceDetector: {
    utilizationThreshold: 0.15,   // both halves of the pipeline in codec work this share of the time
}
```

The payload carries `minUtilization`, so a consumer can tell a machine barely over the line from one pinned. Note that the score calculator shipped with the library does not charge for `cpulimitation` at all — the finding is reported and sampled, but a custom calculator is what would price it.

```typescript
monitor.on('cpulimitation', () => effects.disableBackgroundBlur());
monitor.on('issue-resolved', (issue) => {
    if (issue.type === 'cpulimitation') effects.restore();
});
```

**Sources:** [Power-up getStats for client monitoring (webrtcHacks)](https://webrtchacks.com/power-up-getstats-for-client-monitoring/) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### IcePathEstablishmentDetector

Emits `'ice-path-establishment-slow'` (and the `LONG_PC_CONNECTION_ESTABLISHMENT` client event) when a peer connection stays in `connecting` past the threshold. Re-arms on any exit from `connecting`, so slow *retries* are reported too. Since 4.8.0 the payload names *where* setup is stuck via `stalledStage` — `'ice-gathering'`, `'ice-checking'`, `'dtls'` or `'unknown'` — because `connecting` covers ICE and the DTLS handshake alike, and the two have different fixes.

**It raises no issue, on purpose:** saying establishment is slow is not yet a claim that it has failed. That claim belongs to [`IceEstablishmentFailedDetector`](#iceestablishmentfaileddetector), the other half of layer 3, with its own threshold well past this one's. The `never-established` ICE restart recommendation used to live here too; it now belongs to [`IceRestartRecommendationDetector`](#the-restart-loop) alongside the other three restart reasons, so that the rate limiting across all four is shared — and since 4.9.0 its threshold and cooldown live in that detector's own config block rather than in this one, so `icePathEstablishmentDetector: null` no longer silences the recommendation.

**Use the result:** show "connecting is taking longer than usual"; if it repeats, retry with `iceTransportPolicy: 'relay'` to test whether direct connectivity is the blocker. `stalledStage` says whether to look at the network (`ice-gathering`, `ice-checking`) or at certificates and DTLS interop (`dtls`).

```javascript
icePathEstablishmentDetector: {
    thresholdInMs: 5000,  // `connecting` for this long is reported
    createEvent: true,    // also buffer LONG_PC_CONNECTION_ESTABLISHMENT into samples
}
```

**Sources:** [RTCPeerConnection.connectionState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState) · [ICE (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/ice/)

### IceEstablishmentFailedDetector

The other half of layer 3, and the one that produces an issue: `ice-establishment-failed` is **the call that never connected** — by a wide margin the most common connectivity failure a user actually reports, and until this detector existed the one thing the library could not put in `activeIssues`. Layer 3 emitted an event when establishment dragged on, but an event is a notification: it is gone the moment it fires, it does not resolve, and nothing asking "what is wrong with this session right now" could see it. So the single most user-visible failure produced an empty issue list, which reads as a healthy call.

Three facts must hold together, none sufficient alone, for the whole of `thresholdInMs` of accumulated stats time:

-   **Local candidates exist** — so this is emphatically not the no-network case, which [`IceReachabilityDetector`](#icereachabilitydetector) owns. The two are mutually exclusive by construction rather than by suppression.
-   **The peer connection never reached `connected`** — so this is establishment failing, not a working call that later broke, which the [layer-5 detectors](#the-layer-5-detectors) own.
-   **No candidate pair was ever nominated or reached `succeeded`** — which separates "checks are still running and might yet win" from "nothing ever won". The check is *latched*: a pair that won once is proof establishment got there, however the pair looks on any later tick.

The default 15 s sits well past `icePathEstablishmentDetector.thresholdInMs` on purpose — a connection that is merely slow has to be given time to stop being merely slow. Measuring in stats time rather than wall clock matters here more than almost anywhere: ICE checking legitimately takes seconds, and a wall-clock threshold would punish a slow collection rather than a slow connection.

**The payload carries what was tried, not only that it failed** — which is where the candidate types and pair states this library has collected since forever finally earn their place:

| `localCandidateCounts` shows | Reading |
|---|---|
| host only | Gathering never reached a STUN server |
| host + srflx, no relay | TURN was never configured or never answered — the most common cause of a call that fails only between certain networks |
| relay present, every pair `in-progress` or `failed` | The relay is unreachable, or the far end never answered the checks |

`candidatePairStates` is every distinct pair `state` seen, deduplicated and sorted, and `candidatePairCount` how many there were.

```javascript
iceEstablishmentFailedDetector: {
    thresholdInMs: 15000, // stats time the connection must go on failing to establish
}
```

```typescript
monitor.on('issue', (issue) => {
    if (issue.type !== 'ice-establishment-failed') return;
    const { localCandidateCounts, candidatePairStates } = issue.payload;
    if (localCandidateCounts.relay === 0) ui.showBanner('This network needs a TURN relay to connect');
    reportToServer('establishment-failed', { localCandidateCounts, candidatePairStates });
});
```

**What it will not claim:** which side is at fault. Every fact here is local — what this endpoint gathered and how its own checks went — and a far end that never sent an answer looks exactly like a far end whose candidates cannot be reached. The counts are evidence for a human or for server-side correlation, not a verdict.

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### The layer-5 detectors

Runtime health of a path that **already worked**, per ICE transport — a peer connection without BUNDLE has several and they fail independently. Four classes, four issues, four config keys — `iceDisconnectedDetector`, `iceConnectionFailedDetector`, `iceTransportStalledDetector`, `unstableIcePathDetector` — each of which removes exactly its own class when set to `null`.

| Class | Issue | Raised when |
|---|---|---|
| `IceDisconnectedDetector` | `ice-disconnected` | `disconnected` outlasted `disconnectedThresholdInMs` |
| `IceConnectionFailedDetector` | `ice-connection-failed` | `iceState` reached `failed` — immediately, since it is terminal for the generation |
| `IceTransportStalledDetector` | `ice-transport-stalled` | Still sending on a succeeded pair of a connected transport, nothing coming back, after inbound had been seen |
| `UnstableIcePathDetector` | `unstable-ice-path` | `pathSwitchThreshold` selected-path switches inside `pathSwitchWindowInMs` |

Each keeps its own per-transport state and each reads the ICE local username fragment itself to notice a new generation, rather than asking `IceRestartDetector` — so none depends on another or on the order they run in. That is about twenty duplicated lines per class, and it is deliberate.

**`ice-disconnected` waits; `ice-connection-failed` does not.** `disconnected` on its own is never worth an issue: it is what a browser says when consent checks have missed for a moment, and a Wi-Fi roam or a brief radio dropout produces it several times in an ordinary call while ICE quietly recovers. Only duration separates the blip from the outage. `failed` is the opposite — the browser will not retry candidates on its own, so there is nothing to wait out. A transport falling from `disconnected` into `failed` does *not* resolve the disconnection issue: it has not recovered, it has got worse.

**`ice-connection-failed` carries `everConnected`**, and that field is the reason the issue is worth reading rather than just counting. `IceTransportMonitor.everConnected` is a latch — set the first time the transport reads `connected` or `completed`, never cleared — so it is the transport's own record rather than an inference. `failed` alone conflates two faults that share a state and share nothing else:

| `everConnected` | Meaning | Where to look |
|---|---|---|
| `false` | The path **never worked**: no candidate pair ever won | Symmetric NAT with no TURN, a firewall eating the checks, a TURN credential the client never got |
| `true` | The path **worked and was lost** | The network underneath: the interface changed, the NAT binding expired, the route died |

**`ice-transport-stalled` is the quiet failure**: every state reads healthy while the transport keeps sending and receives nothing back. No state machine will ever report it, because as far as the browser is concerned nothing has gone wrong. Our own outbound traffic is what makes the expectation defensible — a live path returns at least STUN consent responses and RTCP for whatever we send. The mirror case, silence in *both* directions, is deliberately **not** reportable: it cannot be told apart from a legitimately idle connection. Two guards keep it off send-only transports, which is the ordinary shape of an SFU uplink: inbound traffic must have been seen on the transport before, and inbound RTP must be attributed to it at all.

**`unstable-ice-path` counts switches as the larger of two sources.** Diffing `selectedCandidatePairId` tick to tick is portable but blind to a flap that departs and returns inside one collecting period; the browser's own `selectedCandidatePairChanges` delta (Chrome 80+, Firefox 155+) sees exactly those but is absent on Safari. Taking the maximum uses the better evidence where it exists and still works where it does not; the payload carries the native count separately as `nativePairChanges`. The window is *tumbling*, not sliding — each tick adds the transport's `deltaTime`, and once `pathSwitchWindowInMs` accumulates both counters reset. Three switches in thirty seconds is reasoned rather than arbitrary: a legitimate handover produces one, occasionally two, and consent checks run roughly every five seconds, so three means no path survived even a few consent intervals.

```javascript
iceDisconnectedDetector:     { disconnectedThresholdInMs: 5000 },   // how long `disconnected` may self-heal
iceConnectionFailedDetector: {},                                    // terminal state, nothing to tune
iceTransportStalledDetector: { transportStallThresholdInMs: 5000 }, // sending-but-not-receiving tolerance
unstableIcePathDetector: {
    pathSwitchWindowInMs: 30000,       // window for counting selected-path switches
    pathSwitchThreshold: 3,            // switches in the window => unstable path
}
```

```typescript
monitor.on('issue', (issue) => {
    if (issue.type !== 'ice-connection-failed') return;
    // "never worked" and "worked and was lost" need different evidence and different fixes
    reportToServer(issue.payload.everConnected ? 'path-lost' : 'path-never-worked', issue.payload);
});
```

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [RFC 7675: STUN consent freshness](https://datatracker.ietf.org/doc/html/rfc7675) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

### The restart loop

Two classes sit beside the connectivity ladder rather than on it. Neither raises an issue and neither ever will: a restart is a fact about the connection, not a fault — restarts are exactly what a healthy application does when a network changes underneath a call, so an issue would flag the recovery rather than the problem.

`IceRestartRecommendationDetector` names *when* an ICE restart is warranted; performing it is the application's job, because only the application knows whether renegotiation is safe right now, whether signalling is even up, and what an SFU on the other end expects. Four conditions warrant one, and they live in one class because they answer one question — *would starting ICE over help?* — and because the rate limiting only means anything if it is shared. Two detectors each politely waiting out their own cooldown produce twice the nagging.

| `reason` | Scope | Waits for |
|---|---|---|
| `ice-failed` | per transport | Nothing — ICE never self-heals from `failed`. |
| `ice-disconnected` | per transport | `iceRestartRecommendationThresholdInMs`. |
| `transport-stalled` | per transport | `iceRestartRecommendationThresholdInMs`. |
| `never-established` | per peer connection | `restartRecommendationThresholdInMs`. |

`never-established` is measured against `connectingStartedAt` rather than any transport clock, because the fault is the absence of a working transport — there may be none in a reportable state, or none at all. It yields to `ice-failed` and `ice-disconnected`: a transport in either state names what went wrong, where "it never connected" only names what did not happen.

**All four thresholds and cooldowns live in one block of its own**, `iceRestartRecommendationDetector`, and they are its own rather than borrowed from the detectors that raise the corresponding issues — recommending a renegotiation is a different decision from reporting a fault, and it is normal to want the advice to wait longer than the issue did. It used to read the `never-established` pair out of `icePathEstablishmentDetector` and the per-transport pair out of the path-stability key, so each half was gated by a different neighbour. Both halves now run whenever this key is set, and `iceRestartRecommendationDetector: null` is the one way to silence any of it:

```javascript
iceRestartDetector: { createEvent: true },
iceRestartRecommendationDetector: {
    createEvent: true,
    iceRestartRecommendationThresholdInMs: 10000, // per transport: disconnected / stalled
    iceRestartRecommendationCooldownInMs: 15000,
    restartRecommendationThresholdInMs: 10000,    // per pc: never established at all
    restartRecommendationCooldownInMs: 15000,
}
```

Every verdict here is reached from raw transport and connection state, never by asking the layer-5 detectors what they concluded — which is why the stall condition and all its guards are written out a second time in this class. A restart already in flight suppresses further recommendations until it resolves, since asking for a second while the first is still negotiating is how an application ends up in a restart loop.

`IceRestartDetector` then reports what happened. The evidence is a changed ICE local username fragment, which is renegotiated per generation and is the one field a restart cannot leave alone — an inference, not a report, since the browser exposes no "a restart happened" signal and stats cannot separate one the application asked for from one the browser started itself. Firefox's transport report is reconstructed by `FirefoxStatsAdapter` and carries no fragment, so the detector falls back to the selected local candidate's `usernameFragment` and stays silent when neither exists. Three outcomes are emitted rather than one, because "a restart was attempted" and "the restart worked" are different facts:

| `outcome` | Meaning |
|---|---|
| `detected` | A new generation was observed. |
| `recovered` | That generation reached `connected` / `completed`. |
| `failed` | That generation reached `failed`. A generation still checking has no outcome yet, and none is invented for it. |

```typescript
monitor.on('ice-restart-recommended', ({ peerConnectionMonitor, reason, recommendationCount }) => {
    if (recommendationCount >= 3) return session.rejoin(); // restarts are not helping
    rtcPeerConnection.restartIce();                        // or mediasoup transport.restartIce()
});
monitor.on('ice-restart', ({ outcome }) => metrics.count(`ice-restart.${outcome}`));
```

A rising `recommendationCount` against a flat `iceGeneration` is what tells you the advice is not being taken; a rising count *with* a rising generation says restarts are being performed and are not working, which is the escalation-to-rejoin signal.

**Sources:** [ICE restart: recovering connectivity (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/ice-restart/) · [RTCPeerConnection.restartIce (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce) · [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445)

### The blocked-media detectors

> **Transport Quality**, not Connectivity — all three *require* every connectivity stage to have completed before they will judge. Full reference: [docs/TRANSPORT_QUALITY_DETECTORS.md](./TRANSPORT_QUALITY_DETECTORS.md).

The firewall signature: a middlebox that lets ICE/STUN through but blocks the media itself. Every connectivity signal looks healthy and yet the call carries nothing. The other detectors structurally miss this case — STUN consent responses count into the pair's `bytesReceived`, so the pair never looks dry and [`ice-transport-stalled`](#the-layer-5-detectors) never fires, while the dry-track detectors see outbound-rtp counters advancing and stay silent.

One class per direction of the proof, each on `IceTransportMonitor.detectors`, so one instance judges one transport:

| Detector | Issue | What it proves |
|---|---|---|
| `BlockedStunRequestsDetector` | `blocked-stun-requests` | The path stopped answering STUN while we were still asking — a total block, an expired NAT binding, or the network vanishing under the socket |
| `BlockedOutboundMediaDetector` | `blocked-outbound-media-transport` | Our media leaves on a path whose STUN *is* still answered, and no receiver report ever comes back — a selective block in the send direction |
| `BlockedInboundMediaDetector` | `blocked-inbound-media-transport` | The far end keeps telling us it sends, with a rising packet count, and our receivers take nothing off the wire |

**Why the split is three classes and not one.** The three have different proofs, different failure modes and different registration. `blocked-stun-requests` needs the pair to have reached `succeeded` first — a path that never answered is ordinary establishment failure and belongs to [`IceEstablishmentFailedDetector`](#iceestablishmentfaileddetector). `blocked-outbound-media-transport` rests on the far end's *silence* rather than its numbers: with `rtcp-mux`, whatever drops our media drops the reports about it, so a zero packet count is never observed, and `remote-inbound-rtp.deltaTime` is read three ways — positive means a report just arrived, `0` a frozen one served again, `undefined` that none ever came, and only the first clears the window.

**`BlockedInboundMediaDetector` is the one detector not registered unless you ask for it.** It only fires where RTCP survives whatever killed the media, which `rtcp-mux` — required by current browsers — makes rare: the far end's sender reports normally share the fate of its media. Where it *can* fire it is the strongest inbound evidence available, because the sender is still testifying. Supply the key to turn it on.

```javascript
blockedStunRequestsDetector: {},   // {} enables with defaults, null removes
blockedOutboundMediaDetector: {},
blockedInboundMediaDetector: {},   // off unless you supply the key
```

```typescript
monitor.on('blocked-stun-requests', ({ iceTransport }) => {
    // signalling is fine and the media path is gone — a firewall, not a bad network
    ui.showFirewallHelp();
});
```

**Nothing is gated on media having flowed successfully first.** A blocked transport is normally blocked from its first packet — the user is behind a corporate firewall, nothing gets out, and reloading puts them behind the same wall — so any "it was working and then stopped" bar would switch the detectors off in the case they exist for.

Timing is each transport's own `deltaTime`, so a stalled main thread is not counted as silence. While `blocked-stun-requests` is open the transport is marked `blocked`. A replaced transport gets detectors whose clocks start at zero; a transport that goes away takes its detectors with it, leaving the issue open, as with every monitor-bound detector.

**The `blocked-transport` monitor event survives**, emitted by `BlockedStunRequestsDetector`, so an existing listener keeps firing. The *issue* type of that name is gone; narrow on `blocked-stun-requests` instead.

### The DTLS detectors

Layer 4 separates "the network path failed" (the ICE detectors' territory) from "the secure media transport never negotiated", which nothing owned before: a certificate fingerprint mismatch, DTLS version intolerance, or a middlebox that passes STUN but eats DTLS all used to present as a generically slow `connecting`.

Two classes, per ICE transport, each with a config key of its own — because the browser announcing a verdict and the browser saying nothing at all are different problems with different evidence, and either can now be switched off without the other.

`DtlsHandshakeFailedDetector` raises **`dtls-handshake-failed`** on the first tick reporting `dtlsState: 'failed'`. There is nothing to wait for and nothing to average — `failed` is the browser's terminal verdict on this key exchange — so there is no maturity guard and no duration threshold, and the issue is raised once per transport rather than once per tick. Only a later `connected` resolves it, which in practice means an ICE restart re-ran the handshake and the new generation succeeded; a transport dropping back to `new`/`connecting` after a restart is not yet evidence of anything, so the issue stays open until one actually completes. Its `dtlsHandshakeFailedDetector` block is empty by design: `failed` is not a matter of degree, so there is nothing here to tune — `{}` enables the detector, `null` removes it.

`DtlsHandshakeStalledDetector` raises **`dtls-handshake-stalled`** when the ICE side is proven healthy while `dtlsState` sits in `new`/`connecting` past `stalledThresholdInMs`. This is the half with no verdict to read: a handshake being eaten by a middlebox and one that is a few hundred milliseconds from completing look identical in a single stats report, and only duration separates them — accumulated in stats time, so a collection that ran late credits the handshake with exactly the time it spent quiet.

The ICE-health proof is what keeps the layer honest, since DTLS cannot complete over a path that is not yet usable and reporting it would mean re-reporting what the ICE detectors already own. It has two forms, and the payload's `iceEvidence` records which one carried it — a finding resting on the weaker of them is worth less to whoever reads it:

| `iceEvidence` | Meaning |
|---|---|
| `transport-ice-state` | The transport reported `iceState` `connected`/`completed`. |
| `selected-pair-succeeded` | No `iceState` reported (Safari, and the transport reconstructed for Firefox < 153); the selected pair being `succeeded` stood in. |

What the stall detector will not judge: a transport on its first observed tick (Firefox 153/154 report pre-negotiation transport values that only 155 makes trustworthy); `dtlsState: 'closed'`, which is a shutdown, not a failure; and a transport whose ICE side is not proven healthy, where the ICE detectors own whatever is wrong. An inferred ICE restart clears the stall timer, since the new generation re-runs the handshake and deserves the full threshold rather than inheriting the old one's.

```javascript
dtlsHandshakeFailedDetector: {},  // terminal state, nothing to tune
dtlsHandshakeStalledDetector: {
    stalledThresholdInMs: 6000,   // ICE healthy, DTLS still `new`/`connecting` for this long
}
```

**Use the result:** `dtls-handshake-failed` is a configuration or interop problem, not a network problem — check certificate fingerprints in signaling and TLS interception on the client's network; an ICE restart on the same path *can* help because it re-keys DTLS. Server-side, a failure rate concentrated on one browser version is a browser regression; concentrated on one customer network, a middleware/DPI policy.

**Sources:** [RTCDtlsTransport.state (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCDtlsTransport/state) · [RTCTransportStats (W3C webrtc-stats)](https://www.w3.org/TR/webrtc-stats/#transportstats-dict*) · [RFC 8827: WebRTC Security Architecture](https://datatracker.ietf.org/doc/html/rfc8827)

### IceReachabilityDetector

The other end of the connectivity spectrum: the client cannot even *begin* to connect because ICE gathering produced **zero local candidates**. A healthy establishment gathers a host candidate within milliseconds — even without internet, any up interface yields one. Zero candidates while the connection state jumps from `new`/`connecting` straight to `disconnected`/`failed` means there was nothing to connect *with*: no interface, airplane mode, a VPN that tore down every route. This is a different diagnosis from every other ICE issue — those describe a path that existed and stopped working; this one says no path was ever possible.

Raises `no-available-ice-candidate` (per peer connection) immediately on `disconnected`/`failed` with zero local candidates on a never-connected PC, and after `thresholdInMs` when the PC just sits in `new`/`connecting` with nothing gathered. Zero candidate rows count as evidence only once `iceGatheringState` reads `complete` — before that they mean gathering is still running, and where the field is absent they mean nothing was measured. Resolves when a local candidate appears or the connection reaches `connected`. Never fires on a connection that once connected — mid-call network loss belongs to [the layer-5 detectors](#the-layer-5-detectors), and an establishment that had candidates but never won a pair belongs to [`ice-establishment-failed`](#iceestablishmentfaileddetector). The two layer-1 and layer-3 issues are mutually exclusive by construction rather than by suppression.

```javascript
iceReachabilityDetector: {
    thresholdInMs: 6000, // grace for `new`/`connecting` before the sustained variant raises
}
```

**Use the result:** skip the ICE-restart dance entirely — recommend the user check their connection; on the server, treat the client as offline-at-join rather than call-quality-degraded.

**Sources:** [RTCPeerConnection.connectionState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState) · [RTCPeerConnection.iceGatheringState (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceGatheringState) · [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445)

### RtpSenderStalledDetector / TransportDemuxStalledDetector

Media moves through a fixed chain — capture → frame supply → encoder → RTP sender ‖ RTP receiver → frame assembly → decoder → renderer — every stage carries a monotonic counter proving progress, and a disruption is *locatable* as the boundary where the upstream counter advances and the downstream one stays flat. Most boundaries are owned by specialist detectors; these two cover the ones nothing else does. The whole chain, boundary by boundary, is [docs/PIPELINE_DISRUPTION_DETECTORS.md](./PIPELINE_DISRUPTION_DETECTORS.md). Each has a config key of its own and raises its own issue:

| Class | Issue | The boundary |
|---|---|---|
| `RtpSenderStalledDetector` | `rtp-sender-stalled` | `deltaFramesEncoded > 0` while `deltaPacketsSent === 0` on the same outbound RTP — an encoded frame always packetizes, so a sustained violation is a wedged sender or pacer (seen after `replaceTrack` races and simulcast reconfigurations). State is kept per ssrc, since simulcast layers wedge one at a time. |
| `TransportDemuxStalledDetector` | `transport-demux-stalled` | The ICE transport receiving at or above `minTransportReceiveBitrateBps` — well above what RTCP + STUN can explain — while every inbound RTP attributed to it reports zero bytes. Traffic arrives that never reaches a stream: an SSRC mismatch after renegotiation, or a consumer created against a producer that is already gone. |

There is no `media-pipeline-stalled` issue any more, and no `stage` / `direction` discriminator: one class raises one issue type, and the two boundaries are different enough that folding them into one payload field never helped a reader decide anything. Neither class reads any issue but its own — the predecessor annotated every payload with a `suspectedIssueTypes` list of the other issues active on the peer connection, which made one detector's output a function of every other detector's verdicts and of the order they ran in. That field is gone. Correlating issues is the server's job, where the whole session is visible and `peerConnectionId` plus a time window does the same work properly.

The innocent explanations for silence on the wire — congestion, resolution adaptation, a paused sender — would all have stopped the *encoder*, so they cannot produce the send-side signature. What is refused outright: a closed peer connection, and an outbound RTP whose track is missing, muted or not live, or whose simulcast layer is inactive. On the receive side, the bitrate floor rules out RTCP and STUN explaining the arriving bytes, and without at least one inbound RTP there is no demux expectation to violate at all — a send-only transport has nothing to demux into by design.

```javascript
rtpSenderStalledDetector: {
    thresholdInMs: 4000,                  // stats time a broken boundary must persist
},
transportDemuxStalledDetector: {
    thresholdInMs: 4000,                  // its own copy of the same tunable
    minTransportReceiveBitrateBps: 20000, // above this, incoming traffic must demux
}
```

```typescript
monitor.on('rtp-sender-stalled',      ({ ssrc })        => sender.renegotiate(ssrc));
monitor.on('transport-demux-stalled', ({ transportId }) => sfuClient.recreateConsumersOn(transportId));
```

**Use the result:** `rtp-sender-stalled` → renegotiate or replace the sender (the encoder is fine, the pipe after it is wedged); `transport-demux-stalled` → recreate the consumers / re-signal SSRCs (the network is fine, the demux is not).

`transport-demux-stalled` reads `transport.receivingBitrate`, derived from the `RTCTransportStats.bytesReceived` Firefox does not populate as of 153, so it sets [`inputsUnavailable`](./DETECTORS.md#when-a-detector-cannot-see-its-inputs) on a tick where nothing demuxed and no receiving bitrate was reported — its silence there is "cannot see", not "nothing is wrong". `rtp-sender-stalled` compares `framesEncoded` against `packetsSent` on the same outbound RTP, both well supported everywhere, and has no such blind spot.

### IceTraversalDetector

The low-level primitive under the path detectors: emits `'ice-tuple-changed'` whenever the set of selected `local:remote` network tuples changes. It raises no issue by design — needing TURN is a cost, not a fault, and no threshold on tuple changes would be defensible, so its `iceTraversalDetector` block is empty: `{}` enables it, `null` removes it. Until 4.9.0 it had no key at all and was the one detector registered unconditionally. `SelectedIcePath` classifies *what kind of* change it was and emits `'ice-path-changed'`; [`UnstableIcePathDetector`](#the-layer-5-detectors) owns the issue raised when a path keeps switching. Growing from an empty tuple set is skipped, since establishment is not a change.

**Use the result:** debugging and logging — a tuple change with no `ice-path-changed` classification usually means a port change on the same interface.

**Sources:** [RFC 8445: ICE](https://datatracker.ietf.org/doc/html/rfc8445) · [TURN server: when you need it and what it costs (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/turn/) · [RTCIceCandidateStats.relayProtocol (MDN)](https://developer.mozilla.org/docs/Web/API/RTCIceCandidateStats/relayProtocol) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

## Observation detectors

These emit events and **never raise issues** — they record context that is not a fault but is the missing column in most investigations. Each reads a config block of its own, named after the detector, and each carries `createEvent` (default `true`), which buffers the matching client event into samples for server-side use; `statsGapDetector` adds the two thresholds that decide what counts as a gap.

> These are the **Telemetry** category. The full reference — every event payload, the change-detection rules, the Session and Endpoint facts that no detector carries at all, and the recorded gaps — is [docs/TELEMETRY_DETECTORS.md](./TELEMETRY_DETECTORS.md).

The membership test is deliberately counterfactual: *would raising an issue here ever be the right thing to do?* If the answer is no, it belongs here. A detector never lands here because of a bug or a missing implementation.

| Detector | Monitor event / client event | Use the result for |
|---|---|---|
| `CodecChangeDetector` | `codec-changed` / `CODEC_CHANGED` | Answering "why do all the bad calls use H264" — compares `sdpFmtpLine` too, so an H264 profile switch is caught. Fires once or twice per call. |
| `VideoResolutionChangeDetector` | `video-resolution-changed` / `VIDEO_RESOLUTION_CHANGED` | Following the adaptation ladder. On outbound tracks the event carries `qualityLimitationReason` — the field that separates encoder adaptation from your own constraint changes. Classified `upgrade` / `downgrade` / `reshape` (orientation flip). |
| `SimulcastLayerDetector` | `simulcast-layer-changed` / `SIMULCAST_LAYER_CHANGED` | Debugging "why is this participant blurry": a layer counts as active only if it *sent bytes*, so a layer the encoder quietly gave up on becomes visible. |
| [`CaptureTrackMutedDetector`](./DETECTORS.md#capture-detectors) | `capture-track-muted` / `CAPTURE_TRACK_MUTED` | Marking where capture stopped, so the silence and dry-track findings that follow stop looking mysterious. `track.muted` covers the deliberate system mute and the accidental device grab alike, which is why it is not an issue. Config: `captureTrackMutedDetector`. |
| `StatsGapDetector` | `stats-collection-gap` / `STATS_COLLECTION_GAP` | Discounting the metrics right after a backgrounded-tab / sleep gap instead of reading them as a network spike. |

Three connectivity detectors are telemetry too and are documented with their subject rather than here: [`IceTraversalDetector`](#icetraversaldetector), and the two in [the restart loop](#the-restart-loop). So is [`AudioPlayoutSynthesisDetector`](./DETECTORS.md#audioplayoutsynthesisdetector) — though that one is the exception the rule admits: it is a perceived-quality detector with a missing issue rather than telemetry, since a listener hearing invented speech across a sustained window *is* a fault worth raising.

```javascript
captureTrackMutedDetector: { createEvent: true },
codecChangeDetector: { createEvent: true },
videoResolutionChangeDetector: { createEvent: true },
simulcastLayerDetector: { createEvent: true },
statsGapDetector: {
    gapRatioThreshold: 2, // multiple of collectingPeriodInMs that counts as a gap
    minGapInMs: 5000,     // a single missed short tick is jitter, not a gap
    createEvent: true,
},
```

```typescript
monitor.on('video-resolution-changed', ({ trackMonitor, direction, to, qualityLimitationReason }) => {
    if (trackMonitor.direction === 'outbound' && direction === 'downgrade' && qualityLimitationReason === 'cpu') {
        // the encoder is shrinking the picture because of CPU, not bandwidth
        effects.disableBackgroundBlur();
    }
});
monitor.on('stats-collection-gap', ({ gapInMs }) => metrics.markUnreliableWindow(gapInMs));
```

**Sources:** [Simulcast (BlogGeek.me glossary)](https://bloggeek.me/webrtcglossary/simulcast/) · [Page Visibility API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) · [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/)

---

[← back to the detector reference](./DETECTORS.md) · [← back to the README](../README.md)
