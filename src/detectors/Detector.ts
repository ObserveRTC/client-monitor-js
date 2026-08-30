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
 */
export interface Detector {
    readonly name: string;
    disabled?: boolean;
    /** When `false` the local issue lifecycle still runs, but no issue entry is buffered into the `ClientSample` shipped to the server. Defaults to true. */
    includeIssueInSample?: boolean;
    update(): void;
}