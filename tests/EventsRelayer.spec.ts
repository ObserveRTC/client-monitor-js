import { EventsRelayer } from "../src/EventsRelayer";

describe("EventsRelayer", () => {
    it('EventsRelayer is constructed without error', () => {
        EventsRelayer.create();
    });
    it('Relay SampleCreated if subscribed', done => {
        const events = EventsRelayer.create();
        events.onSampleCreated(() => {
            done();
        });
        events.emitSampleCreated({
            clientId: "notImportant",
            timestamp: Date.now(),
        });
    });

    it('Not Relay SampleCreated if unsubscribed', done => {
        const events = EventsRelayer.create();
        const listener = (clientSample: any) => {
            throw new Error(`Should not be called`);
        };
        const doneListener = () => {
            done();
        }
        events.onSampleCreated(listener);
        events.onSampleCreated(doneListener);
        events.offSampleCreated(listener);
        events.emitSampleCreated({
            clientId: "notImportant",
            timestamp: Date.now(),
        });
    });

    it('Relay StatsCollected if subscribed', done => {
        const events = EventsRelayer.create();
        events.onStatsCollected(() => {
            done();
        });
        events.emitStatsCollected([]);
    });

    it('Not Relay StatsCollected if unsubscribed', done => {
        const events = EventsRelayer.create();
        const listener = () => {
            throw new Error(`Should not be called`)
        };
        const doneListener = () => {
            done();
        }
        events.onStatsCollected(listener);
        events.onStatsCollected(doneListener);
        events.offStatsCollected(listener);
        events.emitStatsCollected([]);
    });

    it('Relay SampleSent if subscribed', done => {
        const events = EventsRelayer.create();
        events.onSampleSent(() => {
            done();
        });
        events.emitSampleSent();
    });

    it('Not Relay SampleSent if unsubscribed', done => {
        const events = EventsRelayer.create();
        const listener = () => {
            throw new Error(`Should not be called`)
        };
        const doneListener = () => {
            done();
        }
        events.onSampleSent(listener);
        events.onSampleSent(doneListener);
        events.offSampleSent(listener);
        events.emitSampleSent();
    });

    it('Relay Disconnected if subscribed', done => {
        const events = EventsRelayer.create();
        events.onDisconnected(() => {
            done();
        });
        events.emitDisconnected();
    });

    it('Not Relay Disconnected if unsubscribed', done => {
        const events = EventsRelayer.create();
        const listener = () => {
            throw new Error(`Should not be called`)
        };
        const doneListener = () => {
            done();
        }
        events.onDisconnected(listener);
        events.onDisconnected(doneListener);
        events.offDisconnected(listener);
        events.emitDisconnected();
    });

    it('Relay Connected if subscribed', done => {
        const events = EventsRelayer.create();
        events.onConnected(() => {
            done();
        });
        events.emitConnected();
    });

    it('Not Relay Connected if unsubscribed', done => {
        const events = EventsRelayer.create();
        const listener = () => {
            throw new Error(`Should not be called`)
        };
        const doneListener = () => {
            done();
        }
        events.onConnected(listener);
        events.onConnected(doneListener);
        events.offConnected(listener);
        events.emitConnected();
    });
});
