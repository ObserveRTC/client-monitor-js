import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { Detector } from "./Detector";

/**
 * ICE Tuple Change Detector
 * 
 * Detects changes in ICE candidate pairs (tuples) used for peer connection transport.
 * ICE tuples represent the network paths between local and remote endpoints, and changes
 * can indicate network topology changes, failover events, or connectivity issues.
 * 
 * **Detection Logic:**
 * - Monitors selected ICE candidate pairs from peer connection statistics
 * - Tracks unique tuples based on local/remote addresses, ports, and protocol
 * - Detects when tuples are added or removed from the active set
 * - Ignores initial tuple establishment (when set was empty)
 * 
 * **Tuple Format:**
 * - `localAddress:localPort:remoteAddress:remotePort:protocol`
 * - Example: `192.168.1.100:54321:203.0.113.1:3478:udp`
 * 
 * **Events Emitted:**
 * - `ice-tuple-changed`: Emitted when ICE candidate pairs change
 * 
 * **Use Cases:**
 * - Network path monitoring and diagnostics
 * - Detecting network failover events
 * - Identifying connectivity changes during calls
 * - Network topology analysis
 * 
 * @example
 * ```typescript
 * // Listen for ICE tuple changes
 * monitor.on('ice-tuple-changed', ({ peerConnectionMonitor, clientMonitor }) => {
 *   console.log('ICE candidate pairs changed for PC:', peerConnectionMonitor.peerConnectionId);
 *   console.log('Current tuples:', detector.tuples);
 * });
 * ```
 */
export class IceTupleChangeDetector implements Detector {
		/** Unique identifier for this detector type */
		public readonly name = 'ice-tuple-change-detector';
		
		/**
		 * Creates a new IceTupleChangeDetector instance
		 * @param pcMonitor - The peer connection monitor to analyze for ICE tuple changes
		 */
		public constructor(
				public readonly pcMonitor: PeerConnectionMonitor,
		) {
		}

		/** Set of currently active ICE tuples (network paths) */
		public readonly tuples = new Set<string>();

		/**
		 * Updates the detector state and checks for ICE tuple changes
		 * 
		 * This method monitors the selected ICE candidate pairs and detects when
		 * the set of active network paths changes.
		 * 
		 * **Processing Steps:**
		 * 1. Skip if peer connection is closed
		 * 2. Get current selected ICE candidate pairs
		 * 3. Build current tuple set from candidate pairs
		 * 4. Compare with previous tuple set to detect changes
		 * 5. Update internal tuple set and emit events on changes
		 * 6. Ignore initial establishment (when tuple set was empty)
		 */
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