import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { ClientIssuePayload } from "../ClientMonitorEvents";
import { maxTickGapInMs } from "../utils/common";
import { StarvingWindow } from "../utils/StarvingWindow";
import type { FrameSupplyIssuePayload } from "../ClientMonitorIssues";

export type DecoderBottleneckIssuePayload = FrameSupplyIssuePayload;

/**
 * Inbound Frame Supply Detector
 *
 * The receive-side counterpart of `capture-bottleneck`: frames arrived and the
 * decoder did not turn enough of them into pictures.
 *
 * **The bar is the arrival rate, never the sender's.** Frames that never arrived
 * are the network's story — `FreezedVideoTrackDetector` and the loss metrics
 * tell it — so this compares `framesDecoded` against `framesReceived` over the
 * same interval and nothing else. A stream throttled to 5fps that decodes
 * cleanly is silent.
 *
 * **Why the window rolls and does not count consecutive ticks.** A decoder that
 * is stumbling rather than uniformly overloaded drops frames on some intervals
 * and recovers on others, so a consecutive-run rule never reaches its threshold.
 * `minStarvingTimeInMs` of starving time anywhere inside `windowInMs` catches it.
 * This is what separates it from [`DecoderPerformanceDetector`](./DecoderPerformanceDetector.ts),
 * which asks whether decoding *cost* too much over consecutive ticks: that one
 * is about the price of decoding, this one about frames going missing. Both
 * firing at once is the honest answer when both are true.
 *
 * **What it refuses to judge**, because a low decode rate there is legitimate: a
 * backgrounded tab (`ClientMonitor.activeTab === false`), a paused consumer, a
 * paused remote sender, a track that is not live and unmuted, and a stream too
 * thin to say anything (`minProducedFps`). The window is discarded rather than
 * interpreted after a collection gap, whose threshold is derived from the
 * monitor's own `collectingPeriodInMs` rather than configured.
 *
 * **Issues created:**
 * - Type: `decoder-bottleneck`
 */
export class InboundFrameSupplyDetector implements Detector {
	public static readonly ISSUE_TYPE = 'decoder-bottleneck';

	public readonly name = 'inbound-frame-supply-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private readonly _window = new StarvingWindow();

	/** Previous inbound-rtp timestamp, to measure the gap between collections. */
	private _lastTimestamp?: number;
	private _on = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this._issueKey = `${InboundFrameSupplyDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.inboundFrameSupplyDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Derived from the monitor's own cadence rather than configured. */
	private get _maxTickGapInMs() {
		return maxTickGapInMs(this.peerConnection.parent.config.collectingPeriodInMs);
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const track = this.trackMonitor.track;

		// A backgrounded tab is throttled by the browser, decoding and playout
		// included. Frames legitimately stop being turned into pictures there;
		// that is not the decoder failing.
		if (!this.peerConnection.parent.activeTab) return this._reset('tab in background');
		// Paused on either leg: nothing is meant to be decoded.
		if (this.trackMonitor.paused) return this._reset('consumer paused');
		if (this.trackMonitor.remoteOutboundTrackPaused) return this._reset('remote sender paused');
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._reset('track not playing');

		const inboundRtp = this.trackMonitor.getInboundRtp();
		const timestamp = inboundRtp?.timestamp;

		if (timestamp === undefined) return;

		const previousTimestamp = this._lastTimestamp;

		this._lastTimestamp = timestamp;

		// Nothing to difference against yet; this tick is the baseline.
		if (previousTimestamp === undefined) return;

		const elapsedInMs = timestamp - previousTimestamp;

		// Same reading twice, or a clock that went backwards: nothing to measure.
		if (elapsedInMs <= 0) return;

		// A gap far longer than the collecting period means the ticks themselves
		// stopped, which says nothing about the decoder.
		if (this._maxTickGapInMs < elapsedInMs) return this._reset('collection gap; window restarted');

		const received = inboundRtp?.deltaFramesReceived;
		const decoded = inboundRtp?.deltaFramesDecoded;

		if (received === undefined || decoded === undefined) return this._reset('no comparable frame count');

		const elapsedInSec = elapsedInMs / 1000;
		const receivedFps = received / elapsedInSec;

		// Too thin a stream to judge a decoder on: a trickle says nothing.
		if (receivedFps < this.config.minProducedFps) return this._clear('stream too thin to judge');

		const decodedFps = decoded / elapsedInSec;
		const now = Date.now();

		this._window.evict(now, this.config.windowInMs);

		if (decodedFps < receivedFps * this.config.fpsRatioThreshold) {
			this._window.push(now, decodedFps, elapsedInMs);
		}

		if (this._window.empty) return this._clear('decoder keeping up again');
		if (this._on) return;
		if (this._window.starvingTimeInMs < this.config.minStarvingTimeInMs) return;

		this._on = true;
		this._startedAt = now;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('decoder-bottleneck', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			decodedFps,
			receivedFps,
		});

		clientMonitor.raiseIssue<DecoderBottleneckIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: InboundFrameSupplyDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				sourceFps: decodedFps,
				expectedFps: receivedFps,
				sourceWidth: inboundRtp?.frameWidth,
				sourceHeight: inboundRtp?.frameHeight,
				starvingTimeInMs: this._window.starvingTimeInMs,
				windowSeconds: this.config.windowInMs / 1000,
				worstSourceFps: this._window.worstFps,
				msSinceFirstStarvingTick: now - this._window.oldestAt!,
				trackReadyState: track.readyState,
				trackMuted: track.muted,
			},
		});
	}

	private _reset(comment: string) {
		this._lastTimestamp = undefined;

		this._clear(comment);
	}

	private _clear(comment: string) {
		this._window.clear();

		if (!this._on) return;

		this._on = false;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);

		clientMonitor.resolveIssue(this._issueKey, {
			comment,
			payload: issue
				? {
					...issue.payload,
					durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
				} as ClientIssuePayload
				: undefined,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
