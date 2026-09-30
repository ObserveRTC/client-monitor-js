import { parseSdp, redactSdp } from "../../src/utils/sdp";
import { CHROME_OFFER, SFU_ANSWER } from "../helpers/sdpFixtures";

describe('parseSdp', () => {
	it('reads session-level facts', () => {
		const offer = parseSdp(CHROME_OFFER);
		const answer = parseSdp(SFU_ANSWER);

		expect(offer.sessionVersion).toBe(2);
		expect(offer.iceLite).toBe(false);
		expect(offer.extmapAllowMixed).toBe(true);
		expect(offer.bundleGroups).toEqual([ [ '0', '1' ] ]);
		expect(offer.iceOptions).toEqual([ 'trickle' ]);
		expect(answer.iceLite).toBe(true);
	});

	it('reads media sections, codecs and their parameters', () => {
		const [ audio, video ] = parseSdp(CHROME_OFFER).mediaSections;

		expect(audio?.kind).toBe('audio');
		expect(audio?.mid).toBe('0');
		expect(audio?.direction).toBe('sendrecv');
		expect(audio?.setup).toBe('actpass');
		expect(audio?.rtcpMux).toBe(true);
		expect(audio?.ssrcs).toEqual([ 1111 ]);
		expect(audio?.codecs.map((codec) => codec.mimeType)).toEqual([ 'audio/opus', 'audio/red' ]);
		expect(audio?.codecs[0]).toMatchObject({
			payloadType: 111,
			clockRate: 48000,
			channels: 2,
			sdpFmtpLine: 'minptime=10;useinbandfec=1;usedtx=1',
			parameters: { minptime: '10', useinbandfec: '1', usedtx: '1' },
			rtcpFeedback: [ 'transport-cc' ],
		});
		expect(audio?.extensions).toEqual([ { id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' } ]);

		expect(video?.direction).toBe('sendonly');
		expect(video?.rtcpRsize).toBe(true);
		expect(video?.rids).toEqual([
			{ id: 'q', direction: 'send' },
			{ id: 'h', direction: 'send' },
			{ id: 'f', direction: 'send' },
		]);
		expect(video?.simulcast).toBe('send q;h;f');
		expect(video?.codecs[0]?.rtcpFeedback).toEqual([ 'goog-remb', 'transport-cc', 'nack', 'nack pli' ]);
	});

	it('never throws, and reads nothing from nothing', () => {
		expect(parseSdp('').mediaSections).toEqual([]);
		expect(parseSdp('garbage\nm=\na=rtpmap:x').mediaSections).toHaveLength(1);
	});

	it('redacts the ICE password and nothing else', () => {
		const redacted = redactSdp(CHROME_OFFER);

		expect(redacted).not.toContain('supersecretpassword1234');
		expect(redacted).toContain('a=ice-pwd:<redacted>');
		expect(redacted).toContain('a=ice-ufrag:abcd');
		expect(redacted.split('\r\n')).toHaveLength(CHROME_OFFER.split('\r\n').length);
	});
});
