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

    it('When async process is added Then it is invoked', async () => {
        const timer = new Timer();
        await new Promise<void>(resolve => {
            timer.add({
                type: "collect",
                asyncProcess: async () => resolve(),
                fixedDelayInMs: 10,
            });
        });
        timer.clear();
    });

    it('When two async process is added They are invoked sequentially', async () => {
        const timer = new Timer();
        await new Promise<void>(resolve => {
            let run = false;
            let finished = 0;
            timer.add({
                type: "collect",
                asyncProcess: async () => {
                    if (run) throw new Error(`Test failed, because of parallel async execution of the invoked function in the timer`);
                    run = true;
                    await new Promise<void>(_resolve => {
                        setTimeout(() => {
                            run = false;
                            _resolve();
                            if (1 < ++finished) {
                                resolve();
                            }
                            
                        }, 100);
                    });
                },
                fixedDelayInMs: 10,
            });
            timer.add({
                type: "collect",
                asyncProcess: async () => {
                    if (run) throw new Error(`Test failed, because of parallel async execution of the invoked function in the timer`);
                    run = true;
                    await new Promise<void>(_resolve => {
                        setTimeout(() => {
                            run = false;
                            _resolve();
                            if (1 < ++finished) {
                                resolve();
                            }
                            
                        }, 100);
                    });
                },
                fixedDelayInMs: 10,
            });
        });
        timer.clear();
    });
    it('When two process are added Then both are invoked', async () => {
        const timer = new Timer(100);
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
        expect(process1).toBe(3);
        expect(process2).toBe(2);
    });

    it('When Timer is cleared Then it does invoke processes', async () => {
        const timer = new Timer(100);
        let invoked: number = 0;
        timer.add({
            type: "collect",
            process: () => ++invoked,
            fixedDelayInMs: 500,
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

    it('When Timer is cleared and initial delay is added Then it does invoke processes after the initial delay', async () => {
        const timer = new Timer(100);
        let invoked: number = 0;
        timer.add({
            type: "collect",
            process: () => ++invoked,
            fixedDelayInMs: 500,
            initialDelayInMs: 500
        });
        await new Promise(resolve => {
            setTimeout(resolve, 250);
        });
        expect(invoked).toBe(0);
        await new Promise(resolve => {
            setTimeout(resolve, 500);
        });
        timer.clear();
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
