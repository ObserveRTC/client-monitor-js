# Roadmap: Detector Factory Refactor

> **Status:** Deferred — not planned for the current release.
> **Created:** 2026-08-06
> **Context:** Design discussion around the partially started migration (see
> `src/detectors/DetectorFactories.ts` and `createCongestionDetectorFactory` in
> `src/detectors/CongestionDetector.ts`). This document captures the agreed
> direction and open decisions so the work can be picked up later without
> re-deriving the reasoning.

## Motivation

Detector construction is currently scattered and inconsistent:

- Four constructors create detectors inline (`ClientMonitor`,
  `PeerConnectionMonitor`, `InboundTrackMonitor`, `OutboundTrackMonitor`),
  each repeating the `if (parent.config.xDetector !== null)` pattern.
- Track monitors reach through `getPeerConnection().parent.config` to find
  their configuration, coupling detectors to the whole monitor hierarchy.
  (The commented-out lazy `config` getter in `CongestionDetector` is a
  leftover of this pattern.)
- Monitors import concrete detector classes, so custom/third-party detectors
  are second-class and the built-ins cannot be tree-shaken.
- Two creation paths coexist since the factory arrays were introduced:
  built-ins are hardcoded in constructors while app-supplied factories are
  applied separately.

Moving detector creation behind factories makes config injection explicit,
makes detectors testable in isolation, decouples monitors from concrete
detector classes, and makes application-supplied detectors first-class.

## Agreed design decisions

### 1. Plain factory arrays, no keys

Factories are stored in simple arrays and added/removed **by reference**
(`addPeerConnectionDetectorFactory(factory)` /
`removePeerConnectionDetectorFactory(factory)`). No name/id key argument.

- Duplicate prevention is the **application's responsibility**. This also
  permits legitimately running two instances of the same detector class with
  different configs.
- The application must keep the reference to any factory it wants to remove
  (factory-creating helpers like `createCongestionDetectorFactory(config)`
  return a fresh closure per call).

### 2. Factory semantics: future monitors only

- Adding a factory applies it to monitors created **after** the call.
- Removing a factory stops it from being applied going forward; it does
  **not** remove detector instances already attached to existing monitors.
- Runtime surgery on a live monitor uses the existing `Detectors` API
  (`monitor.detectors.add()/remove()`, `disable(name)`/`enable(name)`),
  which already covers the dynamic case without retrofit logic in the
  factory layer.
- These semantics must be stated in the JSDoc of every `add*Factory` /
  `remove*Factory` method.

### 3. Factories may decline

Type factories as `(monitor) => Detector | undefined` and skip falsy
returns at the application sites. This moves conditional attachment out of
monitor constructors and into factories, e.g.:

- `AudioDesyncDetector` only on audio tracks
- `FreezedVideoTrackDetector` / `PlayoutDiscrepancyDetector` only on video
  tracks
- skip all detectors on the mediasoup `probator` track

### 4. Config injection instead of lazy config lookup

Detectors take their config as a constructor argument (as
`CongestionDetector` now does) instead of reading
`parent.config.xDetector!` lazily.

Behavioral note: a config snapshot captured in a factory closure no longer
sees runtime mutations of `monitor.config`. This is considered desirable,
but it is a semantic change for a published library — call it out in the
changelog.

## Open decision: who registers the built-in detectors?

Two candidate models were discussed; **the final choice is still open.**

### Option A — batteries included via the factory path (recommended in discussion)

`ClientMonitor`'s constructor registers the built-in detector factories
derived from config (config key set to `null` still means "don't register").
One creation path internally; zero-config consumers keep getting congestion
/ freeze / dry-track / etc. detection out of the box.

Escape hatch for apps that want full control: a config flag (e.g.
`detectors: 'none'`) that skips default registration, and/or an exported
`defaultDetectorFactories(config)` helper for cherry-picking.

- Pros: no silent telemetry loss for existing zero-config consumers;
  smallest migration burden; config-based opt-out fails loud.
- Cons: built-in detectors remain in the bundle (~10 KB minified) even when
  unused; config keeps its per-detector blocks.

### Option B — application registers everything

The library ships no detectors by default; the application composes its own
set from exported factories.

- Pros: minimal core; `ClientMonitorConfig` loses all nine detector blocks
  and the `null`-means-disabled convention; single creation path; detectors
  become fully tree-shakeable.
- Cons: **silent failure mode** — an app that forgets to register detectors
  ships samples with no issues/events and nobody notices until debugging a
  bad call weeks later. Every zero-config consumer breaks without a compile
  error. Relevant: `DefaultScoreCalculator` computes from raw stats and does
  NOT depend on detectors, so scores keep working — which makes the loss of
  issues even harder to notice.
- If chosen: make it loud. Major version bump, remove the detector config
  keys (so TS users who set them get compile errors), write a migration
  guide, and consider a one-time warning log when `collect()` runs with zero
  detectors registered.

## Known gaps in the current (half-migrated) code

These exist today and must be resolved by the refactor:

1. **Two creation paths.** `PeerConnectionMonitor`'s constructor hardcodes
   `LongPcConnectionEstablishmentDetector`, `CongestionDetector`, and
   `IceTupleChangeDetector` while `addPeerConnectionMonitor` also applies
   `peerConnectionDetectorFactories`.
2. **Dead code:** `outboundTrackDetectorFactories` and
   `mediaPlayoutDetectorFactories` are never applied — only
   `onNewInboundTrackMonitorEvent` is wired up in `ClientMonitor`. Calling
   `addOutboundTrackDetectorFactory` today is a silent no-op, and
   `mediaPlayoutDetectorFactories` has no public add/remove methods at all.
3. Track monitors (`InboundTrackMonitor`, `OutboundTrackMonitor`) still
   construct their built-in detectors inline and reach into
   `getPeerConnection().parent.config`.

## Implementation checklist (when picked up)

- [ ] Decide Option A vs Option B above.
- [ ] Change factory types to `(monitor) => Detector | undefined`; skip
      falsy returns at application sites.
- [ ] Add factory-creating helpers per built-in detector (pattern:
      `createCongestionDetectorFactory(config)`), each detector taking its
      config as a constructor argument.
- [ ] Remove inline detector construction from `PeerConnectionMonitor`,
      `InboundTrackMonitor`, `OutboundTrackMonitor` (and
      `CpuPerformanceDetector` in `ClientMonitor` if it moves to the same
      mechanism); move kind/probator filtering into the factories.
- [ ] Wire up the missing application sites: listener for
      `new-outbound-track-monitor` (and media playout if kept), plus public
      add/remove methods for `mediaPlayoutDetectorFactories` or drop it.
- [ ] Document the "future monitors only" add/remove semantics in JSDoc.
- [ ] Update README detector sections + changelog entry covering the
      config-snapshot semantic change.
- [ ] Tests: factory application on new monitors, decline (undefined)
      path, removal semantics, config `null` opt-out (if Option A).

## Independent quick fix (do NOT wait for this refactor)

`CongestionDetector.update()` emits the `congestion` event with
`maxReceivingBitrate: this._maxSendingBitrate` — a copy/paste slip; it
should be `this._maxReceivingBitrate`. (The `raiseIssue` payload directly
below it is correct.) This can and should be fixed in a regular release.
