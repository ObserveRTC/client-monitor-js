import { CodecConfig } from "../codecs/Codec";
import { version as schemaVersion } from "@observertc/monitor-schemas";

type MessageListener = (data: string) => void;
/*eslint-disable @typescript-eslint/no-explicit-any*/

export function makeUrl(baseUrl: string, format?: CodecConfig) {
    const queryString = `format=${format ?? "json"}&schemaVersion=${schemaVersion}`;
    if (baseUrl.indexOf("?") !== -1) {
        // no query string
        return `${baseUrl}&${queryString}`;
    } else {
        return `${baseUrl}?${queryString}`;
    }
}

export interface Transport {
    send(data: Uint8Array): Promise<void>;

    onReceived(listener: MessageListener): Transport;
    offReceived(listener: MessageListener): Transport;
    setFormat(format: CodecConfig): Transport;

    readonly closed: boolean;
    close(): void;
}
