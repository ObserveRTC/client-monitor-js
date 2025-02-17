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
import { firefox94StatsAdapter } from "../adapters/firefox94StatsAdapter";
import { StatsGenerator } from "../adapters/StatsGenerators";
import { FirefoxTransportStatsGenerator } from "../adapters/firefoxTransportStatsGenerator";

const logger = createLogger('Sources');

export class Sources {
	private _generatorProviders = new Map<string, (pcMonitor: PeerConnectionMonitor) => StatsGenerator>();

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
				createStatsFromRTCStatsReportProvider(peerConnection.getStats.bind(peerConnection)),
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
			createStatsFromRTCStatsReportProvider(transport.getStats.bind(transport)),
			this.monitor,
			attachments,
		);

		listenMediasoupTransport({
			monitor: peerConnectionMonitor,
			transport,
			attachments,
		});

		this._addPeerConnectionMonitor(peerConnectionMonitor);

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
					if (userAgentData.browser.name === 'Firefox') {
						this.monitor.statsAdapters.add(firefox94StatsAdapter);
						this._addStatsGeneratorProvider(
							FirefoxTransportStatsGenerator.constructor.name,
							(pcMonitor) => new FirefoxTransportStatsGenerator(pcMonitor),
						)
					}
					// no-op
				} catch (err) {
					logger.error('Failed to add adapter', err);
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
		for (const generator of this._generatorProviders.values()) {
			const statsGenerator = generator(pcMonitor);

			pcMonitor.statsGenerators.add(statsGenerator);
		}
		this.monitor.addPeerConnectionMonitor(pcMonitor);
	}

	private _addStatsGeneratorProvider(name: string, provider: (pcMonitor: PeerConnectionMonitor) => StatsGenerator, applyOnExisting = true) {
		if (this._generatorProviders.has(name)) return;

		if (applyOnExisting) {
			for (const pcMonitor of this.monitor.peerConnections) {
				const generator = provider(pcMonitor);
				pcMonitor.statsGenerators.add(generator);
			}
		}

		this._generatorProviders.set(name, provider);
	}
}