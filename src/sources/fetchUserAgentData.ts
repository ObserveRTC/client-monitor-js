import * as UAParser from "ua-parser-js";
import { Logger } from "../utils/logger";

const MODULE_NAME = 'FetchNavigatorData';

export function fetchUserAgentData(baseLogger: Logger): ReturnType<typeof UAParser.UAParser.prototype.getResult> | undefined {
	try {
		let outerNavigator: typeof navigator | undefined = undefined;
		if (navigator !== undefined) outerNavigator = navigator;
		else if (window !== undefined && window.navigator !== undefined) outerNavigator = window.navigator;
		else return baseLogger.error(`[${MODULE_NAME}]:`, 'Cannot integrate navigator.mediaDevices, because navigator is not available');

		const parser = new UAParser.UAParser(outerNavigator.userAgent);
		return parser.getResult();

	} catch (err) {
		baseLogger.warn(`[${MODULE_NAME}]:`, 'Cannot collect Navigator data', err);
	}
}