import { AddedClientIssue, ClientIssuePayload, RaisedClientIssue, ResolvedClientIssue } from "../ClientMonitorEvents";

export interface IssueRegistrySink<T extends IssueRegistryAcceptedTypes = IssueRegistryAcceptedTypes> {
	raise<K extends string & keyof T>(issue: RaisedClientIssue<T[K]>): void,
	update<K extends keyof T>(issue: RaisedClientIssue<T[K]>): void,
	resolve<K extends string & keyof T>(issue: ResolvedClientIssue<T[K]>): void,
	/**
	 * A one-shot issue: reported once, never resolved, and so never stored by any registry. It
	 * still travels this path so that everything a monitor reports leaves by the same door.
	 *
	 * Typed to the branch `notify()` actually builds rather than to the whole `ClientIssue` union,
	 * so the stamp is reachable without narrowing.
	 */
	notify<K extends string & keyof T>(issue: OneShotClientIssue<T[K]>): void,
}

type IssueRegistryAcceptedTypes = {
	[key: string]: ClientIssuePayload,
}

/** The non-resolvable half of `ClientIssue`: what a one-shot report is. */
type OneShotClientIssue<T extends ClientIssuePayload = ClientIssuePayload> =
	AddedClientIssue<T> & { resolvable: false };

/**
 * The active issues of one monitored object, and the link that carries them to the client.
 *
 * Each monitor that owns detectors owns one of these, typed to the issues its own detectors can
 * raise, so `raise()` will not compile with a type that monitor cannot produce. Its uplink is the
 * client monitor's registry, which is the terminal: that one forwards to the sink that emits the
 * events and buffers entries into the `ClientSample`. An issue therefore exists twice — once on
 * the monitor it belongs to, once on the client — so an application can ask either "is this track
 * in trouble" or "is anything in trouble" without walking the object graph.
 *
 * **Raise, update and resolve an issue on the same registry.** Writes only travel up, so a
 * resolution sent straight to the client's registry clears the client's copy and leaves the
 * monitor's behind: that monitor then reports the fault forever and — because `raise()` ignores a
 * key that is already active — can never report it again. Nothing throws when this is got wrong,
 * so the rule is kept by pointing each detector at its own monitor's registry and nowhere else.
 */
export class IssueRegistry<T extends IssueRegistryAcceptedTypes = IssueRegistryAcceptedTypes> {
	private readonly activeIssueTypes = new Map<keyof T, Set<RaisedClientIssue>>();
	private readonly activeIssues = new Map<string, RaisedClientIssue>();

	public constructor(
		private readonly _uplink: IssueRegistrySink<T>,
	) {
	}

	public get(key: string): RaisedClientIssue | undefined {
		return this.activeIssues.get(key);
	}

	public getByType<K extends string & keyof T>(type: K): Set<RaisedClientIssue<T[K]>> | undefined {
		return this.activeIssueTypes.get(type) as Set<RaisedClientIssue<T[K]>> | undefined;
	}

	public getFirstPayloadByType<K extends string & keyof T>(type: K): T[K] | undefined {
		const set = this.activeIssueTypes.get(type) as Set<RaisedClientIssue<T[K]>> | undefined;

		if (!set) {
			return undefined;
		}

		return set.values().next().value?.payload;
	}

	public keys(): IterableIterator<string> {
		return this.activeIssues.keys();
	}

	public get size(): number {
		return this.activeIssues.size;
	}

	public has(key: string): boolean {
		return this.activeIssues.has(key);
	}

	public hasType<K extends keyof T>(key: K): boolean {
		return (this.activeIssueTypes.get(key)?.size ?? 0) > 0;
	}

