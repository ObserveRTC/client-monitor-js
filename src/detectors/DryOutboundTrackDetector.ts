import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { Detector } from "./Detector";

export type DryOutboundTrackIssuePayload = {
	trackId: string;

	/**
	 * Milliseconds of stats time the track had already been dry when the issue was raised — the
	 * stretch that earned the finding, which is at least `thresholdInMs`.
	 *
	 * Not to be confused with `durationInMs` below, which was called `duration` here until the two
	 * names proved impossible to tell apart in a sample: one is how long the fault had lasted
	 * *before* it was reported, the other how long the report stayed open.
	 */
	dryForInMs: number;

	/** How many of this track's layers were sending nothing, and how many were being driven at all. */
	activeLayers: number;

	/** How long the issue was open, in wall-clock ms. Filled in when it resolves. */
	durationInMs?: number;
}
export type DryOutboundTrackIssueType = 'dry-outbound-track';

export type DryOutboundTrackDetectorConfig = {
	/** How long (ms of stats time) an outbound track must be dry before it counts as stalled. */
	thresholdInMs: number;
}

/**
 * Reasons the browser gives for holding an encoder back that *explain* silence, and so stand this
 * detector down.
 *
 * A sender that has stopped because there is no bandwidth, or no CPU, has not broken: it is doing
 * what it is supposed to do under pressure, and the pressure itself is already reported by
 * `uplink-congestion` and `cpulimitation`. Calling it a pipeline disruption on top would price the
 * same condition twice — and worse, point an operator at the capture chain when the answer is the
 * uplink. `other` is deliberately not here: it is the browser declining to say why, which is not an
 * explanation.
 */
const EXPLAINED_LIMITATIONS: ReadonlySet<string> = new Set([ 'bandwidth', 'cpu' ]);

/**
 * The sending-side counterpart: reports one outbound track sending zero bytes tick after tick — a
 * stalled encoder, a capture source that quietly stopped feeding it, or a sender that never really
 * started. Use it for the one failure the local user cannot see for themselves, since their own
 * preview keeps rendering.
 *
 * **It judges the track, which means every layer it is being sent over.** A simulcast track sends
 * across several RTP streams and the sender moves between them constantly: congestion makes the
 * encoder drop the top layer, and an application or an SFU switches layers off outright. Either
 * leaves one stream's counters frozen while the picture keeps going out over another, so a verdict
 * taken from a single stream is a verdict about a layer rather than about the track. Reading one
 * arbitrary stream reported a 640x360 camera as dry for fourteen minutes while the layer beside it
 * sent a hundred kilobytes every collection.
 *
 * Layers the sender is not driving are left out rather than counted as silence: an `active: false`
 * stream is switched off by design, and its counters stay where they stopped for the rest of the
 * call. A track whose layers are *all* inactive is not being sent at all, which is a stand-down and
 * not a fault — and it is also what keeps this detector able to close a finding it opened, since a
 * frozen counter can never differ from itself.
 *
 * A paused sender, a muted track, a track no longer `live`, or the browser reporting the encoder
 * limited by `bandwidth` or `cpu` all explain the silence: any of them discards the timer and
 * resolves an open issue. The limitation cases matter most on a bad network, where the sender stops
 * because it has been told to rather than because anything broke — and where `uplink-congestion`
 * and `cpulimitation` are already reporting the real condition. A stall must last `thresholdInMs` of the sender's
 * own stats time — a busy main thread that collects late would otherwise be counted as evidence for
 * a stalled encoder — and is raised once per episode, not once per tick.
 *
 * Raises `dry-outbound-track`. Emits `dry-outbound-track`. Config: `dryOutboundTrackDetector`.
 * Track attribute: `OutboundTrackMonitor.dry`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — RTP sender to the wire
 *
 */
export class DryOutboundTrackDetector implements Detector {
	public static readonly ISSUE_TYPE: DryOutboundTrackIssueType = 'dry-outbound-track';

