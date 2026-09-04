import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

/** A snapshot of every encoding on the track, materialized only on a change. */
export type SimulcastLayerState = {
	/** The RID, when the application uses one. Falls back to the SSRC. */
	rid: string;
	ssrc: number;
	encodingIndex?: number;
	/** Not the encoding's `active` flag alone: the layer also has to have sent bytes in the interval. */
	active: boolean;
	bitrate?: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	scalabilityMode?: string;
}

export type SimulcastLayerDetectorConfig = {
	/**
	 * Whether to buffer a `SIMULCAST_LAYER_CHANGED` client event into the
	 * sample in addition to emitting the monitor event.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;
}

/**
 * Reports when the set of simulcast layers an outbound video track is actually sending
 * changes. This is an observation rather than a fault — layers are meant to come and go
 * as bandwidth and CPU allow — but the change is otherwise completely invisible: an
 * SFU-side "why is this participant blurry" investigation has no client-side record
 * that the high layer stopped being produced at all.
 *
 * A layer counts as active only when the encoding is not explicitly disabled *and* it
 * actually sent bytes in the interval. `active: true` with no bytes is the common
 * real-world shape of a layer the encoder has quietly given up on, so trusting the flag
 * alone would hide exactly the transition worth reporting. Layers are named by `rid`
 * where the application sets one and by SSRC otherwise; naming them meaningfully
 * ("high"/"low") is the application's RID convention, not something this library can
 * infer.
 *
 * A track with fewer than two encodings is not simulcast and is left alone, and the
 * first observation establishes a baseline rather than reporting a change. While the
 * producer is paused the baseline is forgotten entirely, so resuming re-establishes it
 * instead of reporting the pause and the resume as two layer changes.
 *
 * Raises no issue.
 * Monitor event: `simulcast-layer-changed`; client event `SIMULCAST_LAYER_CHANGED` when
 * `createEvent` is left on.
 * Config: `simulcastLayerDetector`.
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
				// Schema 3.5.0 payloads are flat records of primitives, hence the comma-separated ids and the stringified snapshot.
				activeLayerIds: activeKeys,
				previousActiveLayerIds: from,
				layers: JSON.stringify(layers),
			},
		});
	}
}
