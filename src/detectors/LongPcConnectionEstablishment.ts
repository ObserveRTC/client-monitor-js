import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";

/**
 * Watches how long a peer connection sits in `connecting` and reports when setup outlasts
 * `thresholdInMs` — the user-visible failure being a call that never starts, as opposed to one that
 * starts and then degrades. It is scoped to `connectionState` rather than ICE state on purpose,
 * because that state also covers the DTLS handshake: a connection can stall while every ICE
 * transport already reports `connected`.
 *
 * Setup latency is the whole of its remit; runtime ICE health belongs to `IceConnectivityDetector`,
 * which separately recommends an ICE restart for a connection that never establishes. Firing is
 * one-shot per attempt and rearms on *any* exit from `connecting`, not just a successful one — a
 * connection that failed and is retrying is more interesting than the first attempt, so resetting
 * only on `connected` would silence every attempt after the first failure.
 *
 * Monitor event: `too-long-pc-connection-establishment`. Client event:
 * `LONG_PC_CONNECTION_ESTABLISHMENT`, when `createEvent`. Config:
 * `longPcConnectionEstablishmentDetector`.
 */
export class LongPcConnectionEstablishmentDetector implements Detector{
	public readonly name = 'long-pc-connection-establishment-detector';
	public disabled = false;
	
	private get config() {
		return this.peerConnection.parent.config.longPcConnectionEstablishmentDetector!;
	}

	private _evented = false;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
		
	}

	public update(): void {
		if (this.disabled) return;
		if (this.peerConnection.connectionState !== 'connecting') {
			// Rearms on *any* exit from `connecting`: resetting only on `connected` would silence every attempt after the first failure.
			this._evented = false;

			return;
		}
		if (this._evented) return;
		if (this.peerConnection.connectingStartedAt === undefined) return;
		
		const duration = Date.now() - this.peerConnection.connectingStartedAt;
		if (duration < this.config.thresholdInMs) {
			return;
		}
		this._evented = true;
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('too-long-pc-connection-establishment', {
			peerConnectionMonitor: this.peerConnection,
			clientMonitor,
		});

		if (this.config.createEvent) {
			clientMonitor.addEvent({
				type: ClientEventTypes.LONG_PC_CONNECTION_ESTABLISHMENT,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					duration,
				}
			})
		}
	}
}