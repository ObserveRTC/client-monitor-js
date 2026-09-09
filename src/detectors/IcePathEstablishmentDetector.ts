import { ClientEventTypes } from "../schema/ClientEventTypes";
import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** Which stage of establishment a too-long `connecting` is actually stuck in. */
export type IcePathEstablishmentStage = 'ice-gathering' | 'ice-checking' | 'dtls' | 'unknown';

/** Severity order for picking the transport that best explains a stall — without BUNDLE there are several. */
const ICE_STATE_SEVERITY: Record<string, number> = {
	failed: 6, disconnected: 5, checking: 4, new: 3, connected: 2, completed: 1, closed: 0,
};

export type IcePathEstablishmentDetectorConfig = {
	/** Also add the `LONG_PC_CONNECTION_ESTABLISHMENT` client event, not just the monitor event. Default true. */
	createEvent?: boolean

	/** How long a connection may stay in `connecting` before it is reported, in ms. */
	thresholdInMs: number;
}

/**
 * Reports how long a peer connection has been trying to connect and, more usefully, which stage it
 * is stuck in. `connectionState: 'connecting'` covers ICE gathering, ICE checking and the DTLS
 * handshake alike; `stalledStage` tells them apart, so an operator can say whether to look at
 * candidate gathering, at reachability, or at the certificate exchange.
 *
 * The trigger is `connectionState` rather than any transport's ICE state, because a connection whose
 * ICE side finished and whose DTLS handshake hangs reads `connected` on every transport. Time is
 * accumulated from the connection's own `deltaTime`, so a backgrounded tab does not report the wall
 * clock it slept through, and the stage is read from the same observations as the duration. Any exit
 * from `connecting` re-arms the detector and zeroes the clock, so each attempt is timed on its own.
 *
 * It raises no issue: slow is not yet failed. `IceEstablishmentFailedDetector` makes that claim.
 *
 * Monitor event: `ice-path-establishment-slow`. Client event:
 * `LONG_PC_CONNECTION_ESTABLISHMENT`, when `createEvent`. Config: `icePathEstablishmentDetector`.
 *
 * Category: Connectivity
 * Layer: 3 — Path establishment
 *
 */
export class IcePathEstablishmentDetector implements Detector {
	public readonly name = 'ice-path-establishment-detector';
	public disabled = false;

	private _evented = false;
	/** Stats time this attempt has spent in `connecting`, accumulated from `deltaTime`. */
	private _connectingForInMs = 0;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.icePathEstablishmentDetector!;
	}

	public update(): void {
		if (this.disabled) return;

		if (this.peerConnection.connectionState !== 'connecting') {
			// Any exit re-arms, not just `connected`, so each attempt is timed on its own.
			this._evented = false;
			this._connectingForInMs = 0;

			return;
		}

		this._connectingForInMs += this.peerConnection.deltaTime ?? 0;

		this._checkSlowEstablishment(this._connectingForInMs);
	}

	private _checkSlowEstablishment(durationInMs: number) {
		if (this._evented) return;
		if (durationInMs < this.config.thresholdInMs) return;

		this._evented = true;

		const clientMonitor = this.peerConnection.parent;
		const stalledStage = this._stalledStage();

		clientMonitor.emit('ice-path-establishment-slow', {
			peerConnectionMonitor: this.peerConnection,
			clientMonitor,
			stalledStage,
			sustainedForInMs: durationInMs,
		});

		if (!this.config.createEvent) return;

		const [ subject ] = this._bySeverity();

		clientMonitor.addEvent({
			type: ClientEventTypes.LONG_PC_CONNECTION_ESTABLISHMENT,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				// Stats time, not wall clock.
				duration: durationInMs,
				stalledStage,
				iceState: subject?.iceState,
				dtlsState: subject?.dtlsState,
				iceGatheringState: this.peerConnection.iceGatheringState,
			},
		});
	}

	/** Narrows a stalled `connecting` to the stage responsible, or `unknown` when the stats give no verdict. */
	private _stalledStage(): IcePathEstablishmentStage {
		const transports = this.peerConnection.iceTransports ?? [];

		if (transports.length === 0) {
			return this.peerConnection.iceGatheringState === 'gathering' ? 'ice-gathering' : 'unknown';
		}

		let anyIceDone = false;

		for (const transport of transports) {
			const iceState = transport.iceState;

			if (iceState === 'checking' || iceState === 'new') return 'ice-checking';
			if (iceState === 'connected' || iceState === 'completed') {
				anyIceDone = true;
				continue;
			}
			// Where no iceState is reported (Safari), a succeeded pair proves the ICE side done.
			if (iceState === undefined && transport.getSelectedCandidatePair()?.state === 'succeeded') {
				anyIceDone = true;
			}
		}

		return anyIceDone ? 'dtls' : 'unknown';
	}

	private _bySeverity(): IceTransportMonitor[] {
		return [ ...(this.peerConnection.iceTransports ?? []) ].sort(
			(a, b) => (ICE_STATE_SEVERITY[b.iceState ?? ''] ?? -1) - (ICE_STATE_SEVERITY[a.iceState ?? ''] ?? -1)
		);
	}
}
