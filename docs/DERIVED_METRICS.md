# Derived metrics

# Derived Metrics

The library automatically calculates numerous derived metrics from raw WebRTC statistics, providing enhanced insights into connection quality and performance. These metrics are computed during stats processing and are available on monitor objects.

## Client-Level Derived Metrics

Available on `ClientMonitor`:

```javascript
const monitor = new ClientMonitor();

// Aggregated bitrates across all peer connections
console.log(monitor.sendingAudioBitrate); // Total audio sending bitrate (bps)
console.log(monitor.sendingVideoBitrate); // Total video sending bitrate (bps)
console.log(monitor.receivingAudioBitrate); // Total audio receiving bitrate (bps)
console.log(monitor.receivingVideoBitrate); // Total video receiving bitrate (bps)

// Network capacity metrics
console.log(monitor.totalAvailableIncomingBitrate); // Available bandwidth for receiving
console.log(monitor.totalAvailableOutgoingBitrate); // Available bandwidth for sending

// Connection quality
console.log(monitor.avgRttInSec); // Average RTT across connections (seconds)
console.log(monitor.score); // Calculated quality score (0.0-5.0)
console.log(monitor.durationOfCollectingStatsInMs); // Time to collect stats (performance indicator)
```

## Peer Connection Derived Metrics

Available on `PeerConnectionMonitor`:

```javascript
const pcMonitor = /* get from monitor.peerConnections */;

// Bitrate metrics by media type
console.log(pcMonitor.sendingAudioBitrate);    // Audio sending bitrate (bps)
console.log(pcMonitor.sendingVideoBitrate);    // Video sending bitrate (bps)
console.log(pcMonitor.receivingAudioBitrate);  // Audio receiving bitrate (bps)
console.log(pcMonitor.receivingVideoBitrate);  // Video receiving bitrate (bps)

// Packet loss rates
console.log(pcMonitor.outboundFractionLost);   // Outbound packet loss fraction
console.log(pcMonitor.inboundFractionalLost);  // Inbound packet loss fraction

// Means over the streams that actually carried packets this tick — `undefined`
// rather than 0 when none did, so "nothing arrived" and "nothing was lost" do
// not look the same to a detector. The loss means are what TransportLossDetector
// thresholds; the jitter mean is published but deliberately has no detector. The
// two fields above are sums kept for backwards compatibility.
console.log(pcMonitor.avgInboundFractionLost);  // Mean interval inbound loss fraction (0..1)
console.log(pcMonitor.avgOutboundFractionLost); // Mean loss the far end reported for what we send
console.log(pcMonitor.avgInboundJitterInMs);    // Mean inter-arrival jitter (ms)

// Stats time, not wall clock: the newest timestamp in this collection minus the
// newest in the previous one. PC-level detectors accumulate this to measure how
// long a condition held, so a late or skipped collection still measures the time
// the condition actually held underneath.
console.log(pcMonitor.deltaTime);

// Delta metrics (change since last collection)
console.log(pcMonitor.deltaInboundPacketsLost);     // Packets lost in period
console.log(pcMonitor.deltaInboundPacketsReceived); // Packets received in period
console.log(pcMonitor.deltaOutboundPacketsSent);    // Packets sent in period
console.log(pcMonitor.deltaAudioBytesSent);         // Audio bytes sent in period
console.log(pcMonitor.deltaVideoBytesSent);         // Video bytes sent in period
console.log(pcMonitor.deltaDataChannelBytesSent);   // Data channel bytes sent

// Connection timing and RTT
console.log(pcMonitor.avgRttInSec);            // Current average RTT (seconds)
console.log(pcMonitor.ewmaRttInSec);           // EWMA smoothed RTT (seconds)
console.log(pcMonitor.connectingStartedAt);    // Connection start timestamp
console.log(pcMonitor.connectedAt);            // Connection established timestamp

// Network topology detection
console.log(pcMonitor.usingTURN);              // Boolean: using TURN relay
console.log(pcMonitor.usingTCP);               // Boolean: using TCP transport
console.log(pcMonitor.iceState);               // ICE connection state

// Historical peaks
console.log(pcMonitor.highestSeenSendingBitrate);           // Peak sending bitrate seen
console.log(pcMonitor.highestSeenReceivingBitrate);         // Peak receiving bitrate seen
console.log(pcMonitor.highestSeenAvailableIncomingBitrate); // Peak available incoming
console.log(pcMonitor.highestSeenAvailableOutgoingBitrate); // Peak available outgoing
```

