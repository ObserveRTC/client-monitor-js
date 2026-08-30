import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * Reports that the set of selected ICE candidate pairs changed — the network path underneath the
 * call moved, which is what a user experiences as the brief cut-out when Wi-Fi hands over to
 * cellular, a VPN comes up, or a NAT rebinding forces a new pair. A tuple is
 * `localAddress:localPort:remoteAddress:remotePort:protocol`, built by the candidate pair itself, so
 * this detector and the connectivity detectors always agree on what the selected path is.
 *
 * It stays deliberately the low-level primitive: it reports only *that* the tuple set changed.
 * `SelectedIcePath` classifies what kind of change it was and emits `ice-path-changed`, and
 * `IceConnectivityDetector` owns the issue raised when a path keeps switching. Establishment itself
 * is not a change: growing from an empty set is skipped, or every call would report a path move in
 * its first seconds.
 *
 * Monitor event: `ice-tuple-changed`. No issue, no config block.
 */
export class IceTupleChangeDetector implements Detector {
		public readonly name = 'ice-tuple-change-detector';
		
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