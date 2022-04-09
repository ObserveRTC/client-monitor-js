import { v4 as uuidv4 } from "uuid";
import { createLogger } from "./logger";

const logger = createLogger(`Timer`);

export type Action = {
    type: "collect" | "sample" | "send",
    process: () => void,
    fixedDelayInMs: number,
    maxInvoke?: number,
    context?: string,
}

abstract class ActionVisitor {
    visit(action: Action) {
        switch (action.type) {
            case "collect":
                this.visitCollectTypeAction(action);
                break;
            case "sample":
                this.visitSampleTypeAction(action);
                break;
            case "send":
                this.visitSendTypeAction(action);
                break;
        }
    }
    abstract visitCollectTypeAction(action: Action): void;
    abstract visitSampleTypeAction(action: Action): void;
    abstract visitSendTypeAction(action: Action): void;
}

type StoredAction = Action & {
    id: string,
    nextInvokeInMs: number,
    invoked: number,
}


export class Timer {
    private _timer?: ReturnType<typeof setTimeout>;
    private _collecting: Map<string, StoredAction> = new Map();
    private _sending: Map<string, StoredAction> = new Map();
    private _sampling: Map<string, StoredAction> = new Map();
    public add(action: Action): string {
        const id: string = uuidv4();
        const now = Date.now();
        const storedAction: StoredAction = {
            ...action,
            id,
            nextInvokeInMs: now + action.fixedDelayInMs,
            invoked: 0,
        }
        /*eslint-disable @typescript-eslint/no-this-alias */
        const timer = this;
        const visitor = new class extends ActionVisitor {
            /*eslint-disable @typescript-eslint/no-unused-vars*/
            visitCollectTypeAction(_action: Action): void {
                timer._collecting.set(id, storedAction);
            }
            /*eslint-disable @typescript-eslint/no-unused-vars*/
            visitSampleTypeAction(_action: Action): void {
                timer._sampling.set(id, storedAction);
            }
            /*eslint-disable @typescript-eslint/no-unused-vars*/
            visitSendTypeAction(_action: Action): void {
                timer._sending.set(id, storedAction);
            }
        };
        visitor.visit(storedAction);
        if (!this._timer) {
            this._timer = setTimeout(this._invoke.bind(this), 0);
        }
        return id;
    }

    public remove(id: string): void {
        let deleted = false;
        this._iterateInOrder(map => {
            deleted = deleted || map.delete(id);
        })
        if (!deleted) {
            logger.warn(`Cannot remove a not existing action`);
        }
    }

    public clear(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
        this._collecting.clear();
        this._sampling.clear();
        this._sending.clear();
    }

    public _invoke(): void {
        const now: number = Date.now();
        let next: number = now + 60000;
        let remainingActionsNum = 0;
        this._iterateInOrder(map => {
            const actions = Array.from(map.values());
            for (const action of actions) {
                let stretchInMs = 0;
                const remainingTimeInMs = action.nextInvokeInMs - now;
                if (10 < remainingTimeInMs) {
                    next = Math.min(next, action.nextInvokeInMs);
                    ++remainingActionsNum;
                    continue;
                } else if (0 < remainingTimeInMs) {
                    stretchInMs = remainingTimeInMs;
                }
                try {
                    action.process();
                /*eslint-disable @typescript-eslint/no-explicit-any*/
                } catch (err: any) {
                    logger.warn(`Error occurred while executing timer action (${action.context})`)
                }
                action.nextInvokeInMs = now + action.fixedDelayInMs + stretchInMs;
                next = Math.min(next, action.nextInvokeInMs);
                ++action.invoked;
                if (action.maxInvoke && action.maxInvoke <= action.invoked) {
                    map.delete(action.id);
                } else {
                    ++remainingActionsNum;
                }
            }
        })
        if (remainingActionsNum < 1) {
            this._timer = undefined;
            return;
        }
        const delayInMs = next - now;
        this._timer = setTimeout(this._invoke.bind(this), delayInMs);
    }

    private _iterateInOrder(consumer: (map: Map<string, StoredAction>) => void) {
        for (const map of [this._collecting, this._sampling, this._sending]) {
            consumer(map);
        }
    }
}