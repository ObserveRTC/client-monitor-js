import { ClientMonitor } from "../ClientMonitor";
import { StatsCollector, StatsProvider } from "./StatsCollector";
import { v4 as uuid } from "uuid";
import { createLogger } from "../utils/logger";

const logger = createLogger("PeerConnectionStatsCollector");

type DisposeListener = () => void;

export abstract class PeerConnectionStatsCollector implements StatsCollector {
    public readonly id = uuid();
    private _closed = false;
    private _peerConnection: RTCPeerConnection;
    private _clientMonitor: ClientMonitor;
    private _statsProvider: StatsProvider;
    private _disposer?: DisposeListener;

    public constructor(
        peerConnection: RTCPeerConnection, 
        clientMonitor: ClientMonitor,
        label?: string
    ) {
        this._peerConnection = peerConnection;
        this._clientMonitor = clientMonitor;

        const connectionStateChangeListener = () => {
            this._clientMonitor.addIceConnectionStateChangedCallEvent(
                this.id,
                peerConnection.connectionState,
            )
        }
        peerConnection.addEventListener("connectionstatechange", connectionStateChangeListener);
        this._disposer = () => {
            peerConnection.removeEventListener("connectionstatechange", connectionStateChangeListener);
            this._disposer = undefined;
        }

        this._statsProvider = {
            peerConnectionId: this.id,
            label,
            getStats: async () => peerConnection.getStats(),
        }
        this._addPeerConnection(this.id);
    }

    public get statsProviders(): Iterable<StatsProvider> {
        return [this._statsProvider];
    }

    public close() {
        if (this._closed) {
            logger.warn(`Attempted to close a resource twice`);
            return;
        }
        this._closed = true;
        if (this._disposer) {
            this._disposer();
        }
        this._removePeerConnection(this.id);
        this._close();
    }

    protected abstract _addPeerConnection(peerConnectionId: string, peerConnectionLabel?: string): void;
    protected abstract _removePeerConnection(peerConnectionId: string): void;

    protected abstract _close(): void;
}