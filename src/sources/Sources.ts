import { ClientMonitor } from "..";
import { fetchUserAgentData } from "./fetchUserAgentData";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { listenRtcPeerConnectionEvents } from "./rtcEventers";
import { watchMediaDevices } from "./watchMediaDevice";
import { createLogger } from "../utils/logger";
import * as mediasoup from 'mediasoup-client';
import { listenMediasoupTransport } from "./mediasoupTransportEvents";
import { RtcPeerConnectionStatsCollector } from "../collectors/RtcPeerConnectionStatsCollector";
import { MediasoupTransportStatsCollector } from "../collectors/MediasoupTransportStatsCollector";
import { Firefox94StatsAdapter } from "../adapters/Firefox94StatsAdapter";
import { FirefoxTransportStatsAdapter } from "../adapters/FirefoxTransportStatsAdapter";

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

	public isMediasoupDevice(device: unknown): boolean {
		if (device instanceof mediasoup.types.Device) return true;

		if (device?.constructor?.name?.toLocaleLowerCase().startsWith('device')) return true;

		return false;
	}

	public isMediasoupTransport(transport: unknown): boolean {
		if (transport instanceof mediasoup.types.Transport) return true;

		if (transport?.constructor?.name?.toLocaleLowerCase().startsWith('transport')) return true;

		return false;
	}

	public addRTCPeerConnection(params: {
		peerConnectionId?: string,
		peerConnection: RTCPeerConnection,
		attachments?: Record<string, unknown>,
	}): void {
		if (this.monitor.closed) throw new Error('Cannot add RTCPeerConnection to closed ClientMonitor');
		const {
			peerConnectionId = crypto.randomUUID(),
			peerConnection,
			attachments,
		} = params;

		const peerConnectionMonitor = new PeerConnectionMonitor(
				peerConnectionId,
				new RtcPeerConnectionStatsCollector(peerConnection, this.monitor),
				this.monitor,
				attachments,
		);

		listenRtcPeerConnectionEvents({
			monitor: peerConnectionMonitor,
			peerConnection,
			peerConnectionId,
		});

		this._addPeerConnectionMonitor(peerConnectionMonitor);
	}

	public addMediasoupDevice(device: mediasoup.types.Device, attachments?: Record<string, unknown>) {
		const newTransportListener = (transport: mediasoup.types.Transport) => {
			this.addMediasoupTransport(transport, attachments);
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

	public addMediasoupTransport(transport: mediasoup.types.Transport, providedAttachemnts?: Record<string, unknown>) {
		const attachments = {
			direction: transport.direction,
			...(providedAttachemnts ?? {}),
		}
		const peerConnectionMonitor = new PeerConnectionMonitor(
			transport.id,
			new MediasoupTransportStatsCollector(transport, this.monitor),
			this.monitor,
			attachments,
		);

		listenMediasoupTransport({
			monitor: peerConnectionMonitor,
			transport,
			attachments,
		});

		this._addPeerConnectionMonitor(peerConnectionMonitor);

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
			if (!this.monitor.browser && userAgentData.browser) {

				// the browser set triggers to call the stats adapter for existing peer connections
				const browserName = userAgentData.browser.name.toLowerCase();
				if ([ 'chrome', 'firefox', 'safari', 'edge' ].includes(browserName)) {
					this.monitor.browser = {
						name: browserName,
						version: userAgentData.browser?.version,
					}
				} else {
					this.monitor.browser = {
						name: 'unknown',
						version: 'unknown',
					}
				}
			}
		}

		return userAgentData;
	}

	public watchNavigatorMediaDevices() {
		if (this.mediaDevicesAreWatched) return;

		try {
			watchMediaDevices(this.monitor);
			this.mediaDevicesAreWatched = true;
		} catch (err) {
			logger.error('Failed to watch media devices', err);
		}
	}

	private _addPeerConnectionMonitor(pcMonitor: PeerConnectionMonitor) {
		this.monitor.addPeerConnectionMonitor(pcMonitor);

		this.addStatsAdapters(pcMonitor);
	}

	public addStatsAdapters(pcMonitor: PeerConnectionMonitor) {
		if (!this.monitor.browser) return;

		switch (this.monitor.browser.name) {
			case 'chrome': {
				break;
			}
			case 'edge': {
				break;
			}
			case 'opera': {
				break;
			}
			case 'safari': {
				break;
			}
			case 'firefox': {
				pcMonitor.statsAdapters.add(new Firefox94StatsAdapter());
				pcMonitor.statsAdapters.add(new FirefoxTransportStatsAdapter());
				break;
			}
			case 'unknown' : {
				break;
			}
		}
	}
}