## Track-Level Derived Metrics

### Inbound Track Metrics

Available on `InboundTrackMonitor`:

```javascript
const inboundTrack = /* get from monitor.tracks */;

console.log(inboundTrack.bitrate);              // Receiving bitrate (bps)
console.log(inboundTrack.jitter);               // Network jitter (seconds)
console.log(inboundTrack.fractionLost);         // Packet loss fraction
console.log(inboundTrack.score);                // Track quality score (0.0-5.0)
```

### Outbound Track Metrics

Available on `OutboundTrackMonitor`:

```javascript
const outboundTrack = /* get from monitor.tracks */;

console.log(outboundTrack.bitrate);                    // Sending bitrate (bps)
console.log(outboundTrack.sendingPacketRate);          // Packets sent per second
console.log(outboundTrack.remoteReceivedPacketRate);   // Remote packets received per second
console.log(outboundTrack.jitter);                     // Remote reported jitter
console.log(outboundTrack.fractionLost);               // Remote reported packet loss
console.log(outboundTrack.score);                      // Track quality score (0.0-5.0)
```

## RTP-Level Derived Metrics

### Inbound RTP Metrics

Available on `InboundRtpMonitor`:

```javascript
const inboundRtp = /* get from pcMonitor.mappedInboundRtpMonitors */;

// Bitrate and packet metrics
console.log(inboundRtp.bitrate);                // Calculated receiving bitrate (bps)
console.log(inboundRtp.packetRate);             // Packets received per second
console.log(inboundRtp.fractionLost);           // Calculated packet loss fraction
console.log(inboundRtp.bitPerPixel);            // Video: bits per pixel efficiency

// Video-specific derived metrics
console.log(inboundRtp.avgFramesPerSec);        // Average FPS over recent samples
console.log(inboundRtp.ewmaFps);                // EWMA smoothed FPS
console.log(inboundRtp.fpsVolatility);          // deprecated: prefer interFrameDelayVariation
console.log(inboundRtp.interFrameDelayVariation);  // frame-timing stability (lower is better)
console.log(inboundRtp.isFreezed);              // Boolean: video appears frozen

// Audio-specific metrics
console.log(inboundRtp.receivingAudioSamples);  // Audio samples received in period
console.log(inboundRtp.timeStretchRate);        // Share of samples NetEQ stretched/compressed
console.log(inboundRtp.estimatedPlayoutTimestamp); // Sender NTP time of the last playable sample

// Delta metrics (change since last collection)
console.log(inboundRtp.deltaPacketsLost);           // Packets lost in period
console.log(inboundRtp.deltaPacketsReceived);       // Packets received in period
console.log(inboundRtp.deltaBytesReceived);         // Bytes received in period
console.log(inboundRtp.deltaJitterBufferDelay);     // Jitter buffer delay change
console.log(inboundRtp.deltaFramesDecoded);         // Video frames decoded in period
console.log(inboundRtp.deltaFramesReceived);        // Video frames received in period
console.log(inboundRtp.deltaFramesRendered);        // Video frames rendered in period
console.log(inboundRtp.deltaCorruptionProbability); // Frame corruption change
console.log(inboundRtp.deltaTime);                  // Elapsed time for calculations (ms)

// Audio concealment and jitter buffer (the "how did it sound" set)
console.log(inboundRtp.inventedSpeechRatio);        // Share of the interval NetEQ invented — silence excluded
console.log(inboundRtp.concealmentEventRate);       // Concealment events per second
console.log(inboundRtp.timeStretchRate);            // Share of samples NetEQ stretched or compressed
console.log(inboundRtp.avgJitterBufferDelayInMs);   // Latency the buffer actually added, per sample
console.log(inboundRtp.jitterBufferTargetDelayInMs);// What NetEQ is aiming for — a rising target predicts trouble
console.log(inboundRtp.discardRate);                // Packets that arrived too late to use

// Video decode cost and recovery pressure
console.log(inboundRtp.decodeTimePerFrameInMs);     // Decode cost per frame
console.log(inboundRtp.droppedFrameRatio);          // Frames dropped after arriving
console.log(inboundRtp.renderRatio);                // Frames rendered vs decoded
console.log(inboundRtp.keyFrameRate);               // Keyframes decoded per second
console.log(inboundRtp.pliRate);                    // PLIs sent per second
console.log(inboundRtp.firRate);
console.log(inboundRtp.nackRate);
console.log(inboundRtp.retransmissionRatio);        // Share of received bytes that were retransmissions
```

