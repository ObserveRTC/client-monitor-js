import { Samples } from "@observertc/schemas"
import { Codec, CodecConfig, createCodec } from "./codecs/Codec";
import { Transport, TransportState } from "./transports/Transport"
import { WebsocketTransport, WebsocketTransportConfig } from "./transports/WebsocketTransport";
import { createLogger } from "./utils/logger";

const logger = createLogger("Sender");

export type SenderConfig = {
    /**
     * Configure the format used to transport samples or receieve 
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
    websocket?: WebsocketTransportConfig,
}


const supplyDefaultConfig = () => {
    const defaultConfig: SenderConfig = {
    
    };
    return defaultConfig;
}


export type TransportConfig = {
    websocket?: WebsocketTransportConfig;
}
export function createTransport(config: TransportConfig): Transport {
    if (config.websocket) {
        const result = WebsocketTransport.create(config.websocket);
        return result;
    }
    throw new Error(`No transport is manifested for config ${config}`);
}

export class Sender {
    public static create(config?: SenderConfig) {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        return new Sender(appliedConfig);
    }
    private _closed = false;
    private _config: SenderConfig;
    private _codec: Codec<Samples, Uint8Array>;
    private _transport: Transport
    private constructor(config: SenderConfig) {
        this._config = config;
        this._codec = createCodec<Samples>(this._config.format);
        this._transport = createTransport({
            websocket: config.websocket,
        });
    }
    
    public close(): void {
        if (this._closed) {
            logger.warn(`Attempted to close the Sender twice`);
            return;
        }
        this._closed = true;
    }

    public get closed() {
        return this._closed;
    }

    public async send(samples: Samples): Promise<void> {
        if (this._closed) {
            throw new Error(`Cannot use an already closed Sender`);
        }
        const message = this._codec.encode(samples);
        switch (this._transport.state) {
            case TransportState.Created:
                await this._transport.connect();
                break;
            case TransportState.Closed:
                logger.error(`Transport is closed, sending is not possible`);
                this.close();
                return;
            case TransportState.Connecting:
                break;
            case TransportState.Connected:
                break;
        }
        await this._transport.send(message);
    }
}