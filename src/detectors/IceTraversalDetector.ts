import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/** No tunables. The type exists so the detector can be toggled: `{}` enables it, `null` disables it. */
export type IceTraversalDetectorConfig = Record<string, never>;

/**
 * Reports that the set of selected ICE candidate pairs changed — the network path under the call
 * moved. Use it to place the brief cut-out a user felt when Wi-Fi handed over to cellular, a VPN
 * came up, or a NAT rebinding forced a new pair. A tuple is
 * `localAddress:localPort:remoteAddress:remotePort:protocol`, built by the candidate pair itself,
 * so this and the connectivity detectors always agree on what the selected path is.
 *
 * Establishment is not a change: growing from an empty set is skipped.
 *
 * It reports only *that* the tuple set changed. `SelectedIcePath` classifies the kind of change,
 * and `UnstableIcePathDetector` owns the issue raised when a path keeps switching.
 *
 * Monitor event: `ice-tuple-changed`. No issue. Config: `iceTraversalDetector` — `{}` registers the
 * detector, `null` leaves it unregistered.
 *
 * Category: Telemetry
 * Layer: Transport
 *
 */
export class IceTraversalDetector implements Detector {
		public readonly name = 'ice-traversal-detector';
		
		public constructor(
				public readonly pcMonitor: PeerConnectionMonitor,
		) {
		}

		public readonly tuples = new Set<string>();

		public update() {
			if (this.pcMonitor.closed) return;
			
			const wasEmpty = this.tuples.size === 0;
			let changed = false;
			const curentTuples = new Set<string>();

			for (const pair of this.pcMonitor.selectedIceCandidatePairs) {
				const tuple = pair.tuple;

				curentTuples.add(tuple);
				if (!this.tuples.has(tuple)) {
					changed = true;
					this.tuples.add(tuple);
				}
			}
			for (const tuple of this.tuples) {
				if (!curentTuples.has(tuple)) {
					changed = true;
					this.tuples.delete(tuple);
				}
			}

			if (wasEmpty || !changed) return;
			
			this.pcMonitor.parent.emit('ice-tuple-changed', {
				clientMonitor: this.pcMonitor.parent,
				peerConnectionMonitor: this.pcMonitor,
			});
		}
	}