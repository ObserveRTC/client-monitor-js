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
    update(): void;
}