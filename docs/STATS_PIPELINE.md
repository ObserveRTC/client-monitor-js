# The stats pipeline

# Collecting and Adapting Stats

The monitor collects WebRTC statistics periodically and adapts them for consistent processing across different browsers and integrations.

## Stats Collection Process

1. **Collection Trigger**: Timer-based collection every `collectingPeriodInMs`
2. **Raw Stats Retrieval**: Calls `getStats()` on peer connections
3. **Stats Adaptation**: Applies browser-specific adaptations
4. **Monitor Updates**: Updates all relevant monitor objects
5. **Detector Updates**: Runs all attached detectors
6. **Score Calculation**: Updates performance scores

## Stats Adapters

Stats adapters handle browser-specific differences and integration requirements:

### Browser Adaptations

-   **Firefox**: Handles track identifier format differences
-   **Chrome/Safari**: Handles various stats format variations
-   **Mediasoup**: Filters probator tracks and adapts mediasoup-specific stats

### Custom Stats Adapters

Add custom adaptation logic:

```javascript
monitor.statsAdapters.add((stats) => {
    // Custom adaptation logic
    return stats.map((stat) => {
        if (stat.type === "inbound-rtp" && stat.trackIdentifier) {
            // Custom track identifier handling
            stat.trackIdentifier = stat.trackIdentifier.replace(/[{}]/g, "");
        }
        return stat;
    });
});
```

## Extension Stats Providers

Extension stats providers allow you to inject custom application-specific statistics into the monitoring pipeline. These providers are called during each stats collection cycle and can return either synchronous or asynchronous results.

**What are Extension Stats?**

Extension stats are custom key-value pairs that you define to track application-specific metrics alongside WebRTC statistics. They are included in every sample created by the monitor and allow you to correlate WebRTC quality metrics with your own application data.

**Adding Extension Stats Providers:**

```javascript
// Synchronous provider
monitor.extensionStatsProviders.add(() => ({
    type: "my-custom-metric",
    payload: {
        fps: currentFps,
        bandwidth: availableBandwidth,
        userEngagement: engagementScore,
    },
}));

// Asynchronous provider
monitor.extensionStatsProviders.add(async () => {
    const cpuUsage = await getCpuUsageMetrics();
    return {
        type: "system-metrics",
        payload: {
            cpu: cpuUsage,
            memory: performance.memory?.usedJSHeapSize || 0,
        },
    };
});
```

**Reading Your Own Metrics Back (`id`)**

Give a stat an `id` and the monitor keeps its latest payload, so you can read it back instead of
holding a copy alongside:

```javascript
monitor.addExtensionStats({
    type: "my-custom-metric",
    id: "encoder-tuning",
    payload: { targetBitrate: 1_200_000, profile: "balanced" },
});

const tuning = monitor.getExtensionStatsPayload("encoder-tuning");
// { targetBitrate: 1200000, profile: "balanced" }
```

Without an `id` a stat is still buffered into the next sample and emitted, but nothing keeps it —
the `id` is what turns a reported value into readable state.

-   **Latest only**: re-reporting an id replaces its payload. This is a current-value store, not a
    history.
-   **Lifetime**: a value survives the collection after the one it arrived in, and is dropped by the
    one after that unless it was reported again. A provider runs every collection, so a
    provider-backed id stays readable for the whole call; a one-off `addExtensionStats` call leaves
    a value readable for one collection.
-   **Independent of sampling**: the stored value is kept whether or not samples are being produced.
    Only the sample-buffering half is skipped when nothing is sampling and
    `bufferingEventsForSamples` is off.
-   **Type is asserted, not checked**: `getExtensionStatsPayload<T>(id)` casts to the shape you name.
    Nothing validates it.
-   **`getExtensionStatsMonitor(id)`** returns the entry itself, carrying `type` and the `timestamp`
    at which the payload last arrived.

Providers can supply an `id` too, which is the usual way to keep a metric continuously readable:

```javascript
monitor.extensionStatsProviders.add(() => ({
    type: "system-metrics",
    id: "system",
    payload: { cpu: readCpu() },
}));
```