	public raise<K extends string & keyof T>(input: {
		key: string,
		type: K,
		payload?: T[K],
		timestamp?: number,
		/**
		 * Whether this issue (and its later resolution) is buffered into the
		 * ClientSample. Defaults to true; the built-in detectors pass their
		 * `includeIssueInSample` field here.
		 */
		includeInSample?: boolean,
	}): boolean {
		const now = input.timestamp ?? Date.now();

		// An open issue is the episode, so a second raise on the same key is not a new one.
		if (this.activeIssues.has(input.key)) {
			return false;
		}

		const issue: RaisedClientIssue<T[K]> = {
			type: input.type,
			key: input.key,
			payload: input.payload,
			raisedAt: now,
			updatedAt: now,
			includeInSample: input.includeInSample ?? true,
		};

		this.activeIssues.set(issue.key, issue);
		this.activeIssueTypes.set(
			issue.type, (
				this.activeIssueTypes.get(issue.type) ?? new Set<RaisedClientIssue>()
			).add(issue)
		);

		this._uplink.raise(issue);

		return true;
	}

	public update<K extends keyof T>(input: {
		key: string,
		payload?: Partial<T[K]>,
		timestamp?: number,
		/** Re-raising an open issue may flip this, which decides whether its resolution is buffered. */
		includeInSample?: boolean,
	}): boolean {
		const existing = this.activeIssues.get(input.key) as RaisedClientIssue<T[K]> | undefined;

		if (!existing) {
			return false;
		}

		// Only when one was given: an update carrying no payload is a touch, and overwriting with
		// `undefined` would throw away everything the raise established.
		if (input.payload !== undefined) {
			existing.payload = {
				...(existing.payload ?? {} as T[K]),
				...input.payload,
			};
		}

		// A re-raise is allowed to change its mind about sampling, and the resolution buffered
		// later reads this field — so a flip here is what silences the whole episode downstream.
		if (input.includeInSample !== undefined) {
			existing.includeInSample = input.includeInSample;
		}

		existing.updatedAt = input.timestamp ?? Date.now();

		this._uplink.update(existing);

		return true;
	}

	public resolve<K extends string & keyof T>(input: {
		key: string
		comment?: string,
		payload?: Partial<T[K]>,
		resolvedAt?: number,
	}): ResolvedClientIssue<T[K]> | undefined {
		const existing = this.activeIssues.get(input.key) as RaisedClientIssue<T[K]> | undefined;

		if (!existing) {
			return undefined;
		}

		const indexed = this.activeIssueTypes.get(existing.type);
		const resolved: ResolvedClientIssue<T[K]> = {
			...existing,
			payload: {
				...(existing.payload ?? {} as T[K]),
				...input.payload,
			},
			resolvedAt: input.resolvedAt ?? Date.now(),
			comment: input.comment,
		};

		this.activeIssues.delete(input.key);

		if (indexed) {
			indexed.delete(existing);

			if (indexed.size <= 0) {
				this.activeIssueTypes.delete(existing.type);
			}
		}

		this._uplink.resolve(resolved);

		return resolved;
	}

	public resolveAll(comment: string): number {
		const keys = [ ...this.activeIssues.keys() ];

		for (const key of keys) this.resolve({ key, comment });

		return keys.length;
	}

	public notify<K extends string & keyof T>(input: {
		type: K,
		payload?: T[K],
		timestamp?: number,
		includeInSample?: boolean,
	}) {
		const issue: OneShotClientIssue<T[K]> = {
			type: input.type,
			payload: input.payload,
			timestamp: input.timestamp ?? Date.now(),
			// Carried rather than dropped: without it a detector asking to stay out of the sample
			// is silently overruled, because the sink reads this field and nothing else.
			includeInSample: input.includeInSample,
			resolvable: false,
		};

		return this._uplink.notify(issue);
	}

	/**
	 * This registry seen as a child's uplink.
	 *
	 * The stamp mapping is load-bearing, not cosmetic: a sink is handed a whole issue, which
	 * carries its time on `raisedAt` / `updatedAt`, while the registry's own methods take an input
	 * bag whose time is `timestamp`. Passing the issue straight through leaves `timestamp`
	 * undefined, so this layer calls `Date.now()` again and the two copies of one issue end up
	 * disagreeing about when it was raised — the field the `-resolved` sample entry joins on.
	 */
	public readonly asSink: IssueRegistrySink<T> = {
		raise: (issue) => this.raise({ ...issue, timestamp: issue.raisedAt }),
		update: (issue) => this.update({ ...issue, timestamp: issue.updatedAt }),
		resolve: (issue) => this.resolve(issue),
		notify: (issue) => this.notify(issue),
	};
}
