import EventEmitter from "events";
import { ClientMonitor } from "../ClientMonitor";
import { IceCandidatePairEntry, PeerConnectionEntry } from "../entries/StatsEntryInterfaces";

type PeerConnectionState = {
	congested: boolean;
	outgoingBitrateBeforeCongestion?: number;
	outgoingBitrateAfterCongestion?: number;
	incomingBitrateBeforeCongestion?: number;
	incomingBitrateAfterCongestion?: number;		
}

export type CongestionDetectorEvents = {
	congestion: [PeerConnectionState[]];
	close: [];
}

export declare interface CongestionDetector {
	on<K extends keyof CongestionDetectorEvents>(event: K, listener: (...events: CongestionDetectorEvents[K]) => void): this;
	off<K extends keyof CongestionDetectorEvents>(event: K, listener: (...events: CongestionDetectorEvents[K]) => void): this;
	once<K extends keyof CongestionDetectorEvents>(event: K, listener: (...events: CongestionDetectorEvents[K]) => void): this;
	emit<K extends keyof CongestionDetectorEvents>(event: K, ...events: CongestionDetectorEvents[K]): boolean;
}

export class CongestionDetector extends EventEmitter {
	private _closed = false;
	private _states = new Map<string, PeerConnectionState>();

	public constructor(
	) {
		super();
		this.setMaxListeners(Infinity);
		
	}

	public update(peerConnections: IterableIterator<PeerConnectionEntry>) {
		const visitedPeerConnectionIds = new Set<string>();
		let gotCongested = false;

		for (const peerConnection of peerConnections) {
			const { peerConnectionId } = peerConnection;
			let state = this._states.get(peerConnectionId);

			visitedPeerConnectionIds.add(peerConnectionId);

			if (!state) {
				state = {
					congested: false,
					// outgoingBitrateBeforeCongestion: 0,
					// outgoingBitrateAfterCongestion: 0,
					// incomingBitrateBeforeCongestion: 0,
					// incomingBitrateAfterCongestion: 0,
				};
				this._states.set(peerConnectionId, state);
			}
			const wasCongested = state.congested;
			let isCongested = false;
			
			for (const outboundRtp of peerConnection.outboundRtps()) {
				isCongested ||= outboundRtp.stats.qualityLimitationReason === 'bandwidth';
			}

			let selectedCandidatePair: IceCandidatePairEntry | undefined;
			for (const transport of peerConnection.transports()) {
				selectedCandidatePair = transport.getSelectedIceCandidatePair();
				if (selectedCandidatePair) break;
			}

			if (!selectedCandidatePair) {
				selectedCandidatePair = Array.from(peerConnection.iceCandidatePairs()).find(pair => pair.stats.nominated === true);
			}

			selectedCandidatePair?.stats.availableIncomingBitrate;
			selectedCandidatePair?.stats.availableOutgoingBitrate;

			if (isCongested) {
				state.incomingBitrateAfterCongestion = selectedCandidatePair?.stats.availableIncomingBitrate ?? state.incomingBitrateAfterCongestion;
				state.outgoingBitrateAfterCongestion = selectedCandidatePair?.stats.availableOutgoingBitrate ?? state.outgoingBitrateAfterCongestion;
				state.congested = true;
			} else {
				state.incomingBitrateBeforeCongestion = selectedCandidatePair?.stats.availableIncomingBitrate ?? state.incomingBitrateBeforeCongestion;
				state.outgoingBitrateBeforeCongestion = selectedCandidatePair?.stats.availableOutgoingBitrate ?? state.outgoingBitrateBeforeCongestion;
				state.congested = false;
			}
			
			if (wasCongested === isCongested) {
				if (isCongested) {
					state.incomingBitrateBeforeCongestion = undefined;
					state.outgoingBitrateBeforeCongestion = undefined;
				} else {
					state.incomingBitrateAfterCongestion = undefined;
					state.outgoingBitrateAfterCongestion = undefined;
				}
			} else if (!wasCongested && isCongested) {
				gotCongested = true;
			}
		}

		gotCongested && this.emit('congestion', Array.from(this._states.values()));

		for (const [peerConnectionId] of Array.from(this._states)) {
			if (!visitedPeerConnectionIds.has(peerConnectionId)) {
				this._states.delete(peerConnectionId);
			}
		}
	}

	public close() {
		if (this._closed) return;
		this._closed = true;

		this.emit('close');
	}
}