**Provider Characteristics:**

-   **Type**: Each provider must return an object with a `type` field (string identifier)
-   **Payload**: Optional custom data object containing your metrics
-   **Timing**: Providers are called during every stats collection cycle
-   **Async Support**: Providers can be async and return promises
-   **Error Handling**: Errors in providers are logged but don't stop the monitoring process

**Sample Integration:**

Extension stats are automatically included in every created sample:

```javascript
monitor.on("sample-created", (sample) => {
    // sample.extensionStats contains all extension stats
    // Example output:
    // [
    //   { type: "my-custom-metric", payload: { fps: 30, bandwidth: 5000, ... } },
    //   { type: "system-metrics", payload: { cpu: 45, memory: 52428800 } }
    // ]
    console.log("Extension stats:", sample.extensionStats);
});
```

## Available WebRTC Stats

The monitor collects and processes all standard WebRTC statistics:

### RTP Statistics

-   **Inbound RTP**: Receiving stream statistics
-   **Outbound RTP**: Sending stream statistics
-   **Remote Inbound RTP**: Remote peer's receiving statistics
-   **Remote Outbound RTP**: Remote peer's sending statistics

### Connection Statistics

-   **ICE Candidate**: ICE candidate information
-   **ICE Candidate Pair**: ICE candidate pair statistics
-   **ICE Transport**: ICE transport layer statistics
-   **Certificate**: Security certificate information

### Media Statistics

-   **Codec**: Codec configuration and usage
-   **Media Source**: Local media source statistics
-   **Media Playout**: Audio playout statistics
-   **Data Channel**: Data channel statistics

# Sampling

Sampling creates periodic snapshots (`ClientSample`) containing the complete state of the monitored client.

## Sample Structure

The sample schema version is **3.7.0** (`ClientMonitor.samplingSchemaVersion`). Two things to know on the consuming side:

-   **Payloads may nest.** Client event, issue, meta and extension-stat payloads are records that may carry nested structures — records on the wire, never pre-serialised JSON strings. (`PEER_CONNECTION_ICE_PATH_CHANGED` ships its `from`/`to` path evidence as structured records since 3.7.0.)
-   **Static ICE transport metadata ships on change only.** `iceRole`, `dtlsRole`, `iceLocalUsernameFragment`, `tlsVersion`, `dtlsCipher`, `srtpCipher` and the certificate references appear in a transport's first sample and again only when a value changes — absence means *unchanged*, not unknown; keep the last seen value per transport `id`. Set `sendIceTransportMetadataOnChangeOnly: false` to restore every-sample emission.

A `ClientSample` includes:

-   **Client metadata**: clientId, callId, timestamp, score
-   **Peer connection samples**: All monitored peer connections
-   **Events**: Client events since last sample
-   **Issues**: Detected issues since last sample
-   **Extension stats**: Custom application statistics

## Automatic Sampling

Enable automatic sampling by setting `samplingPeriodInMs`:

```javascript
const monitor = new ClientMonitor({
    collectingPeriodInMs: 2000,
    samplingPeriodInMs: 4000, // Create sample every 4 seconds
});

monitor.on("sample-created", (sample) => {
    console.log("Sample created:", sample);
    // Send to analytics backend
    sendToAnalytics(sample);
});
```

## Manual Sampling

Create samples on demand:

```javascript
const monitor = new ClientMonitor({
    collectingPeriodInMs: 2000,
    bufferingEventsForSamples: true, // Required for manual sampling
});

// Create sample manually
const sample = monitor.createSample();
if (sample) {
    console.log("Manual sample:", sample);
}
```

## Sample Compression

`ClientSample` objects compress well because consecutive samples are nearly identical — the same tracks, the same peer connections, counters that moved a little. Two codec packages exploit that by encoding **each sample as the delta from the previous one**; pick one by the wire format you want:

| Package | Wire format | Use it when |
| --- | --- | --- |
| `@observertc/samples-protobuf-codec` | Protobuf binary | You want the smallest payload and already speak protobuf on the server. |
| `@observertc/samples-json-codec` | JSON | You want zero dependencies (~2 KB gzipped) and a payload you can read in a log. |

