# Events and issues

# Events and Issues

`ClientMonitor` emits two different categories of notification: **issues**, which describe a problem state, and **events**, which describe a thing that happened. The two have different lifecycles and different APIs — picking the right one for your use case is the key to keeping your alerting code sane.

## Issues vs Events at a glance

|  | Issue | Event |
|---|---|---|
| Represents | An ongoing or one-shot condition (network congestion, dry track, …) | A discrete thing that happened (peer joined, ICE candidate found, …) |
| Lifecycle | Can be **raised**, **updated**, **resolved** | Immutable record |
| Resolution | Yes (for the stateful flavor) | No |
| API | `addIssue` / `raiseIssue` / `resolveIssue` | `addEvent` |
| Sample buffer | `sample.clientIssues[]` | `sample.clientEvents[]` |
| Emitted events on `monitor.on(...)` | `'issue'`, `'issue-updated'`, `'issue-resolved'` | `'client-event'` |

The rest of this section drills into the issue lifecycle; events are a thin wrapper around `addEvent` and need no further explanation.

## Two flavors of issue

`ClientMonitor` distinguishes a **one-shot issue** (fire-and-forget) from a **raised issue** (stateful, resolvable). Pick the flavor that matches your situation:

| Flavor | Method | Has `key` | Enters `activeIssues` | Can be resolved | Typical use |
|---|---|---|---|---|---|
| One-shot | `addIssue({ type, payload?, timestamp? })` | no | no | no | A logged event-like incident with no "ended" condition — `USER_MEDIA_ERROR`, a one-off SDK warning, a one-time alert you want included in the next sample. |
| Stateful | `raiseIssue(key, { type, payload?, timestamp? })` | **yes (required)** | yes | yes (`resolveIssue(key, …)`) | Anything with a start and an end: congestion, CPU pressure, audio desync, video freeze, dry track. The detectors that ship with the library all use this flavor. |

You're always free to choose either. The library only insists that *if* you want to resolve later, you must have raised with a `key`.

## In-memory types

Both flavors share `type` and `payload`. The stateful flavor adds the identity (`key`) and timestamps:

```ts
type ClientIssuePayload = Record<string, unknown> | boolean | string | number;

// What addIssue produces.
type AddedClientIssue<T = ClientIssuePayload> = {
    type: string;
    payload?: T;
    timestamp: number;
};

// What raiseIssue produces.
type RaisedClientIssue<T = ClientIssuePayload> = {
    type: string;
    key: string;           // globally unique handle within this monitor
    payload?: T;
    raisedAt: number;
    updatedAt: number;     // bumped on every re-raise of the same key
};

// Discriminated union over the two flavors.
type ClientIssue<T = ClientIssuePayload> = AddedClientIssue<T> | RaisedClientIssue<T>;

// What 'issue-resolved' delivers.
type ResolvedClientIssue<T = ClientIssuePayload> = RaisedClientIssue<T> & {
    resolvedAt: number;
    comment?: string;
};
```

Narrow between the two by checking for `'key' in issue` — that's the discriminant.

> **Wire format** (schema 3.5.0): `ClientSample.clientIssues[]` ships a stripped shape: `{ type, key?, payload?: Record<string, boolean | string | number>, timestamp }`. Payloads are flat records of primitives on the wire — never pre-serialised JSON strings — so nothing is stringified per issue or per event, and the server reads payload fields directly.

## Lifecycle: the events you can listen to

```ts
monitor.on('issue',          (issue: ClientIssue)         => /* … */);  // raised or added
monitor.on('issue-updated',  (issue: RaisedClientIssue)   => /* … */);  // re-raise of an active key
monitor.on('issue-resolved', (issue: ResolvedClientIssue) => /* … */);
```

| Step | When it fires | What's delivered |
|---|---|---|
| `raiseIssue('x', { type: 't', payload: … })` for an **unknown** `x` | New stateful issue created and stored in `activeIssues` | `'issue'` event with the new `RaisedClientIssue` |
| `raiseIssue('x', …)` for an **already-active** `x` | Existing entry's payload + `updatedAt` are refreshed in place; no duplicate | `'issue-updated'` event |
| `addIssue({ type, payload })` | New one-shot issue created; **not** added to `activeIssues` | `'issue'` event |
| `resolveIssue('x', { comment?, payload?, resolvedAt? })` | Active entry removed from `activeIssues`; optional `payload` overwrites the stored one (used by detectors to add `durationInMs`) | `'issue-resolved'` event |
| `monitor.close()` | All still-active issues auto-resolve | `'issue-resolved'` for each, with `comment: 'monitor closed before issue could be resolved'` |

## Public API on `ClientMonitor`