> Every delta above is **counter-reset safe**: a counter that goes backwards
> (SSRC reuse, an ICE restart, a stats-object replacement) yields `0` rather than
> a negative value, so no rate derived from it can go negative.

### Outbound RTP Metrics

Available on `OutboundRtpMonitor`:

```javascript
const outboundRtp = /* get from pcMonitor.mappedOutboundRtpMonitors */;

// Bitrate metrics
console.log(outboundRtp.bitrate);               // Total sending bitrate (bps)
console.log(outboundRtp.payloadBitrate);        // Payload-only bitrate (excluding headers/retransmissions)
console.log(outboundRtp.packetRate);            // Packets sent per second
console.log(outboundRtp.bitPerPixel);           // Video: bits per pixel efficiency

// Delta metrics
console.log(outboundRtp.deltaPacketsSent);      // Packets sent in period
console.log(outboundRtp.deltaBytesSent);        // Bytes sent in period

// Encoder cost and pressure
console.log(outboundRtp.encodeTimePerFrameInMs);// Encode cost per frame — the most direct send-side CPU signal
console.log(outboundRtp.avgQpPerFrame);         // Average quantization parameter per encoded frame
console.log(outboundRtp.retransmissionRatio);   // Share of sent bytes that were retransmissions
console.log(outboundRtp.retransmittedPacketRatio);
console.log(outboundRtp.avgPacketSendDelayInMs);// Per-packet pacer delay
console.log(outboundRtp.keyFrameRate);          // Keyframes encoded per second
console.log(outboundRtp.nackRate, outboundRtp.pliRate, outboundRtp.firRate);

// What the encoder spent THIS interval doing, in 0..1 — unlike the raw
// `qualityLimitationDurations` accumulators, this can be compared to a threshold.
console.log(outboundRtp.qualityLimitationDurationShares);
// => { none: 0.25, cpu: 0.75, bandwidth: 0, other: 0 }
```

### Remote RTP Metrics

