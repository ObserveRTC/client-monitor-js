import { EventEmitter } from 'events';
import { CodecConfig } from '../codecs/Codec';
import { createLogger } from "../utils/logger";
import { Transport, makeUrl } from "./Transport";

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

    /**
     * Flag indicate to reconnect websocket if 
     * the connection has been lost, but the transport is not closed
     */
    reconnect?: boolean,
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
    private _sendingCounter = 0;
    private _sent?: Promise<void>;
    private _config: WebsocketTransportConstructorConfig;
    private _format?: CodecConfig;

    private constructor(config: WebsocketTransportConstructorConfig) {
        if (typeof WebSocket === 'undefined') {
            throw new Error(`No Websocket class has found in global namespace`);
        }
        this._config = config;
    }

    public setFormat(format: CodecConfig): Transport {
        this._format = format;
        return this;
    }

    public onReceived(listener: (data: string) => void): Transport {
        this._emitter.on(ON_RECEIVED_EVENT_NAME, listener);
        return this;
    }
    
    public offReceived(listener: (data: string) => void): Transport {
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
    public close() {
        if (this._closed) {
            logger.warn(`Attempted to close twice`);
            return;
        }
        this._closed = true;
        try {
            if (this._ws) {
                this._ws.close();
            }
            if (this._cancelTimer) {
                this._cancelTimer();
            }
            this._sent = undefined;
        } finally {
            logger.info(`Closed`);
        }
    }

    /**
     * Enqueue specified data to be transmitted to the server over the WebSocket connection
     */
    public async send(data: ArrayBuffer): Promise<void> {
        if (this._closed) {
            throw new Error(`Failed to send data on an already closed transport`);
        }
        const id = ++this._sendingCounter;
        const _send = async (retried = false) => {
            const { reconnect } = this._config;
            if (!this._ws) {
                if (this._closed) return;
                await this._connect();
                if (!this._ws) {
                    if (!this._closed) this.close();
                    return;
                }
            }
            try {
                this._ws.send(data);
            } catch (err) {
                if (!reconnect || retried) throw err;
                await _send(true);
            }
        };
        this._sent = (this._sent ?? Promise.resolve()).then(async () => {
            await _send();
        }).catch(() => {
            if (!this._closed) {
                this.close();
            }
        }).finally(() => {
            if (this._sendingCounter === id) {
                this._sent = undefined;
            }
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
        
        // at this point we have an open,
        // connection established websocket.
        const { reconnect } = this._config;
        result.addEventListener("message", data => {
            this._emitter.emit(ON_RECEIVED_EVENT_NAME, data);
        });
        result.addEventListener("close", (closeReason) => {
            // check for observer close reasons code:
            if (4224 <= closeReason.code && closeReason.code <= 4230) {
                // most likely observer close reasons
                logger.warn(`Closed by the observer, reason: ${closeReason.reason}`);
            } else {
                logger.info(`Websocket is closed, reason: ${closeReason.reason}`);
            }
            this._ws = undefined;
            if (!this._closed && !reconnect) {
                this.close();
            }
        });
        result.addEventListener("error", err => {
            this._ws = undefined;
            logger.warn(`Error occurred in transport`, err);
            if (!this._closed && !reconnect) {
                this.close();
            }
        });
        this._ws = result;
        logger.info(`Connected to ${this._ws.url}`);
    }

    private async _createWebsocket(tried = 0): Promise<WebSocket> {
        if (this._closed) {
            throw new Error(`The transport is already closed`)
        }
        const { urls, maxRetries, protocols } = this._config;
        const canRetry = tried < maxRetries * urls.length;
        const url = makeUrl(urls[tried % urls.length], this._format);
        return await new Promise<WebSocket>((resolve, reject) => {
            // logger.info(`Connecting to ${url}`);
            const ws = new WebSocket(url, protocols);
            if (ws.readyState === WebSocket.OPEN) {
                resolve(ws);
            } else {
                // promise can be resolved or rejected only once, so no problem
                ws.addEventListener("close", reject);
                ws.addEventListener("error", reject);
                ws.addEventListener("open", () => resolve(ws));
            }
        }).catch(async () => {
            if (canRetry) {
                // print the error out anyhow
                logger.info(`Connection to ${url} is failed. Tried: ${tried}`);
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
        const random = Math.random();
        const exp = 1 + Math.max(0.1, Math.min(random, 1 / base));
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