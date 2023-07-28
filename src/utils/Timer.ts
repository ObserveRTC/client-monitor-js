import { createLogger } from "./logger";

const logger = createLogger(`Timer`);

type Action = {
    action: () => Promise<void>;
    created: number;
    fixedDelayInMs: number;
    invoked?: number;
};

export type Timer = ReturnType<typeof createTimer>;

export function createTimer(tickTimeInMs?: number) {
    let timer: ReturnType<typeof setInterval> | undefined;
    let collecting: Action | undefined;
    let sampling: Action | undefined;
    if (tickTimeInMs) {
        setTickingTime(tickTimeInMs);
    }

    function setTickingTime(tickInMs?: number): void {
        if (timer) {
            clearInterval(timer);
            timer = undefined;
        }
        if (!tickInMs) {
            return;
        }
        timer = setInterval(() => {
            if (!collecting && !sampling) {
                return;
            }
            const now = Date.now();
            let promise = Promise.resolve();
            if (collecting) {
                if (collecting.invoked) {
                    if (collecting.invoked + collecting.fixedDelayInMs <= now) {
                        promise = promise.then(() => collecting?.action() ?? Promise.resolve());
                        collecting.invoked = now;
                    }
                } else {
                    promise = promise.then(() => collecting?.action() ?? Promise.resolve());
                    collecting.invoked = now;
                }
            }
            if (sampling) {
                if (sampling.invoked) {
                    if (sampling.invoked + sampling.fixedDelayInMs <= now) {
                        promise = promise.then(() => sampling?.action() ?? Promise.resolve());
                        sampling.invoked = now;
                    }
                } else {
                    promise = promise.then(() => sampling?.action() ?? Promise.resolve());
                    sampling.invoked = now;
                }
            }
            promise.catch(err => {
                logger.warn(`Error occurred while executing timer action`, err);
            });
        }, tickInMs);
    }

    function setCollectingAction(config: { action?: () => Promise<void>, fixedDelayInMs?: number }): void {
        const {
            action,
            fixedDelayInMs,
        } = config;
        if (!action || !fixedDelayInMs) {
            collecting = undefined;
            return;
        }
        collecting = {
            action,
            created: Date.now(),
            fixedDelayInMs,
        };
    }

    function setSamplingAction(config: { action?: () => Promise<void>, fixedDelayInMs?: number }): void {
        const {
            action,
            fixedDelayInMs,
        } = config;
        if (!action || !fixedDelayInMs) {
            sampling = undefined;
            return;
        }
        sampling = {
            action,
            created: Date.now(),
            fixedDelayInMs,
        };
    }

    function clear() {
        if (timer) {
            clearInterval(timer);
            timer = undefined;
        }
        collecting = undefined;
        sampling = undefined;
    }

    return {
        get active() {
            return !!timer;
        },
        set tickTimeInMs(value: number | undefined) {
            setTickingTime(value);
        },
        setCollectingAction,
        setSamplingAction,
        clear,
    }
}
