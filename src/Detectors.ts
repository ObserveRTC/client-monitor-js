import { ClientMonitor } from "./ClientMonitor";
import { AudioDesyncDetector, AudioDesyncDetectorConfig, createAudioDesyncDetector } from "./detectors/AudioDesyncDetector";
import { CongestionDetectorConfig, createCongestionDetector } from "./detectors/CongestionDetector";
import { CpuPerformanceDetectorConfig, createCpuPerformanceDetector } from "./detectors/CpuPerformanceDetector";
import { StatsStorage } from "./entries/StatsStorage";
import { Middleware } from "./utils/Processor";
import { createLogger } from "./utils/logger";

const logger = createLogger(`Detectors`);

export type DetectorsContext = {
    clientMonitor: ClientMonitor,
};

export interface Detector {
    id: string;
    readonly alert: 'on' | 'off';
    update(): Promise<void>;
}

export type Detectors = ReturnType<typeof createDetectors>;

export function createDetectors(context: DetectorsContext) {
    const { 
        clientMonitor 
    } = context;
    const savedDetectors = new Map<string, {
        detector: Detector,
        middleware: Middleware<StatsStorage>,
    }>();
    let audioDesyncDetector: AudioDesyncDetector | undefined;
    let cpuPerformanceDetector: Detector | undefined;
    let congestionDetector: Detector | undefined;

    function add(detector: Detector) {
        if (savedDetectors.has(detector.id)) {
            logger.warn(`Detector ${detector.id} already exists.`);
            return;
        }
        const middleware: Middleware<StatsStorage> = (storage, next) => {
            detector.update().then(() => {
                return next(storage);
            }).catch((error) => {
                logger.error(`Detector ${detector.id} update failed: ${error}, the detector will be removed.`);
                remove(detector.id);
                next(storage);
            });
        }
        savedDetectors.set(detector.id, {
            detector,
            middleware,
        });
        clientMonitor.storage.processor.addMiddleware(middleware);
    }

    function addAudioDesyncDetector(config: AudioDesyncDetectorConfig) {
        if (audioDesyncDetector) return audioDesyncDetector;
        audioDesyncDetector = createAudioDesyncDetector({
            ...config,
            clientMonitor,
        });
        add(audioDesyncDetector);
        return audioDesyncDetector;
    }
    
    function addCongestionDetector(config: CongestionDetectorConfig) {
        if (congestionDetector) return congestionDetector;
        congestionDetector = createCongestionDetector({
            ...config,
            clientMonitor,
        })
        add(congestionDetector);
        return congestionDetector;
    }

    function addCpuPerformanceDetector(config: CpuPerformanceDetectorConfig) {
        if (cpuPerformanceDetector) return cpuPerformanceDetector;
        cpuPerformanceDetector = createCpuPerformanceDetector({
            ...config,
            clientMonitor,
        });
        add(cpuPerformanceDetector);
        return cpuPerformanceDetector;
    }

    function get(detectorId: string) {
        const savedDetector = savedDetectors.get(detectorId);
        if (!savedDetector) return;
        return savedDetector.detector;
    }

    function remove(detectorId: string) {
        const savedDetector = savedDetectors.get(detectorId);
        if (!savedDetector) return;
        savedDetectors.delete(detectorId);
        clientMonitor.storage.processor.removeMiddleware(savedDetector.middleware);
        if (savedDetector.detector.id === audioDesyncDetector?.id) {
            audioDesyncDetector = undefined;
        } else if (savedDetector.detector.id === cpuPerformanceDetector?.id) {
            cpuPerformanceDetector = undefined;
        } else if (savedDetector.detector.id === congestionDetector?.id) {
            congestionDetector = undefined;
        }
    }

    function clear() {
        for (const detectorId of Array.from(savedDetectors.keys())) {
            remove(detectorId);
        }
        savedDetectors.clear();
    }

    return {
        get,
        add,
        addAudioDesyncDetector,
        addCongestionDetector,
        addCpuPerformanceDetector,
        remove,
        clear,
        [Symbol.iterator]: () => {
            return Array.from(savedDetectors.values()).map((savedDetector) => savedDetector.detector).values();
        },
        get audioDesyncDetector() {
            return audioDesyncDetector;
        },
        get cpuPerformanceDetector() {
            return cpuPerformanceDetector;
        },
        get congestionDetector() {
            return congestionDetector;
        },
    }
}
