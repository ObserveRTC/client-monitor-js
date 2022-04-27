import { MediaDevice } from "@observertc/monitor-schemas";
import { MediaDevices } from "../../src/utils/MediaDevices";

describe(`MediaDevices`, () => {
    const devices = new MediaDevices();
    const device: MediaDevice = {
        id: "deviceId_0",
        kind: "audioinput",
    };
    const anotherDevice: MediaDevice = {
        id: "deviceId_1",
        kind: "audioinput",
    };
    describe(`When mediadevice is added through update`, () => {
        it(`Then it can be retrieved`, () => {
            devices.update(device);
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
    describe(`When mediadevice is removed by update`, () => {
        it(`Then it cannot be retrieved`, () => {
            devices.update(device);
            devices.update(anotherDevice);
            let foundDevice = 0;
            let foundAnotherDevice = 0;

            for (const d of devices.values()) {
                if (d.id === device.id) ++foundDevice;
                if (d.id === anotherDevice.id) ++foundAnotherDevice;
            }

            for (const d of devices.values(device.kind!)) {
                if (d.id === device.id) ++foundDevice;
                if (d.id === anotherDevice.id) ++foundAnotherDevice;
            }
            expect(foundDevice).toBe(0);
            expect(foundAnotherDevice).toBe(2);
        });
    });
});