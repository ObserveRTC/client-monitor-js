# Replay sandbox

Drop `.jsonl` captures here and replay them through a real `ClientMonitor`
in any spec. This is a sandbox, not a framework: use it to investigate an
issue locally, develop a new detector against real data, tune detector
configs, or hand a capture to an agent and let it play with the data.

## The line format

One JSON object per line, one line per stats-collection tick. The contract is
the `ReplayEntry` type in `tests/helpers/StatsReplayer.ts`:

- `timestamp` — wall-clock ms of the tick; drives the virtual clock on replay.
- `peerConnections` — `[peerConnectionId, rawGetStatsArray]` pairs, i.e.
  exactly the `collectedStats` payload of the monitor's `'stats-collected'`
  event.
- `tracks` (optional) — `MediaStreamTrack` state snapshots
  (`muted`/`enabled`/`readyState`/`settings`), so track-level detectors run too.

How the lines get produced is not this library's business — server-side
capture, an app-side listener on `'stats-collected'`, or a script that
synthesizes a scenario all work.

## Using it

Quickest path from a terminal — the replay CLI, which needs no spec at all:

```bash
npm run replay -- tests/fixtures/degrading-camera.jsonl
npm run replay -- some-session.jsonl --only capture-bottleneck --pretty
```

It prints NDJSON on stdout, one record per detector fire plus a summary. See
`scripts/replay.ts` (or `--help`) for the flags.

Quickest path — `replayFixture` (`tests/helpers/replayFixture.ts`) loads a
file from this directory, replays it, and hands back everything that happened:

```typescript
import { replayFixture } from './helpers/replayFixture';

const run = await replayFixture('stuck-decoder');
console.log([...run.issueTypes]);       // which detectors fired
console.log(run.issues);                // full issues, stamped with captured time
console.log(run.resolvedIssues);        // resolutions, if any
run.monitor.getPeerConnectionMonitor('pc-1'); // poke at any monitor state
run.close();
```

Second argument is `ClientMonitorConfig` overrides — replay the same file
against different thresholds to see where a detector would flip:

```typescript
const run = await replayFixture('stuck-decoder', {
    stuckDecoderDetector: { thresholdInMs: 30_000, rttMultiplier: 15, minBitrate: 10_000 },
});
```

For full control (multiple monitors, tick-by-tick assertions, injecting
entries between lines, real-time replay), use `StatsReplayer` directly — see
`tests/StatsReplayer.spec.ts` for working examples. Replays run on virtual
time by default, so hour-long captures finish in milliseconds while every
duration-based verdict stays faithful to the captured timeline.

## The captures here

- `stuck-decoder.jsonl` — minimal synthesized example: bytes keep flowing,
  nothing decodes, PLIs pile up → `stuck-decoder` fires on the fourth tick.
- `degrading-camera.jsonl` — a 30fps camera degrading the way a real failing USB
  camera does: degraded ticks (132, 97, 123, 88, 76 frames per 5s tick)
  *interleaved* with healthy 150-frame ticks, then frames stop entirely while
  the track still reports `live` and unmuted. `capture-bottleneck` raises on tick 10
  with three starving ticks in the window but never three in a row — the case a
  consecutive-run rule cannot see — while the camera is still delivering.
