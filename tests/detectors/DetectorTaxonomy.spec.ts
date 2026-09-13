import * as fs from 'fs';
import * as path from 'path';
import { ClientMonitor } from "../../src/ClientMonitor";
import type { ClientMonitorConfig } from "../../src/ClientMonitorConfig";
import { PeerConnectionMonitor } from "../../src/monitors/PeerConnectionMonitor";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";
import { MediaPlayoutMonitor } from "../../src/monitors/MediaPlayoutMonitor";
import { IceTransportMonitor } from "../../src/monitors/IceTransportMonitor";


/**
 * The category every detector belongs to, from docs/DETECTOR_TAXONOMY.md. This
 * is the machine-readable copy: the tests below fail if a detector is
 * registered without a category, which is what stops the taxonomy from
 * quietly going stale the next time somebody adds one.
 *
 * Categories 1-4 raise issues and are ordered — read a failed session from the
 * lowest one that fired. `telemetry` sits beside them: it raises nothing, so it
 * has no rung. Membership there is by design, never by omission — the test is
 * "would raising an issue here ever be right?", which is why
 * `ice-traversal-detector` is telemetry (a TURN path is a cost, not a fault)
 * while `ice-path-establishment-detector` is not: it is a connectivity layer-3
 * detector that deliberately emits an event and nothing else, because
 * "establishment is taking a long time" is not yet a claim that establishment
 * failed. That claim belongs to `ice-establishment-failed-detector`, which owns
 * the layer-3 failure issue — so the event-only shape here is the design, not a
 * gap.
 */
type DetectorCategory =
    | 'connectivity'
    | 'transport-quality'
    | 'pipeline-disruption'
    | 'perceived-quality'
    | 'telemetry';

const DETECTOR_CATEGORIES: Readonly<Record<string, DetectorCategory>> = Object.freeze({
    // 1 — Connectivity (five layers; see docs/CONNECTIVITY_DETECTORS.md)
    'ice-reachability-detector': 'connectivity',
    // (ice-traversal-detector sits at layer 2 but is Telemetry — see below)
    'ice-path-establishment-detector': 'connectivity',
    'ice-establishment-failed-detector': 'connectivity',
    'dtls-handshake-failed-detector': 'connectivity',
    'dtls-handshake-stalled-detector': 'connectivity',
    'ice-disconnected-detector': 'connectivity',
    'ice-connection-failed-detector': 'connectivity',
    'ice-transport-stalled-detector': 'connectivity',
    'unstable-ice-path-detector': 'connectivity',
    // 2 — Transport Quality
    // Deprecated, superseded by the two below.
    'congestion-detector': 'transport-quality',
    'uplink-congestion-detector': 'transport-quality',
    'downlink-congestion-detector': 'transport-quality',
    'transport-delay-detector': 'transport-quality',
    'transport-loss-detector': 'transport-quality',
    // Delivery reliability, beside transport-loss: a path dropping a share of
    // what crosses it, and a path dropping all of it by policy. It used to be
    // filed as connectivity layer 6, "media flow"; that layer is retired,
    // because every connectivity stage completes and holds and the path simply
    // is not delivering — the Transport Quality membership test word for word.
    'blocked-stun-requests-detector': 'transport-quality',
    'blocked-outbound-media-detector': 'transport-quality',
    'blocked-inbound-media-detector': 'transport-quality',
    // 3 — Pipeline Disruption
    'rtp-sender-stalled-detector': 'pipeline-disruption',
    'transport-demux-stalled-detector': 'pipeline-disruption',
    'video-recovery-failed-detector': 'pipeline-disruption',
    'cpu-performance-detector': 'pipeline-disruption',
    'capture-source-lost-detector': 'pipeline-disruption',
    'silent-audio-source-detector': 'pipeline-disruption',
    'video-capture-bottleneck-detector': 'pipeline-disruption',
    'encoder-bottleneck-detector': 'pipeline-disruption',
    'dry-outbound-track-detector': 'pipeline-disruption',
    'dry-inbound-track-detector': 'pipeline-disruption',
    'frame-assembly-stalled-detector': 'pipeline-disruption',
    'decoder-bottleneck-detector': 'pipeline-disruption',
    'decoder-performance-detector': 'pipeline-disruption',
    'stuck-decoder-detector': 'pipeline-disruption',
    'playout-discrepancy-detector': 'pipeline-disruption',
    // 4 — Perceived Quality
    // (the repair loop around a freeze — video-recovery-failed —
    //  is pipeline-disruption and lives in its own two detectors, listed above)
    'pixelated-video-detector': 'perceived-quality',
    'inbound-video-flow-state-detector': 'perceived-quality',
    'invented-speech-detector': 'perceived-quality',
    'av-desync-playout-detector': 'perceived-quality',
    'jitter-buffer-stress-detector': 'perceived-quality',
    'audio-playout-synthesis-detector': 'perceived-quality',
    // 5 — Telemetry (raises no issue, by design)
    'ice-traversal-detector': 'telemetry',
    // An ICE restart is a fact about the connection, not a fault; recommending
    // one is advice about what to do next, which is not a finding either.
    'ice-restart-detector': 'telemetry',
    'ice-restart-recommendation-detector': 'telemetry',
    'capture-track-muted-detector': 'telemetry',
    'codec-change-detector': 'telemetry',
    'video-resolution-change-detector': 'telemetry',
    'simulcast-layer-detector': 'telemetry',
    'stats-gap-detector': 'telemetry',
});

