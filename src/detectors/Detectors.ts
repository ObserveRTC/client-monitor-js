import { createLogger } from "../utils/logger";
import { Detector } from "./Detector";

const logger = createLogger("Detectors");

export class Detectors {
	private _detectors: Detector[];

	public constructor(...detectors: Detector[]) {
		this._detectors = detectors;
	}

	public addDetector(detector: Detector) {
		this._detectors.push(detector);
	}

	public removeDetector(detector: Detector) {
		this._detectors = this._detectors.filter((d) => d !== detector);
	}

	public update() {
		for (const detector of this._detectors) {
			try {
				detector.update();
			} catch (err) {
				logger.warn(`Error updating detector ${detector?.constructor?.name}`, err);
			}
		}
	}

	public clear() {
		this._detectors = [];
	}
}