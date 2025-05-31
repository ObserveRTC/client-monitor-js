
export interface ScoreCalculator {
	update(): void;
	encodeClientScoreReasons?: <T extends Record<string, number>>(reasons?: T) => string
	encodePeerConnectionScoreReasons?: <T extends Record<string, number>>(reasons?: T) => string
	encodeInboundAudioScoreReasons?: <T extends Record<string, number>>(reasons?: T) => string
	encodeInboundVideoScoreReasons?: <T extends Record<string, number>>(reasons?: T) => string
	encodeOutboundAudioScoreReasons?: <T extends Record<string, number>>(reasons?: T) => string
	encodeOutboundVideoScoreReasons?: <T extends Record<string, number>>(reasons?: T) => string
}