/**
 * The layer every detector sits at within its category — the second half of the
 * source stamp, and the layer column of the full map in
 * docs/DETECTOR_TAXONOMY.md. Same job as `DETECTOR_CATEGORIES` above, done for
 * the other half: without it the layer text was required to be present but not
 * to say anything in particular, which is how the map came to spell Pipeline
 * Disruption's layers in the deep reference's short grid codes while the stamps
 * spelled them out.
 *
 * One spelling, and it is the deep reference's own `##` sub-layer heading —
 * `Send — capture to frame supply`, not `S1 capture → frames`. A grid code means
 * nothing to a reader who has not opened the one document that defines it,
 * whereas the heading carries its meaning wherever it is quoted. Where a stamp
 * and its deep reference ever disagree, the deep reference wins: it is the
 * authority on its own layer names, and this map is the transcription.
 *
 * Connectivity's entries drop the word "Layer" because the stamp itself supplies
 * it — `Layer: 1 — Reachability` reads back as the heading `Layer 1 —
 * Reachability`.
 */
const DETECTOR_LAYERS: Readonly<Record<string, string>> = Object.freeze({
    // 1 — Connectivity (docs/CONNECTIVITY_DETECTORS.md)
    'ice-reachability-detector': '1 — Reachability',
    'ice-path-establishment-detector': '3 — Path establishment',
    'ice-establishment-failed-detector': '3 — Path establishment',
    'dtls-handshake-failed-detector': '4 — Secure transport',
    'dtls-handshake-stalled-detector': '4 — Secure transport',
    'ice-disconnected-detector': '5 — Path continuity',
    'ice-connection-failed-detector': '5 — Path continuity',
    'ice-transport-stalled-detector': '5 — Path continuity',
    'unstable-ice-path-detector': '5 — Path continuity',
    // 2 — Transport Quality (docs/TRANSPORT_QUALITY_DETECTORS.md)
    'congestion-detector': 'Capacity',
    'uplink-congestion-detector': 'Capacity',
    'downlink-congestion-detector': 'Capacity',
    'transport-delay-detector': 'Delay',
    'transport-loss-detector': 'Delivery reliability',
    'blocked-stun-requests-detector': 'Delivery reliability',
    'blocked-outbound-media-detector': 'Delivery reliability',
    'blocked-inbound-media-detector': 'Delivery reliability',
    // 3 — Pipeline Disruption (docs/PIPELINE_DISRUPTION_DETECTORS.md), in chain
    // order: the send chain, then the receive chain, then the two boundaries
    // that belong to neither.
    'capture-source-lost-detector': 'Send — the source',
    'silent-audio-source-detector': 'Send — the source',
    'video-capture-bottleneck-detector': 'Send — capture to frame supply',
    'encoder-bottleneck-detector': 'Send — frames to encoder',
    'rtp-sender-stalled-detector': 'Send — encoder to RTP sender',
    'dry-outbound-track-detector': 'Send — RTP sender to the wire',
    'transport-demux-stalled-detector': 'Receive — transport to RTP streams',
    'dry-inbound-track-detector': 'Receive — the wire to the track',
    'frame-assembly-stalled-detector': 'Receive — packets to frames',
    'decoder-bottleneck-detector': 'Receive — frames to decoder',
    'decoder-performance-detector': 'Receive — frames to decoder',
    'stuck-decoder-detector': 'Receive — frames to decoder',
    'playout-discrepancy-detector': 'Receive — decoder to renderer',
    'video-recovery-failed-detector': 'Beside the receive chain — the repair loop',
    'cpu-performance-detector': 'Across both chains — the machine',
    // 4 — Perceived Quality (docs/PERCEIVED_QUALITY_DETECTORS.md)
    'pixelated-video-detector': 'Visual — clarity',
    'inbound-video-flow-state-detector': 'Visual — continuity',
    'invented-speech-detector': 'Audio — continuity',
    'audio-playout-synthesis-detector': 'Audio — naturalness',
    'av-desync-playout-detector': 'Synchronization',
    'jitter-buffer-stress-detector': 'Responsiveness',
    // 5 — Telemetry (docs/TELEMETRY_DETECTORS.md). Its Session and Endpoint
    // sub-layers carry no detector at all, so neither appears here.
    'ice-traversal-detector': 'Transport',
    'ice-restart-detector': 'Transport',
    'ice-restart-recommendation-detector': 'Transport',
    'codec-change-detector': 'Media',
    'video-resolution-change-detector': 'Media',
    'simulcast-layer-detector': 'Media',
    'capture-track-muted-detector': 'Lifecycle',
    'stats-gap-detector': 'Lifecycle',
});

