import { Timer } from "../../src/utils/Timer";

describe("Timer", () => {
    it('When it is constructed Then no error', () => {
        new Timer();
    });
    it('When process is added Then process is invoked', async () => {
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
    it('When two process are added Then both are invoked', async () => {
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

    it('When Timer is cleared Then it does not invoke processes', async () => {
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

    it('When different type of processes (collect, sample, send) are added Then they are called strictly in typed order (collect, sample, send)', async () => {
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