	public readonly name = 'dry-outbound-track-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly issueKey: string;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this.issueKey = `${DryOutboundTrackDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private _startedDryAt?: number;

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.dryOutboundTrackDetector!;
	}

	/** Stats time accumulated over the current dry stretch; `0` whenever the silence is explained or over. */
	private _dryForInMs = 0;

	public update() {
		if (this.disabled) {
			this.trackMonitor.dry = undefined;

			return;
		}

		// A paused, muted or dead track legitimately sends nothing.
		if (this.trackMonitor.paused || this.trackMonitor.track.muted || this.trackMonitor.track.readyState !== 'live') {
			this.trackMonitor.dry = undefined;
			this._dryForInMs = 0;
			if (this._startedDryAt !== undefined) {
				this._resolve('track paused, muted or not live');
			}
			return;
		}

		// Only the layers the sender is driving. A deactivated one sends nothing by design and its
		// counters never move again, so counting it as silence both invents a fault and makes the
		// finding it invents impossible to close.
		const activeRtps = this.trackMonitor.getOutboundRtps()
			.filter((outboundRtp) => outboundRtp.active !== false);

		// The browser saying why it is holding the encoder back is an explanation for the silence,
		// and this detector only reports silence that has none. Read from the layers rather than
		// from the connection: another track on the same peer connection may be the limited one.
		const limitation = activeRtps
			.map((outboundRtp) => outboundRtp.qualityLimitationReason)
			.find((reason) => reason !== undefined && EXPLAINED_LIMITATIONS.has(reason));

		if (limitation !== undefined) {
			this.trackMonitor.dry = undefined;
			this._dryForInMs = 0;

			if (this._startedDryAt !== undefined) {
				this._resolve(`the encoder is limited by ${limitation}`);
			}

			return;
		}

		if (activeRtps.length === 0) {
			this.trackMonitor.dry = undefined;
			this._dryForInMs = 0;

			if (this._startedDryAt !== undefined) {
				this._resolve('no layer of this track is being sent');
			}

			return;
		}

		let deltaBytesSent: number | undefined;
		let deltaTime: number | undefined;

		// Summed across the layers: the track is dry only when every one of them is.
		for (const outboundRtp of activeRtps) {
			if (outboundRtp.deltaBytesSent !== undefined) {
				deltaBytesSent = (deltaBytesSent ?? 0) + outboundRtp.deltaBytesSent;
			}
			if (deltaTime === undefined) deltaTime = outboundRtp.deltaTime;
		}

		// No counter on any layer is blind, which is not the same as silent.
		if (deltaBytesSent === undefined) {
			this.trackMonitor.dry = undefined;

			return;
		}

		if (deltaBytesSent !== 0) {
			this.trackMonitor.dry = false;
			this._dryForInMs = 0;

			if (this._startedDryAt !== undefined) {
				this._resolve('dry outbound track recovered');
			}

			return;
		}

		// Zero bytes, but not yet long enough to be a fault: judged, and not yet wrong.
		this.trackMonitor.dry = false;

		this._dryForInMs += deltaTime ?? 0;

		const dryForInMs = this._dryForInMs;

		if (dryForInMs < this.config.thresholdInMs) return;

		if (this._startedDryAt !== undefined) return;


		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dry-outbound-track', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		this._raise({
			trackId: this.trackMonitor.track.id,
			dryForInMs,
			activeLayers: activeRtps.length,
		});
	}

	private _raise(payload: DryOutboundTrackIssuePayload) {
		// Set here, not at the call site, so the flag and the finding cannot drift.
		this.trackMonitor.dry = true;
		this._startedDryAt = Date.now();

		// The track's own registry, never the client's: it forwards up, and resolving anywhere
		// else would leave this copy standing for the rest of the call.
		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: DryOutboundTrackDetector.ISSUE_TYPE,
			payload,
		});
	}

	private _resolve(comment?: string) {
		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: DryOutboundTrackIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as DryOutboundTrackIssuePayload),
				durationInMs: this._startedDryAt ? Date.now() - this._startedDryAt : undefined,
			};
		}

		// Same registry the raise went to, so both copies close together.
		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedDryAt = undefined;
	}
}