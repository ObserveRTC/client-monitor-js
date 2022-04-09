type MessageListener = (data: string) => void;
/*eslint-disable @typescript-eslint/no-explicit-any*/

export interface Transport {
    send(data: Uint8Array): Promise<void>;

    onReceived(listener: MessageListener): Transport;
    offReceived(listener: MessageListener): Transport;

    readonly closed: boolean;
    close(): void;
}
