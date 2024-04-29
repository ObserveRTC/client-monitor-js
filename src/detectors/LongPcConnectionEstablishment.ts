import { EventEmitter } from "events";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";
import { ClientMonitor } from "../ClientMonitor";

export type LongPcConnectionEstablishmentDetectorConfig = {
	// Minimum duration in milliseconds for a track to be considered stuck
	thresholdInMs: number,
}

export type LongPcConnectionEstablishmentDetectorEvent = {
	'too-long-connection-establishment': [{
		peerConnectionId: string,
	}],
	close: [],
}

export declare interface LongPcConnectionEstablishmentDetector {
	on<K extends keyof LongPcConnectionEstablishmentDetectorEvent>(event: K, listener: (...events: LongPcConnectionEstablishmentDetectorEvent[K]) => void): this;
	off<K extends keyof LongPcConnectionEstablishmentDetectorEvent>(event: K, listener: (...events: LongPcConnectionEstablishmentDetectorEvent[K]) => void): this;
	once<K extends keyof LongPcConnectionEstablishmentDetectorEvent>(event: K, listener: (...events: LongPcConnectionEstablishmentDetectorEvent[K]) => void): this;
	emit<K extends keyof LongPcConnectionEstablishmentDetectorEvent>(event: K, ...events: LongPcConnectionEstablishmentDetectorEvent[K]): boolean;
}

export class LongPcConnectionEstablishmentDetector extends EventEmitter {
	private _closed = false;
	private _timers = new Map<string, ReturnType<typeof setTimeout>>();
	private _listeners = new Map<string, () => void>();
	private _destroyCb: () => void;

	public constructor(
		public readonly config: LongPcConnectionEstablishmentDetectorConfig,
		monitor: ClientMonitor,
	) {
		super();
		this.setMaxListeners(Infinity);
		const onPeerConnectionAdded = (peerConnectionEntry: PeerConnectionEntry) => {
			let prevState = peerConnectionEntry.connectionState;
			const listener = () => {
				const {
					connectionState: state,
				} = peerConnectionEntry;

				if (prevState === state) return;
				if (state !== 'connecting') {
					if (state === 'connected') {
						clearTimeout(this._timers.get(peerConnectionEntry.peerConnectionId));
					}

					return (prevState = state), void 0;
				}
				
				this._timers.set(peerConnectionEntry.peerConnectionId, setTimeout(() => {
					this._timers.delete(peerConnectionEntry.peerConnectionId);

					this.emit('too-long-connection-establishment', {
						peerConnectionId: peerConnectionEntry.peerConnectionId,
					});
				}, config.thresholdInMs));

				prevState = state;
			}
			peerConnectionEntry.events.on('state-updated', listener)
			this._listeners.set(peerConnectionEntry.peerConnectionId, listener);
		}

		const onPeerConnectionRemoved = (peerConnectionEntry: PeerConnectionEntry) => {
			const listener = this._listeners.get(peerConnectionEntry.peerConnectionId);
			if (listener) {
				peerConnectionEntry.events.off('state-updated', listener);
				this._listeners.delete(peerConnectionEntry.peerConnectionId);
			}
		}

		this._destroyCb = () => {
			monitor.storage.events.off('peer-connection-added', onPeerConnectionAdded);
			monitor.storage.events.off('peer-connection-removed', onPeerConnectionRemoved);

			for (const [peerConnectionId, listener] of this._listeners) {
				const peerConnectionEntry = monitor.storage.getPeerConnection(peerConnectionId);
				if (peerConnectionEntry) {
					peerConnectionEntry.events.off('state-updated', listener);
				}
			}
			this._listeners.clear();
		}

		monitor.storage.events.on('peer-connection-added', onPeerConnectionAdded);
		monitor.storage.events.on('peer-connection-removed', onPeerConnectionRemoved);

		for (const peerConnectionEntry of monitor.storage.peerConnections()) {
			onPeerConnectionAdded(peerConnectionEntry);
		}
	}

	public close() {
		if (this._closed) return;
		this._closed = true;

		this._destroyCb();
		this.emit('close');
	}
}