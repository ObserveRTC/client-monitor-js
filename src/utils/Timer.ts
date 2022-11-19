import { v4 as uuidv4 } from "uuid";
import { createLogger } from "./logger";

const logger = createLogger(`Timer`);

export type ActionType = "collect" | "sample" | "send";

export type Action = {
    type: ActionType;
    process?: () => void;
    asyncProcess?: () => Promise<void>;
    initialDelayInMs?: number;
    fixedDelayInMs: number;
    maxInvoke?: number;
    context?: string;
};

type StoredAction = Action & {
    id: string;
    created: number;
    invoked?: number;
    invocations: number;
};

export class Timer {
    private _timer?: ReturnType<typeof setTimeout>;
    private _collecting: Map<string, StoredAction> = new Map();
    private _sending: Map<string, StoredAction> = new Map();
    private _sampling: Map<string, StoredAction> = new Map();
    private _tickInMs: number;
    private _maxTimeoutInMs: number;
    
    public constructor(tickInMs?: number, maxTimeoutInMs?: number) {
        if (tickInMs === undefined) {
            this._tickInMs = 1000;
        } else if (0 < tickInMs) {
            this._tickInMs = tickInMs;
        } else {
            throw new Error(`Ticking time must be positive`);
        }
        this._maxTimeoutInMs = maxTimeoutInMs ?? 30000;
        
    }

    public add(action: Action): string {
        if (!action.process && !action.asyncProcess) {
            logger.warn(`Action has no process or asyncProcess to be invoked cannot be added to the timer`);
            return "Unknown";
        }
        const id: string = uuidv4();
        const now = Date.now();
        const storedAction: StoredAction = {
            ...action,
            id,
            created: now,
            invocations: 0,
        };
        this._getMap(storedAction.type).set(id, storedAction);
        /*eslint-disable @typescript-eslint/no-this-alias */
        if (!this._timer) {
            this._timer = setTimeout(this._invoke.bind(this), action.initialDelayInMs ?? 0);
        }
        return id;
    }

    public hasListener(type: ActionType) {
        return this._getMap(type).size;
    }

    private _getMap(type: ActionType): Map<string, StoredAction> {
        switch (type) {
            case "collect":
                return this._collecting;
            case "sample":
                return this._sampling;
            case "send":
                return this._sending;
        }
    }

    public remove(id: string): void {
        let deleted = false;
        for (const action of Array.from(this._iterable())) {
            if (action.id === id) {
                deleted = this._getMap(action.type).delete(id);
            }
        }
        if (!deleted) {
            logger.warn(`Cannot remove a not existing action`);
        }
    }

    public clear(actionType?: ActionType): void {
        if (!actionType) {
            this._collecting.clear();
            this._sampling.clear();
            this._sending.clear();
        } else {
            this._getMap(actionType).clear();
        }
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
    }

    public async _invoke(): Promise<void> {
        const now: number = Date.now();
        const storedActions = Array.from(this._iterable());
        for (const storedAction of storedActions) {
            if (storedAction.initialDelayInMs) {
                if (now <= storedAction.created + storedAction.initialDelayInMs) {
                    continue;
                }
            }
            if (storedAction.maxInvoke) {
                if (storedAction.maxInvoke <= storedAction.invocations) {
                    // let's remove it then
                    this._getMap(storedAction.type).delete(storedAction.id);
                    continue;
                }
            }
            if (storedAction.initialDelayInMs && now - storedAction.initialDelayInMs < storedAction.created) {
                continue;
            }
            let doInvoke = false;
            if (storedAction.invoked === undefined) {
                doInvoke = true;
            } else {
                doInvoke = storedAction.invoked + storedAction.fixedDelayInMs <= now;
            }
            if (!doInvoke) {
                continue;
            }
            try {
                if (storedAction.process) {
                    storedAction.process();
                } else if (storedAction.asyncProcess){
                    // if async process ever surfaced it has to have a timeout in order to preve
                    await storedAction.asyncProcess().catch(err => {
                        logger.warn(`Error occurred while invoking action for ${storedAction.type}. context: ${storedAction.context}`, err);
                    });
                }
                /*eslint-disable @typescript-eslint/no-explicit-any*/
            } catch (err: any) {
                logger.warn(`Error occurred while executing timer action (${storedAction.context})`);
            }
            storedAction.invoked = now;
            ++storedAction.invocations;
        }
        if (0 < storedActions.length) {
            this._timer = setTimeout(this._invoke.bind(this), this._tickInMs);
        }
    }

    private *_iterable(): IterableIterator<StoredAction> {
        for (const process of Array.from(this._collecting.values())) {
            yield process;
        }
        for (const process of Array.from(this._sampling.values())) {
            yield process;
        }
        for (const process of Array.from(this._sending.values())) {
            yield process;
        }
    }
}