/**
 * Which connectivity layer each connectivity detector belongs to — the number
 * alone, because the tests below order and count layers rather than print them;
 * `DETECTOR_LAYERS` above holds the text every category's layer is written as.
 * The model is documented in docs/CONNECTIVITY_DETECTORS.md, and it has five
 * layers:
 * `blocked-transport-detector` used to hold a sixth, "media flow", and is now
 * Transport Quality, so no layer number belongs to it any more.
 */
const CONNECTIVITY_LAYERS: Readonly<Record<string, number>> = Object.freeze({
    'ice-reachability-detector': 1,
    'ice-traversal-detector': 2,
    'ice-path-establishment-detector': 3,
    'ice-establishment-failed-detector': 3,
    'dtls-handshake-failed-detector': 4,
    'dtls-handshake-stalled-detector': 4,
    'ice-disconnected-detector': 5,
    'ice-connection-failed-detector': 5,
    'ice-transport-stalled-detector': 5,
    'unstable-ice-path-detector': 5,
});

/**
 * Layers that legitimately register more than one detector class, because one
 * detector raises exactly one issue type. Layer 4 has two DTLS findings — a
 * handshake the browser declared `failed`, and one that never answers — which
 * rest on different evidence and are judged differently, so they are two
 * classes rather than one class with two branches. Layer 3 has two: establishment
 * that is merely slow, which is an event rather than a claim of failure, and
 * establishment that demonstrably did not work. Layer 5 has four — the path is
 * down, it is finished, it is up but delivering nothing, it will not settle —
 * each with its own issue type, its own evidence and its own resolution.
 */
const MULTI_CLASS_LAYERS = new Set<number>([ 3, 4, 5 ]);

/**
 * Every detector class carries the taxonomy in the last lines of its own class
 * doc comment — `Category:` and `Layer:` — so the answer is where somebody
 * editing the detector will actually see it, rather than only in a document and
 * a map they have no reason to open. The stamps spell the category the way the
 * documents title it; this maps those spellings back onto the slugs
 * `DETECTOR_CATEGORIES` is keyed by, because the two have to be reconcilable or
 * the stamp is decoration.
 */
const STAMPED_CATEGORIES: Readonly<Record<string, DetectorCategory>> = Object.freeze({
    'Connectivity': 'connectivity',
    'Transport Quality': 'transport-quality',
    'Pipeline Disruption': 'pipeline-disruption',
    'Perceived Quality': 'perceived-quality',
    'Telemetry': 'telemetry',
});

const DETECTORS_DIR = path.join(process.cwd(), 'src', 'detectors');

/** The one file every detector's config block is declared as a property of. */
const CLIENT_MONITOR_CONFIG = path.join(process.cwd(), 'src', 'ClientMonitorConfig.ts');

/** `Detector.ts` is the interface and `Detectors.ts` the registry; neither is a detector. */
const NON_DETECTOR_SOURCES = new Set([ 'Detector.ts', 'Detectors.ts' ]);

/**
 * The class-level doc comment and the class it introduces. The anchor is the
 * `export class` that follows, not the first comment in the file: payload and
 * state types carry doc comments of their own and several of them sit above the
 * class, so a "first comment wins" parse would read the wrong block. The inner
 * group refuses to cross a comment terminator, which is what keeps the match
 * from swallowing everything from the top of the file down.
 */
const CLASS_DOC_COMMENT = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export (?:abstract )?class (\w+)/;

/** The one place a detector source is read from disk. */
const readDetectorSource = (file: string) => fs.readFileSync(path.join(DETECTORS_DIR, file), 'utf8');