```ts
// One-shot, never enters activeIssues, cannot be resolved.
addIssue<T>(input: { type: string; payload?: T; timestamp?: number }): AddedClientIssue<T> | undefined;

// Stateful: enters activeIssues under `key`. Re-raising with the same key updates in place.
raiseIssue<T>(key: string, input: { type: string; payload?: T; timestamp?: number }): RaisedClientIssue<T> | undefined;

// Resolves a stateful issue by key. `input.payload`, when provided, overwrites the stored payload
// — that's how built-in detectors enrich the resolved record with `durationInMs`.
resolveIssue<T>(key: string, input: { comment?: string; payload?: T; resolvedAt?: number }): ResolvedClientIssue | undefined;

// Snapshot helpers.
getActiveIssuesByType(type?: string): RaisedClientIssue[];
isIssueActive(key: string): boolean;

// Public Map<key, RaisedClientIssue> — readable, mutable but should not be touched directly.
readonly activeIssues: Map<string, RaisedClientIssue>;
```

## The built-in detector issues

Most built-in detectors raise their own stateful issue with a typed payload, emit a detector-specific named event on entry, and resolve the issue when the condition clears — enriching the resolved payload with `durationInMs`. **One class raises exactly one issue type**, so the table below is also the list of issue-raising detector classes.

Ten classes are the exception and emit events only, because what they report is not a fault: `CodecChangeDetector`, `VideoResolutionChangeDetector`, `SimulcastLayerDetector`, `CaptureTrackMutedDetector`, `StatsGapDetector`, `IceTraversalDetector`, `IcePathEstablishmentDetector`, `IceRestartDetector`, `IceRestartRecommendationDetector` and `AudioPlayoutSynthesisDetector`.

