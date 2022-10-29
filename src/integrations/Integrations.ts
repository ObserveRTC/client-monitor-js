import { ClientMonitor } from "../ClientMonitor";
import { MediaosupDeviceSurrogate, MediasoupIntegration } from "./MediasoupIntegration";

export interface Integration {
    readonly type: "mediasoup";
    readonly id: string;
    readonly closed: boolean;
    close(): void;
}

export class Integrations {
    private _closed = false;
    private _integrations = new Map<string, Integration>();
    private _clientMonitor: ClientMonitor;

    public constructor(clientMontor: ClientMonitor) {
        this._clientMonitor = clientMontor;
    }

    public addMediasoupDevice(device: MediaosupDeviceSurrogate, version?: string): MediasoupIntegration {
        const result = new MediasoupIntegration(
            this._clientMonitor, 
            device,
            version
        );

        result.onClosed(() => {
            this._integrations.delete(result.id);
        })
        this._integrations.set(result.id, result);
        return result;
    }

    public close(): void {
        if (this._closed) {
            return;
        }
        this._closed = true;
        for (const integration of Array.from(this._integrations.values())) {
            this._integrations.delete(integration.id);
            integration.close();
        }
    }
}