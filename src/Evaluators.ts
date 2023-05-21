import { StatsReader, StatsWriter } from "./entries/StatsStorage";
import { createLogger } from "./utils/logger";

const logger = createLogger("Evaluators");

export type EvaluatorsConfig = {

};

export type EvaluatorContext = {
    collectingTimeInMs: number,
    storage: StatsReader,
};

export type EvaluatorProcess = (context: EvaluatorContext) => Promise<void>;

export class Evaluators {
    private _processes: EvaluatorProcess[] = [];
    
    public async use(context: EvaluatorContext): Promise<void> {
        for (const process of this._processes) {
            await process(context).catch(err => {
                logger.warn(`Error occurred while executing a process`, err);
            });
        }
    }

    public add(process: EvaluatorProcess): void {
        this._processes.push(process);
    }

    public remove(process: EvaluatorProcess): boolean {
        const index = this._processes.indexOf(process);
        if (index < 0) {
            return false;
        }
        this._processes.splice(index, 1);
        return true;
    }
}
