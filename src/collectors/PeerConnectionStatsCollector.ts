import { CustomCallEvent } from "../schema/Samples";
import { createPeerConnectionStateChangedEvent, createIceGatheringStateChangedEvent, createPeerConnectionClosedEvent, createPeerConnectionOpenedEvent, createIceConnectionStateChangedEvent } from "../utils/callEvents";
import { listenDataChannelEvents, listenTrackEvents } from "./utils";

export type PeerConnectionStatsCollector = ReturnType<typeof createPeerConnectionCollector>;

export type PeerConnectionStatsCollectorConfig = {
    peerConnectionId: string,
    peerConnection: RTCPeerConnection,
    peerConnectionLabel?: string,
    emitCallEvent: ((event: CustomCallEvent) => void);
}

export function createPeerConnectionCollector(config: PeerConnectionStatsCollectorConfig)  {
    const { 
        peerConnectionId, 
        peerConnection, 
        peerConnectionLabel,
        emitCallEvent
    } = config;
    let closed = false;
    
    let onclose: (() => void) | undefined;
    
    async function getStats(): Promise<RTCStatsReport> {
        return peerConnection.getStats();
    }

    const connectionStateChangeListener = () => {
        emitCallEvent(
            createPeerConnectionStateChangedEvent({
                peerConnectionId,
                peerConnectionState: peerConnection.connectionState,
            })
        );
    };
    const dataChannelListener = (event: RTCDataChannelEvent) => {
        const { channel: dataChannel } = event;
        if (!dataChannel) {
            return;
        }
        listenDataChannelEvents({
            dataChannel,
            peerConnectionId,
            emitCallEvent,
        })
    };
    const negotiationNeededListener = () => {
        emitCallEvent({
            name: 'NEGOTIATION_NEEDED',
            peerConnectionId,
        });
    };
    const signalingStateChangeListener = () => {
        emitCallEvent({
            name: 'SIGNALING_STATE_CHANGE',
            peerConnectionId,
        });
    };
    const iceGatheringStateChangeListener = () => {
        emitCallEvent(
            createIceGatheringStateChangedEvent({
                peerConnectionId,
                iceGatheringState: peerConnection.iceGatheringState,
            })
        );
    };
    const iceConnectionStateChangeListener = () => {
        emitCallEvent(
            createIceConnectionStateChangedEvent({
                peerConnectionId,
                iceConnectionState: peerConnection.iceConnectionState,
            })
        );
    };
    const trackListener = (event: RTCTrackEvent) => {
        const { track } = event;
        if (!track) {
            return;
        }
        listenTrackEvents({
            track,
            peerConnectionId,
            added: Date.now(),
            emitCallEvent,
        });
    };

    function close() {
        if (closed) {
            return;
        }
        closed = true;
        peerConnection.removeEventListener('track', trackListener);
        peerConnection.removeEventListener('iceconnectionstatechange', iceConnectionStateChangeListener);
        peerConnection.removeEventListener('icegatheringstatechange', iceGatheringStateChangeListener);
        peerConnection.removeEventListener('signalingstatechange', signalingStateChangeListener);
        peerConnection.removeEventListener('negotiationneeded', negotiationNeededListener);
        peerConnection.removeEventListener('datachannel', dataChannelListener);
        peerConnection.removeEventListener('connectionstatechange', connectionStateChangeListener);
        emitCallEvent(
            createPeerConnectionClosedEvent({
                peerConnectionId,
                attachments: JSON.stringify({
                    label: peerConnectionLabel,
                }),
            })
        );
        onclose?.();
    }

    peerConnection.addEventListener('track', trackListener);
    peerConnection.addEventListener('iceconnectionstatechange', iceConnectionStateChangeListener);
    peerConnection.addEventListener('icegatheringstatechange', iceGatheringStateChangeListener);
    peerConnection.addEventListener('signalingstatechange', signalingStateChangeListener);
    peerConnection.addEventListener('negotiationneeded', negotiationNeededListener);
    peerConnection.addEventListener('datachannel', dataChannelListener);
    peerConnection.addEventListener('connectionstatechange', connectionStateChangeListener);
    
    emitCallEvent(
        createPeerConnectionOpenedEvent({
            peerConnectionId,
            attachments: JSON.stringify({
                label: peerConnectionLabel,
            }),
        })
    );
    
    return {
        id: peerConnectionId,
        peerConnectionId,
        peerConnection,
        peerConnectionLabel,
        getStats,
        close,
        set onclose(value: (() => void) | undefined) {
            onclose = value;
        },
        get closed() {
            return closed;
        }
    }
}
