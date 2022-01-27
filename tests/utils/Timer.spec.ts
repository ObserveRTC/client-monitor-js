import { Timer } from "../../src/utils/Timer";

describe("Connect to a server", () => {
    it('Timer is constructed without error', () => {
        new Timer();
    });
    it('Timer invokes the added action', async () => {
        const timer = new Timer();
        await new Promise<void>(resolve => {
            timer.add({
                type: "collect",
                process: () => resolve(),
                fixedDelayInMs: 10,
            });
        });
        timer.clear();
    });
    it('Timer invokes the added actions having different timeout', async () => {
        const timer = new Timer();
        let process1: number = 0;
        let process2: number = 0;
        timer.add({
            type: "collect",
            process: () => ++process1,
            fixedDelayInMs: 250,
            context: "proc1",
        });
        timer.add({
            type: "collect",
            process: () => ++process2,
            fixedDelayInMs: 500,
            context: "proc2",
        });
        await new Promise(resolve => {
            setTimeout(resolve, 700);
        });
        timer.clear();
        expect(process1).toBe(2);
        expect(process2).toBe(1);
    });

    it('Timer is not invoked after it is cleared', async () => {
        const timer = new Timer();
        let invoked: number = 0;
        timer.add({
            type: "collect",
            process: () => ++invoked,
            fixedDelayInMs: 250,
        });
        await new Promise(resolve => {
            setTimeout(resolve, 350);
        });
        timer.clear();
        await new Promise(resolve => {
            setTimeout(resolve, 1050);
        });
        expect(invoked).toBe(1);
    });

    it('Timers invoked in typed order (collect, sample, send) and not in added order', async () => {
        const timer = new Timer();
        let invoked: number = 0;
        await new Promise<void>(resolve => {
            timer.add({
                type: "send",
                process: () => {
                    expect(++invoked).toBe(3);
                    resolve();
                },
                fixedDelayInMs: 100,
            });
            timer.add({
                type: "collect",
                process: () => {
                    expect(++invoked).toBe(1);
                },
                fixedDelayInMs: 100,
            });
            timer.add({
                type: "sample",
                process: () => {
                    expect(++invoked).toBe(2);
                },
                fixedDelayInMs: 100,
            });
        })
        timer.clear();
        expect(invoked).toBe(3);
    });
});
