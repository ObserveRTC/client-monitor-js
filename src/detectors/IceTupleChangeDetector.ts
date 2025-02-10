import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

export class IceTupleChangeDetector implements Detector {
		public readonly name = 'ice-tuple-change-detector';
		
		public constructor(
				public readonly pcMonitor: PeerConnectionMonitor,
		) {
		}

		public readonly tuples = new Set<string>();

		public update() {
			if (this.pcMonitor.closed) return;
			
			const selectedIceCandidatePairs = this.pcMonitor.selectedIceCandidatePairs;
			const wasEmpty = this.tuples.size === 0;
			let changed = false;
			const curentTuples = new Set<string>();

			for (const pair of selectedIceCandidatePairs) {
				const local = pair.getLocalCandidate();
				const remote = pair.getRemoteCandidate();
				const tuple = `${local?.address}:${local?.port}:${remote?.address}:${remote?.port}:${local?.protocol}`;
			
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