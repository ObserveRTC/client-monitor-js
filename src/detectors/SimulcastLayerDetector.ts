import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

/** A snapshot of every encoding on the track, materialized only on a change. */
export type SimulcastLayerState = {
	/** The RID, when the application uses one. Falls back to the SSRC. */
	rid: string;
	ssrc: number;
	encodingIndex?: number;
	/** Not the encoding's flag alone: the layer also has to have sent bytes in the interval. */
	active: boolean;
	bitrate?: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	scalabilityMode?: string;
}

export type SimulcastLayerDetectorConfig = {
	/** Whether to buffer a `SIMULCAST_LAYER_CHANGED` client event into the sample. DEFAULT: true */
	createEvent?: boolean;
}

/**
 * Reports a change in which simulcast layers an outbound video track is actually sending. Layers
 * are meant to come and go, so this is an observation rather than a fault — but use it to answer
 * "why is this participant blurry" with a client-side record that the high layer stopped being
 * produced at all.
 *
 * A layer counts as active only when the encoding is not explicitly disabled *and* it sent bytes
 * in the interval; `active: true` with no bytes is what a layer the encoder quietly gave up on
 * looks like. Fewer than two encodings is not simulcast and is left alone, the first observation
 * only establishes a baseline, and a pause forgets the baseline rather than reporting the pause
 * and the resume as two changes.
 *
 * Raises no issue.
 * Monitor event: `simulcast-layer-changed`; client event `SIMULCAST_LAYER_CHANGED` when
 * `createEvent` is left on. Config: `simulcastLayerDetector`.
 *
 * Category: Telemetry
 * Layer: Media
 *
 */
export class SimulcastLayerDetector implements Detector {
	public readonly name = 'simulcast-layer-detector';
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

		if (this.trackMonitor.paused) {
			this._previousActiveKeys = undefined;

			return;
		}

		const outboundRtps = this.trackMonitor.getOutboundRtps();

		if (outboundRtps.length < 2) return;

		const activeRids: string[] = [];

		for (const outboundRtp of outboundRtps) {
			if (outboundRtp.active !== false && 0 < (outboundRtp.deltaBytesSent ?? 0)) {
				activeRids.push(outboundRtp.rid ?? `${outboundRtp.ssrc}`);
			}
		}

		const activeKeys = activeRids.sort().join(',');

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
				// Schema payloads are flat records of primitives, hence the joined ids and the stringified snapshot.
				activeLayerIds: activeKeys,
				previousActiveLayerIds: from,
				layers: JSON.stringify(layers),
			},
		});
	}
}
