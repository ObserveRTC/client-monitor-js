import { MediaDevice } from '../../src/schema/Samples';
import { ClientMetaData } from "../../src/ClientMetaData";

describe(`ClientMetaData`, () => {
    const audioInput: MediaDevice = {
        id: "deviceId_0",
        kind: "audioinput",
    };
    const newAudioInput: MediaDevice = {
        id: "deviceId_1",
        kind: "audioinput",
    };
    describe(`When mediadevice is added through update`, () => {
        it(`Then it can be retrieved`, () => {
            const meta = new ClientMetaData();
            meta.mediaDevices = [audioInput];
            let invoked = 0;

            for (const d of meta.mediaDevices) {
                expect(d.id).toBe(audioInput.id);
                ++invoked;
            }

            for (const d of meta.audioInputs()) {
                expect(d.id).toBe(audioInput.id);
                ++invoked;
            }
            expect(invoked).toBe(2);
        });
    });
    describe(`When mediadevice is removed by update`, () => {
        it(`Then it cannot be retrieved`, () => {
            const meta = new ClientMetaData();
            meta.mediaDevices = [audioInput];
            meta.mediaDevices = [newAudioInput];
            let foundDevice = 0;
            let foundAnotherDevice = 0;

            for (const d of meta.mediaDevices) {
                if (d.id === audioInput.id) ++foundDevice;
                if (d.id === newAudioInput.id) ++foundAnotherDevice;
            }

            for (const d of meta.audioInputs()) {
                if (d.id === audioInput.id) ++foundDevice;
                if (d.id === newAudioInput.id) ++foundAnotherDevice;
            }
            expect(foundDevice).toBe(0);
            expect(foundAnotherDevice).toBe(2);
        });
    });
});