**Remote Inbound RTP** (remote peer's receiving stats):

```javascript
const remoteInboundRtp = /* get from pcMonitor.mappedRemoteInboundRtpMonitors */;

console.log(remoteInboundRtp.packetRate);       // Remote receiving packet rate
console.log(remoteInboundRtp.deltaPacketsLost); // Remote packets lost in period

// The RTT the far end measured for the stream we send, averaged over the
// interval from totalRoundTripTime / roundTripTimeMeasurements. `roundTripTime`
// alone is the last single measurement and is noisy.
console.log(remoteInboundRtp.avgRoundTripTimeInSec);
```

> `packetsLost` legitimately *decreases* when a late packet arrives, so the
> counter-reset guard is not merely defensive here — `deltaPacketsLost` is
> clamped at `0` rather than going negative.

**Remote Outbound RTP** (remote peer's sending stats):

```javascript
const remoteOutboundRtp = /* get from pcMonitor.mappedRemoteOutboundRtpMonitors */;

console.log(remoteOutboundRtp.bitrate);         // Remote sending bitrate
```

## ICE Transport Derived Metrics

Available on `IceTransportMonitor` and `IceCandidatePairMonitor`:

```javascript
const iceTransport = /* get from pcMonitor.mappedIceTransportMonitors */;

// Transport-level bitrates
console.log(iceTransport.sendingBitrate);       // Transport sending bitrate
console.log(iceTransport.receivingBitrate);     // Transport receiving bitrate

// Delta metrics
console.log(iceTransport.deltaPacketsSent);     // Packets sent in period
console.log(iceTransport.deltaPacketsReceived); // Packets received in period
console.log(iceTransport.deltaBytesSent);       // Bytes sent in period
console.log(iceTransport.deltaBytesReceived);   // Bytes received in period

// ICE candidate pair specific
const candidatePair = /* get from pcMonitor.mappedIceCandidatePairMonitors */;
console.log(candidatePair.availableIncomingBitrate); // Bandwidth estimation for receiving
console.log(candidatePair.availableOutgoingBitrate); // Bandwidth estimation for sending
```

## Data Channel Derived Metrics

Available on `DataChannelMonitor`:

```javascript
const dataChannel = /* get from pcMonitor.mappedDataChannelMonitors */;

console.log(dataChannel.deltaBytesSent);        // Bytes sent in period
console.log(dataChannel.deltaBytesReceived);    // Bytes received in period
```

## Media Source and Playout Metrics

**Media Source derived metrics** (local media):

```javascript
const mediaSource = /* get from pcMonitor.mappedMediaSourceMonitors */;

console.log(mediaSource.deltaFrames);   // Frames the capture source produced in the period
console.log(mediaSource.sourceFps);     // ...as a rate. Compare against what the encoder managed
                                        // to tell a slow camera from a slow encoder.
console.log(mediaSource.rmsAudioLevel); // RMS over the interval, from totalAudioEnergy —
                                        // unlike `audioLevel` it does not read zero between words.

console.log(mediaSource.getOutboundRtps()); // Every encoding fed by this source (simulcast: several)
```

**Media Playout derived metrics** (audio playout):

```javascript
const mediaPlayout = /* get from pcMonitor.mappedMediaPlayoutMonitors */;

console.log(mediaPlayout.deltaSynthesizedSamplesDuration); // Synthesized audio duration in period
console.log(mediaPlayout.deltaSamplesDuration);            // Total samples duration in period
console.log(mediaPlayout.synthesizedSamplesRatio);         // Synthesized share of the interval, 0..1
console.log(mediaPlayout.playoutDelayPerSampleInMs);       // How long audio waited before being played.
                                                           // `totalPlayoutDelay` alone grows forever and
                                                           // cannot be compared to a threshold; this can.
```

## Accessing Derived Metrics

```javascript
// Access derived metrics through monitor hierarchy
monitor.on("stats-collected", () => {
    // Client-level aggregates
    console.log("Total sending bitrate:", monitor.sendingAudioBitrate + monitor.sendingVideoBitrate);

    // Per-connection metrics
    monitor.peerConnections.forEach((pc) => {
        console.log(`PC ${pc.peerConnectionId} RTT:`, pc.avgRttInSec * 1000, "ms");

        // Per-track metrics
        pc.mappedInboundTracks.forEach((track) => {
            if (track.kind === "video") {
                const inboundRtp = track.getInboundRtp();
                console.log(`Video FPS: ${inboundRtp?.ewmaFps}, Volatility: ${inboundRtp?.fpsVolatility}`);
            }
        });
    });
});

// Manual access to specific metrics
const videoTrack = monitor.tracks.find((t) => t.kind === "video" && t.direction === "inbound");
if (videoTrack) {
    const rtp = videoTrack.getInboundRtp();
    console.log("Video quality metrics:", {
        bitrate: rtp.bitrate,
        fps: rtp.ewmaFps,
        volatility: rtp.fpsVolatility,
        packetLoss: rtp.fractionLost,
    });
}
```

---

[← back to the README](../README.md)