Both expose the same shape: a `ClientSampleEncoder`, a `ClientSampleDecoder`, and a `createClientSampleCodec()` factory that returns a matched pair.

**Encoding on the client:**

```javascript
import { ClientSampleEncoder } from "@observertc/samples-protobuf-codec";

const encoder = new ClientSampleEncoder();

monitor.on("sample-created", ({ sample }) => {
    const encoded = encoder.encode(sample);

    fetch("/api/samples", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: encoded,
    });
});
```

**Decoding on the server:**

```javascript
import { ClientSampleDecoder } from "@observertc/samples-protobuf-codec";

// one decoder per client connection — see "Delta encoding is stateful" below
const decoder = new ClientSampleDecoder();

const sample = decoder.decode(new Uint8Array(await request.arrayBuffer()));
```

**Delta encoding is stateful, and that has three consequences:**

1. **One encoder per client, one decoder per client.** Each holds the previous sample as its baseline. Sharing an encoder across clients, or decoding two clients' streams through one decoder, produces garbage rather than an error.
2. **Samples must be decoded in the order they were encoded.** A dropped or reordered payload desynchronises the pair. Use `tryDecode()` where the transport can lose messages — it returns `undefined` instead of throwing, so you can drop the sample and wait for the next resync rather than tearing down the connection.
3. **Call `reset()` on both sides when a client reconnects.** The encoder starts a fresh baseline; the decoder must be told to expect one.

**Transport-specific helpers.** Where the payload has to survive a text channel, each codec carries its own:

```javascript
// protobuf: base64 for text transports, or the raw protobuf message
encoder.encodeToBase64(sample);   decoder.decodeBase64(text);
encoder.encodeToMessage(sample);  decoder.decodeFromMessage(message);

// json: a plain JSON-serialisable delta
encoder.encodeToJson(sample);     decoder.decodeJson(json);
                                  decoder.tryDecodeJson(json);
```

**Errors** are `ProtobufCodecError` / `JsonCodecError`, each carrying a `code` and a `context` describing what failed — a schema mismatch and a desynchronised baseline report differently, which is what you want in a log.

**Schema compatibility.** Both codecs export a `schemaVersion` describing the `ClientSample` shape they were built against. This monitor ships schema **3.6.0** (`ClientMonitor.samplingSchemaVersion`). Check the two agree before deploying — a codec built against an older schema silently drops fields the monitor now sends.

**Installation:**

```bash
# choose one
npm install @observertc/samples-protobuf-codec
npm install @observertc/samples-json-codec
```

Both packages ship CommonJS and ESM builds with type definitions.

**Integration with ObserveRTC Stack:**
These compression packages are part of the broader ObserveRTC ecosystem and are designed to work seamlessly with:

-   Client Monitor (sample generation)
-   Observer Service (sample processing)
-   Schema definitions (data consistency)

The compression format maintains full compatibility with the ObserveRTC schema definitions and can be used with any transport mechanism (WebSocket, HTTP REST, etc.).

# WebRTC Stats Monitors

The monitor creates specialized monitor objects for each WebRTC statistics type, providing navigation, derived fields, and lifecycle management.

## Monitor Hierarchy

```
ClientMonitor
├── PeerConnectionMonitor[]
│   ├── InboundRtpMonitor[]
│   ├── OutboundRtpMonitor[]
│   ├── RemoteInboundRtpMonitor[]
│   ├── RemoteOutboundRtpMonitor[]
│   ├── MediaSourceMonitor[]
│   ├── CodecMonitor[]
│   ├── IceTransportMonitor[]
│   ├── IceCandidateMonitor[]
│   ├── IceCandidatePairMonitor[]
│   ├── CertificateMonitor[]
│   ├── DataChannelMonitor[]
│   └── MediaPlayoutMonitor[]
├── InboundTrackMonitor[]
└── OutboundTrackMonitor[]
```

## Track Monitors

### InboundTrackMonitor

Monitors incoming media tracks with attached detectors:

**Properties:**