/**
 * The config key a detector name maps to: the name in camelCase, so
 * `frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector`. One
 * detector, one key — the rule the config-ownership test below enforces.
 */
const configKeyOf = (name: string) => name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/**
 * Every config block one detector source reaches for, read off `config.<key>`
 * accessors. Detector blocks all end in `Detector`, which is what separates a
 * block reference from the field reads that follow it (`config.thresholdInMs`
 * and friends, which are reached through a local alias just as often).
 */
const CONFIG_BLOCK_REFERENCE = /\bconfig\.([A-Za-z][A-Za-z0-9]*Detector)\b/g;

/**
 * The class one detector source exports. Unlike `readDetectorStamp` below this
 * asks nothing of the doc comment, so a detector whose stamp has drifted still
 * reports its class name here rather than vanishing from the config-type test
 * and passing it by absence.
 */
const readDetectorClassName = (file: string) =>
    /^export (?:abstract )?class (\w+)/m.exec(readDetectorSource(file))?.[1];

/** The detector's own `name` and the config blocks its source reads, for one file. */
const readDetectorConfigUse = (file: string) => {
    const source = readDetectorSource(file);
    const name = /readonly name = '([a-z0-9-]+)'/.exec(source);

    if (!name) return undefined;

    return {
        name: name[1] as string,
        blocks: [ ...new Set([ ...source.matchAll(CONFIG_BLOCK_REFERENCE) ].map((match) => match[1] as string)) ],
    };
};

/** The `Category:` / `Layer:` stamp of one detector source, or `undefined` where it has none. */
const readDetectorStamp = (file: string) => {
    const source = readDetectorSource(file);
    const classDoc = CLASS_DOC_COMMENT.exec(source);

    if (!classDoc) return undefined;

    const category = /^\s*\*\s*Category:\s*(.+?)\s*$/m.exec(classDoc[1] ?? '');
    const layer = /^\s*\*\s*Layer:\s*(.+?)\s*$/m.exec(classDoc[1] ?? '');
    const name = /readonly name = '([a-z0-9-]+)'/.exec(source);

    if (!category || !layer || !name) return undefined;

    return {
        className: classDoc[2] as string,
        name: name[1] as string,
        category: category[1] as string,
        layer: layer[1] as string,
    };
};

const detectorSourceFiles = () => fs.readdirSync(DETECTORS_DIR)
    .filter((file) => file.endsWith('.ts') && !NON_DETECTOR_SOURCES.has(file))
    .sort();

/**
 * `blockedInboundMediaDetector` is the one detector whose default is `null` — it needs
 * the far end's RTCP to outlive what killed its media, which rtcp-mux rules out on every
 * browser. The registry tests below supply it, so being off by default costs it none of
 * the coverage every other detector gets.
 */
const DEFAULT_OFF: Partial<ClientMonitorConfig> = {
    blockedInboundMediaDetector: { thresholdInMs: 10000 },
};

