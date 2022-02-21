import { WebsocketTransport, WebsocketTransportConfig } from "./WebsocketTransport";

export enum TransportState {
    Created = "CREATED",
    Connecting = "CONNECTING",
    Connected = "CONNECTED",
    Closed = "CLOSED",
}

type MessageListener = (data: string) => void;
/*eslint-disable @typescript-eslint/no-explicit-any*/
type ErrorListener = (err: any) => void;
type StateChangedListener = (newState: TransportState) => void;

export type TransportConfig = {
    
    websocket?: WebsocketTransportConfig;
}

export interface Transport {
    readonly state: TransportState;
    send(data: ArrayBuffer): Promise<void>;

    onReceived(listener: MessageListener): Transport;
    offReceived(listener: MessageListener): Transport;

    onStateChanged(listener: StateChangedListener): Transport;
    offStateChanged(listener: StateChangedListener): Transport;

    onError(listener: ErrorListener): Transport;
    offError(listener: ErrorListener): Transport;

    connect(): Promise<void>;
    readonly closed: boolean;
    close(): void;
}

export function createTransport(config: TransportConfig): Transport {
    let result: Transport | undefined;
    if (config.websocket) {
        result = WebsocketTransport.create(config.websocket);
    }
    if (!result) throw new Error(`No transport is manifested for config ${config}`);
    return result;
}