-   `score`: Calculated quality score
-   `bitrate`: Receiving bitrate
-   `jitter`: Network jitter
-   `fractionLost`: Packet loss fraction
-   `dtxMode`: Discontinuous transmission mode
-   `detectors`: Attached detectors

**Detectors:**

-   `DryInboundTrackDetector` and `CodecChangeDetector` (any kind)
-   Audio: `AVDesyncPlayoutDetector`, `InventedSpeechDetector`, `JitterBufferStressDetector`
-   Video: `InboundVideoFlowStateDetector`, `VideoRecoveryFailedDetector`, `PlayoutDiscrepancyDetector`, `DecoderBottleneckDetector`, `DecoderPerformanceDetector`, `StuckDecoderDetector`, `VideoResolutionChangeDetector`, `FrameAssemblyStalledDetector`, `PixelatedVideoDetector`

Which of them are constructed depends on the matching config keys; see [Detectors](./DETECTORS.md#detectors).

### OutboundTrackMonitor

Monitors outgoing media tracks:

**Properties:**

-   `score`: Calculated quality score
-   `bitrate`: Aggregate sending bitrate
-   `sendingPacketRate`: Packet sending rate
-   `remoteReceivedPacketRate`: Remote receiving rate
-   `detectors`: Attached detectors

**Methods:**

-   `getHighestLayer()`: Gets highest bitrate layer
-   `getOutboundRtps()`: Gets all outbound RTP monitors

**Detectors:** `DryOutboundTrackDetector`, `CaptureSourceLostDetector`, `CaptureTrackMutedDetector`, `SilentAudioSourceDetector`, `CodecChangeDetector`, and on video tracks `VideoCaptureBottleneckDetector`, `EncoderPerformanceDetector`, `SimulcastLayerDetector`, `VideoResolutionChangeDetector`.

## RTP Monitors

### InboundRtpMonitor

Extended inbound RTP statistics with derived fields:

**Derived Fields:**

-   `bitrate`: Calculated receiving bitrate
-   `packetRate`: Packet receiving rate
-   `deltaPacketsLost`: Packets lost since last collection
-   `deltaJitterBufferDelay`: Jitter buffer delay change
-   `ewmaFps`: Exponentially weighted moving average FPS

### OutboundRtpMonitor

Extended outbound RTP statistics:

**Derived Fields:**

-   `bitrate`: Calculated sending bitrate
-   `payloadBitrate`: Payload-only bitrate
-   `packetRate`: Packet sending rate
-   `retransmissionRate`: Retransmission rate

**Navigation:**

-   `getRemoteInboundRtp()`: Navigate to corresponding remote stats
-   `getMediaSource()`: Navigate to media source

## Connection Monitors

### IceCandidatePairMonitor

ICE candidate pair with derived metrics:

**Derived Fields:**

-   `availableIncomingBitrate`: Calculated available bandwidth
-   `availableOutgoingBitrate`: Calculated available bandwidth

**Path helpers** — every one is read from the pair's **own local candidate**, so a
TURN verdict can never be assembled from signals belonging to two different
candidates:

-   `usingTurn`: the local candidate is a relay candidate. A `turn:` url alone is
    *not* a TURN signal — a srflx candidate discovered through a TURN server's
    STUN function carries one too.
-   `usingTcp`: the local candidate's ICE transport protocol is TCP. Note a relay
    reached over TURN/TCP or TURN/TLS commonly still reports `protocol: 'udp'` —
    read `relayProtocol` for the TURN leg.
-   `relayProtocol`: `'udp'`, `'tcp'` or `'tls'`, when exposed.
-   `pathKind`: `'direct'`, `'turn-udp'`, `'turn-tcp'`, `'turn-tls'`, or
    `'turn-unknown'` (a relay whose `relayProtocol` the browser hides).
-   `turnUrl` / `turnServer`: the ICE server, and its identity without the query
    part so the same server over UDP and TCP resolves to one value.
-   `tuple`: `localAddress:localPort:remoteAddress:remotePort:protocol`.
-   `pathKey`: identity of the path this pair belongs to — the transport id,
    falling back to the local candidate's, then to one constant per peer
    connection. Never the pair id, so a path survives a pair switch.

### IceCandidateMonitor

Adds `isRelay`, `turnTransport` (normalized `relayProtocol`), `turnServer` and
`addressFamily` (`'ipv4'` / `'ipv6'`, `undefined` behind an mDNS name).

### IceTransportMonitor

ICE transport layer monitoring:

**Properties:**

-   `selectedCandidatePair`: Currently selected candidate pair
-   `everConnected`: a latch, set the first time `iceState` reads `connected` or `completed` and never cleared. It is what separates a path that **never established** from one that **established and was then lost** — two conditions with different causes and different fixes that `iceState === 'failed'` alone conflates. [`ice-connection-failed`](./CONNECTION_DETECTORS.md#the-layer-5-detectors) carries it on its payload for exactly that reason.
-   `deltaTime`: milliseconds between this transport's stats report and the previous one, from the reports' own timestamps. Every transport-level detector accumulates this rather than wall-clock elapsed.
-   All standard ICE transport fields

### SelectedIcePath

The live selected path of one ICE transport, reachable as
`peerConnectionMonitor.selectedIcePath` (the single path — with BUNDLE
negotiated, which is the normal case and always the case for mediasoup
transports, a peer connection has exactly one) or `selectedIcePaths` (all of
them, for a connection whose m-lines were not bundled and can sit on different
paths).

It holds **no copies** of candidate data: `kind`, `usingTurn`, `relayProtocol`,
`turnServer`, `tuple`, addresses, ports and address families are getters reading
through the linked pair and its candidates, alongside `pair`, `localCandidate`,
`remoteCandidate` and `iceTransport`. It follows the pair it is updated with, so
it can never disagree with the stats.

What it owns is what those monitors cannot express:

-   **Transitions.** It compares the selected pair between ticks and emits
    `'ice-path-changed'` with `transition` of `'initial-selection'`,
    `'direct-to-relay'`, `'relay-to-direct'`, `'relay-protocol-changed'`,
    `'turn-server-changed'` or `'path-changed'`, plus `from` / `to` evidence.
-   **TURN usage facts.** `durations` per path kind, `relayDurationInMs`,
    `timeToFirstRelayInMs`, the switch counters, and relay-vs-total bytes and
    packets with `relayBytesRatio`. These are measurements, not verdicts — the
    client does not judge whether TURN usage was appropriate.

```typescript
monitor.on('ice-path-changed', ({ selectedIcePath, transition, from, to }) => {
    console.log(`${transition}: ${from?.kind ?? 'none'} -> ${to.kind}`);
    console.log('relay share of traffic so far:', selectedIcePath.relayBytesRatio);
});
```

These accumulators are deliberately **not** part of the client sample. The sample
already carries `iceTransports`, `iceCandidatePairs` and `iceCandidates`, so a
server can resolve the selected pair and derive the same facts itself, and the
sub-sample transitions it would otherwise miss arrive as
`PEER_CONNECTION_ICE_PATH_CHANGED` client events.

## appData and attachments

Every monitor supports two types of additional data properties that serve different purposes:

**`attachments`** - Data shipped with ClientSample:

-   Included in the `ClientSample` when `createSample()` is called
-   Sent to your analytics backend/server
-   Used for server-side processing, analysis, and correlation
-   Survives the monitoring lifecycle and becomes part of the permanent sample data

**`appData`** - Application-specific data (not shipped):

-   Never included in `ClientSample` creation
-   Used exclusively for local application logic
-   Temporary data for runtime decisions and local processing
-   Does not consume bandwidth or storage in your analytics pipeline

```javascript
// Set application data (not shipped with samples)
trackMonitor.appData = {
    userId: "user-123",
    internalTrackId: "track-abc",
    localProcessingFlags: { enableProcessing: true },
};

// Set attachments (shipped with samples)
trackMonitor.attachments = {
    roomId: "room-456",
    participantRole: "presenter",
    mediaType: "screen-share",
    customMetrics: { quality: "high" },
};
```

Every monitor in the hierarchy supports both properties:

-   `ClientMonitor.attachments` / `ClientMonitor.appData`
-   `PeerConnectionMonitor.appData` (attachments set via tracks)
-   All track monitors: `InboundTrackMonitor`, `OutboundTrackMonitor`
-   All RTP monitors: `InboundRtpMonitor`, `OutboundRtpMonitor`, etc.
-   All connection monitors: `IceCandidatePairMonitor`, `IceTransportMonitor`, etc.

**Use Cases:**

_attachments_ for:

-   User/session identification for server-side analysis
-   Room/conference context for grouping samples
-   A/B testing flags for performance comparison
-   Custom quality metrics for specialized analysis

_appData_ for:

-   Local UI state management
-   Runtime feature toggles
-   Temporary computation results
-   Internal application routing information

# Stats Adapters

Stats adapters provide a powerful mechanism to customize how WebRTC statistics are processed before being consumed by monitors. They handle browser-specific differences and allow custom preprocessing logic.

## Built-in Adapters

Every engine deviates from the [W3C webrtc-stats](https://www.w3.org/TR/webrtc-stats/) specification — legacy aliases, spec-removed members, missing dictionaries, renamed fields. The library ships one normalizing adapter per browser family, applied automatically based on the detected browser, so the monitors (and everything downstream — detectors, samples, your own code) always see stats as close to the standard shape as possible. Each fix feature-detects from the report itself rather than parsing browser versions, so an adapter applied to an already-conformant report is a no-op.

Adapters do exactly three things: **fold** a value into the standard field it provably belongs to (a renamed member, a legacy report carrying the same measurement), **infer references** — the `*Id` fields that wire one report to another — and **map** legacy enum spellings onto the values the monitors accept.

Inferring a reference is safe where computing a measurement is not. A reference is a structural link, and the report graph either determines it or it doesn't; when it doesn't, the field is left unset rather than guessed. Measured values are never invented: a number a browser omits stays omitted, because an approximation is indistinguishable downstream from a measurement and a detector cannot tell that it is judging a guess.

Nothing is thrown away except a value that survives elsewhere — a member folded into its standard name, or a legacy report whose contents were relocated. Members the spec dropped but a browser still fills (a candidate pair's `priority`, Chromium's `contentType`, Firefox's `selected`) are left on the stat: the browser measured them, monitors copy through whatever they receive, and removing them would only destroy information.

### ChromeStatsAdapter (Chrome, Edge, Opera)

Folds: `mediaType` → `kind` (the legacy alias, still emitted on every RTP report); `ip` → `address` on ICE candidate reports (Chromium emits both spellings with identical values); the deprecated `track`/`stream` reports and their `trackId` reference (Chrome ≤ M111) → the matching `inbound-rtp` fields.

Infers: `mediaSourceId`, `transportId`, the `remoteId`/`localId` cross-references and `codecId` when absent — normally a no-op on Chromium, kept as a safety net for older versions and for stats arriving through a relay that dropped them.

### SafariStatsAdapter

Folds: the deprecated `track` reports (Safari ≤ 16.x) → `inbound-rtp` — most importantly `trackIdentifier`, absent on `inbound-rtp` before Safari 16.4, without which a stream cannot be bound to its `MediaStreamTrack` at all, plus freeze/pause counters, frame geometry and audio levels; `mediaType` → `kind`; `data-channel.datachannelid` → `dataChannelIdentifier` (Safari ≤ 17.6).

Maps: legacy `candidate-pair.state` spellings → the spec enum (`inprogress` → `in-progress`, `cancelled` → `failed`).

Infers: `codec.transportId`, spec-required but unfilled through Safari 17.3; `inbound-rtp.remoteId`, which WebKit dropped in Safari 16.4 through 16.6, severing an inbound stream from the sender's clock and RTCP round trip; plus `mediaSourceId` and `codecId` where older WebKit omits them.

### FirefoxStatsAdapter

Folds: `mediaType` → `kind`; the non-standard `discardedPackets` alias → `packetsDiscarded`. Maps `candidate-pair.state: 'cancelled'` → `'failed'`. Brace-wrapped `{uuid}` track identifiers are intentionally left alone — Firefox wraps `MediaStreamTrack.id` the same way, so they match the application's track ids exactly as emitted.

Reconstructs the whole `transport` report, which Firefox ships none of before Firefox 153, from the `candidate-pair` marked `selected` — accumulating that pair's measured packet and byte counters, and carrying the totals across a selected-pair change rather than jumping back to the new pair's own counters, so ICE-level monitoring behaves the same across browsers. Every number comes from the pair the browser reported. A no-op as soon as a native transport report is present.

Reference inference matters most here, since Firefox omits the most: `outbound-rtp.mediaSourceId`, never emitted, and the link through which a sent stream reaches its source and its `MediaStreamTrack` — resolved by kind when a single source of that kind exists (so simulcast encodings all resolve to it), left unset when a camera and a screen share make it ambiguous. Also `transportId` on RTP, codec and ICE reports, absent before Firefox 153 — resolved to the sole transport, native or reconstructed — plus the `remoteId`/`localId` cross-references and `codecId`, which respects the `encode`/`decode` direction Firefox tags on codec entries.

This is the one stateful adapter, since the reconstructed transport accumulates across ticks: one instance per peer connection, and it should see every tick. Re-adapting the same tick is harmless — the accumulation is keyed on the collection timestamp.

### Deviations the adapters do not correct

These fields are absent because the browser does not measure them, and nothing in the report can stand in without guessing:

-   `inbound-rtp.framesRendered` — no engine emits it.
-   `remote-inbound-rtp.packetsReceived` — Chromium and WebKit never emit it.
-   Firefox: `qualityLimitationReason`/`Durations`, `totalPacketSendDelay`, `targetBitrate`, `media-source` audio levels, `media-playout` reports, `remote-outbound-rtp` round-trip time.
-   Safari: `media-playout` reports (so `playoutId` and audio-playout metrics are unavailable) and the `address` on host/peer-reflexive ICE candidates, which WebKit nulls.
-   Chromium: `candidate-pair.requestsSent` counts only STUN checks sent before the first response — every later check lands in `consentRequestsSent`, so the sum of the two is the real total. `inbound-rtp.packetsDiscarded` is audio-only.

### Adding a version-scoped adapter

There is deliberately one adapter per browser family, not one per browser version. Every fix guards on the data — fold `mediaType` if it is there, fill `transportId` if it is missing, rebuild the `transport` report if none is present — which is why a single Firefox adapter covers Firefox 96 through 155 without knowing which it is talking to. Most spec deviations are of the form "this field only exists from version N", and a presence check handles those for free, with no version matrix to maintain across the boundaries each engine has (Firefox at 96, 104, 106, 135, 142, 153, 154; Safari at 16.4, 17.0, 17.4, 18.0).

A version gate is warranted only when the report cannot answer the question: the same field, present in every version, *meaning* something different in a range — a unit change, a counter switching from monotonic to per-interval, or a value that is actively wrong in known builds. None of the deviations handled today are of that kind. Prefer the data whenever it can answer, because a reported user-agent version is the less trustworthy signal: Edge, Opera and Brave lag Chromium and do not report its version, WebViews version themselves oddly, and UA reduction freezes minor versions, so a version gate can be wrong about the engine in a way a presence check cannot.

When one is genuinely needed, register it alongside the browser adapter rather than gating inside shared code — `Sources.addStatsAdapters` already has the browser name and version, and `StatsAdapters` composes adapters in registration order:

```typescript
case "firefox": {
    pcMonitor.statsAdapters.add(new FirefoxStatsAdapter());
    if (majorVersion < 142) pcMonitor.statsAdapters.add(new FirefoxJitterUnitsAdapter());
    break;
}
```

Name it after the deviation it corrects, not the version that introduced it. `FirefoxJitterUnitsAdapter` still says what it does after the next boundary moves; `Firefox94StatsAdapter` — this library's former adapter, which despite its name ran on every Firefox version — said nothing at all.

## Custom Stats Adapters

Create custom adapters by implementing the `StatsAdapter` interface:

```javascript
import { StatsAdapter } from "@observertc/client-monitor-js";

class CustomStatsAdapter {
    name = "custom-stats-adapter";

    adapt(stats) {
        // Pre-processing: runs before monitor updates
        return stats.map((stat) => {
            if (stat.type === "inbound-rtp" && stat.trackIdentifier) {
                // Custom track identifier normalization
                stat.trackIdentifier = stat.trackIdentifier.replace(/[{}]/g, "");
            }

            if (stat.type === "outbound-rtp" && stat.mediaSourceId) {
                // Add custom metadata
                stat.customQualityFlag = this.calculateQualityFlag(stat);
            }

            return stat;
        });
    }

    postAdapt(stats) {
        // Post-processing: runs after initial monitor updates
        // Useful for cross-stat calculations
        const inboundStats = stats.filter((s) => s.type === "inbound-rtp");
        const outboundStats = stats.filter((s) => s.type === "outbound-rtp");

        // Add custom correlation stats
        if (inboundStats.length > 0 && outboundStats.length > 0) {
            stats.push({
                type: "custom-correlation",
                id: "correlation-metrics",
                timestamp: Date.now(),
                totalStreams: inboundStats.length + outboundStats.length,
                avgBitrate: this.calculateAvgBitrate(inboundStats, outboundStats),
            });
        }

        return stats;
    }

    calculateQualityFlag(stat) {
        // Custom quality assessment logic
        return stat.bitrate > 1000000 ? "high" : "standard";
    }

    calculateAvgBitrate(inbound, outbound) {
        // Custom correlation calculation
        const totalBitrate = [...inbound, ...outbound].reduce((sum, stat) => sum + (stat.bitrate || 0), 0);
        return totalBitrate / (inbound.length + outbound.length);
    }
}

// Add to peer connection monitor
const adapter = new CustomStatsAdapter();
pcMonitor.statsAdapters.add(adapter);

// Remove adapter
pcMonitor.statsAdapters.remove(adapter);
// or by name
pcMonitor.statsAdapters.remove("custom-stats-adapter");
```

## Adapter Processing Flow

Adapters are processed in a specific order during stats collection:

1. **Raw Stats Collection**: `getStats()` called on peer connection
2. **Pre-Adaptation**: `adapt()` method called on all adapters in order
3. **Monitor Updates**: Monitors process adapted stats and update derived fields
4. **Post-Adaptation**: `postAdapt()` method called for advanced cross-stat processing
5. **Final Processing**: Detectors run and scores calculated

## Advanced Adapter Examples

### Mediasoup Probator Filter

```javascript
class MediasoupProbatorFilter {
    name = "mediasoup-probator-filter";

    adapt(stats) {
        // Filter out mediasoup probator tracks
        return stats.filter((stat) => {
            if (stat.type === "inbound-rtp" || stat.type === "outbound-rtp") {
                return stat.trackIdentifier !== "probator";
            }
            return true;
        });
    }
}
```

### Bandwidth Estimation Adapter

```javascript
class BandwidthEstimationAdapter {
    name = "bandwidth-estimation-adapter";

    postAdapt(stats) {
        const candidatePairs = stats.filter((s) => s.type === "candidate-pair");
        const selectedPair = candidatePairs.find((p) => p.state === "succeeded");

        if (selectedPair && selectedPair.availableIncomingBitrate) {
            // Add custom bandwidth metrics
            stats.push({
                type: "custom-bandwidth",
                id: "bandwidth-estimation",
                timestamp: Date.now(),
                estimatedBandwidth: selectedPair.availableIncomingBitrate,
                bandwidthUtilization: this.calculateUtilization(stats, selectedPair),
            });
        }

        return stats;
    }

    calculateUtilization(stats, selectedPair) {
        const totalBitrate = stats
            .filter((s) => s.type === "inbound-rtp")
            .reduce((sum, s) => sum + (s.bitrate || 0), 0);
        return totalBitrate / selectedPair.availableIncomingBitrate;
    }
}
```

---

[← back to the README](../README.md)
