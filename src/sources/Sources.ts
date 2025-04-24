import { ClientMonitor } from "..";
import { fetchUserAgentData } from "./fetchUserAgentData";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { watchMediaDevices } from "./watchMediaDevice";
import { createLogger } from "../utils/logger";
import * as mediasoup from 'mediasoup-client';
import { RtcPeerConnectionStatsCollector } from "../collectors/RtcPeerConnectionStatsCollector";
import { MediasoupTransportStatsCollector } from "../collectors/MediasoupTransportStatsCollector";
import { Firefox94StatsAdapter } from "../adapters/Firefox94StatsAdapter";
import { FirefoxTransportStatsAdapter } from "../adapters/FirefoxTransportStatsAdapter";
import { RtcPeerConnectionBinding } from "./RtcPeerConnectionBinding";
import { MediasoupTransportBinding } from "./MediasoupTransportBinding";
import { MediasoupDeviceBinding } from "./MediasoupDeviceBinding";

const logger = createLogger('Sources');

export class Sources {
	public mediaDevicesAreWatched = false;
	public userAgentMetaDataSent = false;
	public userAgentStatsAdapterAdded = false;
	public mediasoupStatsAdapterAdded = false;

	private readonly _peerConnectionBindings = new Map<string, RtcPeerConnectionBinding>();
	private readonly _mediasoupTransportBindings = new Map<string, MediasoupTransportBinding>();

	private _mediasoupDeviceBindings: MediasoupDeviceBinding[] = [];

	public constructor(
		public readonly monitor: ClientMonitor
	) {
	}

	public addRTCPeerConnection(params: {
		peerConnectionId?: string,
		peerConnection: RTCPeerConnection,
	}): void {
		const exists = [...this._peerConnectionBindings.values()].find((binding) => binding.peerConnection === params.peerConnection);
		
		if (exists) {
			return logger.warn('RTCPeerConnection already exists in sources, not adding again');
		}

		const {
			peerConnectionId = crypto.randomUUID(),
			peerConnection,
		} = params;

		const peerConnectionMonitor = new PeerConnectionMonitor(
				peerConnectionId,
				new RtcPeerConnectionStatsCollector(peerConnection, this.monitor),
				this.monitor,
		);
		const bindnings = new RtcPeerConnectionBinding(peerConnection, peerConnectionMonitor);

		peerConnectionMonitor.once('close', () => {
			this._peerConnectionBindings.delete(peerConnectionId);
		});
		this._peerConnectionBindings.set(peerConnectionId, bindnings);

		this._addPeerConnectionMonitor(peerConnectionMonitor);
	}

	public removeRTCPeerConnection(peerConnection: RTCPeerConnection) {
		const binding = [...this._peerConnectionBindings.values()].find((binding) => binding.peerConnection === peerConnection);

		if (!binding) {
			logger.warn('RTCPeerConnection not found in sources, cannot remove');
			return;
		}

		binding.unbind();
	}

	public addMediasoupDevice(device: mediasoup.types.Device) {
		const exists = this._mediasoupDeviceBindings.find((binding) => binding.device === device);

		if (exists) {
			logger.warn('Mediasoup device already exists in sources, not adding again');
			return this;
		}

		const deviceBinding = new MediasoupDeviceBinding(device, this);
		this._mediasoupDeviceBindings.push(deviceBinding);

		deviceBinding.bind();

		return this;
	}

	public removeMediasoupDevice(device: mediasoup.types.Device) {
		const binding = this._mediasoupDeviceBindings.find((binding) => binding.device === device);

		if (!binding) {
			logger.warn('Mediasoup device not found in sources, cannot remove');
			return this;
		}

		binding.unbind();
		this._mediasoupDeviceBindings = this._mediasoupDeviceBindings.filter((b) => b !== binding);

		return this;
	}

	public addMediasoupTransport(transport: mediasoup.types.Transport) {
		if (this._mediasoupTransportBindings.has(transport.id)) {
			logger.warn(`Mediasoup transport (${transport.id}) already exists in sources, not adding again`);
			return this;
		}

		const attachments = {
			direction: transport.direction,
		}
		const peerConnectionMonitor = new PeerConnectionMonitor(
			transport.id,
			new MediasoupTransportStatsCollector(transport, this.monitor),
			this.monitor,
			attachments,
		);
		const binding = new MediasoupTransportBinding(transport, peerConnectionMonitor);

		peerConnectionMonitor.once('close', () => {
			this._mediasoupTransportBindings.delete(transport.id);
		});

		this._mediasoupTransportBindings.set(transport.id, binding);

		binding.bind();

		this._addPeerConnectionMonitor(peerConnectionMonitor);

		return this;
	}

	public removeMediasoupTransport(transport: mediasoup.types.Transport) {
		const binding = this._mediasoupTransportBindings.get(transport.id);
	
		if (!binding) {
			logger.warn(`Mediasoup transport (${transport.id}) not found in sources, cannot remove`);
			return this;
		}
	
		binding.unbind();
		this._mediasoupTransportBindings.delete(transport.id);
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