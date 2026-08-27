import { ClientMonitor } from "../ClientMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Logger } from "../utils/logger";

const MODULE_NAME = 'WatchTabVisibility';

/**
 * Keeps `ClientMonitor.activeTab` in sync with `document.visibilityState`.
 *
 * Browsers throttle background tabs — timers fire late, rendering stops,
 * decoding may slow down — which corrupts the signals several detectors rely
 * on (CPU limitation, decoder performance, stuck decoder, playout
 * discrepancy, video freezes). Those detectors read `monitor.activeTab` and
 * stand down while the tab is hidden.
 *
 * Every transition is also emitted as a `TAB_VISIBILITY_CHANGED` client
 * event, so the sample stream shows exactly when the tab went to the
 * background and came back.
 *
 * When no usable `document` exists (SSR, unit tests, workers, react-native),
 * the watcher logs and leaves `activeTab` at its default `true` — a missing
 * watcher must never look like a hidden tab.
 */
export function watchTabVisibility(monitor: ClientMonitor, baseLogger: Logger) {
	let outerDocument: Document | undefined = undefined;

	try {
		if (typeof document !== 'undefined') outerDocument = document;
		else if (typeof window !== 'undefined' && window.document !== undefined) outerDocument = window.document;
	} catch {
		// document/window access can throw in exotic sandboxes; treated as absent
	}

	if (
		!outerDocument ||
		outerDocument.visibilityState === undefined ||
		typeof outerDocument.addEventListener !== 'function'
	) {
		return baseLogger.warn(
			`[${MODULE_NAME}]:`,
			'Cannot watch tab visibility, document.visibilityState is not available; ClientMonitor.activeTab stays true'
		);
	}

	const watchedDocument = outerDocument;
	const onVisibilityChange = () => {
		const visible = watchedDocument.visibilityState === 'visible';

		if (monitor.activeTab === visible) return;
		monitor.activeTab = visible;

		monitor.addEvent({
			type: ClientEventTypes.TAB_VISIBILITY_CHANGED,
			payload: monitor.clientEventPayloadProvider.createPayload(
				ClientEventTypes.TAB_VISIBILITY_CHANGED,
				{ visible },
			),
		});
	};

	monitor.once('close', () => watchedDocument.removeEventListener('visibilitychange', onVisibilityChange));
	watchedDocument.addEventListener('visibilitychange', onVisibilityChange);

	// pick up the initial state — the monitor may well be created in a
	// background tab (e.g. a rejoin after a refresh while the user is elsewhere)
	onVisibilityChange();
}
