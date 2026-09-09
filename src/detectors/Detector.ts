/**
 * The contract every detector implements. A detector is a small stateful observer bound to exactly
 * one monitor — the client monitor, a peer connection, or a single track — whose `update()` the
 * owning `Detectors` registry calls once per stats collection, in registration order, catching and
 * logging anything it throws. With that tick it may emit monitor events, add client events, or raise
 * and resolve keyed issues on `ClientMonitor`. `name` is the lookup key for `Detectors.getByName()` /
 * `disable()` / `enable()`, so it must be unique and stable within a registry.
 *
 * Implementations keep their own cross-tick state and stay conservative about incomplete evidence: a
 * missing field, a restarted counter, a collection gap, a paused track are all ordinary, and the
 * right response is to stay quiet and drop any accumulated window rather than guess.
 *
 * Three conventions hold across every implementation. **One detector, one issue type** — one that
 * would raise two issues is two detectors. **Condition duration comes from the stats, not the
 * clock** — accumulate the monitored object's `deltaTime` so a late collection still measures the
 * time the condition held; `Date.now()` is for the issue lifecycle and nothing else. **A detector
 * never infers the raw stats it needs** — reading a different real measurement of the same traffic
 * is fine, reconstructing a missing counter is not. That last one is a layer of the library's
 * boundary: adapters make stats spec-conformant, monitors derive facts, detectors threshold them.
 *
 * The interface carries only what the registry needs to run a detector and what an application needs
 * to toggle one. Several detectors also expose a public `inputsUnavailable` flag — "we cannot see
 * whether anything is wrong" as distinct from "nothing is wrong" — deliberately left out of the
 * contract until something in the library actually decides on it.
 */
export interface Detector {
    readonly name: string;
    disabled?: boolean;
    /** When `false` the local issue lifecycle still runs, but no issue entry is buffered into the `ClientSample` shipped to the server. Defaults to true. */
    includeIssueInSample?: boolean;
    update(): void;
}