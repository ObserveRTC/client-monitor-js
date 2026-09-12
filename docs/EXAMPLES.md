# Examples

# Examples

## Basic Monitoring Setup

```javascript
import { ClientMonitor } from "@observertc/client-monitor-js";

const monitor = new ClientMonitor({
    clientId: "client-123",
    callId: "call-456",
    collectingPeriodInMs: 2000,
    samplingPeriodInMs: 5000,
});

// Add peer connection
const pc = new RTCPeerConnection();
monitor.addSource(pc);

// Handle samples
monitor.on("sample-created", (sample) => {
    // Send to analytics
    fetch("/analytics", {
        method: "POST",
        body: JSON.stringify(sample),
        headers: { "Content-Type": "application/json" },
    });
});

// Handle issues
monitor.on("issue", (issue) => {
    console.warn("Issue detected:", issue.type, issue.payload);
});
```

## Advanced Configuration

```javascript
const monitor = new ClientMonitor({
    clientId: "advanced-client",
    collectingPeriodInMs: 1000,
    samplingPeriodInMs: 3000,

    // Sensitive congestion detection
    congestionDetector: {
        sensitivity: "high",
    },

    // Strict CPU monitoring
    cpuPerformanceDetector: {
        utilizationThreshold: 0.1,   // stricter than the 0.15 default
    },

    // Quick dry track detection
    dryInboundTrackDetector: {
        thresholdInMs: 3000,
    },

    appData: {
        version: "1.0.0",
        feature: "screen-share",
    },
});
```

## Mediasoup Integration

```javascript
import mediasoup from "mediasoup-client";

const device = new mediasoup.Device();
const monitor = new ClientMonitor({
    clientId: "mediasoup-client",
});

// Load device capabilities
await device.load({ routerRtpCapabilities });

// Add device for monitoring
monitor.addSource(device);

// Create transport
const sendTransport = device.createSendTransport({
    // transport options
});

// The monitor automatically detects the new transport
// For existing transports, add manually:
// monitor.addSource(sendTransport);

// Produce media
const producer = await sendTransport.produce({
    track: videoTrack,
    codecOptions: {},
});

// Track is automatically monitored
```

## Custom Detector

```javascript
// A custom detector following the new lifecycle: stateful issue keyed by the PC,
// auto-resolve when latency recovers, payload enriched with durationInMs on close.
class NetworkLatencyDetector {
    name = "network-latency-detector";
    // Public runtime kill-switch — apps may flip this without removing the detector.
    disabled = false;

    constructor(pcMonitor) {
        this.pcMonitor = pcMonitor;
        this.highLatencyThreshold = 0.2; // 200ms in seconds, matching avgRttInSec
        this.lowLatencyThreshold = 0.1; // 100ms hysteresis floor
        this.issueKey = `high-latency-pc-${pcMonitor.peerConnectionId}`;
        this._startedAt = undefined;
    }

    update() {
        if (this.disabled) return;

        const rtt = this.pcMonitor.avgRttInSec ?? 0;
        const monitor = this.pcMonitor.parent;
        const isActive = monitor.isIssueActive(this.issueKey);

        if (!isActive && rtt > this.highLatencyThreshold) {
            this._startedAt = Date.now();
            monitor.raiseIssue(this.issueKey, {
                type: "high-latency",
                payload: {
                    peerConnectionId: this.pcMonitor.peerConnectionId,
                    rttInSec: rtt,
                    threshold: this.highLatencyThreshold,
                },
            });
        } else if (isActive && rtt < this.lowLatencyThreshold) {
            const active = monitor.activeIssues.get(this.issueKey);
            monitor.resolveIssue(this.issueKey, {
                comment: "latency recovered",
                payload: {
                    ...active?.payload,
                    durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
                },
            });
            this._startedAt = undefined;
        }
    }
}

// Attach the detector when each PeerConnection is added.
monitor.on("new-peerconnnection-monitor", ({ peerConnectionMonitor }) => {
    const detector = new NetworkLatencyDetector(peerConnectionMonitor);
    peerConnectionMonitor.detectors.add(detector);
});
```

## Real-time Monitoring Dashboard

```javascript
class MonitoringDashboard {
    constructor(monitor) {
        this.monitor = monitor;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.monitor.on("score", ({ clientScore, currentReasons }) => {
            // currentReasons is the AGGREGATE: every component's reasons summed
            this.updateScoreDisplay(clientScore, currentReasons);
        });

        this.monitor.on("congestion", ({ availableIncomingBitrate, availableOutgoingBitrate }) => {
            this.showCongestionAlert(availableIncomingBitrate, availableOutgoingBitrate);
        });

        this.monitor.on("stats-collected", ({ durationOfCollectingStatsInMs }) => {
            this.updatePerformanceMetrics(durationOfCollectingStatsInMs);
        });

        this.monitor.on("issue", (issue) => {
            this.addIssueToLog(issue);
        });

        this.monitor.on("issue-resolved", (resolved) => {
            this.addResolvedIssueToLog(resolved);
        });
    }

    updateScoreDisplay(score, reasons) {
        document.getElementById("score").textContent = score.toFixed(1);
        document.getElementById("score-reasons").textContent = JSON.stringify(reasons, null, 2);
    }

    showCongestionAlert(incoming, outgoing) {
        const alert = document.createElement("div");
        alert.className = "congestion-alert";
        alert.textContent = `Congestion detected! Available: ${incoming}/${outgoing} kbps`;
        document.body.appendChild(alert);
    }

    updatePerformanceMetrics(duration) {
        document.getElementById("collection-time").textContent = `${duration}ms`;
    }

    addIssueToLog(issue) {
        const log = document.getElementById("issue-log");
        const entry = document.createElement("div");
        entry.dataset.issueKey = "key" in issue ? issue.key : "";
        entry.textContent = `${new Date(issue.timestamp ?? issue.raisedAt).toISOString()} OPEN  ${issue.type} ${JSON.stringify(issue.payload ?? {})}`;
        log.appendChild(entry);
    }

    addResolvedIssueToLog(resolved) {
        const log = document.getElementById("issue-log");
        const entry = document.createElement("div");
        entry.textContent =
            `${new Date(resolved.resolvedAt).toISOString()} CLOSE ${resolved.type} ` +
            `${resolved.comment ?? ""} duration=${resolved.payload?.durationInMs ?? "?"}ms`;
        log.appendChild(entry);
    }
}

// Initialize dashboard
const dashboard = new MonitoringDashboard(monitor);
```

---

[← back to the README](../README.md)