| `type` | Raised when | Resolved when | Detector-specific event | Payload shape |
|---|---|---|---|---|
| `av-desync` | The audio track's playout ran ahead of its linked video track's by `audioAheadRaiseInMs`, or behind by `audioBehindRaiseInMs`, for `sustainForInMs` of stats time | The skew falls back inside the matching resolve threshold, or the track pauses | `'av-desync'` | `AVDesyncPlayoutIssuePayload` |
| `congestion` | Per-PC bandwidth limitation + sensitivity-specific corroborator | Bandwidth limitation clears | `'congestion'` | `CongestionIssuePayload` |
| `uplink-congestion` | The browser reports the encoder bandwidth limited **and** `sqrt(undershoot × pacerBloating)` reaches `minSeverity` | The browser stops reporting a bandwidth limitation | `'uplink-congestion'` | `UplinkCongestionIssuePayload` |
| `downlink-congestion` | `sqrt(undershoot × bufferBloating)` reaches `minSeverity` | That severity falls back under half of `minSeverity` | `'downlink-congestion'` | `DownlinkCongestionIssuePayload` |
| `blocked-outbound-media-transport` | Media leaving on a STUN-answered path with no receiver report for `thresholdInMs` | A report arrives | `'blocked-outbound-media-transport'` | `BlockedOutboundMediaIssuePayload` |
| `blocked-inbound-media-transport` | The far end's sender reports advance while our receivers take nothing | Media arrives | `'blocked-inbound-media-transport'` | `BlockedInboundMediaIssuePayload` |
| `capture-source-lost` | The outbound track's device reached `ended` | — (terminal) | `'capture-source-lost'` | `CaptureSourceLostIssuePayload` |
| `synthesized-audio` | The share of played audio that was invented exceeds `synthesizedRatioThreshold` | The share falls back under it | `'synthesized-audio'` | `AudioPlayoutSynthesisIssuePayload` |
| `transport-delay-degraded` | Mean RTT over the detection window reached `thresholdInMs` | The recovery window behind it also reads below `recoveryThresholdInMs` | `'transport-delay-degraded'` | `TransportDelayIssuePayload` |
| `transport-loss-sustained` | Mean interval loss (worse direction) stayed at or above `threshold` for `durationInMs` | Loss falls below `recoveryThreshold` | `'transport-loss-sustained'` | `TransportLossIssuePayload` |
| `cpulimitation` | CPU-tagged outbound RTP / stats-collection slowness / low inbound decoded-to-received frames ratio | Indicators normalize | `'cpulimitation'` | `CpuPerformanceIssuePayload` |
| `dry-inbound-track` | Inbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-inbound-track'` | `DryInboundTrackIssuePayload` |
| `dry-outbound-track` | Outbound bytes stay flat for `thresholdInMs` | Bytes start flowing again | `'dry-outbound-track'` | `DryOutboundTrackIssuePayload` |
| `video-flow-disrupted` | freezes counted over `observationWindowInMs` reach `frozen` or `choppy` | Frames render again (`frozen`), or `continuousDurationInMs` passes freeze-free (`choppy`) | `'video-flow-disrupted'` | `FrozenVideoTrackIssuePayload` |
| `inbound-video-playout-discrepancy` | `(framesReceived - framesRendered) / framesReceived > highSkewRatio` | Ratio drops below `lowSkewRatio` | `'inbound-video-playout-discrepancy'` | `PlayoutDiscrepancyIssuePayload` |
| `ice-disconnected` | An ICE transport stayed `disconnected` past `disconnectedThresholdInMs` | ICE reconnects, or the transport goes away | — | `IceDisconnectedIssuePayload` |
| `ice-connection-failed` | An ICE transport reached `failed` | ICE reconnects (typically after a restart) | — | `IceConnectionFailedIssuePayload` |
| `ice-transport-stalled` | Still sending on a succeeded pair of a connected transport, but receiving nothing for `transportStallThresholdInMs` | Inbound traffic resumes | — | `IceTransportStalledIssuePayload` |
| `unstable-ice-path` | `pathSwitchThreshold` selected-path switches within `pathSwitchWindowInMs` | A whole window passes below the threshold | — | `UnstableIcePathIssuePayload` |
| `no-available-ice-candidate` | Gathering reported `complete` with zero local candidates on a never-connected PC — immediately if it fell to `disconnected`/`failed`, after `thresholdInMs` otherwise | A candidate appears, the connection connects, or the PC closes | `'no-available-ice-candidate'` | `NoAvailableIceCandidateIssuePayload` |
| `ice-establishment-failed` | Local candidates existed, the PC never reached `connected`, and no pair was ever nominated, for `thresholdInMs` | The connection establishes after all, or the PC closes | — | `IceEstablishmentFailedIssuePayload` |
| `blocked-stun-requests` | A succeeded pair stopped answering STUN while this endpoint kept asking, for `thresholdInMs` | STUN is answered again | `'blocked-transport'` | `BlockedTransportIssuePayload` |
| `rtp-sender-stalled` | `deltaFramesEncoded > 0` while `deltaPacketsSent === 0` on one ssrc, for `thresholdInMs` | Packets leave again, or the ssrc goes away | `'rtp-sender-stalled'` | `RtpSenderStalledIssuePayload` |
| `transport-demux-stalled` | Transport receiving above `minTransportReceiveBitrateBps` while every inbound RTP on it stays flat, for `thresholdInMs` | Inbound RTP receives again, or the transport goes away | `'transport-demux-stalled'` | `TransportDemuxStalledIssuePayload` |
| `dtls-handshake-failed` | An ICE transport reached `dtlsState: 'failed'` | A later handshake connects (after an ICE restart re-keys it) | `'dtls-handshake-failed'` | `DtlsHandshakeFailedIssuePayload` |
| `dtls-handshake-stalled` | ICE proven healthy while DTLS sat in `new`/`connecting` past `stalledThresholdInMs` | The handshake completes | `'dtls-handshake-stalled'` | `DtlsHandshakeStalledIssuePayload` |
| `invented-speech` | Invented audio (silence excluded) accumulates `raiseAfterInventedMs` beyond `allowedInventedRatio` | The accumulator drains back to zero | `'invented-speech'` | `InventedSpeechIssuePayload` |
| `audio-jitter-buffer-stress` | Target delay grown **and** NetEQ time-stretching, for `minConsecutiveTicks` | Either condition clears | `'audio-jitter-buffer-stress'` | `JitterBufferStressIssuePayload` |
| `video-decoder-overloaded` | Frames arrived and loss was quiet, but decode time overran the frame budget or frames were dropped after arrival | The decoder keeps up again | `'video-decoder-overloaded'` | `DecoderPerformanceIssuePayload` |
| `video-recovery-failed` | PLIs sent, picture frozen, `keyFramesDecoded` not advancing for `recoveryFailedThresholdInMs` | A keyframe arrives or the freeze ends | `'video-recovery-failed'` | `VideoRecoveryFailedIssuePayload` |
| `video-capture-bottleneck` | the capture device fell more than `produceDegradationThreshold` short of the configured frame rate across the detection window | a later average comes back at or above `captureFpsRatioRecoveryThreshold` | `'video-capture-bottleneck'` | `CaptureBottleneckIssuePayload` |
| `decoder-bottleneck` | the decoder left more than `decodeDegradationThreshold` of the frames that arrived over `durationInMs` | the next average comes back at or above it | `'decoder-bottleneck'` | `DecoderBottleneckIssuePayload` |
| `encoder-bottleneck` | A delivering source outran the encoder for `durationInMs` continuously | The encoder keeps up again | `'encoder-bottleneck'` | `EncoderBottleneckIssuePayload` |
| `silent-audio-source` | A live, enabled, unmuted microphone produced silence for `silenceThresholdInMs` | Audio appears, or the track stops capturing | `'silent-audio-source'` | `SilentAudioSourceIssuePayload` |
| `stuck-decoder` | RTP bytes flowing, nothing decoding, PLIs firing, for `thresholdInMs` | Frames decode again | `'stuck-decoder'` | `StuckDecoderIssuePayload` |
| `frame-assembly-stalled` | Packets kept arriving with `framesReceived` flat for `thresholdInMs`, past `minPacketsReceived` | A frame is assembled, packets stop arriving, or the track pauses | `'frame-assembly-stalled'` | `FrameAssemblyStalledIssuePayload` |
| `pixelated-video` | `bitPerPixel` stayed at or below `threshold` for `durationInMs` of stats time | It rises above `recoveryThreshold`, or the track pauses | `'pixelated-video'` | `PixelatedVideoIssuePayload` |

