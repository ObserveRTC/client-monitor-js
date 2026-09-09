# The monitor API

What `ClientMonitor` and the monitors under it expose to an application: how to
reach a monitor, how to walk from one stats object to another, how to read your
own metrics back off the monitor, and how to raise issues of your own.

The detector reference answers *what the library decides*. This answers *what you
can ask it*.

- [Reaching a monitor](#reaching-a-monitor)
- [Walking the graph](#walking-the-graph)
- [Extension stats — your own metrics on the monitor](#extension-stats--your-own-metrics-on-the-monitor)
- [Issues you raise yourself](#issues-you-raise-yourself)
- [Context an application declares](#context-an-application-declares)
- [Reading a score](#reading-a-score)

---

## Reaching a monitor

`ClientMonitor` holds peer connections; everything else is reached from one. Every
collection getter returns a **fresh array**, so hold the result rather than calling
it in a loop.

```typescript
monitor.peerConnections;      // PeerConnectionMonitor[]
monitor.tracks;               // TrackMonitor[]   — inbound and outbound, every connection
monitor.inboundRtps;          // InboundRtpMonitor[]
monitor.outboundRtps;         // OutboundRtpMonitor[]
monitor.remoteInboundRtps;    // RemoteInboundRtpMonitor[]
monitor.remoteOutboundRtps;   // RemoteOutboundRtpMonitor[]
monitor.iceTransports;        // IceTransportMonitor[]
monitor.codecs;               // CodecMonitor[]
monitor.certificates;         // CertificateMonitor[]
```

By id, when you already know which one you want:

```typescript
monitor.getPeerConnectionMonitor(peerConnectionId);
monitor.getTrackMonitor(trackId);                    // either direction

const pc = monitor.peerConnections[0];
pc.getTrackMonitor(trackId);
pc.getInboundTrackMonitor(trackId);
pc.getOutboundTrackMonitor(trackId);
```

`mappedPeerConnections` is the underlying `Map<string, PeerConnectionMonitor>` if
you want to iterate without allocating.

---

## Walking the graph

`getStats()` reports a flat list of objects that reference each other by id. The
monitors resolve those references for you, so a question like *"what codec is this
inbound stream using, and which ICE transport is carrying it?"* is two property
accesses rather than an id lookup.

Every accessor returns `undefined` when the browser did not report the link, or
when the object it points at has gone away.

| From | Accessor | To |
|---|---|---|
| any monitor | `getPeerConnection()` | `PeerConnectionMonitor` |
| `InboundRtpMonitor` | `getTrack()` | `InboundTrackMonitor` |
| | `getCodec()` | `CodecMonitor` |
| | `getRemoteOutboundRtp()` | `RemoteOutboundRtpMonitor` — the sender's own view |
| | `getMediaPlayout()` | `MediaPlayoutMonitor` |
| | `getIceTransport()` | `IceTransportMonitor` |
| | `getSelectedCandidatePair()` | `IceCandidatePairMonitor` |
| `OutboundRtpMonitor` | `getTrack()` | `OutboundTrackMonitor` |
| | `getCodec()` | `CodecMonitor` |
| | `getMediaSource()` | `MediaSourceMonitor` |
| | `getRemoteInboundRtp()` | `RemoteInboundRtpMonitor` — the receiver's report about us |
| | `getIceTransport()`, `getSelectedCandidatePair()` | as above |
| `InboundTrackMonitor` | `getInboundRtp()` | `InboundRtpMonitor` |
| | `getLinkedVideoTrack()` | the video track this audio track is paired with |
| `OutboundTrackMonitor` | `getMediaSource()` | `MediaSourceMonitor` |
| | `getOutboundRtps()` | `OutboundRtpMonitor[]` — one per simulcast layer |
| `MediaSourceMonitor` | `getTrack()`, `getOutboundRtps()` | the track and its layers |
| `IceTransportMonitor` | `getSelectedCandidatePair()` | `IceCandidatePairMonitor` |
| | `getInboundRtps()`, `getOutboundRtps()` | the streams attributed to this transport |
| | `getSelectedIcePath()` | `SelectedIcePath` |
| `IceCandidatePairMonitor` | `getLocalCandidate()`, `getRemoteCandidate()` | `IceCandidateMonitor` |
| `RemoteInboundRtpMonitor` | `getOutboundRtp()` | the local stream it reports on |
| `RemoteOutboundRtpMonitor` | `getInboundRtp()` | the local stream it describes |
| `CodecMonitor` | `getIceTransport()` | `IceTransportMonitor` |

A worked example — from a track a user is complaining about, to the path carrying it:

```typescript
const track = monitor.getTrackMonitor(trackId);
const rtp = track?.direction === 'inbound' ? track.getInboundRtp() : undefined;

const codec = rtp?.getCodec()?.mimeType;              // 'video/VP8'
const pair = rtp?.getSelectedCandidatePair();
const relayed = pair?.getRemoteCandidate()?.candidateType === 'relay';
const senderView = rtp?.getRemoteOutboundRtp();        // what the far end says it sent
```

**Simulcast.** An outbound track has several `outbound-rtp` streams.
`OutboundTrackMonitor.getOutboundRtps()` returns all of them and `highestLayer` is
the one carrying the most bits — which is the one to judge an encoder on.

---

## Extension stats — your own metrics on the monitor

Anything your application measures can be attached to the monitor, read back off
it later, and carried in the sample to your server.

```typescript
monitor.addExtensionStats({
    type: 'render-stats',
    id: 'tile-42',                  // giving an id is what makes it readable back
    payload: { droppedFrames: 3, canvasFps: 24 },
});

monitor.getExtensionStatsPayload<{ droppedFrames: number }>('tile-42')?.droppedFrames;  // 3
monitor.getExtensionStatsMonitor('tile-42')?.timestamp;                                 // when it was reported
```

**The `id` is what makes it a readable value.** Without one the payload still
reaches the sample, but nothing is kept on the monitor to read back — use an id
when the value is a *current reading* you want to consult later, and omit it when
you are emitting a one-off record.

**It is a current-value store, not a history.** Each id holds only the most recent
payload. A monitor is dropped one collection after the id stops being reported, so
a value reported once through `addExtensionStats` becomes unreadable on the second
collection after it; a value reported from a provider (below) lives as long as the
provider keeps reporting it.

To report every collection without wiring a timer, register a provider:

```typescript
monitor.extensionStatsProviders.add(async () => ({
    type: 'render-stats',
    id: 'tile-42',
    payload: { canvasFps: renderer.fps },
}));
```

Providers are awaited as part of each collection, so their values land in the same
tick as the `getStats()` they sit beside.

---

## Issues you raise yourself

Your application knows things the library cannot see — a failed signalling
request, a user reporting bad audio, a render loop falling behind. Those belong in
the same issue stream as the detectors' findings, so a server reading a session
sees one timeline.

```typescript
// A condition with a lifetime: raise it, resolve it when it clears.
monitor.raiseIssue('signalling-down', {
    type: 'signalling-unreachable',
    payload: { attempts: 3 },
});

monitor.isIssueActive('signalling-down');            // true
monitor.resolveIssue('signalling-down', { comment: 'reconnected' });

// A moment rather than a condition — no key, nothing to resolve.
monitor.addIssue({ type: 'user-reported-bad-audio', payload: { rating: 2 } });

monitor.getActiveIssuesByType('signalling-unreachable');   // RaisedClientIssue[]
monitor.activeIssues;                                       // everything open right now
```

Custom issues ride the same `'issue'` / `'issue-resolved'` events as built-in ones
and are buffered into the sample the same way. They are **not** priced by
`ISSUE_SCORING` unless you add a rule for them — `unscoredIssueTypes()` will list
any type that has none.

---

## Context an application declares

Some facts are not in `getStats()` and cannot be inferred. Declaring them turns a
detector on rather than merely tuning it.

```typescript
// How large a video is actually being shown — makes a blocky picture cost more
// full-screen than in a thumbnail.
monitor.setInboundTrackContext(trackId, { presentedResolution: { width: 1280, height: 720 } });

// Which audio and video tracks belong to the same participant.
// AVDesyncPlayoutDetector reports inputsUnavailable until this is declared:
// an SFU forwards them as independent streams with no signalled relationship.
monitor.setInboundTrackContext(audioTrackId, { linkedVideoTrackId: videoTrackId });

// A moving surface captured as a screen share, which should be judged like camera video.
monitor.setOutboundTrackContext(trackId, { contentType: 'camera' });
```

---

## Reading a score

```typescript
monitor.score;                       // 0.0 - 5.0 for the whole client
monitor.scoreReasons;                // { 'issue-type': cost, ... } for the last tick

monitor.peerConnections[0].calculatedStabilityScore;   // { value, reasons, weight }
monitor.tracks[0].calculatedScore;

monitor.on('score', ({ clientScore, currentReasons }) => { /* ... */ });
```

A score of `undefined` means *too few collections to judge yet*, which is a
different statement from `0`. See
[SCORE_CALCULATIONS.md](./SCORE_CALCULATIONS.md).

---

[← back to the README](../README.md)
