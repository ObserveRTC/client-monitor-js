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
		const stalledStage = this._stalledStage();

		clientMonitor.emit('too-long-pc-connection-establishment', {
			peerConnectionMonitor: this.peerConnection,
			clientMonitor,
			stalledStage,
		});

		if (this.config.createEvent) {
			const [ transport ] = this._sortedBySeverity();

			clientMonitor.addEvent({
				type: ClientEventTypes.LONG_PC_CONNECTION_ESTABLISHMENT,
				payload: {
					peerConnectionId: this.peerConnection.peerConnectionId,
					duration,
					// `connecting` covers both ICE and DTLS — this names which of them
					// the connection is actually stuck in.
					stalledStage,
					iceState: transport?.iceState,
					dtlsState: transport?.dtlsState,
					iceGatheringState: this.peerConnection.iceGatheringState,
				}
			})
		}
	}

	/**
	 * Where establishment is actually stuck. `connectionState: 'connecting'`
	 * covers ICE and the DTLS handshake alike; the per-transport states can name
	 * the stage — `ice-gathering` before any transport exists, `ice-checking`
	 * while a transport is still negotiating connectivity, `dtls` once every
	 * transport's ICE side is done (proven by `iceState` where the browser
	 * reports one, by the selected pair being `succeeded` where it does not) yet
	 * the connection still is not `connected`, and `unknown` when the stats give
	 * no verdict.
	 */
	private _stalledStage(): LongPcConnectionEstablishmentStage {
		// nullish-guarded so a partially mocked monitor (tests, custom sources) stays judgeable
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
			// no reported iceState (Safari, reconstructed Firefox transport):
			// a succeeded selected pair proves the ICE side done
			if (iceState === undefined && transport.getSelectedCandidatePair()?.state === 'succeeded') {
				anyIceDone = true;
			}
		}

		return anyIceDone ? 'dtls' : 'unknown';
	}

	private _sortedBySeverity() {
		const severity: Record<string, number> = {
			failed: 6, disconnected: 5, checking: 4, new: 3, connected: 2, completed: 1, closed: 0,
		};

		return [ ...(this.peerConnection.iceTransports ?? []) ].sort(
			(a, b) => (severity[b.iceState ?? ''] ?? -1) - (severity[a.iceState ?? ''] ?? -1)
		);
	}
}

/** Which stage of establishment a too-long `connecting` is actually stuck in. */
export type LongPcConnectionEstablishmentStage = 'ice-gathering' | 'ice-checking' | 'dtls' | 'unknown';