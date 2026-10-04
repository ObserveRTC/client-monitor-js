import { Detector } from "./Detector";
import type { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";

export type LoopbackAudioInputIssuePayload = {
	peerConnectionId: string;
	trackId: string;

	/** The capture device's label, `MediaStreamTrack.label`, exactly as the browser reported it. */
	deviceLabel: string;

	/** The configured pattern the label matched, as its source string. */
	matchedPattern: string;

	/** `getSettings().deviceId` of the capture device, when the browser reports one. */
	deviceId?: string;

	/**
	 * `getSettings().echoCancellation` at the raise. Reported because a reader's first question is
	 * whether AEC was on, and the answer does not help: a loopback source hands the far end's
	 * playout back as a clean digital copy, which a canceller tuned for an acoustic path does not
	 * reliably remove.
	 */
	echoCancellation?: boolean;
}

export type LoopbackAudioInputIssueType = 'loopback-audio-input';

export type LoopbackAudioInputDetectorConfig = {
	/**
	 * Case-insensitive regular expressions, as source strings, matched against the capture track's
	 * label. A match marks the device as a loopback of the machine's audio output rather than a
	 * microphone. Replaces the default list; spread `DEFAULT_LOOPBACK_AUDIO_INPUT_LABEL_PATTERNS`
	 * into it to extend rather than replace.
	 */
	labelPatterns: string[];
}

/**
 * Labels that name an output loopback on every platform that ships one. Kept to devices whose only
 * purpose is to record what the machine plays. Virtual cables (BlackHole, VB-Audio CABLE,
 * VoiceMeeter, Loopback by Rogue Amoeba) are left out on purpose: they are routinely used to carry a
 * processed microphone, so their name says nothing about whether playout reaches them.
 */
export const DEFAULT_LOOPBACK_AUDIO_INPUT_LABEL_PATTERNS: readonly string[] = Object.freeze([
	// PulseAudio and PipeWire create one "Monitor of <sink>" source for every output device.
	'^Monitor of ',
	// Windows: the Realtek / Conexant / IDT loopback inputs, and Creative's.
	'\\bStereo Mix\\b',
	'\\bWave Out Mix\\b',
	'\\bWhat U Hear\\b',
]);

/**
 * Reports an outbound audio track whose capture device is a loopback of the machine's own audio
 * output — a PulseAudio/PipeWire `Monitor of …` source, Windows `Stereo Mix` — rather than a
 * microphone. Everything the machine plays, the other participants' voices included, is sent back
 * into the call, so they hear themselves: an echo no network or AEC finding will explain, because
 * the stats look healthy on every side. Use it to name the device when someone reports echo, and to
 * prompt the user to pick a microphone before anyone hears it.
 *
 * The evidence is the track label and nothing else, which is why the finding carries the label and
 * the pattern it matched: it says the device is *named* like a loopback, and it is the observer's
 * cross-participant correlation that can say the echo actually happened. A track with no label —
 * capture permission not yet granted — is not judged.
 *
 * **It judges each track once.** A track's label never changes, so the first collection that sees
 * a label settles the question for the track's whole life: the detector raises (or not), records
 * the verdict on the track, and removes itself from the track's registry. A device switch produces
 * a new track, and with it a new detector. Until the browser reveals a label (capture permission
 * not yet granted) it keeps looking; a track that is screen share, not audio or no longer live at
 * that first look is left unjudged and the detector removes itself just the same.
 *
 * Because nothing runs afterwards, nothing in the detector resolves the finding: it stays open
 * while the track is muted, disabled or paused — none of those changed the device — and closes
 * with the rest of the track's issues when the track monitor is dropped.
 *
 * Issue raised: `loopback-audio-input`, resolved when the track stops being reported.
 * No monitor event.
 * Config: `loopbackAudioInputDetector`.
 * Track attribute: `OutboundTrackMonitor.loopbackAudioInput`, final once set.
 *
 * Category: Pipeline Disruption
 * Layer: Send — the source
 *
 */
export class LoopbackAudioInputDetector implements Detector {
	public static readonly ISSUE_TYPE: LoopbackAudioInputIssueType = 'loopback-audio-input';

	public readonly name = 'loopback-audio-input-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private _patterns?: { source: string, regex: RegExp }[];

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._issueKey = `${LoopbackAudioInputDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config(): LoopbackAudioInputDetectorConfig {
		return this.peerConnection.parent.config.loopbackAudioInputDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	/** Compiled once, on first use, so an invalid pattern is logged once and skipped rather than thrown every tick. */
	private get patterns() {
		if (this._patterns) return this._patterns;

		this._patterns = [];

		for (const source of this.config.labelPatterns ?? []) {
			try {
				this._patterns.push({ source, regex: new RegExp(source, 'i') });
			} catch (err) {
				this.peerConnection.parent.logger.warn(
					`loopbackAudioInputDetector.labelPatterns: invalid pattern ${JSON.stringify(source)}, skipped`,
					err,
				);
			}
		}

		return this._patterns;
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.loopbackAudioInput = undefined;

			return;
		}

		const track = this.trackMonitor.track;

		// Nothing this detector could say about these, now or later.
		if (this.trackMonitor.kind !== 'audio') return this._done();
		if (this.trackMonitor.isScreenShare) return this._done();
		if (track.readyState !== 'live') return this._done();

		// Firefox and Chrome both blank the label until capture permission is granted: the one case
		// worth looking at again on the next collection.
		const label = track.label;

		if (!label) return;

		const match = this.patterns.find(({ regex }) => regex.test(label));

		if (!match) {
			this.trackMonitor.loopbackAudioInput = false;

			return this._done();
		}

		const settings = this.trackMonitor.settings;

		this.trackMonitor.loopbackAudioInput = true;
		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: LoopbackAudioInputDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				deviceLabel: label,
				matchedPattern: match.source,
				deviceId: settings?.deviceId || undefined,
				echoCancellation: typeof settings?.echoCancellation === 'boolean' ? settings.echoCancellation : undefined,
			},
			timestamp: Date.now(),
		});

		this._done();
	}

	/** The label is final, so the verdict is too: never run for this track again. */
	private _done() {
		this.trackMonitor.detectors.remove(this);
	}
}