Most per-detector payload types are exported from the package root; the five newest are not yet re-exported individually (`TransportDelayIssuePayload`, `TransportLossIssuePayload`, `PixelatedVideoIssuePayload`, `ChoppyVideoIssuePayload`, `FrameAssemblyStalledIssuePayload`), so reach them through the `ClientMonitorIssue` union below, which does narrow to all of them. The resolved-side payload is always the raise-time payload plus `durationInMs` (and, for some, refreshed metrics).

## Type-safe handling: the `ClientMonitorIssue` discriminated union

Listeners on `'issue'` / `'issue-updated'` / `'issue-resolved'` receive the generic `ClientIssue` / `RaisedClientIssue` / `ResolvedClientIssue`. To get full payload typing for the built-in detector issues, cast to the discriminated unions exported from the package:

```ts
import {
    ClientMonitor,
    ClientMonitorIssue,
    ClientMonitorResolvedIssue,
    isClientMonitorIssue,
} from '@observertc/client-monitor-js';

const monitor = new ClientMonitor({ /* … */ });

monitor.on('issue', (issue) => {
    if (!isClientMonitorIssue(issue)) {
        // Custom / app-raised issue → handle as RaisedClientIssue<unknown>
        return;
    }

    switch (issue.type) {
        case 'congestion':
            // issue.payload is CongestionIssuePayload
            console.log('congestion on PC', issue.payload.peerConnectionId,
                'avail in', issue.payload.availableIncomingBitrate);
            break;

        case 'cpulimitation':
            // issue.payload is CpuPerformanceIssuePayload
            console.warn('cpu pressure');
            break;

        case 'av-desync':
            // issue.payload is AVDesyncPlayoutIssuePayload
            console.log('lip sync off by', issue.payload.playoutDiffInMs, 'ms',
                '(', issue.payload.direction, ')',
                'on', issue.payload.trackId, 'vs', issue.payload.linkedVideoTrackId);
            break;

        case 'video-flow-disrupted':
            console.log('freeze on track', issue.payload.trackId);
            break;

        case 'dry-inbound-track':
        case 'dry-outbound-track':
            console.log('dry track', issue.payload.trackId,
                'duration', issue.payload.duration);
            break;

        case 'inbound-video-playout-discrepancy':
            console.log('playout discrepancy on track', issue.payload.trackId,
                'skew', issue.payload.frameSkew);
            break;
    }
});

monitor.on('issue-resolved', (resolved) => {
    const own = resolved as ClientMonitorResolvedIssue;
    switch (own.type) {
        case 'av-desync':
            console.log(`Lip sync drift on ${own.payload.trackId} lasted ${own.payload.durationInMs}ms`);
            break;
        case 'congestion':
            console.log(`Congestion on ${own.payload.peerConnectionId} lasted ${own.payload.durationInMs}ms`);
            break;
        // …
    }
});
```

Three helpers are available:

-   `ClientMonitorIssue` — discriminated union of every raised issue produced by the bundled detectors.
-   `ClientMonitorResolvedIssue` — same, for `'issue-resolved'`.
-   `isClientMonitorIssue(issue)` / `isClientMonitorResolvedIssue(issue)` — type guards that return `true` only for the 35 built-in `type` values, and `false` for anything raised by a custom detector or by application code.

`ClientMonitorIssueType` is the literal union of those 35 strings, useful for exhaustive switches and for typing a server-side allow-list.

## Managing active stateful issues

```ts
// All active issues across all detectors:
const all = monitor.getActiveIssuesByType();

// Active issues of one type:
const congestionIssues = monitor.getActiveIssuesByType('congestion');
for (const issue of congestionIssues) {
    if (issue.payload?.availableIncomingBitrate < 200_000) {
        ui.showLowBandwidthWarning(issue.key);
    }
}

// Is a specific issue active?
if (monitor.isIssueActive('congestion-pc-pc-123')) { /* … */ }

// Iterate the raw map (advanced — prefer the helpers):
for (const [key, issue] of monitor.activeIssues) {
    console.log(key, issue.type, issue.payload);
}
```

## Raising your own custom issues

You can raise issues from app code or your own custom detector. Pick a `key` that's unique per logical incident — the detector convention is `${type}-${scope}` (e.g. `congestion-pc-${peerConnectionId}`, `av-desync-track-${trackId}`).

