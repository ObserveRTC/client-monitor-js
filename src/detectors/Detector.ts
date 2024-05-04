import { AlertState } from "../ClientMonitor";

export interface Detector {
    readonly closed: boolean;
    once(event: 'close', listener: () => void): this;
    on(event: 'alert-state', listener: (state: AlertState) => void): this;
    off(event: 'alert-state', listener: (state: AlertState) => void): this;
    close(): void;
}