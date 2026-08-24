import { watchTabVisibility } from "../../src/sources/watchTabVisibility";
import { ClientEventPayloadProvider } from "../../src/sources/ClientEventPayloadProvider";
import { ClientEventTypes } from "../../src/schema/ClientEventTypes";

type Listener = () => void;

class FakeDocument {
    public visibilityState: 'visible' | 'hidden' = 'visible';
    private listeners: { [type: string]: Listener[] } = {};

    addEventListener(type: string, listener: Listener) {
        (this.listeners[type] ??= []).push(listener);
    }

    removeEventListener(type: string, listener: Listener) {
        this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== listener);
    }

    dispatch(type: string) {
        (this.listeners[type] ?? []).forEach(l => l());
    }

    listenerCount(type: string) {
        return (this.listeners[type] ?? []).length;
    }
}

class MockMonitor {
    public activeTab = true;
    public readonly events: { type: string, payload?: Record<string, unknown> }[] = [];
    public readonly clientEventPayloadProvider = new ClientEventPayloadProvider();
    private closeListeners: Listener[] = [];

    addEvent(event: { type: string, payload?: Record<string, unknown> }) {
        this.events.push(event);
    }

    once(eventName: string, listener: Listener) {
        if (eventName === 'close') this.closeListeners.push(listener);
    }

    close() {
        this.closeListeners.forEach(l => l());
    }
}

const mockLogger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() };

describe('watchTabVisibility', () => {
    let fakeDocument: FakeDocument;
    let monitor: MockMonitor;

    beforeEach(() => {
        fakeDocument = new FakeDocument();
        monitor = new MockMonitor();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).document = fakeDocument;
        mockLogger.warn.mockClear();
    });

    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).document;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const watch = () => watchTabVisibility(monitor as any, mockLogger as any);

    it('keeps activeTab true when no document is available', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).document;

        watch();

        expect(monitor.activeTab).toBe(true);
        expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('leaves activeTab true for a visible tab and emits no event', () => {
        watch();

        expect(monitor.activeTab).toBe(true);
        expect(monitor.events).toHaveLength(0);
    });

    it('picks up a monitor created in a background tab', () => {
        fakeDocument.visibilityState = 'hidden';

        watch();

        expect(monitor.activeTab).toBe(false);
        expect(monitor.events).toHaveLength(1);
        expect(monitor.events[0]).toMatchObject({
            type: ClientEventTypes.TAB_VISIBILITY_CHANGED,
            payload: { visible: false },
        });
    });

    it('flips activeTab and records an event on every visibility transition', () => {
        watch();

        fakeDocument.visibilityState = 'hidden';
        fakeDocument.dispatch('visibilitychange');
        expect(monitor.activeTab).toBe(false);

        fakeDocument.visibilityState = 'visible';
        fakeDocument.dispatch('visibilitychange');
        expect(monitor.activeTab).toBe(true);

        expect(monitor.events.map(e => e.payload?.visible)).toEqual([false, true]);
        expect(monitor.events.every(e => e.type === ClientEventTypes.TAB_VISIBILITY_CHANGED)).toBe(true);
    });

    it('does not record duplicate events for repeated identical states', () => {
        watch();

        fakeDocument.dispatch('visibilitychange'); // still visible
        fakeDocument.dispatch('visibilitychange'); // still visible

        expect(monitor.events).toHaveLength(0);
    });

    it('unsubscribes when the monitor closes', () => {
        watch();
        expect(fakeDocument.listenerCount('visibilitychange')).toBe(1);

        monitor.close();
        expect(fakeDocument.listenerCount('visibilitychange')).toBe(0);
    });
});
