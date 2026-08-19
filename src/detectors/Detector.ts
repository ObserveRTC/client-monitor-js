// import { AlertState } from "../ClientMonitor";

export interface Detector {
    readonly name: string;
    /**
     * Optional runtime kill-switch. When true, the parent `Detectors.update()`
     * skips this detector's `update()`. Applications may flip this at any
     * time to silence a detector without removing it. Detectors are not
     * required to implement this field; when omitted the detector always
     * runs.
     */
    disabled?: boolean;
    /**
     * Optional flag controlling whether issues raised by this detector are
     * included in the `ClientSample` shipped to the server. When `false` the
     * detector still emits its monitor events and maintains the local issue
     * lifecycle (`activeIssues`, `issue` / `issue-resolved` events), but no
     * issue entry is buffered into samples — useful for shrinking the sample
     * size when the issue is derivable server-side from the stats the sample
     * already carries. Detectors that only emit events have nothing to gate
     * and may omit the field. Defaults to true when omitted.
     */
    includeIssueInSample?: boolean;
    update(): void;
}