describe('detector taxonomy', () => {
    let monitor: ClientMonitor;

    beforeEach(() => {
        monitor = new ClientMonitor({
            collectingPeriodInMs: 0,
            samplingPeriodInMs: 0,
            integrateNavigatorMediaDevices: false,
            addClientJointEventOnCreated: false,
            addClientLeftEventOnClose: false,
        });
    });

    afterEach(() => {
        monitor.close();
    });

    const peerConnectionDetectorNames = (m: ClientMonitor) => new PeerConnectionMonitor(
        'pc-1',
        { getStats: async () => [] },
        m,
        m.logger,
    ).detectors.listOfNames;

    /**
     * The detectors an ICE transport monitor registers under a default config.
     * `blocked-transport` is a finding about one transport rather than about the
     * connection, so its detector is constructed with the transport and lives in this
     * registry — which is why the disable test has to look here too.
     */
    const iceTransportDetectorNames = (m: ClientMonitor) => new IceTransportMonitor(
        new PeerConnectionMonitor('pc-1', { getStats: async () => [] }, m, m.logger),
        { id: 'transport-1', timestamp: 0 },
    ).detectors.listOfNames;

    /**
     * The detectors a track monitor registers under a default config. `kind`
     * matters: half the track-level detectors are video-only, and an
     * audio-only probe would report them as unregistered rather than
     * uncategorised.
     */
    const trackDetectorNames = (
        m: ClientMonitor,
        direction: 'inbound' | 'outbound',
        kind: 'audio' | 'video' = 'audio',
    ) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const track: any = {
            id: 'track-1',
            kind,
            enabled: true,
            muted: false,
            readyState: 'live',
            getSettings: () => ({}),
        };
        // An inbound track monitor reads its kind from the inbound RTP monitor,
        // an outbound one from the track itself.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stub: any = { kind, getPeerConnection: () => ({ parent: m }) };

        return direction === 'outbound'
            ? new OutboundTrackMonitor(track, stub).detectors.listOfNames
            : new InboundTrackMonitor(track, stub).detectors.listOfNames;
    };

    /** Every name registered at peer-connection or track level, both kinds. */
    const allRegisteredDetectorNames = (m: ClientMonitor) => [ ...new Set([
        ...peerConnectionDetectorNames(m),
        ...trackDetectorNames(m, 'outbound', 'audio'),
        ...trackDetectorNames(m, 'outbound', 'video'),
        ...trackDetectorNames(m, 'inbound', 'audio'),
        ...trackDetectorNames(m, 'inbound', 'video'),
    ]) ];

    it('gives every registered detector a category', () => {
        // The taxonomy is only worth having if it stays complete. A detector added
        // without a row in DETECTOR_CATEGORIES — and therefore without a row in
        // docs/DETECTOR_TAXONOMY.md — fails here rather than silently becoming
        // uncategorised.
        // Track level counts too: the three detectors this refactor added there —
        // `frame-assembly-stalled`, `pixelated-video`, `video-flow-disrupted` — were in
        // docs/DETECTOR_TAXONOMY.md and missing here, which a peer-connection-only
        // check could never have caught.
        const uncategorised = allRegisteredDetectorNames(monitor)
            .filter((name) => DETECTOR_CATEGORIES[name] === undefined);

        expect(uncategorised).toEqual([]);
    });

    it('stamps every detector class with a category and a layer', () => {
        // The same job the completeness test above does for the map, done for the
        // sources: a detector added to `src/detectors/` without the stamp fails
        // here rather than quietly becoming the one class whose doc comment does
        // not say where it sits. Reading the directory rather than a list is the
        // point — a new file is in scope the moment it exists.
        const files = detectorSourceFiles();
        const unstamped = files.filter((file) => readDetectorStamp(file) === undefined);

        expect(unstamped).toEqual([]);
        expect(0 < files.length).toBe(true);
    });

    it('stamps every detector class with the category the taxonomy gives it', () => {
        // Two ways to disagree, and both matter: a stamp naming a category that
        // does not exist, and a stamp naming a real category that is not this
        // detector's. Reported as `name: category` pairs so a failure says which
        // detector drifted and to what, rather than only that something did.
        const stamped = detectorSourceFiles()
            .map((file) => readDetectorStamp(file))
            .filter((stamp): stamp is NonNullable<typeof stamp> => stamp !== undefined);

        const disagreements = stamped
            .filter((stamp) => STAMPED_CATEGORIES[stamp.category] !== DETECTOR_CATEGORIES[stamp.name])
            .map((stamp) => `${stamp.name}: ${stamp.category}`);

        expect(disagreements).toEqual([]);
        expect(stamped.length).toBe(Object.keys(DETECTOR_CATEGORIES).length);
    });

    it('stamps every detector class with the layer the taxonomy gives it', () => {
        // The other half of the stamp, held to the same standard. It went
        // unchecked once, and the map drifted into the deep reference's grid
        // codes — `S1 capture → frames` against a stamped `Send — capture to
        // frame supply` — while every test stayed green, because "has a layer"
        // was the whole bar. Comparing the text is what closes that: one
        // spelling in the source, in `DETECTOR_LAYERS` and in the map, or a
        // failure naming the detector and what it drifted to.
        const stamped = detectorSourceFiles()
            .map((file) => readDetectorStamp(file))
            .filter((stamp): stamp is NonNullable<typeof stamp> => stamp !== undefined);

        const disagreements = stamped
            .filter((stamp) => stamp.layer !== DETECTOR_LAYERS[stamp.name])
            .map((stamp) => `${stamp.name}: ${stamp.layer}`);

        expect(disagreements).toEqual([]);
        expect(stamped.length).toBe(Object.keys(DETECTOR_LAYERS).length);
    });

    it('gives every categorised detector a layer, and no others', () => {
        // The two maps are one table read in two columns, so a detector added to
        // one and forgotten in the other is the drift this file exists to stop —
        // and `DETECTOR_LAYERS[name]` being `undefined` would otherwise only
        // fail the test above by way of a confusing "layer does not match".
        expect(Object.keys(DETECTOR_LAYERS).sort()).toEqual(Object.keys(DETECTOR_CATEGORIES).sort());
    });

    it('categorises every connectivity-layer detector as connectivity or telemetry', () => {
        // A layer may be telemetry-only: layer 2 (traversal) deliberately raises
        // nothing, because needing TURN is a cost rather than a fault. What it may
        // not be is uncategorised, or filed under one of the media categories.
        for (const name of Object.keys(CONNECTIVITY_LAYERS)) {
            expect([ 'connectivity', 'telemetry' ]).toContain(DETECTOR_CATEGORIES[name]);
        }
    });

    it('registers at most one detector class per layer at peer-connection level', () => {
        const perLayer = new Map<number, string[]>();

        for (const name of peerConnectionDetectorNames(monitor)) {
            const layer = CONNECTIVITY_LAYERS[name];

            if (layer === undefined) continue; // quality axis, not constrained

            perLayer.set(layer, [ ...(perLayer.get(layer) ?? []), name ]);
        }

        for (const [ layer, names ] of perLayer) {
            if (MULTI_CLASS_LAYERS.has(layer)) continue;

            expect({ layer, names }).toEqual({ layer, names: [ names[0] ] });
        }
    });

    it('registers the connectivity detectors in ascending layer order', () => {
        // Nothing depends on this — every detector re-derives its condition from
        // the stats, so the run order changes no verdict. It is a readability
        // convention: the registration block reads as the connectivity ladder, and
        // this guards it against drifting into an arbitrary order.
        const layers = peerConnectionDetectorNames(monitor)
            .map((name) => CONNECTIVITY_LAYERS[name])
            .filter((layer): layer is number => layer !== undefined);

        expect(layers).toEqual([ ...layers ].sort((a, b) => a - b));
        expect(1 < layers.length).toBe(true);
    });

    it('resolves detector names exactly, with no alias for a name that no longer exists', () => {
        // There is deliberately no rename shim. Detector names changed in 4.10.0
        // when several classes were split one-per-issue, and an alias could only
        // ever have pointed each old name at one of the parts — so an application
        // toggling a split detector by its old name would have kept working while
        // quietly governing a fraction of what it used to. Failing the lookup is
        // the answer a caller can actually act on.
        const pc = new PeerConnectionMonitor(
            'pc-1',
            { getStats: async () => [] },
            monitor,
            monitor.logger,
        );
        const retired = [
            'ice-path-stability-detector',
            'ice-connectivity-detector',
            'dtls-handshake-detector',
            'capture-failure-detector',
            'media-pipeline-detector',
            'no-available-ice-candidate-detector',
            'long-pc-connection-establishment-detector',
            'ice-tuple-change-detector',
        ];

        for (const name of retired) {
            expect(pc.detectors.has(name)).toBe(false);
            expect(pc.detectors.getByName(name)).toBeUndefined();
            expect(pc.detectors.disable(name)).toBe(false);
            expect(pc.detectors.enable(name)).toBe(false);
        }

        // ...and a current name still resolves, so the assertions above cannot pass
        // merely because lookup is broken outright.
        expect(pc.detectors.has('ice-disconnected-detector')).toBe(true);
        expect(pc.detectors.getByName('ice-disconnected-detector')).toBeDefined();
    });

    it('registers the detectors whose config keys lost a deprecated alias, under a bare default config', () => {
        // The companion to the guard below, aimed at the normalizer rather than at
        // the detectors. 4.10.0 deleted the three pre-4.9.0 config keys
        // (`longPcConnectionEstablishmentDetector`, `iceConnectivityDetector`,
        // `noAvailableIceCandidateDetector`) and with them the `??` merging that
        // folded each onto its replacement. Registration is gated on
        // `config.<key> !== null`, so if that simplification had dropped a key from
        // the normalizer the key would read back as `undefined` and the detector
        // would simply never be constructed — silently, because nothing else asks
        // for it and `Detectors.update()` never sees it. One name per affected key,
        // now that every detector is gated on a key of its own.
        //
        // Building with no config at all is the point — passing a config object is
        // precisely what would mask a normalizer that stopped supplying a default.
        const bare = new ClientMonitor();

        try {
            const names = new PeerConnectionMonitor(
                'pc-1',
                { getStats: async () => [] },
                bare,
                bare.logger,
            ).detectors.listOfNames;

            expect(names).toContain('ice-path-establishment-detector');
            expect(names).toContain('ice-disconnected-detector');
            expect(names).toContain('ice-reachability-detector');
        } finally {
            bare.close();
        }
    });

    it('runs every registered detector against a DEFAULT config without throwing', () => {
        // Regression guard. `Detectors.update()` wraps each detector in a try/catch,
        // so a detector reading a config key the normalizer no longer populates
        // fails silently — it just never raises anything again. That is exactly how
        // the 4.9.0 renames broke `ice-path-stability-detector` and
        // `ice-reachability-detector`: their config getters still named the
        // pre-rename keys, and every per-detector spec masked it by setting the
        // deprecated key on its mock. Only a default config catches it, so this
        // builds one and drives every detector directly, outside the try/catch.
        const pc = new PeerConnectionMonitor(
            'pc-1',
            { getStats: async () => [] },
            monitor,
            monitor.logger,
        );

        for (const detector of pc.detectors) {
            expect(() => detector.update()).not.toThrow();
        }

        expect(0 < pc.detectors.size).toBe(true);
    });

    it('reads only its own config block in every detector source', () => {
        // One detector, one key: `frame-assembly-stalled-detector` reads
        // `config.frameAssemblyStalledDetector` and nothing else. This is the
        // config counterpart of one-detector-one-issue, and the reason it needs a
        // test is that borrowing a neighbour's block is invisible at runtime —
        // everything keeps working until somebody sets that neighbour to `null`
        // to switch one detector off and silently retunes or breaks another.
        //
        // Reading the directory rather than a list is the point, as it is for the
        // stamp tests above: a detector added tomorrow is in scope the moment its
        // file exists.
        const borrowed = detectorSourceFiles()
            .map((file) => readDetectorConfigUse(file))
            .filter((use): use is NonNullable<typeof use> => use !== undefined)
            .flatMap((use) => use.blocks
                .filter((block) => block !== configKeyOf(use.name))
                .map((block) => `${use.name}: ${block}`));

        expect(borrowed).toEqual([]);
    });

    it('declares every detector config type in the detector\'s own file, imported by ClientMonitorConfig', () => {
        // Where a detector's config *type* lives is the other half of one
        // detector, one key. The key has to be in `ClientMonitorConfig` — that
        // is the object an application writes — but the shape of what goes in
        // it belongs beside the code that reads it, so adding a tunable is one
        // file's worth of edit and the field's doc comment sits next to the
        // logic it describes rather than in a list of forty-five blocks.
        //
        // Three claims per detector, each named on failure: the detector file
        // exports `<ClassName>Config`, `ClientMonitorConfig.ts` imports it, and
        // the detector's own key is typed with it. The import has to be `import
        // type`: detector files reach monitors, monitors reach `ClientMonitor`,
        // and `ClientMonitor` reaches `ClientMonitorConfig`, so a value import
        // here would close that cycle at runtime.
        //
        // Driven off the same directory walk as the tests above, so a detector
        // added tomorrow is in scope the moment its file exists — which is what
        // stops the next one from declaring its config inline again.
        const configSource = fs.readFileSync(CLIENT_MONITOR_CONFIG, 'utf8');
        const problems: string[] = [];

        for (const file of detectorSourceFiles()) {
            const className = readDetectorClassName(file);
            const use = readDetectorConfigUse(file);

            if (className === undefined || use === undefined) {
                problems.push(`${file}: no detector class with a \`name\``);
                continue;
            }

            const typeName = `${className}Config`;
            const key = configKeyOf(use.name);

            if (!new RegExp(`^export type ${typeName}\\b`, 'm').test(readDetectorSource(file))) {
                problems.push(`${className}: ${file} does not export \`${typeName}\``);
            }

            if (!configSource.includes(`import type { ${typeName} } from "./detectors/${className}";`)) {
                problems.push(`${className}: ClientMonitorConfig.ts does not \`import type\` \`${typeName}\``);
            }

            if (!new RegExp(`^ {4}${key}: ${typeName} \\| null;$`, 'm').test(configSource)) {
                problems.push(`${className}: ClientMonitorConfig.ts does not type \`${key}\` as \`${typeName} | null\``);
            }
        }

        // ...and nothing is left declaring a config block inline, which is the
        // shape every one of these types was moved out of.
        for (const [ , key ] of configSource.matchAll(/^ {4}([a-z][A-Za-z0-9]*Detector): \{$/gm)) {
            problems.push(`${key}: declared inline in ClientMonitorConfig.ts`);
        }

        expect(problems).toEqual([]);
    });

    /**
     * Every registry a detector can be registered in, under one config. The
     * detectors split across eight of them — the client monitor's own, the peer
     * connection's, each ICE transport's, one per track direction and kind, and the
     * media playout monitor — and a detector switched off has to disappear from
     * whichever one holds it, so the disable test below compares all eight rather than
     * guessing which is the right one to look in.
     */
    const registriesOf = (m: ClientMonitor): Record<string, string[]> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playout: any = { parent: m };

        return {
            client: m.detectors.listOfNames,
            peerConnection: peerConnectionDetectorNames(m),
            iceTransport: iceTransportDetectorNames(m),
            outboundAudio: trackDetectorNames(m, 'outbound', 'audio'),
            outboundVideo: trackDetectorNames(m, 'outbound', 'video'),
            inboundAudio: trackDetectorNames(m, 'inbound', 'audio'),
            inboundVideo: trackDetectorNames(m, 'inbound', 'video'),
            mediaPlayout: new MediaPlayoutMonitor(playout, {
                id: 'playout-1', timestamp: 0, kind: 'audio',
            }).detectors.listOfNames,
        };
    };

    /** A monitor built the way `beforeEach` builds one, plus `overrides`. */
    const monitorWith = (overrides: Partial<ClientMonitorConfig>) => new ClientMonitor({
        collectingPeriodInMs: 0,
        samplingPeriodInMs: 0,
        integrateNavigatorMediaDevices: false,
        addClientJointEventOnCreated: false,
        addClientLeftEventOnClose: false,
        ...overrides,
    });

    /**
     * Both halves of it: absent under a bare config, present as soon as the key is
     * supplied. Without the second half, "off by default" would be indistinguishable
     * from a detector quietly dropped from its registry.
     */
    it('leaves the default-off detectors unregistered until their key is supplied', () => {
        const names = [ 'blocked-inbound-media-detector' ];
        const optedIn = monitorWith(DEFAULT_OFF);

        try {
            const byDefault = Object.values(registriesOf(monitor)).flat();
            const enabled = Object.values(registriesOf(optedIn)).flat();

            expect(names.filter((name) => byDefault.includes(name))).toEqual([]);
            expect(names.filter((name) => !enabled.includes(name))).toEqual([]);
        } finally {
            optedIn.close();
        }
    });

    it('registers every detector under some registry, so the disable test below covers them all', () => {
        // The premise of the next test: it drives one detector at a time from the
        // directory listing, so a detector nothing registers would be "absent when
        // disabled" for the wrong reason and pass without testing anything. The
        // default-off detectors are opted back in here, so they are covered too.
        const enabledMonitor = monitorWith(DEFAULT_OFF);
        const registered = new Set(Object.values(registriesOf(enabledMonitor)).flat());

        enabledMonitor.close();
        const unregistered = detectorSourceFiles()
            .map((file) => readDetectorConfigUse(file))
            .filter((use): use is NonNullable<typeof use> => use !== undefined)
            .map((use) => use.name)
            .filter((name) => !registered.has(name));

        expect(unregistered).toEqual([]);
        expect(registered.size).toBe(Object.keys(DETECTOR_CATEGORIES).length);
    });

    it('drops exactly one detector when its own config key is set to null', () => {
        // The behaviour the one-key-per-detector rule exists to give: any detector
        // can be switched off on its own. Setting a key to `null` must remove that
        // detector and leave every neighbour registered — which is the half that
        // used to fail, because six connectivity classes shared
        // `icePathStabilityDetector` and three capture classes shared
        // `captureFailureDetector`, so disabling one took the others with it.
        //
        // Exhaustive rather than representative: every detector is driven from the
        // directory listing, and each registry is compared against the same
        // registry under a default config, so both halves of the claim are checked
        // at once — the detector is gone, and the difference is only ever that one
        // name.
        const enabledMonitor = monitorWith(DEFAULT_OFF);
        const baseline = registriesOf(enabledMonitor);

        enabledMonitor.close();

        const names = detectorSourceFiles()
            .map((file) => readDetectorConfigUse(file))
            .filter((use): use is NonNullable<typeof use> => use !== undefined)
            .map((use) => use.name);

        for (const name of names) {
            const disabled = monitorWith({
                ...DEFAULT_OFF,
                [configKeyOf(name)]: null,
            } as Partial<ClientMonitorConfig>);

            try {
                const registries = registriesOf(disabled);

                for (const [ registry, listed ] of Object.entries(registries)) {
                    expect({ name, registry, listed }).toEqual({
                        name,
                        registry,
                        listed: (baseline[registry] ?? []).filter((other) => other !== name),
                    });
                }
            } finally {
                disabled.close();
            }
        }

        expect(0 < names.length).toBe(true);
    });

});
