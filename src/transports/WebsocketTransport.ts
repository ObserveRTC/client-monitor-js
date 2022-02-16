import { Transport, TransportState } from "./Transport";
import ReconnectingWebSocket from 'reconnecting-websocket';
import { EventEmitter } from "events";
import { logger } from "../utils/logger";

export type WebsocketTransportConfig = {
    url: string;
    maxRetries?: number;
}

type WebsocketTransportConstructorConfig = WebsocketTransportConfig & {
    maxRetry: number,
}

const defaultConfig: WebsocketTransportConstructorConfig = {
    url: "cannot be this",
    maxRetry: 3
}

const ON_STATE_CHANGED_EVENT_NAME = "onStateChanged";
const ON_RECEIVED_EVENT_NAME = "onReceived";
const ON_ERROR_EVENT_NAME = "onError";

export class WebsocketTransport implements Transport {
    public static create(config?: WebsocketTransportConfig): WebsocketTransport {
        const appliedConfig = Object.assign(defaultConfig, config);
        return new WebsocketTransport(appliedConfig)
    }
    private _cancelTimer?: () => void;
    private _config: WebsocketTransportConfig;
    private _state: TransportState = TransportState.Created;
    private _buffer: Uint8Array[] = [];
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
        this._buffer.push(message);
        for (let sendingIndex = 0; sendingIndex < this._buffer.length; ++sendingIndex) {
            const queuedMessage = this._buffer[sendingIndex];
            if (!this._ws) {
                throw new Error(`Websocket has not been initialized`);
            }
            try {
                this._ws.send(queuedMessage);
                logger.debug(`Message is sent`);
            /*eslint-disable @typescript-eslint/no-explicit-any */
            } catch (error: any) {
                logger.warn("Websocket encountered an error while sending message", error);
                this._ws = undefined;
                this._buffer.push(message);
                this._setState(TransportState.Connecting);
                await this._connect();
            }
        }
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

    public async close(): Promise<void> {
        if (this._state === TransportState.Closed) {
            return Promise.resolve();
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


    private async _connect(tried = 0): Promise<void> {
        if (this._state === TransportState.Closed) {
            return Promise.reject(`The transport is already closed`);
        }
        if (this._state === TransportState.Connected) {
            // log it
            return Promise.resolve();
        }
        this._setState(TransportState.Connecting);
        const url = this._config.url;
        await new Promise<void>((resolve, reject) => {
            const ws = new ReconnectingWebSocket(url);
            const opened = () => {
                this._ws = ws;
                resolve();
                this._setState(TransportState.Connected);
                logger.info(`Connection is established to ${url}`);
            };
            if (ws.readyState === WebSocket.OPEN) {
                opened();
            } else {
                ws.onopen = () => {
                    opened();
                };
                ws.onerror = (error: any) => {
                    reject(error);
                };
            }
        /*eslint-disable @typescript-eslint/no-explicit-any */
        }).catch(async (err: any) => {
            logger.warn(err);
            if (tried < this._config.maxRetries!) {
                await this._waitBeforeReconnect(tried + 1);
                await this._connect(tried + 1);
                return;
            }
            this._emitter.emit(ON_ERROR_EVENT_NAME, err);
            this.close();
        });
    }

    private async _waitBeforeReconnect(executed: number) {
        const base = executed + 1;
        const max = 1 / base;
        const random = Math.random();
        const exp = 1 + Math.max(0.1, Math.min(random, max));
        const timeout = Math.floor(Math.min(Math.pow(base, exp), 60) * 1000);
        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                this._cancelTimer = undefined;
                resolve();
            }, timeout);
            this._cancelTimer = () => {
                clearTimeout(timer);
            };
            logger.info(`Enforced waiting before reconnect is ${timeout}ms`);
        })
        
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
