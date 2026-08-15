# Replay sandbox

Drop `.jsonl` recordings here and replay them through a real `ClientMonitor`
in any spec. This is a sandbox, not a framework: use it to investigate an
issue locally, develop a new detector against real data, tune detector
configs, or hand a recording to an agent and let it play with the data.

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

Quickest path — `replayFixture` (`tests/helpers/replayFixture.ts`) loads a
file from this directory, replays it, and hands back everything that happened:

```typescript
import { replayFixture } from './helpers/replayFixture';

const run = await replayFixture('stuck-decoder');
console.log([...run.issueTypes]);       // which detectors fired
console.log(run.issues);                // full issues, stamped with recorded time
console.log(run.resolvedIssues);        // resolutions, if any
run.monitor.getPeerConnectionMonitor('pc-1'); // poke at any monitor state
run.close();
```

Second argument is `ClientMonitorConfig` overrides — replay the same file
against different thresholds to see where a detector would flip:

```typescript
const run = await replayFixture('stuck-decoder', {
    stuckDecoderDetector: { thresholdInMs: 30_000, rttMultiplier: 15, minStuckTicks: 2, minBitrate: 10_000 },
});
```

For full control (multiple monitors, tick-by-tick assertions, injecting
entries between lines, real-time replay), use `StatsReplayer` directly — see
`tests/StatsReplayer.spec.ts` for working examples. Replays run on virtual
time by default, so hour-long recordings finish in milliseconds while every
duration-based verdict stays faithful to the recorded timeline.

`stuck-decoder.jsonl` is a minimal synthesized example: bytes keep flowing,
nothing decodes, PLIs pile up → `stuck-decoder` fires on the fourth tick.
