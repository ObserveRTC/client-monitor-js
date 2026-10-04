/* eslint-disable no-shadow */

export enum ClientMetaTypes {
	MEDIA_CONSTRAINT = 'MEDIA_CONSTRAINT',
	MEDIA_DEVICE = 'MEDIA_DEVICE',
	MEDIA_DEVICES_SUPPORTED_CONSTRAINTS = 'MEDIA_DEVICES_SUPPORTED_CONSTRAINTS',
	USER_MEDIA_ERROR = 'USER_MEDIA_ERROR',
	LOCAL_SDP = 'LOCAL_SDP',
	REMOTE_SDP = 'REMOTE_SDP',
	/** The capture device behind an outbound audio track, sent once per track. See `AudioInputDevice`. */
	AUDIO_INPUT_DEVICE = 'AUDIO_INPUT_DEVICE',

	OPERATION_SYSTEM = 'OPERATION_SYSTEM',
	ENGINE = 'ENGINE',
	PLATFORM = 'PLATFORM',
	BROWSER = 'BROWSER',
}

export type MediaDeviceInfo = {
	deviceId: string;
	label: string;
	kind: string;
	groupId: string;
}

/**
 * Payload of `AUDIO_INPUT_DEVICE`: which device an outbound audio track captures from. Sent when
 * the track is first monitored, so a device switch (a new track) sends a new entry.
 */
export type AudioInputDevice = {
	peerConnectionId: string;
	trackId: string;
	/** `MediaStreamTrack.label`. Empty until capture permission is granted. */
	label: string;
	deviceId?: string;
	groupId?: string;
}

export type Browser = {
	name: string;
	version: string;
}

export type Platform = {
	name: string;
	version: string;
}

export type Engine = {
	name: string;
	version: string;
}

export type OperationSystem = {
	name: string;
	version: string;
}