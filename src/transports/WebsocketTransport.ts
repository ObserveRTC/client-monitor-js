import { EventEmitter } from 'events';
import { createLogger } from "../utils/logger";
import { Transport } from "./Transport";
import { v4 as uuidv4 } from "uuid";

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
    /**
     * Protocols of the websocket
     */
    protocols?: string | string[],
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


const ON_RECEIVED_EVENT_NAME = "onReceived";

export class WebsocketTransport implements Transport {
    public static create(config?: WebsocketTransportConfig): WebsocketTransport {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        const result = new WebsocketTransport(appliedConfig);
        logger.debug(`Created`, appliedConfig);
        return result;
    }

    private _ws?: WebSocket;
    private _cancelTimer?: () => void;
    private _closed = false;
    private _emitter: EventEmitter = new EventEmitter();
    private _counter = 0;
    private _sent?: Promise<void>;
    private _lastRequest?: [string, Promise<void>];
    private _config: WebsocketTransportConstructorConfig;

    private constructor(config: WebsocketTransportConstructorConfig) {
        if (typeof WebSocket === 'undefined') {
            throw new Error(`No Websocket class has found in global namespace`);
        }
        this._config = config;
    }

    onReceived(listener: (data: string) => void): Transport {
        this._emitter.on(ON_RECEIVED_EVENT_NAME, listener);
        return this;
    }
    offReceived(listener: (data: string) => void): Transport {
        this._emitter.off(ON_RECEIVED_EVENT_NAME, listener);
        return this;
    }

    public get closed() {
        return this._closed;
    }

    public get connected() {
        return !!this._ws;
    }

    /**
     * Closes the WebSocket connection or connection attempt, if any. If the connection is already
     * CLOSED, this method does nothing
     */
    public close(code = 1000, reason?: string) {
        if (this._closed) {
            logger.warn(`Attempted to close twice`);
            return;
        }
        try {
            if (this._ws) {
                this._ws.close();
            }
            if (this._cancelTimer) {
                this._cancelTimer();
            }
        } finally {
            this._closed = true;
        }
        
    }

    /**
     * Enqueue specified data to be transmitted to the server over the WebSocket connection
     */
    public async send(data: ArrayBuffer): Promise<void> {
        if (this._closed) {
            throw new Error(`Failed to send data on an already closed transport`);
        }
        const id = ++this._counter;
        const clear = () => {
            if (this._counter === id) {
                this._sent = undefined;
            }
        };
        let prerequisite: Promise<void>;
        if (!this._ws) {
            prerequisite = this._connect();
        } else if (this._sent) {
            prerequisite = this._sent;
        } else {
            prerequisite = Promise.resolve();
        }
        this._sent = prerequisite.then(async () => {
            if (!this._ws) throw new Error(`No websocket to send data on`);
            this._ws.send(data);
            clear();
        }).catch(err => {
            clear();
            throw err;
        });
        return this._sent;
    }

    private async _connect(): Promise<void> {
        if (this._closed) {
            throw new Error(`Failed to connect to an already closed transport`);
        }
        if (this._ws) {
            logger.info(`Already connected`);
            return;
        }
        const result = await this._createWebsocket();
        result.addEventListener("message", data => {
            this._emitter.emit(ON_RECEIVED_EVENT_NAME, data);
        })
        result.addEventListener("close", () => {
            this._ws = undefined;
            if (!this._closed) {
                this.close();
            }
        });
        result.addEventListener("error", err => {
            this._ws = undefined;
            logger.warn(`Error occurred in transport`, err);
            if (!this._closed) {
                this.close();
            }
        });
        this._ws = result;
        logger.info(`Connected`);
    }

    private async _createWebsocket(tried = 0): Promise<WebSocket> {
        if (this._closed) {
            throw new Error(`The transport is already closed`)
        }
        const { urls, maxRetries, protocols } = this._config;
        const canRetry = tried < maxRetries * urls.length;
        const url = urls[tried % urls.length]
        return await new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(url, protocols);
            if (ws.readyState === WebSocket.OPEN) {
                resolve(ws);
            } else {
                // promise can be resolved or rejected only once, so no problem
                ws.addEventListener("close", reject);
                ws.addEventListener("error", reject);
                ws.addEventListener("open", () => resolve(ws));
            }
        }).catch(async (err: any) => {
            if (canRetry) {
                logger.info(`Connection to ${url} is failed. Tried: ${tried}, Error:`, err);
                await this._waitBeforeReconnect(tried + 1);
                // if the transport is closed during waiting, 
                // the call to connect again is going to be rejected
                return await this._createWebsocket(tried + 1);
            }
            throw new Error(`Cannot connect to ${urls.join(", ")}.`);
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
                this._cancelTimer = undefined;
            };
            logger.info(`Enforced waiting before reconnect is ${timeout}ms`);
        });
    }
}