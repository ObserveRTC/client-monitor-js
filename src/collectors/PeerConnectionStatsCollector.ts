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
            this._clientMonitor.addCustomCallEvent({
                name: "CONNECTION_STATE_CHANGED",
                peerConnectionId: this.id,
                value: peerConnection.connectionState,
                timestamp: Date.now(),
            });
        }
        peerConnection.addEventListener("connectionstatechange", connectionStateChangeListener);

        this._disposer = () => {
            peerConnection.removeEventListener("connectionstatechange", connectionStateChangeListener);
            this._disposer = undefined;
        }

        this._statsProvider = {
            id: this.id,
            label,
            getStats: async () => peerConnection.getStats(),
        }
        this._addStatsProvider(this._statsProvider);
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
        this._removeStatsProvider(this._statsProvider);
        this._close();
    }

    protected abstract _close(): void;
    protected abstract _addStatsProvider(statsProvider: StatsProvider): void;
    protected abstract _removeStatsProvider(statsProvider: StatsProvider): void;
}