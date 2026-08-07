## 4.4.0

### Major Features

-   **ICE Connectivity Detection**: A new `IceConnectivityDetector` covers runtime ICE and transport health, per ICE transport (a peer connection without BUNDLE has several, and they fail independently). Peer-connection setup latency stays with `LongPcConnectionEstablishmentDetector`.
    -   `ice-disconnected`: raised only once `disconnected` has persisted past `disconnectedThresholdInMs`, so the transient blips ICE routinely heals on its own never produce an issue. Recovery resolves it with the episode duration.
    -   `ice-connection-failed`: raised immediately on `failed`, which is terminal for that ICE generation.
    -   `ice-transport-stalled`: deliberately narrow — raised only while this endpoint is still *sending* on a succeeded pair of a connected transport but receives nothing, and only after inbound traffic had previously been observed. "No traffic in either direction" is not reported, because at peer-connection level it cannot be distinguished from a legitimately idle or paused connection.
    -   `unstable-ice-path`: raised when the selected path switches `pathSwitchThreshold` times within `pathSwitchWindowInMs`.
-   **ICE Restart Recommendation**: The detector reports *when* an ICE restart is warranted and leaves performing it to the application — only the application knows whether renegotiation is safe, whether signalling is up, or whether it would rather rejoin. Listen for `'ice-restart-recommended'` (also buffered as the `ICE_RESTART_RECOMMENDED` client event). It fires immediately on `failed`, and after `iceRestartRecommendationThresholdInMs` for a persistent `disconnected`, an inbound stall, or a peer connection that never finished establishing (`never-established`, tracked from `connectionState` so it covers a stuck DTLS handshake and attempts that never produce a reportable transport); it stays quiet while a restart the application already started is in flight, spaces repeats by `iceRestartRecommendationCooldownInMs`, and carries `recommendationCount` and `iceGeneration` so applications can back off after repeated failed attempts.
-   **ICE Restart Inference**: A changed ICE local username fragment (falling back to the selected local candidate's) is reported as `'ice-restart'` with an `outcome` of `'detected'`, `'recovered'` or `'failed'`, and increments a per-transport ICE generation counter. A `connected → checking` transition alone is never treated as a restart. High-confidence detection still needs the application to instrument `restartIce()`; Firefox exposes no username fragment on the synthesized transport report, so inference degrades there.
-   **`SelectedIcePath`**: The live selected path of an ICE transport, at `peerConnectionMonitor.selectedIcePath` (singular; with BUNDLE — always the case for mediasoup transports — there is exactly one) and `selectedIcePaths`. It stores no copies of candidate data: every descriptive getter reads through the linked candidate pair and its candidates, so it can never disagree with the stats. It emits `'ice-path-changed'` for direct↔relay, relay-protocol, TURN-server and tuple changes, and accumulates TURN usage facts — per-kind durations, `timeToFirstRelayInMs`, switch counters, and relay-vs-total traffic with `relayBytesRatio`. These are measurements, not verdicts; they are kept client-side rather than added to the sample, since the sample already carries everything a server needs to derive them.
-   **ICE path helpers on the monitors**: `IceCandidatePairMonitor` gained `usingTurn`, `usingTcp`, `relayProtocol`, `pathKind`, `turnUrl`, `turnServer`, `tuple` and `pathKey`; `IceCandidateMonitor` gained `isRelay`, `turnTransport`, `turnServer` and `addressFamily`. Every path signal is now read from one candidate of one pair.

### Bug Fixes

-   **`usingTURN` could be true when no pair used TURN**: `PeerConnectionMonitor` evaluated `relayProtocol` and the candidate `url` in two independent `.some()` calls, so one candidate carrying `relayProtocol` and a *different* one carrying a `turn:` url together produced a false positive. TURN is now decided per pair from the local candidate's `candidateType === 'relay'`. The `url` check was dropped entirely: srflx candidates discovered through a TURN server's STUN function also carry a `turn:` url, so it never indicated a relay path.
-   **Negative deltas after counter resets**: `IceCandidatePairMonitor` and `IceTransportMonitor` subtracted cumulative counters without guarding against a reset (stats-object replacement, ICE restart), so a delta — and the bitrate derived from it — could go negative.
-   **`deltaOutboundPacketsSent` was never reset**: every other per-tick delta is zeroed at the top of `PeerConnectionMonitor.accept()`; this one accumulated across ticks and inflated `totalOutboundPacketsSent` quadratically.
-   **Stats were adapted twice per tick**: `collect()` ran `statsAdapters.adapt()` and then called `accept()`, which adapted again. Stateful adapters such as `FirefoxTransportStatsAdapter` are not idempotent, so the second pass was a latent corruption hazard. Adaptation now happens exactly once; `accept()` still adapts raw stats for direct callers.
-   **`CongestionDetector` reported the wrong bitrate**: the `congestion` event payload carried `maxReceivingBitrate` taken from `_maxSendingBitrate`.
-   **`ClientMonitor.collect()` kept collecting after close**: the closed check only logged a warning. `avgRttInSec` also became `NaN` when no peer connection was registered.
-   **A slow establishment after a failed attempt was never reported**: `LongPcConnectionEstablishmentDetector` cleared its one-shot flag only when `connectionState` reached `connected`, so after one failed attempt every later slow establishment on that peer connection was silent — even though a retry failing is more interesting than the first attempt. It now rearms on any exit from `connecting`.
-   **Stale state survived an ICE restart**: a restart now closes the previous generation's issues and clears its bookkeeping. Previously a re-failure in the new generation looked like the already-reported one, so it was never reported and the transport stayed permanently mid-restart, silencing later findings.

### Other Changes

-   `PEER_CONNECTION_ICE_PATH_CHANGED`, `ICE_RESTART`, `ICE_RESTART_RECOMMENDED`, `LONG_PC_CONNECTION_ESTABLISHMENT` and `EXCESSIVE_SYNTHESIZED_AUDIO` are now members of the `ClientEventTypes` enum with payload types, instead of raw strings at the emission sites. Mirror them in the server-side schema if you switch on event types there.
-   `IceTupleChangeDetector` now reads the tuple from the candidate pair instead of rebuilding it, so it and the connectivity detectors always agree on the selected path. It remains the low-level primitive: it reports *that* the tuple set changed, `SelectedIcePath` classifies *what kind of* change it was, and only `IceConnectivityDetector` raises issues.
-   New `iceConnectivityDetector` config block (`null` disables it, as with every detector): `disconnectedThresholdInMs` (5000), `transportStallThresholdInMs` (5000), `pathSwitchWindowInMs` (30000), `pathSwitchThreshold` (3), `iceRestartRecommendationThresholdInMs` (10000), `iceRestartRecommendationCooldownInMs` (15000), `createEvent` (true).
-   New monitor events: `'ice-path-changed'`, `'ice-restart'`, `'ice-restart-recommended'`, `'new-selected-ice-path'`.

## 4.3.2

### Bug Fixes

-   **CPU Detector — false alerts on screen share**: `CpuPerformanceDetector` no longer infers inbound CPU limitation from frame-rate (FPS) volatility, which false-triggered on content such as screen share whose frame rate legitimately swings (e.g. 15 → 1 fps when the shared content goes static). Inbound limitation is now inferred from the ratio of decoded to received frames per stats interval: when the decoder cannot keep up, frames are received but not decoded, so the ratio drops; when fps drops legitimately, received and decoded frames drop together and the ratio stays near 1.0 (no alert). Evaluated on video tracks only, with the existing on/off hysteresis and a minimum received-frame guard. Outbound `qualityLimitationReason === 'cpu'` and stats-collection-duration signals are unchanged.
    -   Config: `cpuPerformanceDetector.fpsVolatilityThresholds` (`{ lowWatermark, highWatermark }`) is replaced by `cpuPerformanceDetector.incomingDecodedFramesRatioThresholds` (`{ alertOn, alertOff, minReceivedFrames }`), defaulting to `alertOn: 0.7`, `alertOff: 0.85`, `minReceivedFrames: 10`. Applications passing `fpsVolatilityThresholds` should update their config.

## 4.3.1

### Bug Fixes

-   Added `dataChannels` to peer connection sample serialization so tracked data channel stats are included in `ClientSample.peerConnections[].dataChannels`.

## 4.3.0

### Major Features

-   **Issue Lifecycle Rework**: The issue system has been rebuilt around a stateful raise/resolve lifecycle keyed by an explicit `key` string. One-shot logging stays available; stateful issues that can be cleared now have a first-class API.
    -   `raiseIssue(key, { type, payload?, timestamp? })`: Creates (or refreshes) a stateful issue. Re-raising with the same `key` updates the entry in place and emits `'issue-updated'` instead of `'issue'`.
    -   `resolveIssue(key, { comment?, payload?, resolvedAt? })`: Resolves a single stateful issue by its `key`. The optional `payload` overwrites the active issue's payload, so detectors enrich the resolved record with episode-level info such as `durationInMs`.
    -   `addIssue({ type, payload?, timestamp? })`: Kept for one-shot, non-stateful issues (e.g. `USER_MEDIA_ERROR`). Emits `'issue'` and buffers into the next sample but never enters the active store and cannot be resolved.
    -   `getActiveIssuesByType(type?)`: Snapshot of currently active stateful issues, optionally filtered by type.
    -   `isIssueActive(key)`: True when a stateful issue with the given key is currently active.
    -   `activeIssues` is now a public read-mostly `Map<string, RaisedClientIssue>` keyed by `key` (previously `Record<string, ClientIssue[]>`).
-   **Discriminated Union for Built-In Issues**: New `ClientMonitorIssue` and `ClientMonitorResolvedIssue` unions narrow `payload` from the `type` discriminator. `switch (issue.type)` inside an `'issue'` / `'issue-resolved'` listener gives full payload typing for every detector that ships with the library, plus `isClientMonitorIssue` / `isClientMonitorResolvedIssue` runtime type guards.
-   **Detector Runtime Toggle**: Every built-in detector now carries a `public disabled = false` field. Flip it at any time (`monitor.detectors` or via the parent peer-connection / track instance) to silence a detector without removing it. `Detectors.update()` skips `disabled === true` entries, and each detector's own `update()` short-circuits as well — so direct invocations behave consistently.
-   **`null` Config = "Don't Instantiate"**: Every detector field in `ClientMonitorConfig` is now typed as `Type | null`. Passing `null` for a detector skips its construction entirely (no instance, no `update()` overhead). Passing `undefined` (the omitted case) still applies the documented defaults; passing an object enables the detector with the provided overrides.
-   **Ergonomic `Detectors` Registry**: The `Detectors` registry attached at every level (`monitor.detectors`, `peerConnectionMonitor.detectors`, track-level `detectors`) now exposes a proper public API for inspection and runtime toggling: `size`, `has(name)`, `getByName<T>(name)`, `find(pred)`, `filter(pred)`, iteration (`for (const d of detectors)`), and the toggle helpers `disable(name)` / `enable(name)` / `disableAll()` / `enableAll()` / `isEnabled(name)`. The previous mutation API (`add` / `remove` / `clear` / `update` / `listOfNames`) is preserved.

### Breaking Changes

-   **Logger API Refactor**: Removed the global `setLogger` API in favor of instance-level logger injection via `ClientMonitor`.
-   **Removed**: `ClientMonitor.resolveActiveIssues(type, issueOrFilter, comment?)` is gone. Callers that resolved stateful issues should switch to `raiseIssue` + `resolveIssue(key, …)`.
-   **Changed**: `ClientMonitor.activeIssues` shape — was `Record<string, ClientIssue[]>` (mutable, sometimes containing stringified payloads), now a `Map<string, RaisedClientIssue>` keyed by issue `key`. Use `getActiveIssuesByType(type?)` / `isIssueActive(key)` instead of `Object.keys` / index access.
-   **Removed**: `createIssue?: boolean` from every detector's config block (`videoFreezesDetector`, `dryInboundTrackDetector`, `dryOutboundTrackDetector`, `audioDesyncDetector`, `congestionDetector`, `cpuPerformanceDetector`, `playoutDiscrepancyDetector`). Whether a detector raises an issue is now the detector's own decision; applications that do not want issues from a particular detector should pass `null` for that detector's config, or flip `detector.disabled = true` at runtime.
-   **Removed**: `disabled?: boolean` from every detector's config block. The flag now lives on the detector instance (`detector.disabled`). The new `Detector` interface includes an optional `disabled?: boolean` so custom detectors can opt in.
-   **Renamed event**: `'resolved-issue'` is now `'issue-resolved'` for consistency with `'issue-updated'`.
-   **Type rename / shape**: `ClientIssue` is now a discriminated union of `AddedClientIssue | RaisedClientIssue`. The wire format on `ClientSample.clientIssues` is unchanged (`{ type, payload?: string, timestamp }`), but in-memory issues carry richer fields. `ResolvedClientIssue` extends `RaisedClientIssue` (which carries `key`, `raisedAt`, `updatedAt`).

### Improvements

-   **Logger Propagation**: `ClientMonitor` now propagates the same logger instance to sources and monitors.
-   **Module-Prefixed Logs**: Internal logs now include module prefixes such as `[ClientMonitor]:` and `[Sources]:` for easier filtering.

### Bug Fixes

-   **`activeIssues` payload corruption**: Previously, `addIssue` stored a JSON-stringified payload in `activeIssues` while emitting the original object via `'issue'`. Every detector's resolve filter then tried to read `(issue.payload as Record).trackId` off a string and silently failed — issues never resolved, the active store grew unbounded. Fixed: in-memory issues keep the original payload object; stringification happens only at sample-serialization time.
-   **Resolution return value**: The old `resolveActiveIssues` returned the *remaining* issues, not the resolved ones, contradicting its name. The new `resolveIssue` returns the resolved issue (or `undefined` if no match).
-   **Reference-equality dead branch**: `resolveActiveIssues(type, issueObject)` could never match because the stored object was a copy of the input. The new API takes a `key` string, eliminating the foot-gun.
-   **`'issue'` event gated on sampling**: Issue events were silently dropped when sampling was disabled and `bufferingEventsForSamples` was false. Event emission is now unconditional; only the sample buffer is gated.
-   **Dry-track detectors spammed events**: `DryInboundTrackDetector` and `DryOutboundTrackDetector` fired their detector-specific event (and re-raised the issue) on every update tick while the dry condition persisted. They now emit exactly once per episode, mirroring the pattern in `AudioDesyncDetector` / `CongestionDetector`.
-   **Extension Stats Providers**: Fixed provider execution in `collect()` so configured extension stat providers are executed and appended to samples correctly.

### Helpers

-   **`AudioDesyncIssuePayload`, `CongestionIssuePayload`, `CpuPerformanceIssuePayload`, `DryInboundTrackIssuePayload`, `DryOutboundTrackIssuePayload`, `FreezedVideoTrackIssuePayload`, `PlayoutDiscrepancyIssuePayload`** are now exported from the package root, so applications can import the exact payload type for each detector.
-   **Resolved issues carry `durationInMs`** on the payload for episode-length detectors (`audio-desync`, `congestion`, `cpulimitation`, `dry-inbound-track`, `dry-outbound-track`, `freezed-video-track`, `inbound-video-playout-discrepancy`). The detector measures the time from `raise` → `resolve` and merges it into the resolved payload.
-   **Auto-resolve on `close()`**: `ClientMonitor.close()` now resolves every still-active issue with `comment: 'monitor closed before issue could be resolved'`, so consumers see a clean lifecycle even if the call drops mid-incident.

### Migration

| Before | After |
|---|---|
| `monitor.addIssue({ type: 'congestion', payload: { … } })` (for a resolvable issue) | `monitor.raiseIssue('congestion-pc-1', { type: 'congestion', payload: { … } })` |
| `monitor.addIssue({ type: 'USER_MEDIA_ERROR', payload: { … } })` (fire-and-forget) | Unchanged — `addIssue` still does the right thing for one-shot logs. |
| `monitor.resolveActiveIssues('congestion', issue => issue.payload.peerConnectionId === 'pc-1')` | `monitor.resolveIssue('congestion-pc-1')` |
| `monitor.activeIssues['congestion']?.[0]` | `monitor.getActiveIssuesByType('congestion')[0]` |
| `monitor.config.congestionDetector.disabled = true` | `peerConnectionMonitor.detectors`-located instance: `detector.disabled = true`; **or** at construction time: `new ClientMonitor({ congestionDetector: null })` to skip instantiation entirely. |
| `monitor.config.audioDesyncDetector.createIssue = false` | Removed. Pass `audioDesyncDetector: null` to skip, or flip `detector.disabled` at runtime. |
| `monitor.on('resolved-issue', …)` | `monitor.on('issue-resolved', …)` |

### Documentation

-   **README**: Rewrote the "Events and Issues" section to cover the new lifecycle, the `ClientMonitorIssue` discriminated union, the `disabled` runtime toggle, the `null`-disables-instantiation config semantics, and end-to-end examples for every built-in detector.
-   **README Logging Section**: Expanded logging documentation with basic, production-adapter, and no-op logger examples.
-   **Score Calculation Notes**: Documented outbound video scoring behavior for screen-share tracks (`contentHint: 'screen'`).

## 4.1.0

### Major Features

-   **Issue Resolution Management**: Introduced `resolveActiveIssues()` method to manage and resolve active issues in real-time
    -   Issues can now be resolved by filter function or by direct reference
    -   Method returns remaining active issues after resolution
    -   Emits `resolved-issue` events when issues are resolved
-   **Active Issues Tracking**: Added `activeIssues` property to ClientMonitor to track all currently active issues by type
-   **Extension Stats Providers**: Implemented extensible stats provider system for injecting custom application metrics
    -   Supports both synchronous and asynchronous providers
    -   Custom stats are automatically included in every sample
    -   Allows correlation of WebRTC metrics with application-specific data

### Improvements

-   **Issue vs Event Distinction**: Clear separation between Issues (resolvable problems) and Events (immutable notifications)
    -   Issues can be resolved when the problem goes away
    -   Events are permanent records of what happened
    -   Detectors now properly use `createIssue` or `createEvent` based on the type of notification
-   **Multiple Event Emissions**: Dry track detectors can now emit multiple events during a single dry period, providing more granular tracking
-   **Detector Configuration**: Clarified and corrected detector configuration comments to reflect actual implementation
    -   `syntheticSamplesDetector` and `longPcConnectionEstablishmentDetector` use `createEvent`
    -   All other detectors use `createIssue`

### Documentation

-   **Enhanced README**: Comprehensive documentation on issue management and resolution
    -   New "Managing Active Issues" section with practical examples
    -   Clear explanation of Events vs Issues distinction
    -   Extended "Extension Stats Providers" subsection in "Collecting and Adapting Stats"
-   **Configuration Comments**: Updated `ClientMonitorConfig.ts` with accurate descriptions of each detector's configuration options

### Bug Fixes

-   **Dry Inbound Track Detector**: Added missing `_evented` flag check to prevent duplicate event emissions
-   **Configuration Consistency**: Fixed property names in detector configurations (`createEvent` vs `createIssue`)

### Migration Notes

This is a minor version update with no breaking changes. Existing applications will continue to work as-is. New applications can take advantage of:

-   The `resolveActiveIssues()` method for dynamic issue management
-   Extension stats providers for custom application metrics
-   Improved issue resolution and tracking capabilities

## 4.0.0

### Breaking Changes

-   **Schema v3.0.0**: Upgraded to use schema version 3.0.0 for sampling with new data structures
-   **API Refactor**: Complete ClientMonitor API refactor with breaking changes
-   **Detector Architecture**: Rewritten detector and monitor system for better performance

### Major Features

-   **Enhanced Detectors**: Added comprehensive documentation and unit tests for all detectors
-   **Score System**: Improved scoring system with detailed score reasons for tracks and connections
-   **Event Handling**: Enhanced event system with better payload handling and new event listeners
-   **Stats Adapters**: Refactored stats adapter architecture for improved statistics collection
-   **Issue Creation**: Added configurable `createIssue` flag across all detectors

### Configuration & Build

-   **Build Process**: Updated to TypeScript compiler with ES module support and minification
-   **Package Config**: Enhanced package.json with better entry points and Node.js 14+ requirement
-   **Documentation**: Restructured documentation with comprehensive README and examples

### Migration Notes

This is a major version with breaking changes. Applications using v3.x will need to update API usage, detector configurations, and event handlers to work with the new architecture.

## 3.0.0

-   The ClientMonitor API is simplified and refactored.

## 2.3.0

-   refactored collectors and sampler
-   `clientMontior.os` is moved to `clientMonitor.meta.operationSystem`
-   `clientMontior.engine` is moved to `clientMonitor.meta.engine`
-   `clientMontior.browser` is moved to `clientMonitor.meta.browser`
-   `clientMontior.audioInputs` is moved to `clientMonitor.meta.audioInputs`
-   `clientMontior.audioOutputs` is moved to `clientMonitor.meta.audioOutputs`
-   `clientMontior.videoInputs` is moved to `clientMonitor.meta.videoInputs`
-   `clientMonitor.alerts` is removed, `clientMonitor.audioDesyncDetector`, `clientMonitor.cpuPerformanceDetector`, and `clientMonitor.congestionDetector`
-   all `updates` fields in storage entries are moved to the entries of the `storage`
-   `metrics` field is removed `elapsedSinceLastCollectInMs` and `elapsedSinceLastSampleInMs` is added to the `stats-collected`, and `sample-created` events
-   refactored mediasoup-collector
-   add events are collected automatically
-   simplified configuration, and detectors configurations are moved to create detectors

## 2.1.0

-   Remove dependency @observertc/samples-schema
-   Add Samples and W3cStats to the source under the `./src/schema` library

## 2.0.0

### Conceptual changes

-   The ClientMonitor is no longer responsible for WebSocket connections, signaling, and transports.
-   The ClientMonitor has become responsible for the following event emissions:
    -   PEER_CONNECTION_OPENED, PEER_CONNECTION_CLOSED
    -   MEDIA_TRACK_ADDED, MEDIA_TRACK_REMOVED
    -   ICE_CONNECTION_STATE_CHANGED
-   Specific collectors can add additional call events. For example, mediasoup adds PRODUCER_PAUSED, PRODUCER_RESUMED, CONSUMER_PAUSED, CONSUMER_RESUMED events.
-   ClientMonitor calculate derived metrics such as sending, and receiving bitrates, total sent and received packets.

### Major Code changes

-   Removed Sender component and corresponding configuration from ClientMonitor.
-   Removed Transport component, as sending and transporting no longer fall under the responsibility of the ClientMonitor.
-   Storage StatsEntries `id` is renamed to `statsId`.
-   PeerConnectionEntry `collectorId` is renamed to `id`, and `collectorLabel` to `label`.
-   Removed `setUserId`, `setCallId`, `setClientId`, `setRoomId`, and `marker` from ClientMonitor, as this information should be used for context creation on the server side, which falls under the responsibility of signaling.
-   Removed `events` field from ClientMonitor, as events have become part of the ClientMonitor itself, and ClientMonitor now provides `on`, `off`, `once` interfaces for events.

### Functionality changes

-   Stats are removed based on visited ids in getStats. If a stat is no longer present in the getStats extracted result, it is removed from the Storage.

### Configuration changes

-   Sampler configuration is reduced.
-   Sender configuration is removed.
-   `statsExpirationTimeInMs` is removed.
-   `createCallEvents` is added.

## 1.3.2

-   Change hash function to makeStamp and stop using sha256 as it turned out to be performance intensive

## 1.3.1

-   Change visibility of MediasoupStatsCollector `addTransport` method to be public
-   make imported schema version to be 2.2.0 instead of the last snapshot

## 1.3.0

-   Change the concept of add and removing stats collectors responsible from the clientMonitor to the Collectors
-   Make warn log instead of throwing exception In case a provided callId is invalid
-   Make callId to be set only once per session
-   Add mediasoup integration
-   Add setter for clientId, and roomId
-   Move addStatsCollector to a new objects called Collectors
-   Add MediasoupStatsCollector, PeerConnectionStatsCollector
-   bugfix timer
-   add event dispatched when client is connected to an observer
-   Add rawstats emitted for onStatsSamples event
-   Add last stats change timestamp to metrics
-   Add Mediasoup hack for trackIdentifier for firefox

## 1.2.0

-   Make timer tick based instead of calculated next delays
-   Be able to collect samples if sender is not available
-   add maxSamples config option to accumulator

## 1.1.0

-   Fix continous media source meta sending due to constantly changing `audioLevel`
-   add ice-candidate-pairs according to schema changes in 2.1.0^
-   align peer-connection-transport changes according to schema changes in 2.1.0^
-   make id navigational alterations in PeerConnectionImpl related to the webrtc schema changes
-   run prettier

## 1.0.1

-   Add validation for extension stats to check if the given payload is a valid json string or not.

## 1.0.0

Init
