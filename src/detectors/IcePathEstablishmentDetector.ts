import { ClientEventTypes } from "../schema/ClientEventTypes";
import { IceTransportMonitor } from "../monitors/IceTransportMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** Which stage of establishment a too-long `connecting` is actually stuck in. */
export type IcePathEstablishmentStage = 'ice-gathering' | 'ice-checking' | 'dtls' | 'unknown';

/**
 * Severity order used to pick the transport that best explains a stalled
 * establishment. A connection without BUNDLE has several transports, and the
 * failing one is the story — not whichever healthy sibling was listed first.
 */
const ICE_STATE_SEVERITY: Record<string, number> = {
	failed: 6, disconnected: 5, checking: 4, new: 3, connected: 2, completed: 1, closed: 0,
};

export type IcePathEstablishmentDetectorConfig = {
	/**
	 * Flag to indicate if the detector should create the
	 * `LONG_PC_CONNECTION_ESTABLISHMENT` client event in addition to
	 * emitting the monitor event. Set it to `false` to keep the event out of
	 * the sample stream while still receiving it in-process.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean

	/**
	 * The time threshold (in milliseconds) for reporting prolonged
	 * PeerConnection establishment. Raising it makes the detector quieter on
	 * slow-but-working networks; lowering it reports sooner and more often.
	 */
	thresholdInMs: number;
}

/**
 * Reports how long a peer connection has been trying to connect, and — the part that makes the
 * report actionable — which stage of connecting it is stuck in. Nothing else in the library can
 * answer that second question, because `connectionState: 'connecting'` deliberately covers ICE
 * gathering, ICE checking and the DTLS handshake alike, and the three have nothing in common except
 * that the connection is not ready yet.
 *
 * The trigger is `connectionState` rather than any transport's ICE state precisely because of that
 * coverage: a connection whose ICE side finished and whose DTLS handshake is hanging has every
 * transport reading `connected` while the call still does not work, and a detector watching ICE
 * alone would call it healthy. `_stalledStage()` then narrows the report to the stage actually
 * responsible, using the selected pair being `succeeded` as the proof that the ICE side is done
 * where the browser reports no per-transport `iceState` at all.
 *
 * It re-arms on **any** exit from `connecting`, not only on `connected`. Resetting on success alone
 * would silence every attempt after the first failure, and a retry that is also taking too long is
 * more interesting than the first attempt was, not less. The same exit zeroes the establishment
 * clock, so each attempt is timed from its own start rather than from the connection's.
 *
 * That clock is stats time: `_connectingForInMs` accumulates the peer connection's own `deltaTime`
 * on every tick spent in `connecting`. Measuring against `connectingStartedAt` — a wall-clock stamp
 * — reported the time the *page* spent, which is a different quantity the moment collection runs
 * late: a backgrounded tab resurfacing after two minutes would announce a two-minute establishment
 * it never watched, and the `stalledStage` shipped alongside would be read off a single stats report
 * taken after the fact. The duration and the stage it explains now come from the same observations.
 *
 * This detector raises no issue: it says establishment is slow, which is not yet a claim that it has
 * failed. `IceEstablishmentFailedDetector` — same layer, its own class — makes that claim once the
 * evidence supports it, and `IceRestartRecommendationDetector` owns the `never-established` restart
 * recommendation that used to live here. All three read the connection's own state rather than each
 * other's conclusions.
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
			// Rearms on *any* exit from `connecting`: resetting only on `connected` would silence every attempt after the first failure.
			this._evented = false;
			// The condition has broken, so the clock starts over: a second attempt must
			// earn the threshold on its own, not inherit what the first one banked.
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
				// stats time, not wall-clock: how much observed `connecting` the
				// threshold was actually crossed with
				duration: durationInMs,
				// `connecting` covers both ICE and DTLS — this names which of them
				// the connection is actually stuck in.
				stalledStage,
				iceState: subject?.iceState,
				dtlsState: subject?.dtlsState,
				iceGatheringState: this.peerConnection.iceGatheringState,
			},
		});
	}

	/**
	 * Where establishment is actually stuck. `connectionState: 'connecting'` covers ICE and the DTLS
	 * handshake alike; the per-transport states can name the stage — `ice-gathering` before any
	 * transport exists, `ice-checking` while a transport is still negotiating connectivity, `dtls`
	 * once a transport's ICE side is done (proven by `iceState` where the browser reports one, by the
	 * selected pair being `succeeded` where it does not) yet the connection still is not `connected`,
	 * and `unknown` when the stats give no verdict.
	 */
	private _stalledStage(): IcePathEstablishmentStage {
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

	private _bySeverity(): IceTransportMonitor[] {
		return [ ...(this.peerConnection.iceTransports ?? []) ].sort(
			(a, b) => (ICE_STATE_SEVERITY[b.iceState ?? ''] ?? -1) - (ICE_STATE_SEVERITY[a.iceState ?? ''] ?? -1)
		);
	}
}