```ts
// Start: a meeting-quality watchdog notices a participant's input mic is muted unexpectedly
monitor.raiseIssue(`unexpected-mute-${participantId}`, {
    type: 'unexpected-mute',
    payload: {
        participantId,
        sinceUtc: new Date().toISOString(),
    },
});

// Refresh while still ongoing (e.g. with updated metadata):
monitor.raiseIssue(`unexpected-mute-${participantId}`, {
    type: 'unexpected-mute',
    payload: {
        participantId,
        sinceUtc: knownStart,
        framesSpoken: 0,
    },
});
// → emits 'issue-updated', not 'issue'

// End: the participant unmuted, attach how long it lasted
monitor.resolveIssue(`unexpected-mute-${participantId}`, {
    comment: 'participant unmuted',
    payload: {
        participantId,
        sinceUtc: knownStart,
        durationInMs: Date.now() - mutedAtMs,
    },
    resolvedAt: Date.now(),
});
```

For a one-shot incident with no "ended" condition (a `getUserMedia` failure, a click-to-call timeout, …), use `addIssue`:

```ts
monitor.addIssue({
    type: 'USER_MEDIA_ERROR',
    payload: { error: `${err}` },
});
// Never enters activeIssues, can't be resolved, but is emitted as 'issue'
// and buffered into the next ClientSample.
```

## Custom detector example

A custom detector follows the same pattern the built-ins use: own a `key`, expose a `public disabled` flag, raise on entry, resolve on exit, enrich the resolved payload with duration.

```ts
import {
    Detector,
    ClientMonitor,
    InboundTrackMonitor,
} from '@observertc/client-monitor-js';

interface MicMutedIssuePayload {
    participantId: string;
    expected: boolean;
    durationInMs?: number;
}

class UnexpectedMicMuteDetector implements Detector {
    public readonly name = 'unexpected-mic-mute-detector';
    public disabled = false;

    private readonly issueKey: string;
    private _startedAt?: number;

    constructor(
        private readonly track: InboundTrackMonitor,
        private readonly participantId: string,
        private readonly clientMonitor: ClientMonitor,
    ) {
        this.issueKey = `unexpected-mic-mute-track-${track.track.id}`;
    }

    update() {
        if (this.disabled) return;

        const wantsAudio = !this.track.track.muted;
        const isReceivingAudio = (this.track.getInboundRtp()?.deltaBytesReceived ?? 0) > 0;
        const isMisbehaving = wantsAudio && !isReceivingAudio;

        if (isMisbehaving && !this.clientMonitor.isIssueActive(this.issueKey)) {
            this._startedAt = Date.now();
            this.clientMonitor.raiseIssue<MicMutedIssuePayload>(this.issueKey, {
                type: 'unexpected-mic-mute',
                payload: { participantId: this.participantId, expected: false },
            });
        } else if (!isMisbehaving && this.clientMonitor.isIssueActive(this.issueKey)) {
            const active = this.clientMonitor.activeIssues.get(this.issueKey);
            this.clientMonitor.resolveIssue<MicMutedIssuePayload>(this.issueKey, {
                comment: 'mic unmuted',
                payload: {
                    ...(active?.payload as MicMutedIssuePayload),
                    durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
                },
            });
            this._startedAt = undefined;
        }
    }
}
```

Three things to notice:

1. `disabled` is a public field — applications flip it at runtime to silence the detector.
2. `Detectors.update()` skips detectors with `disabled === true`, and the in-method `if (this.disabled) return;` makes direct invocations behave the same.
3. The detector is the source of truth for `_startedAt`; the resolved payload carries the duration so consumers don't have to track it themselves.

## Controlling which detectors run

Each detector has one entry in `ClientMonitorConfig`, typed `<ClassName>Config | null` and keyed by the detector's own `name` in camelCase. **One key, one detector**, in both directions: no key constructs a second class, and no detector reads a second key — so `null` removes precisely the detector you named.

```ts
new ClientMonitor({
    // null → don't even construct this detector. No memory, no update() ticks.
    congestionDetector: null,

    // undefined / omitted → use defaults (this is the existing behavior).

    // Object → enable with overrides.
    avDesyncPlayoutDetector: {
        audioAheadRaiseInMs: 120,
        audioBehindRaiseInMs: 240,
    },
});
```

