import { StatsStorage } from "./entries/StatsStorage";
import { createLogger } from "./utils/logger";

const logger = createLogger("StatsEvaluators");

export type EvaluatorContext = {
    collectingTimeInMs: number,
    storage: StatsStorage,
};

export type StatsEvaluatorProcess = (context: EvaluatorContext) => Promise<void>;
export type StatsEvaluators = ReturnType<typeof createStatsEvaluators>;

export function createStatsEvaluators() {
    const processes: StatsEvaluatorProcess[] = [];
    async function use(context: EvaluatorContext): Promise<void> {
        for (const process of processes) {
            await process(context).catch(err => {
                logger.warn(`Error occurred while executing a process`, err);
            });
        }
    }

    function add(process: StatsEvaluatorProcess): void {
        processes.push(process);
    }

    function remove(process: StatsEvaluatorProcess): boolean {
        const index = processes.indexOf(process);
        if (index < 0) {
            return false;
        }
        processes.splice(index, 1);
        return true;
    }

    return {
        use,
        add,
        remove,
    }
}
