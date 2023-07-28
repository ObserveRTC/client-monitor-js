import { createTimer } from "../../src/utils/Timer";

describe("Timer", () => {
    it('When it is constructed Then no error', () => {
        const timer = createTimer();
        expect(timer.active).toBe(false);
    });
    it('When process is added Then process is invoked', async () => {
        const timer = createTimer(100);
        await new Promise<void>(resolve => {
            timer.setCollectingAction({
                action: async () => resolve(),
                fixedDelayInMs: 10,
            })
        });
        timer.clear();
        expect(timer.active).toBe(false);
    });

    it('When async process is added Then it is invoked', async () => {
        const timer = createTimer(100);
        await new Promise<void>(resolve => {
            timer.setCollectingAction({
                action: async () => resolve(),
                fixedDelayInMs: 10,
            })
        });
        timer.clear();
        expect(timer.active).toBe(false);
    });

    it('When two async process is added They are invoked sequentially', async () => {
        const timer = createTimer(100);
        await new Promise<void>(resolve => {
            let run = false;
            let finished = 0;
            timer.setCollectingAction({
                action: async () => {
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
            timer.setSamplingAction({
                action: async () => {
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
            })
        });
        timer.clear();
        expect(timer.active).toBe(false);
    });

    it('When Timer is cleared Then it does invoke processes', async () => {
        const timer = createTimer();
        timer.tickTimeInMs = 100;
        let invoked = 0;
        timer.setCollectingAction({
            action: async () => {
                ++invoked
            },
            fixedDelayInMs: 300,
        });
        await new Promise(resolve => {
            setTimeout(resolve, 400);
        });
        timer.tickTimeInMs = 0;
        await new Promise(resolve => {
            setTimeout(resolve, 1050);
        });
        expect(invoked).toBe(1);
    });
});
