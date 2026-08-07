import { IceTupleChangeDetector } from "../../src/detectors/IceTupleChangeDetector";

interface EventHandler {
    (event: Record<string, unknown>): void;
}

class MockClientMonitor {
    private eventHandlers: { [key: string]: EventHandler[] } = {};
    public readonly activeIssues = new Map<string, unknown>();

    emit(eventName: string, eventData: Record<string, unknown>) {
        const handlers = this.eventHandlers[eventName] || [];
        handlers.forEach(handler => handler(eventData));
    }

    on(eventName: string, handler: EventHandler) {
        if (!this.eventHandlers[eventName]) {
            this.eventHandlers[eventName] = [];
        }
        this.eventHandlers[eventName].push(handler);
    }

    raiseIssue() {
        throw new Error('IceTupleChangeDetector must not raise issues');
    }

    addIssue() {
        throw new Error('IceTupleChangeDetector must not raise issues');
    }
}

function makePair(tuple: string, pathKey = 'transport-1') {
    return { pathKey, tuple };
}

class MockPeerConnectionMonitor {
    public parent = new MockClientMonitor();
    public closed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public selectedIceCandidatePairs: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPairs(...pairs: any[]) {
        this.selectedIceCandidatePairs = pairs;
    }
}

describe('IceTupleChangeDetector', () => {
    let detector: IceTupleChangeDetector;
    let mockPeerConnection: MockPeerConnectionMonitor;
    let mockClientMonitor: MockClientMonitor;

    beforeEach(() => {
        mockPeerConnection = new MockPeerConnectionMonitor();
        mockClientMonitor = mockPeerConnection.parent;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detector = new IceTupleChangeDetector(mockPeerConnection as any);
    });

    it('should create detector with correct name', () => {
        expect(detector.name).toBe('ice-tuple-change-detector');
    });

    it('does not report the initial tuple establishment', () => {
        const eventSpy = jest.fn();
        mockClientMonitor.on('ice-tuple-changed', eventSpy);
        mockPeerConnection.setPairs(makePair('10.0.0.1:1111:203.0.113.5:3478:udp'));

        detector.update();

        expect(eventSpy).not.toHaveBeenCalled();
        expect(detector.tuples.size).toBe(1);
    });

    it('reports a tuple change', () => {
        const eventSpy = jest.fn();
        mockClientMonitor.on('ice-tuple-changed', eventSpy);
        mockPeerConnection.setPairs(makePair('10.0.0.1:1111:203.0.113.5:3478:udp'));
        detector.update();

        mockPeerConnection.setPairs(makePair('10.0.0.2:2222:203.0.113.5:3478:udp'));
        detector.update();

        expect(eventSpy).toHaveBeenCalledTimes(1);
        expect(detector.tuples.size).toBe(1);
    });

    it('stays silent while the tuple set is unchanged', () => {
        const eventSpy = jest.fn();
        mockClientMonitor.on('ice-tuple-changed', eventSpy);
        mockPeerConnection.setPairs(makePair('10.0.0.1:1111:203.0.113.5:3478:udp'));

        detector.update();
        detector.update();
        detector.update();

        expect(eventSpy).not.toHaveBeenCalled();
    });

    it('tracks a tuple per transport', () => {
        const eventSpy = jest.fn();
        mockClientMonitor.on('ice-tuple-changed', eventSpy);
        mockPeerConnection.setPairs(
            makePair('10.0.0.1:1111:203.0.113.5:3478:udp', 'transport-audio'),
            makePair('10.0.0.1:2222:203.0.113.5:3478:udp', 'transport-video'),
        );
        detector.update();

        expect(detector.tuples.size).toBe(2);
        expect(eventSpy).not.toHaveBeenCalled();
    });

    it('never raises issues — it stays a low-level primitive', () => {
        mockPeerConnection.setPairs(makePair('10.0.0.1:1111:203.0.113.5:3478:udp'));
        detector.update();
        mockPeerConnection.setPairs(makePair('10.0.0.2:2222:203.0.113.5:3478:udp'));

        // MockClientMonitor throws if raiseIssue/addIssue is called.
        expect(() => detector.update()).not.toThrow();
        expect(mockClientMonitor.activeIssues.size).toBe(0);
    });
});
