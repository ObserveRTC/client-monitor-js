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
	durationInMs?: number;
}

export type FrameAssemblyStalledDetectorConfig = {
	/**
	 * How long (ms of stats time) packets must keep arriving with no frame
	 * completed before the issue is raised.
	 */
	thresholdInMs: number;

	/**
	 * How many packets must have arrived over that time before the silence
	 * counts as a stall rather than a trickle.
	 */
	minPacketsReceived: number;
}

/**
 * Watches the one boundary in the receive chain that nothing else watches: packets arriving from the
 * network and frames coming out of reassembly. When `packetsReceived` keeps advancing and
 * `framesReceived` does not, RTP is being delivered and no complete picture is being made from it —
 * every frame is missing pieces, or the depacketizer has lost the stream.
 *
 * The value of naming this boundary is that today the same condition surfaces as `stuck-decoder`,
 * which points at the decoder for something that happened before the decoder ever saw a frame.
 * `StuckDecoderDetector` already half-admits this with its `assembly` variant; this detector is the
 * other half, stated directly.
 *
 * Deliberately narrow. It says nothing about *why* frames are not assembling — sustained loss inside
 * every frame and a codec mismatch look identical from here, and both are real. Attribution is what
 * co-firing with `transport-loss-sustained` is for, and that comparison belongs to whoever reads the
 * issues, not to this class.
 *
 * A sender that has simply stopped sending is not this: no packets arrive, so nothing accumulates.
 * Pause, mute and a backgrounded tab each reset the stall rather than counting toward it.
 *
 * Issue raised: `frame-assembly-stalled`. Monitor event: `frame-assembly-stalled`.
 * Config: `frameAssemblyStalledDetector`.
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
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') return;

		if (
			this.trackMonitor.paused ||
			this.trackMonitor.remoteOutboundTrackPaused ||
			!this.peerConnection.parent.activeTab
		) {
			return this._reset('not watching this track right now');
		}

		const deltaPacketsReceived = inboundRtp.deltaPacketsReceived;
		const deltaFramesReceived = inboundRtp.deltaFramesReceived;

		// `framesReceived` is the whole point of this detector; a browser that does
		// not report it cannot be asked this question at all.
		if (deltaPacketsReceived === undefined || deltaFramesReceived === undefined) {
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		if (0 < deltaFramesReceived) {
			return this._reset('a frame was assembled');
		}

		// Nothing arriving is a silent sender, not a stalled assembler. That is
		// `DryInboundTrackDetector`'s question and this detector must not answer it.
		if (deltaPacketsReceived <= 0) {
			return this._reset('no packets arriving');
		}

		this._packetsSinceLastFrame += deltaPacketsReceived;
		this._stalledForInMs += inboundRtp.deltaTime ?? 0;

		if (this._raised) return;
		if (this._stalledForInMs < this.config.thresholdInMs) return;
		if (this._packetsSinceLastFrame < this.config.minPacketsReceived) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('frame-assembly-stalled', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			packetsSinceLastFrame: this._packetsSinceLastFrame,
			stalledForInMs: this._stalledForInMs,
		});

		clientMonitor.raiseIssue<FrameAssemblyStalledIssuePayload>(this.issueKey, {
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

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: FrameAssemblyStalledIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as FrameAssemblyStalledIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<FrameAssemblyStalledIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
