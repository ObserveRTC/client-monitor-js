import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type SimulcastLayerState = {
	/** The RID, when the application uses one. Falls back to the SSRC. */
	rid: string;
	ssrc: number;
	encodingIndex?: number;
	active: boolean;
	bitrate?: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	scalabilityMode?: string;
}

/**
 * Simulcast Layer Detector
 *
 * Reports when the set of simulcast layers actually being sent changes. This is
 * an observation, not a fault: layers are meant to come and go as bandwidth and
 * CPU allow. It is worth surfacing because today the change is completely
 * invisible — an SFU-side "why is this participant blurry" investigation
 * currently has no client-side record that the high layer stopped being
 * produced at all.
 *
 * A layer counts as active when the encoding is not explicitly disabled **and**
 * it actually sent bytes in the interval. `active: true` with no bytes is the
 * common real-world shape of a layer the encoder has quietly given up on, and
 * treating it as active would hide exactly the transition worth reporting.
 *
 * Layers are named by `rid` where the application sets one, falling back to the
 * SSRC. Naming them meaningfully ("high"/"low") is the application's RID
 * convention, not something this library can infer.
 *
 * **Events emitted:**
 * - `simulcast-layer-changed` (monitor event)
 * - `SIMULCAST_LAYER_CHANGED` (client event, when `createEvent` is set)
 */
export class SimulcastLayerDetector implements Detector {
	public readonly name = 'simulcast-layer-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;

	private _previousActiveKeys?: string;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {}

	private get config() {
		return this.peerConnection.parent.config.simulcastLayerDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const outboundRtps = this.trackMonitor.getOutboundRtps();

		// a single encoding is not simulcast
		if (outboundRtps.length < 2) return;

		// only the cheap comparison key on the steady-state tick; the full
		// per-layer snapshot is materialized exclusively on a change
		const activeRids: string[] = [];

		for (const outboundRtp of outboundRtps) {
			if (outboundRtp.active !== false && 0 < (outboundRtp.deltaBytesSent ?? 0)) {
				activeRids.push(outboundRtp.rid ?? `${outboundRtp.ssrc}`);
			}
		}

		const activeKeys = activeRids.sort().join(',');

		// first observation is the baseline, not a change
		if (this._previousActiveKeys === undefined) {
			this._previousActiveKeys = activeKeys;

			return;
		}
		if (this._previousActiveKeys === activeKeys) return;

		const layers: SimulcastLayerState[] = outboundRtps.map((outboundRtp) => ({
			rid: outboundRtp.rid ?? `${outboundRtp.ssrc}`,
			ssrc: outboundRtp.ssrc,
			encodingIndex: outboundRtp.encodingIndex,
			active: outboundRtp.active !== false && 0 < (outboundRtp.deltaBytesSent ?? 0),
			bitrate: outboundRtp.bitrate,
			frameWidth: outboundRtp.frameWidth,
			frameHeight: outboundRtp.frameHeight,
			framesPerSecond: outboundRtp.framesPerSecond,
			scalabilityMode: outboundRtp.scalabilityMode,
		}));

		const from = this._previousActiveKeys;

		this._previousActiveKeys = activeKeys;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('simulcast-layer-changed', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			activeLayerIds: activeKeys.length ? activeKeys.split(',') : [],
			previousActiveLayerIds: from.length ? from.split(',') : [],
			layers,
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.SIMULCAST_LAYER_CHANGED,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				activeLayerIds: activeKeys.length ? activeKeys.split(',') : [],
				previousActiveLayerIds: from.length ? from.split(',') : [],
				layers: layers as unknown as Record<string, unknown>[],
			},
		});
	}
}
