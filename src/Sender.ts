import { Samples } from "@observertc/monitor-schemas";
import { Codec, CodecConfig, createSamplesCodec } from "./codecs/Codec";
import { Transport } from "./transports/Transport";
import { WebsocketTransport, WebsocketTransportConfig } from "./transports/WebsocketTransport";
import { createLogger } from "./utils/logger";
import EventEmitter from "events";

const logger = createLogger("Sender");

export type SentSamplesCallback = (error?: Error) => void;

export type SenderConfig = {
    /**
     * Configure the codec used to transport samples or receieve
     * feedback from the server.
     *
     * Possible values: json, protobuf
     *
     * DEFAULT: json
     *
     */
    format?: CodecConfig;
    /**
     * Websocket configuration to transport the samples
     */
    websocket?: WebsocketTransportConfig;
};

const supplyDefaultConfig = () => {
    const defaultConfig: SenderConfig = {};
    return defaultConfig;
};

export type TransportConfig = {
    websocket?: WebsocketTransportConfig;
};
function createTransport(config: TransportConfig): Transport {
    if (config.websocket) {
        const result = WebsocketTransport.create(config.websocket);
        return result;
    }
    throw new Error(`No transport is manifested for config ${config}`);
}

const ON_ERROR_EVENT_NAME = "onError";
const ON_CLOSED_EVENT_NAME = "onClosed";

export class Sender {
    public static create(config?: SenderConfig) {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        const result = new Sender(appliedConfig);
        logger.debug(`Created`, appliedConfig);
        return result;
    }
    private _closed = false;
    private _config: SenderConfig;
    private _codec: Codec<Samples, Uint8Array>;
    private _emitter = new EventEmitter();
    private _transport: Transport;
    private constructor(config: SenderConfig) {
        this._config = config;
        this._codec = createSamplesCodec(this._config.format);
        this._transport = createTransport({
            websocket: config.websocket,
        })
            .setFormat(this._config.format ?? "json")
            .onReceived((message) => {
                logger.debug("Received message", message);
            });
    }

    public close(): void {
        if (this._closed) {
            return;
        }
        this._close();
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    private _close(err?: any): void {
        if (this._closed) {
            logger.warn(`Attempted to close the Sender twice`);
            return;
        }
        try {
            if (this._transport && !this._transport.closed) {
                this._transport.close();
            }
        } finally {
            this._closed = true;
            logger.info(`Closed`);
        }
        if (err) {
            this._emitter.emit(ON_ERROR_EVENT_NAME, err);
        } else {
            this._emitter.emit(ON_CLOSED_EVENT_NAME);
        }
        [ON_CLOSED_EVENT_NAME, ON_ERROR_EVENT_NAME].forEach((eventType) => this._emitter.removeAllListeners(eventType));
    }

    public get closed() {
        return this._closed;
    }

    public send(samples: Samples, callback?: SentSamplesCallback): void {
        if (this._closed) {
            throw new Error(`Cannot use an already closed Sender`);
        }
        let message: Uint8Array | undefined = undefined;
        try {
            message = this._codec.encode(samples);
        } catch (error) {
            logger.warn(`Encoding error`, error);
            return;
        }

        // --- for observer decoding tests ---
        // const messageInBase64 = require("js-base64").Base64.fromUint8Array(message);
        // logger.info({
        //     original: JSON.stringify(samples),
        //     messageInBase64
        // });

        this._transport.send(message).then(() => {
            if (!this._closed && callback) {
                callback();
            }
        }).catch((err) => {
            logger.warn(err);
            if (!this._closed) {
                if (callback) {
                    callback(new Error(`Error occurred while sending` + err));
                }
                this.close();
            }
        });
    }

    onTransportReady(listener: () => void): Sender {
        if (this._closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Sender`);
        }
        this._transport.onReady(listener);
        return this;
    }

    offTransportReady(listener: () => void): Sender {
        if (this._closed) {
            return this;
        }
        this._transport.offReady(listener);
        return this;
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    onError(listener: (err: any) => void): Sender {
        if (this._closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Sender`);
        }
        this._emitter.on(ON_ERROR_EVENT_NAME, listener);
        return this;
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    offError(listener: (err: any) => void): Sender {
        if (this._closed) {
            return this;
        }
        this._emitter.off(ON_ERROR_EVENT_NAME, listener);
        return this;
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    onClosed(listener: () => void): Sender {
        if (this._closed) {
            throw new Error(`Cannot subscribe / unsubscribe events of a closed Sender`);
        }
        this._emitter.on(ON_CLOSED_EVENT_NAME, listener);
        return this;
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    offClosed(listener: () => void): Sender {
        if (this._closed) {
            return this;
        }
        this._emitter.off(ON_CLOSED_EVENT_NAME, listener);
        return this;
    }
}
