import { ClientMonitor } from "..";
import { fetchUserAgentData } from "./fetchUserAgentData";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { listenRtcPeerConnectionEvents } from "./rtcEventers";
import { watchMediaDevices } from "./watchMediaDevice";
import { collectStatsFromRtcPeerConnection } from "../utils/stats";
import { createLogger } from "../utils/logger";

const logger = createLogger('Sources');

export class Sources {
	public userAgentMetaDataSent = false;
	
	public constructor(
		public readonly monitor: ClientMonitor
	) {
	}

	public addRtcPeerConnection(params: {
		peerConnectionId?: string,
		peerConnection: RTCPeerConnection,
		appData?: Record<string, unknown>,
	}): this {
		if (this.monitor.closed) throw new Error('Cannot add RTCPeerConnection to closed ClientMonitor');
		const {
			peerConnectionId = crypto.randomUUID(),
			peerConnection,
			appData,
		} = params;

		const peerConnectionMonitor = new PeerConnectionMonitor(
				peerConnectionId,
				() => collectStatsFromRtcPeerConnection(peerConnection),
				this.monitor,
		);

		listenRtcPeerConnectionEvents({
			monitor: this.monitor,
			peerConnection,
			peerConnectionId,
			appData,
		});

		peerConnectionMonitor.once('close', () => {
				this.monitor.mappedPeerConnections.delete(peerConnectionId);
		});
		this.monitor.mappedPeerConnections.set(peerConnectionId, peerConnectionMonitor);

		return this;
	}

	public addMediasoupDevice() {
		return this;
	}

	public addMediasoupTransport() {
		return this;
	}

	public fetchUserAgentData() {
		const userAgentData = fetchUserAgentData();
		
		if (!userAgentData) return this;

		if (!this.userAgentMetaDataSent) {
			this.monitor.addMetaData({
				type: 'USER_AGENT_DATA',
				payload: {
					...userAgentData
				}
			});
			this.userAgentMetaDataSent = true;
		}

		if (userAgentData.browser) {
			// let's add adapter here if we know the browser
			try {
				// no-op for now
			} catch (err) {
				logger.error('Failed to add adapter', err);
			}
		}

		return this;
	}

	public watchMediaDevices() {
		try {
			watchMediaDevices(this.monitor);
		} catch (err) {
			logger.error('Failed to watch media devices', err);
		}

		return this;
	}

	
}