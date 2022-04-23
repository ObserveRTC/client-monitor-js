import { MediaDevice } from "@observertc/monitor-schemas";
import { MediaDevices } from "../../src/utils/MediaDevices";

describe(`MediaDevices`, () => {
    const devices = new MediaDevices();
    const device: MediaDevice = {
        id: "deviceId_0",
        kind: "audioinput",
    };
    describe(`When mediadevice is added`, () => {
        it(`Then it can be retrieved`, () => {
            devices.add(device);
            let invoked = 0;

            for (const d of devices.values()) {
                expect(d.id).toBe(device.id);
                ++invoked;
            }

            for (const d of devices.values(device.kind!)) {
                expect(d.id).toBe(device.id);
                ++invoked;
            }
            expect(invoked).toBe(2);
        });
    });
    describe(`When mediadevice is removed`, () => {
        it(`Then it cannot be retrieved`, () => {
            devices.remove(device.id!);
            let invoked = 0;

            for (const d of devices.values()) {
                ++invoked;
            }

            for (const d of devices.values(device.kind!)) {
                ++invoked;
            }
            expect(invoked).toBe(0);
        });
    });
});