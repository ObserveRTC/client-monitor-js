import { ClientMonitor } from "..";
import { fetchUserAgentData } from "./fetchUserAgentData";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { listenRtcPeerConnectionEvents } from "./rtcEventers";
import { watchMediaDevices } from "./watchMediaDevice";
import { createStatsFromRTCStatsReportProvider } from "../utils/stats";
import { createLogger } from "../utils/logger";
import * as mediasoup from 'mediasoup-client';
import { listenMediasoupTransport } from "./mediasoupTransportEvents";
import { mediasoupStatsAdapter } from "../adapters/mediasoupAdapter";

const logger = createLogger('Sources');

export class Sources {
	public mediaDevicesAreWatched = false;
	public userAgentMetaDataSent = false;
	public userAgentStatsAdapterAdded = false;
	public mediasoupStatsAdapterAdded = false;

	private _mediasoupDeviceListeners: {
		device: mediasoup.types.Device,
		listener: (transport: mediasoup.types.Transport) => void,
	}[] = [];

	public constructor(
		public readonly monitor: ClientMonitor
	) {
	}

	public addRTCPeerConnection(params: {
		peerConnectionId?: string,
		peerConnection: RTCPeerConnection,
		appData?: Record<string, unknown>,
	}): void {
		if (this.monitor.closed) throw new Error('Cannot add RTCPeerConnection to closed ClientMonitor');
		const {
			peerConnectionId = crypto.randomUUID(),
			peerConnection,
			appData,
		} = params;

		const peerConnectionMonitor = new PeerConnectionMonitor(
				peerConnectionId,
				createStatsFromRTCStatsReportProvider(peerConnection.getStats),
				this.monitor,
		);

		listenRtcPeerConnectionEvents({
			monitor: peerConnectionMonitor,
			peerConnection,
			peerConnectionId,
			appData,
		});

		this.monitor.addPeerConnectionMonitor(peerConnectionMonitor);
	}

	public addMediasoupDevice(device: mediasoup.types.Device, clientEventAppData?: Record<string, unknown>) {
		const newTransportListener = (transport: mediasoup.types.Transport) => {
			this.addMediasoupTransport(transport, clientEventAppData);
		}
		this._mediasoupDeviceListeners.push({ device, listener: newTransportListener });
		device.observer.on('newtransport', newTransportListener);
	}

	public removeMediasoupDevice(device: mediasoup.types.Device) {
		const listener = this._mediasoupDeviceListeners.find((l) => l.device === device);
		if (!listener) return this;
		device.observer.off('newtransport', listener.listener);
		this._mediasoupDeviceListeners = this._mediasoupDeviceListeners.filter((l) => l !== listener);
		return this;
	}

	public addMediasoupTransport(transport: mediasoup.types.Transport, clientEventAppData?: Record<string, unknown>) {
		const peerConnectionMonitor = new PeerConnectionMonitor(
			transport.id,
			createStatsFromRTCStatsReportProvider(transport.getStats),
			this.monitor,
		);

		listenMediasoupTransport({
			monitor: peerConnectionMonitor,
			transport,
			appData: clientEventAppData,
		});

		this.monitor.addPeerConnectionMonitor(peerConnectionMonitor);

		if (!this.mediasoupStatsAdapterAdded) {
			this.monitor.statsAdapters.add(
				mediasoupStatsAdapter
			);
			this.mediasoupStatsAdapterAdded = true;
		}

		return this;
	}

	public fetchUserAgentData() {
		const userAgentData = fetchUserAgentData();
		
		if (!userAgentData) return;

		if (!this.userAgentMetaDataSent) {
			this.monitor.addMetaData({
				type: 'USER_AGENT_DATA',
				payload: {
					...userAgentData
				}
			});
			this.userAgentMetaDataSent = true;
		}

		if (!this.userAgentStatsAdapterAdded) {
			this.userAgentStatsAdapterAdded = true;
			if (userAgentData.browser) {
				// let's add adapter here if we know the browser
				try {
					// no-op
				} catch (err) {
					logger.error('Failed to add adapter', err);
				}
			}
		}

		return userAgentData;
	}

	public watchMediaDevices() {
		if (this.mediaDevicesAreWatched) return;

		try {
			watchMediaDevices(this.monitor);
			this.mediaDevicesAreWatched = true;
		} catch (err) {
			logger.error('Failed to watch media devices', err);
		}
	}

}