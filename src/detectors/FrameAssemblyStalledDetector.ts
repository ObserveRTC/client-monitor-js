import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type FrameAssemblyStalledIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	ssrc?: number;
	/** RTP packets that arrived while no frame was completed. */
	packetsSinceLastFrame: number;
	/** How long packets kept arriving with no frame assembled, from stats timestamps. */
	stalledForInMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type FrameAssemblyStalledDetectorConfig = {
	/** Stats time packets must keep arriving with no frame completed before raising, in ms. */
	thresholdInMs: number;

	/** How many packets must have arrived over that time to count as a stall, not a trickle. */
	minPacketsReceived: number;
}

/**
 * Reports RTP arriving from the network with no complete frame coming out of reassembly —
 * `packetsReceived` advancing while `framesReceived` stays flat. Use it to place the break before
 * the decoder rather than in it: every frame is missing pieces, or the depacketizer has lost the
 * stream, which is a different fix from a decoder that is genuinely stuck.
 *
 * A sender that has simply stopped sending is not this: no packets arrive, so nothing accumulates.
 * Pause, mute and a backgrounded tab reset the stall rather than counting toward it.
 *
 * It does not claim *why* frames are not assembling — sustained loss and a codec mismatch look
 * identical from here, and attribution belongs to whoever reads the issues alongside each other.
 *
 * Issue raised: `frame-assembly-stalled`. Monitor event: `frame-assembly-stalled`.
 * Config: `frameAssemblyStalledDetector`.
 * Track attribute: `InboundTrackMonitor.stalledFrameAssembly`.
 *
 * Category: Pipeline Disruption
 * Layer: Receive — packets to frames
 *
 */
export class FrameAssemblyStalledDetector implements Detector {
	public static readonly ISSUE_TYPE = 'frame-assembly-stalled';
	public readonly name = 'frame-assembly-stalled-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _stalledForInMs = 0;
	private _packetsSinceLastFrame = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${FrameAssemblyStalledDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.frameAssemblyStalledDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.stalledFrameAssembly = undefined;

			return;
		}

		const inboundRtp = this.trackMonitor.getInboundRtp();

		// An audio track has no frames to assemble; there is nothing here to be right or wrong about.
		if (!inboundRtp || inboundRtp.kind !== 'video') {
			this.trackMonitor.stalledFrameAssembly = undefined;

			return;
		}

		if (
			this.trackMonitor.paused ||
			this.trackMonitor.remoteOutboundTrackPaused ||
			!this.peerConnection.parent.activeTab
		) {
			this.trackMonitor.stalledFrameAssembly = undefined;

			return this._reset('not watching this track right now');
		}

		const deltaPacketsReceived = inboundRtp.deltaPacketsReceived;
		const deltaFramesReceived = inboundRtp.deltaFramesReceived;

		// Without `framesReceived` the question cannot be asked at all. Blind, not healthy.
		if (deltaPacketsReceived === undefined || deltaFramesReceived === undefined) {
			this.inputsUnavailable = true;
			this.trackMonitor.stalledFrameAssembly = undefined;

			return;
		}

		this.inputsUnavailable = false;

		if (0 < deltaFramesReceived) {
			this.trackMonitor.stalledFrameAssembly = false;

			return this._reset('a frame was assembled');
		}

		// Nothing arriving is a silent sender, not a stalled assembler — a different detector's
		// question, and one this detector cannot answer either way.
		if (deltaPacketsReceived <= 0) {
			this.trackMonitor.stalledFrameAssembly = undefined;

			return this._reset('no packets arriving');
		}

		// Packets arriving with no frame out of them, but not yet for long enough to be a fault.
		this.trackMonitor.stalledFrameAssembly = false;

		this._packetsSinceLastFrame += deltaPacketsReceived;
		this._stalledForInMs += inboundRtp.deltaTime ?? 0;

		if (this._raised) return;
		if (this._stalledForInMs < this.config.thresholdInMs) return;
		if (this._packetsSinceLastFrame < this.config.minPacketsReceived) return;

		this._raised = true;
		this._startedAt = Date.now();
		// Set here, not at the call sites, so the flag and the finding cannot drift.
		this.trackMonitor.stalledFrameAssembly = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('frame-assembly-stalled', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			packetsSinceLastFrame: this._packetsSinceLastFrame,
			stalledForInMs: this._stalledForInMs,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: FrameAssemblyStalledDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				ssrc: inboundRtp.ssrc,
				packetsSinceLastFrame: this._packetsSinceLastFrame,
				stalledForInMs: this._stalledForInMs,
			},
		});
	}

	private _reset(comment: string) {
		this._stalledForInMs = 0;
		this._packetsSinceLastFrame = 0;

		if (!this._raised) return;

		this._raised = false;

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: FrameAssemblyStalledIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as FrameAssemblyStalledIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
