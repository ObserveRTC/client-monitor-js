import { Detector } from "./Detector";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientMonitorEvents } from "../ClientMonitorEvents";

export type CongestionIssuePayload = {
	peerConnectionId: string;
	/** Bandwidth estimate at the moment congestion was declared, in bps. */
	availableIncomingBitrate: number;
	/** Bandwidth estimate at the moment congestion was declared, in bps. */
	availableOutgoingBitrate: number;
	/** Peak estimate observed during the healthy stretch immediately before this episode. */
	maxAvailableIncomingBitrate: number;
	/** Peak estimate observed during the healthy stretch immediately before this episode. */
	maxAvailableOutgoingBitrate: number;
	/** Peak bitrate actually received during that same healthy stretch. */
	maxReceivingBitrate: number;
	/** Peak bitrate actually sent during that same healthy stretch. */
	maxSendingBitrate: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type CongestionDecetorEvent = ClientMonitorEvents['congestion'];

export type CongestionDetectorConfig = {
	/**
	 * How much corroboration the browser's own bandwidth verdict needs before congestion is
	 * declared. `high` takes it at its word, `medium` also wants the round trip to be moving,
	 * `low` instead wants outbound loss above 5%.
	 */
	sensitivity: 'low' | 'medium' | 'high';
}

/**
 * **Deprecated.** Superseded by `UplinkCongestionDetector` and `DownlinkCongestionDetector`, which
 * judge each direction on its own evidence and report a graded `severity` rather than a single
 * on/off verdict for the whole connection. This class is kept only so integrations built against
 * the `congestion` event and the `congestion` issue keep working through the transition, and will
 * be removed. New code should read `uplink-congestion` and `downlink-congestion`.
 *
 * Watches a peer connection for the point at which the network stops being able to carry what
 * the encoder wants to produce — the cause behind collapsing resolution, stuttering video and
 * the "you're breaking up" complaint.
 *
 * The anchor signal is the browser's own verdict rather than any bitrate threshold this library
 * could invent: `qualityLimitationReason === 'bandwidth'` on an outbound stream means the
 * encoder is already being throttled by the bandwidth estimator, which sees far more than the
 * stats API exposes. That verdict is eager, so `sensitivity` decides how much corroboration is
 * demanded. `high` takes it at its word. `medium` additionally wants the round trip to be
 * moving — the current average diverging from its EWMA by more than a third of that EWMA,
 * clamped to a 50-150ms band — which is queue build-up rather than a link that is merely narrow.
 * `low` instead wants outbound loss above 5%, and deliberately applies no round-trip guard:
 * requiring both made a bandwidth-limited connection losing a twentieth of its packets read as
 * perfectly healthy until the first RTCP report happened to arrive.
 *
 * Both round-trip figures are drawn with the same source preference, RTCP first and ICE/STUN as
 * the fallback, so their difference can never compare two different round trips against each
 * other. Whenever the connection is *not* congested the detector keeps running maxima of the
 * available and actual bitrates; those travel with the issue as the "before" picture and are
 * then reset, so each episode is measured against the headroom that immediately preceded it
 * rather than against the whole call.
 *
 * Its issue is raised on the **client** registry rather than the connection's, which is what keeps
 * it out of the score: `uplink-congestion` and `downlink-congestion` already price congestion, and
 * a deprecated duplicate reporting the same condition must not penalise a call twice. It is priced
 * at zero in `ISSUE_SCORING` to say so explicitly rather than by omission.
 *
 * Raises `congestion`. Emits `congestion`. Config: `congestionDetector`.
 * Connection attribute: `PeerConnectionMonitor.congested`.
 *
 * Category: Transport Quality
 * Layer: Capacity
 *
 * @deprecated Use `UplinkCongestionDetector` and `DownlinkCongestionDetector` instead.
 */
export class CongestionDetector implements Detector {
	public static readonly ISSUE_TYPE = 'congestion';
	public readonly name = 'congestion-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private _maxAvailableIncomingBitrate = 0;

	private _maxReceivingBitrate = 0;

	private _maxAvailableOutgoingBitrate = 0;

	private _maxSendingBitrate = 0;

	private readonly issueKey: string;

	private _startedCongestionAt?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor
	) {
		this.issueKey = `${CongestionDetector.ISSUE_TYPE}-pc-${peerConnection.peerConnectionId}`;
	}

	private get config() {
		return this.peerConnection.parent.config.congestionDetector!;
	}

	public update() {

		if (this.disabled) return;
		let hasBwLimitedOutboundRtp = false;

		for (const outboundRtp of this.peerConnection.outboundRtps) {
			hasBwLimitedOutboundRtp ||= outboundRtp.qualityLimitationReason === 'bandwidth';
		}

		// avgRttInSec/ewmaRttInSec prefer the RTCP round trip and fall back to
		// ICE/STUN together, so the difference below never mixes two round trips
		let rttDiffInS = 0;

		if (this.peerConnection.avgRttInSec !== undefined) {
			if (this.peerConnection.ewmaRttInSec !== undefined) {
				rttDiffInS = Math.abs(this.peerConnection.avgRttInSec - this.peerConnection.ewmaRttInSec);
			}
		}

		let isCongested = false;

		switch (this.config.sensitivity) {
			case 'high':
				isCongested = hasBwLimitedOutboundRtp;
				break;
			case 'medium': {
				if (!this.peerConnection.ewmaRttInSec) break;

				const rttDiffThreshold = Math.min(0.15, Math.max(0.05, this.peerConnection.ewmaRttInSec * 0.33));

				isCongested = hasBwLimitedOutboundRtp && rttDiffInS > rttDiffThreshold;

				break;
			}
			case 'low': {
				// No RTT guard here (unlike `medium`): requiring one made a bandwidth-limited
				// connection losing >5% silently not congested before the first RTCP report.
				if (this.peerConnection.outboundFractionLost === undefined) break;

				isCongested = hasBwLimitedOutboundRtp && this.peerConnection.outboundFractionLost > 0.05;
				break;
			}
		}
		const availableIncomingBitrate = this.peerConnection.totalAvailableIncomingBitrate ?? 0;
		const availableOutgoingBitrate = this.peerConnection.totalAvailableOutgoingBitrate ?? 0;

		if (!isCongested) {
			if (this.peerConnection.congested) {
				this.peerConnection.congested = false;
				this._resolve('congestion ended');
			}
			this._maxAvailableIncomingBitrate = Math.max(this._maxAvailableIncomingBitrate, availableIncomingBitrate);
			this._maxAvailableOutgoingBitrate = Math.max(this._maxAvailableOutgoingBitrate, availableOutgoingBitrate);
			this._maxReceivingBitrate = Math.max(this._maxReceivingBitrate, this.peerConnection.receivingBitrate);
			this._maxSendingBitrate = Math.max(this._maxSendingBitrate, this.peerConnection.sendingBitrate);

			return;
		} else if (this.peerConnection.congested) {
			return;
		}

		this.peerConnection.congested = true;
		this.peerConnection.parent.emit('congestion', {
			clientMonitor: this.peerConnection.parent,
			peerConnectionMonitor: this.peerConnection,
			availableIncomingBitrate,
			availableOutgoingBitrate,
			maxAvailableIncomingBitrate: this._maxAvailableIncomingBitrate,
			maxAvailableOutgoingBitrate: this._maxAvailableOutgoingBitrate,
			maxReceivingBitrate: this._maxReceivingBitrate,
			maxSendingBitrate: this._maxSendingBitrate,
		});

		this._raise({
			peerConnectionId: this.peerConnection.peerConnectionId,
			availableIncomingBitrate,
			availableOutgoingBitrate,
			maxAvailableIncomingBitrate: this._maxAvailableIncomingBitrate,
			maxAvailableOutgoingBitrate: this._maxAvailableOutgoingBitrate,
			maxReceivingBitrate: this._maxReceivingBitrate,
			maxSendingBitrate: this._maxSendingBitrate,
		});

		this._maxAvailableIncomingBitrate = 0;
		this._maxAvailableOutgoingBitrate = 0;
		this._maxReceivingBitrate = 0;
		this._maxSendingBitrate = 0;
	}

	private _raise(payload: CongestionIssuePayload) {
		this._startedCongestionAt = Date.now();

		this.peerConnection.parent.raiseIssue<CongestionIssuePayload>(this.issueKey, {
			includeInSample: this.includeIssueInSample,
			type: CongestionDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.resolveIssue<CongestionIssuePayload>(this.issueKey, {
			comment,
			// The registry merges, so the raise's payload survives and only the duration is added.
			payload: {
				durationInMs: this._startedCongestionAt ? Date.now() - this._startedCongestionAt : undefined,
			} as CongestionIssuePayload,
			resolvedAt: Date.now(),
		});

		this._startedCongestionAt = undefined;
	}

}