Seven keys that used to cover a group of detectors were retired in 4.9.0 — see [Detector config keys that changed](#detector-config-keys-that-changed).

Already running and want to flip a detector on/off without restarting the monitor? Every built-in detector exposes a `public disabled = false` field, and every layer's `detectors` registry exposes ergonomic helpers for finding and toggling them. Issue-raising detectors additionally expose `public includeIssueInSample = true` — flip it to `false` to keep a detector running locally (events, `activeIssues`) while excluding its issues from the samples shipped to the server; see [Which issues belong in the sample](./DETECTORS.md#which-issues-belong-in-the-sample).

`Detectors` (the registry attached as `monitor.detectors`, `peerConnectionMonitor.detectors`, `inboundTrackMonitor.detectors`, `outboundTrackMonitor.detectors`, `mediaPlayoutMonitor.detectors`) offers:

```ts
// Inspection
detectors.size;                         // number of attached detectors
detectors.listOfNames;                  // string[] of every detector.name
detectors.has(name);                    // is a detector with that name attached?
detectors.getByName(name);              // Detector | undefined
detectors.getByName<CpuPerformanceDetector>('cpu-performance-detector');
detectors.find(pred);                   // first match
detectors.filter(pred);                 // all matches
for (const d of detectors) { /* … */ }  // iterate

// Mutation
detectors.add(detector);                // append a custom detector
detectors.remove(detector);             // detach an instance
detectors.clear();                      // detach all

// Runtime toggle
detectors.disable(name);                // sets detector.disabled = true (returns true if found)
detectors.enable(name);                 // sets detector.disabled = false
detectors.isEnabled(name);              // attached AND not disabled
detectors.disableAll();                 // silence every attached detector
detectors.enableAll();                  // re-enable every attached detector
```

Common patterns:

```ts
// Kill one specific detector instance-wide.
monitor.detectors.disable('cpu-performance-detector');

// Silence congestion alerts across every existing PeerConnection.
for (const pc of monitor.mappedPeerConnections.values()) {
    pc.detectors.disable('congestion-detector');
}

// Toggle a track-level detector based on something the app knows.
inboundTrackMonitor.detectors.disable('inbound-video-flow-state-detector');

// Suspend everything during a known-noisy state, then re-enable.
monitor.detectors.disableAll();
// …later
monitor.detectors.enableAll();

// Tweak the live config of a detector at runtime via getByName.
const cpu = monitor.detectors.getByName('cpu-performance-detector');
if (cpu) cpu.disabled = true;
```

If you want a detector outright gone (not just silenced), call `detectors.remove(instance)` — or skip its construction entirely at monitor creation time by passing `null` for its config field.

### Detector names that changed

`name` is the lookup key for `getByName` / `disable` / `enable` / `has` / `isEnabled`, and **lookup is exact**. There is no alias table: a retired name returns `undefined` from `getByName` and `false` from `has`, `disable` and `enable`.

**An alias could only ever have pointed at one part of a split.** A name resolves to exactly one detector, so an old spelling for a class that became several would have picked one of the parts — an application toggling `ice-path-stability-detector` by its old name would have kept working while quietly governing one of the six classes it used to cover. A failed lookup is something a caller can act on; a silently narrowed one is not.

The table below is migration guidance, not resolution — every name in the left column now fails the lookup:

| Retired name | What it became |
|---|---|
| `ice-path-stability-detector` | `ice-disconnected-detector`, `ice-connection-failed-detector`, `ice-transport-stalled-detector`, `unstable-ice-path-detector`, `ice-restart-detector`, `ice-restart-recommendation-detector` |
| `ice-connectivity-detector` | as above |
| `dtls-handshake-detector` | `dtls-handshake-stalled-detector`, `dtls-handshake-failed-detector` |
| `capture-failure-detector` | `capture-source-lost-detector`, `silent-audio-source-detector`, `capture-track-muted-detector` |
| `media-pipeline-detector` | `rtp-sender-stalled-detector`, `transport-demux-stalled-detector` |
| `ice-tuple-change-detector` | `ice-traversal-detector` (a straight rename) |
| `no-available-ice-candidate-detector` | `ice-reachability-detector` |
| `long-pc-connection-establishment-detector` | `ice-path-establishment-detector` |

So an application that was disabling a split detector by its old name is now disabling nothing:

```ts
// Returns false and silences nothing — the name no longer exists.
pc.detectors.disable('ice-path-stability-detector');

// Name each part you meant.
pc.detectors.disable('ice-disconnected-detector');
pc.detectors.disable('ice-connection-failed-detector');

// Or don't construct them in the first place — one key per detector.
new ClientMonitor({
    iceDisconnectedDetector: null,
    iceConnectionFailedDetector: null,
});
```

### Detector config keys that changed

Every detector reads a config block named after it — its `name` in camelCase, so `frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector`. That was not always true: several keys used to construct a group of classes, which meant a `null` intended to silence one finding silently removed its neighbours. **Seven keys were retired in 4.9.0** to fix that, split where a class had already become several and renamed where the key spelled a different word from the detector:

| Retired config key | What to use instead |
|---|---|
| `captureFailureDetector` | `captureTrackEndedDetector`, `silentAudioSourceDetector`, `captureTrackMutedDetector` |
| `dtlsHandshakeDetector` | `dtlsHandshakeStalledDetector`, `dtlsHandshakeFailedDetector` |
| `icePathStabilityDetector` | `iceDisconnectedDetector`, `iceConnectionFailedDetector`, `iceTransportStalledDetector`, `unstableIcePathDetector`, `iceRestartDetector`, `iceRestartRecommendationDetector` |
| `mediaPipelineDetector` | `rtpSenderStalledDetector`, `transportDemuxStalledDetector` |
| `videoRecoveryDetector` | `videoRecoveryFailedDetector` |
| `videoFreezesDetector` | `inboundVideoFlowStateDetector` *(rename)* |
| `syntheticSamplesDetector` | `audioPlayoutSynthesisDetector` *(rename)* |

Three more keys went with them, renamed because the key spelled a different word from the detector:

| Retired config key | Current key |
|---|---|
| `longPcConnectionEstablishmentDetector` | `icePathEstablishmentDetector` |
| `iceConnectivityDetector` | `icePathStabilityDetector`, which was then split — see the table above |
| `noAvailableIceCandidateDetector` | `iceReachabilityDetector` |

**None of these ten is a member of `ClientMonitorConfig` any more**, which means a config object still using one **fails to type-check**. There is no alias and no runtime fallback: if such an object reaches the constructor anyway (plain JavaScript, or a cast), the key is ignored and the detectors that used to read it run on their defaults rather than on your settings — including a `null` meant to disable them. For a key that was *split*, there is no mechanical migration either — decide which of the new blocks you meant.

Two field moves are worth checking for in an existing config. `icePathEstablishmentDetector.restartRecommendationThresholdInMs` and `.restartRecommendationCooldownInMs` now live on `iceRestartRecommendationDetector`, which holds all four recommendation conditions in one block; and `EncoderBottleneckDetector` reads its own `encoderBottleneckDetector.encodeDegradationThreshold`, default `0.3`.

Three detectors that had no key at all gained one, so each can now be disabled individually: `dtlsHandshakeFailedDetector`, `iceConnectionFailedDetector` and `iceTraversalDetector`. All three carry no tunables — `{}` enables, `null` disables. `IceTraversalDetector` in particular used to be registered unconditionally, silenceable only by name.

Config *types* moved with the keys. Each detector file exports `<ClassName>Config`, and the package root re-exports it beside every detector class it already exported, so `import type { StuckDecoderDetectorConfig } from '@observertc/client-monitor-js'` names the block you are building.

The **class** exports carry no legacy names either. `IceTupleChangeDetector`, `LongPcConnectionEstablishmentDetector`, `LongPcConnectionEstablishmentStage` and `NoAvailableIceCandidateDetector` are removed; import `IceTraversalDetector`, `IcePathEstablishmentDetector`, `IcePathEstablishmentStage` and `IceReachabilityDetector` instead. The classes that were *split* — the old `IcePathStabilityDetector`, `DtlsHandshakeDetector`, `CaptureFailureDetector` and `MediaPipelineDetector` — never had an alias to remove: a class that raised four issues cannot be aliased onto one that raises a single one without lying about what it does. Import the part you meant.

No issue type, payload or monitor event name was renamed by any of this.

## Sample-channel behavior

Every `addIssue` and every `raiseIssue` adds an entry to the next `ClientSample.clientIssues[]` — unless the issue was raised with `includeInSample: false` (what a detector's `includeIssueInSample = false` compiles down to), in which case neither the raise nor its resolution reaches the sample. **Re-raises do not add a new entry** — they emit `'issue-updated'` to live listeners but the sample buffer is unchanged.

**The issue lifecycle reaches the sample too** (`sendResolvedIssuesToServer`, default `true`). The purpose: the server keeps an on-the-fly mirror of each client's currently *active* issues and can correlate across clients or act immediately (recreate a consumer, recommend a rejoin) instead of only ever learning that issues started. On the wire, both entries of a stateful issue carry the schema-level `key` — the identity the server opens and closes on:

```
raise:      { type: 'stuck-decoder',          key, payload,                                       timestamp: raisedAt }
resolution: { type: 'stuck-decoder-resolved', key, payload: { raisedAt, comment, ...resolution }, timestamp: resolvedAt }
```

The resolution's payload carries only what was **explicitly passed** to `resolveIssue`, flattened — the built-in detectors pass their final payload, so fields like `durationInMs` appear here, while a bare resolve carries just `raisedAt` and `comment`. The raise-time payload is not repeated; the server already has it from the raise entry. `raisedAt` equals the raise entry's `timestamp` — a secondary join for consumers that do not store keys. Issues still active at `close()` are auto-resolved and reach the final sample. Servers switching on issue `type` should ignore or handle the `-resolved` suffix; one-shot `addIssue` entries have no lifecycle and no `key`. Pass `sendResolvedIssuesToServer: false` to restore the previous wire format exactly (raise entries only, no `key`); the realtime `'issue-resolved'` event is emitted either way.

## Event listeners cheat-sheet

```ts
// Sample produced.
monitor.on('sample-created', ({ sample }) => { /* … */ });

// Issue lifecycle.
monitor.on('issue',          (issue)    => { /* new addIssue or new raiseIssue */ });
monitor.on('issue-updated',  (issue)    => { /* re-raise of an existing key */ });
monitor.on('issue-resolved', (resolved) => { /* resolveIssue or close() auto-resolve */ });

// Detector-specific events (these fire alongside 'issue', once per episode).
monitor.on('congestion',                          (e) => { /* … */ });
monitor.on('cpulimitation',                       (e) => { /* … */ });
monitor.on('av-desync',                           (e) => { /* … */ });
monitor.on('video-flow-disrupted',                 (e) => { /* … */ });
monitor.on('dry-inbound-track',                   (e) => { /* … */ });
monitor.on('dry-outbound-track',                  (e) => { /* … */ });
monitor.on('inbound-video-playout-discrepancy',   (e) => { /* … */ });
monitor.on('invented-speech',                     (e) => { /* audio NetEQ invented, not raw loss */ });
monitor.on('audio-jitter-buffer-stress',          (e) => { /* buffer grown AND stretching */ });
monitor.on('video-decoder-overloaded',            (e) => { /* frames arrived, client could not decode */ });
monitor.on('video-recovery-failed',               (e) => { /* we asked for a keyframe; nothing came back */ });
monitor.on('stuck-decoder',                       (e) => { /* RTP flowing, nothing decodes — recreate the consumer */ });
monitor.on('video-capture-bottleneck',                  (e) => { /* the camera never produced the frames */ });
monitor.on('decoder-bottleneck',                  (e) => { /* frames arrived; the decoder could not decode them */ });
monitor.on('encoder-bottleneck',                  (e) => { /* the source did; the encoder could not keep up */ });
monitor.on('capture-source-lost',                 (e) => { /* the device is gone */ });
monitor.on('capture-track-muted',                 (e) => { /* the OS or another app took it — event only */ });
monitor.on('silent-audio-source',                 (e) => { /* live mic producing digital silence */ });
monitor.on('frame-assembly-stalled',              (e) => { /* packets arriving, no frame ever assembled */ });
monitor.on('pixelated-video',                     (e) => { /* too few bits per pixel, sustained */ });

// Transport quality — properties of a path that is up and holding.
monitor.on('transport-delay-degraded',    (e) => { /* round trip long enough to break turn-taking */ });
monitor.on('transport-loss-sustained',    (e) => { /* packets vanishing — `direction` says which way */ });
monitor.on('blocked-transport',           (e) => { /* STUN passes, media does not — the firewall signature */ });

// Pipeline stage boundaries nothing else covers.
monitor.on('rtp-sender-stalled',      (e) => { /* frames encode, no packet leaves */ });
monitor.on('transport-demux-stalled', (e) => { /* traffic arrives, no inbound RTP accounts for it */ });

// Observations — these never raise an issue.
monitor.on('codec-changed',            (e) => { /* mime type or profile switched */ });
monitor.on('video-resolution-changed', (e) => { /* the adaptation ladder moved */ });
monitor.on('simulcast-layer-changed',  (e) => { /* which layers are actually being sent */ });
monitor.on('stats-collection-gap',     (e) => { /* backgrounded tab: discount this interval */ });

// ICE connectivity.
monitor.on('ice-path-changed',      (e) => { /* selected path changed: direct <-> TURN, protocol, server */ });
monitor.on('ice-restart',           (e) => { /* a new ICE generation was inferred */ });
monitor.on('ice-restart-recommended', (e) => { /* YOUR app decides whether to restartIce() */ });
monitor.on('ice-tuple-changed',     (e) => { /* low-level: the selected tuple set changed */ });
monitor.on('dtls-handshake-failed',  (e) => { /* DTLS is terminal for this transport — config/interop, not network */ });
monitor.on('dtls-handshake-stalled', (e) => { /* ICE fine, DTLS not completing — something eats DTLS */ });
monitor.on('new-selected-ice-path', (e) => { /* an ICE transport selected its first path */ });
monitor.on('no-available-ice-candidate', (e) => { /* gathering produced nothing — no usable network */ });
monitor.on('ice-path-establishment-slow', ({ stalledStage }) => { /* and which stage it is stuck in */ });
// `ice-establishment-failed` has no named event of its own — listen on 'issue'.

// Score & stats lifecycle.
monitor.on('score',          ({ clientScore, currentReasons }) => { /* … */ });
monitor.on('stats-collected', ({ durationOfCollectingStatsInMs, collectedStats }) => { /* … */ });
```

---

[← back to the README](../README.md)
