import { createLogger } from "../utils/logger";
import { Detector } from "./Detector";

const MODULE_NAME = 'Detectors';

export class Detectors {
	private _detectors: Detector[];
	private readonly logger;

	public constructor(...detectors: Detector[]) {
		this.logger = createLogger();
		this._detectors = detectors;
	}

	public add(detector: Detector) {
		this._detectors.push(detector);
	}

	public remove(detector: Detector) {
		this._detectors = this._detectors.filter((d) => d !== detector);
	}

	get listOfNames() {
		return this._detectors.map((d) => d.name);
	}

	public update() {
		for (const detector of this._detectors) {
			try {
				detector.update();
			} catch (err) {
				this.logger.warn(`[${MODULE_NAME}]:`, `Error updating detector ${detector?.constructor?.name}`, err);
			}
		}
	}

	public clear() {
		this._detectors = [];
	}
}