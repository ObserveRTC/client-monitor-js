import { Transport, TransportState } from "./Transport";
import ReconnectingWebSocket from 'reconnecting-websocket';
import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";

const logger = createLogger("WebsocketTransport");

export type WebsocketTransportConfig = {
    /**
     * Target urls in a priority order. If the Websocket has not succeeded for the first,
     * it tries with the second. If no more url left the connection is failed
     * 
     */
    urls: string[];
    /**
     * The maximum number of retries to connect to a server before,
     * tha connection failed is stated.
     * 
     * DEFAULT: 3
     */
    maxRetries?: number;
}

type WebsocketTransportConstructorConfig = WebsocketTransportConfig & {
    maxRetries: number,
}

const supplyDefaultConfig = () => {
    const defaultConfig: WebsocketTransportConstructorConfig = {
        urls: ["cannot be this"],
        maxRetries: 3
    }
    return defaultConfig;
}

const ON_STATE_CHANGED_EVENT_NAME = "onStateChanged";
const ON_RECEIVED_EVENT_NAME = "onReceived";
const ON_ERROR_EVENT_NAME = "onError";

export class WebsocketTransport implements Transport {
    public static create(config?: WebsocketTransportConfig): WebsocketTransport {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        return new WebsocketTransport(appliedConfig)
    }
    private _cancelTimer?: () => void;
    private _config: WebsocketTransportConfig;
    private _state: TransportState = TransportState.Created;
    private _emitter: EventEmitter = new EventEmitter();
    private _ws?: ReconnectingWebSocket;
    private constructor(config: WebsocketTransportConstructorConfig) {
        this._config = config;
    }

    public connect(): Promise<void> {
        if (this._state === TransportState.Closed) {
            return Promise.reject(`The transport is already closed`);
        }
        if (this._state === TransportState.Connected) {
            return Promise.resolve();
        }
        return this._connect();
    }

    public get state(): TransportState {
        return this._state;
    }

    public async send(message: Uint8Array): Promise<void> {
        if (this._state !== TransportState.Connected) {
            throw new Error(`Transport must be Connected state to send any data`);
        }
        this._ws?.send(message);
    }

    onReceived(listener: (data: string) => void): Transport {
        if (this._state === TransportState.Closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Transport`);
        }
        this._emitter.on(ON_RECEIVED_EVENT_NAME, listener);
        return this;        
    }

    offReceived(listener: (data: string) => void): Transport {
        if (this._state === TransportState.Closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Transport`);
        }
        this._emitter.off(ON_RECEIVED_EVENT_NAME, listener);
        return this;
    }

    onStateChanged(listener: (newState: TransportState) => void): Transport {
        if (this._state === TransportState.Closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Transport`);
        }
        this._emitter.on(ON_STATE_CHANGED_EVENT_NAME, listener);
        return this;
    }

    offStateChanged(listener: (newState: TransportState) => void): Transport {
        if (this._state === TransportState.Closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Transport`);
        }
        this._emitter.off(ON_STATE_CHANGED_EVENT_NAME, listener);
        return this;
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    onError(listener: (err: any) => void): Transport {
        if (this._state === TransportState.Closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Transport`);
        }
        this._emitter.on(ON_ERROR_EVENT_NAME, listener);
        return this;
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    offError(listener: (err: any) => void): Transport {
        if (this._state === TransportState.Closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Transport`);
        }
        this._emitter.off(ON_ERROR_EVENT_NAME, listener);
        return this;
    }

    public get closed(): boolean {
        return this._state === TransportState.Closed;
    }

    public close(): void {
        if (this._state === TransportState.Closed) {
            return;
        }
        if (this._ws) {
            this._ws.close();
        }
        if (this._cancelTimer) {
            this._cancelTimer();
        }
        [ON_ERROR_EVENT_NAME, ON_RECEIVED_EVENT_NAME].forEach(eventType => this._emitter.removeAllListeners(eventType));
        this._setState(TransportState.Closed);
        this._emitter.removeAllListeners(ON_STATE_CHANGED_EVENT_NAME);
    }


    private async _connect(): Promise<void> {
        if (this._state === TransportState.Closed) {
            return Promise.reject(`The transport is already closed`);
        }
        if (this._state === TransportState.Connected) {
            // log it
            return Promise.resolve();
        }
        this._setState(TransportState.Connecting);
        let urlIndex = 0;
        const urlProvider = async () => {
            urlIndex = ++urlIndex % this._config.urls.length;
            const result = this._config.urls[urlIndex];
            return result;
        };
        const protocols: string | undefined = undefined;
        const options = {
            maxRetries: this._config.maxRetries,
        };
        const rws = new ReconnectingWebSocket(urlProvider, protocols, options);
        return new Promise((resolve, reject) => {
            rws.addEventListener('open', () => {
                this._ws = rws;
                rws.addEventListener('message', (message) => {
                    this._emitter.emit(ON_RECEIVED_EVENT_NAME, message);
                });
                rws.addEventListener('close', () => {
                    this.close();
                })
                this._setState(TransportState.Connected);
                resolve();
            });
            rws.addEventListener('error', (err) => {
                logger.warn(err);
                this._emitter.emit(ON_ERROR_EVENT_NAME, err);
                this.close();
                reject(err);
            });
        });
    }

    private _setState(state: TransportState): void {
        if (this._state === state) return;
        const prevState = this._state;
        this._state = state;
        this._emitter.emit(ON_STATE_CHANGED_EVENT_NAME, {
            prevState,
            state,
        });
    }
}
