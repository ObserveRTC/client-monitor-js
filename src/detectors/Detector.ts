/**
 * The contract every detector implements. A detector is a small stateful observer bound to exactly
 * one monitor — the client monitor, a peer connection, or a single track — whose `update()` is
 * called once per stats collection by the `Detectors` registry that owns it. What it does with that
 * tick is its own business: emit monitor events, add client events, or raise and resolve issues on
 * `ClientMonitor`, keying each issue so the same condition reopens the same entry.
 *
 * Implementations carry their own cross-tick state and are expected to be conservative about
 * incomplete evidence. A browser that never reports a field, a counter that restarted, a collection
 * gap, a paused or backgrounded track: all of these are ordinary, and the correct response is to
 * stay quiet (and to drop any accumulated window) rather than to guess. `update()` is the only entry
 * point the registry uses; it is invoked on enabled detectors in registration order, and anything it
 * throws is caught and logged rather than propagated.
 *
 * `name` doubles as the lookup key for `Detectors.getByName()` / `disable()` / `enable()`, so it
 * must be unique and stable within a registry.
 *
 * Three conventions hold across every implementation. **One detector, one issue type:** a detector
 * that would raise two different issues is two detectors, and a detector generally keeps at most one
 * collection — one map, set or array — for the thing it is tracking. **Condition duration comes from
 * the stats, not the clock:** a detector measuring how long something has held accumulates the
 * monitored object's `deltaTime` (the difference between consecutive stats `timestamp`s) rather than
 * wall-clock elapsed, so a late or skipped collection still measures the time the condition actually
 * held underneath. `Date.now()` is for the issue lifecycle — when an issue was raised or resolved —
 * and for nothing else. **A detector never infers the raw stats it needs:** it detects where the
 * browser supplies them and declines to judge where it does not. Reading a different real
 * measurement of the same traffic is fine — a candidate pair's byte deltas standing in for a
 * transport's, say — but reconstructing a missing counter from unrelated ones, or assuming a
 * plausible value for it, is not. A detector that guesses produces findings whose meaning depends on
 * which browser was looking, which is worse than producing none.
 *
 * That rule is one layer of a boundary the whole library keeps: **adapters** make the stats
 * spec-conformant, **monitors** read spec-conformant stats and derive facts, **detectors**
 * threshold those facts. Compensating for a browser that omits a spec-required field belongs
 * in an adapter and nowhere above it.
 *
 * The interface stays this small on purpose: it carries only what the registry needs to run a
 * detector and what an application needs to toggle one. Several detectors additionally expose a
 * public `inputsUnavailable` flag, set on ticks where the browser reported none of the stats that
 * detector judges — the difference between "nothing is wrong" and "we cannot see whether anything is
 * wrong". Nothing in the library reads it yet, so it is deliberately not part of this contract; it
 * is a field on the classes that can compute it, and it will move here only if and when something
 * actually decides on it.
 */
export interface Detector {
    readonly name: string;
    disabled?: boolean;
    /** When `false` the local issue lifecycle still runs, but no issue entry is buffered into the `ClientSample` shipped to the server. Defaults to true. */
    includeIssueInSample?: boolean;
    update(): void;
}