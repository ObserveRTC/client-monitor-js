/* eslint-disable @typescript-eslint/no-explicit-any */
import { IssueRegistry, IssueRegistrySink } from '../../src/utils/IssueRegistry';

type TrackIssues = {
	'dry-outbound-track': { trackId: string, duration?: number },
	'capture-bottleneck': { trackId: string },
};

/**
 * Stands in for `ClientMonitor`'s sink: the end of the chain, which emits and buffers rather than
 * storing anything. Every call it receives is recorded, because the whole point of the chain is
 * that a write on any registry arrives here exactly once.
 */
function createSink() {
	const calls: { op: string, issue: any }[] = [];
	const uplink: IssueRegistrySink = {
		notify: (issue) => { calls.push({ op: 'notify', issue }); },
		raise: (issue) => { calls.push({ op: 'raise', issue }); },
		update: (issue) => { calls.push({ op: 'update', issue }); },
		resolve: (issue) => { calls.push({ op: 'resolve', issue }); },
	};

	return { calls, uplink };
}

/**
 * A client registry with the sink behind it, and a per-monitor registry uplinked into that
 * through `asSink` — the same wiring the real monitors use.
 */
function createChain() {
	const sink = createSink();
	const client = new IssueRegistry(sink.uplink);
	const track = new IssueRegistry<TrackIssues>(client.asSink);

	return { sink, client, track };
}

/** Burns wall-clock time inside a hop, so a layer that re-stamps is visible rather than lucky. */
function stall(durationInMs: number) {
	const startedAt = Date.now();

	while (Date.now() - startedAt < durationInMs);
}

describe('IssueRegistry', () => {
	describe('the chain', () => {
		it('holds a raise at every layer and reports it once at the sink', () => {
			const { sink, client, track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });

			expect(track.has('k1')).toBe(true);
			expect(client.has('k1')).toBe(true);
			expect(sink.calls.filter((c) => c.op === 'raise')).toHaveLength(1);
		});

		/**
		 * Each layer would otherwise stamp its own `Date.now()`, so the same issue would carry a
		 * different `raisedAt` on the track than on the client — and the `-resolved` sample entry
		 * joins on exactly that field.
		 */
		it('agrees on raisedAt across layers, even when the hop is slow', () => {
			const sink = createSink();
			const client = new IssueRegistry(sink.uplink);
			// `asSink` maps `raisedAt` onto the input bag's `timestamp`. Without that the upper
			// layer calls `Date.now()` again, and a hop long enough to cross a millisecond makes
			// the two copies disagree — which a fast test would never notice.
			const track = new IssueRegistry<TrackIssues>({
				...client.asSink,
				raise: (issue) => { stall(5); client.asSink.raise(issue); },
			});

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });

			expect(client.get('k1')?.raisedAt).toBe(track.get('k1')?.raisedAt);
		});

		it('agrees on updatedAt across layers', () => {
			const { client, track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			track.update({ key: 'k1', payload: { trackId: 't', duration: 1 }, timestamp: 999_000 });

			expect(track.get('k1')?.updatedAt).toBe(999_000);
			expect(client.get('k1')?.updatedAt).toBe(999_000);
		});

		it('treats a second raise on an open key as no raise at all', () => {
			const { sink, track } = createChain();

			expect(track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } })).toBe(true);
			expect(track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } })).toBe(false);
			expect(sink.calls.filter((c) => c.op === 'raise')).toHaveLength(1);
		});
	});

	describe('resolving', () => {
		/**
		 * The regression this file exists for. `resolve()` used to drop its entry before handing
		 * over only a key, so a sink that looked that key up found nothing and silently returned:
		 * no `issue-resolved` event, no `-resolved` sample entry, and `durationInMs` never
		 * reaching the server. The whole resolved issue is handed over now, so the sink needs
		 * nowhere to look.
		 */
		it('hands the whole resolved issue to the sink', () => {
			const { sink, track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			const resolved = track.resolve({ key: 'k1', comment: 'recovered' });

			const delivered = sink.calls.find((c) => c.op === 'resolve')?.issue;

			expect(delivered?.key).toBe('k1');
			expect(delivered?.type).toBe('dry-outbound-track');
			expect(delivered?.raisedAt).toBeDefined();
			expect(delivered?.resolvedAt).toBeDefined();
			expect(delivered?.comment).toBe('recovered');
			expect(resolved).toEqual(delivered);
		});

		/**
		 * Every layer has already dropped the key by the time the sink runs, so a handler that
		 * resolves again during `issue-resolved` finds nothing instead of recursing. Delete-then-
		 * forward is what makes that true; forward-then-delete emitted the same resolution once
		 * per re-entry, until the stack ran out.
		 */
		it('is closed everywhere before the sink is told, so re-entry finds nothing', () => {
			const sink = createSink();
			let depth = 0;
			// The sink closes over `registry`, which is safe because nothing calls it until the
			// constructor has returned and the binding is initialised.
			const registry: IssueRegistry<TrackIssues> = new IssueRegistry<TrackIssues>({
				...sink.uplink,
				resolve: (issue) => {
					sink.uplink.resolve(issue);
					expect(registry.has('k1')).toBe(false);

					if (++depth < 5) registry.resolve({ key: 'k1' });
				},
			});

			registry.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			registry.resolve({ key: 'k1' });

			expect(depth).toBe(1);
			expect(sink.calls.filter((c) => c.op === 'resolve')).toHaveLength(1);
		});

		it('clears the key from every layer, so the same fault can be reported again', () => {
			const { client, track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			track.resolve({ key: 'k1' });

			expect(track.has('k1')).toBe(false);
			expect(client.has('k1')).toBe(false);
			expect(track.hasType('dry-outbound-track')).toBe(false);
			expect(track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } })).toBe(true);
		});

		/**
		 * The rule the design rests on, written down as a test. Resolving on the client leaves the
		 * track's copy standing, and because a raise on an open key is ignored, that track can
		 * never report the fault again. Nothing throws — which is exactly why it is pinned here.
		 */
		it('leaves the monitor stranded when the resolution is sent to the wrong layer', () => {
			const { client, track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			client.resolve({ key: 'k1' });

			expect(client.has('k1')).toBe(false);
			expect(track.has('k1')).toBe(true);
			expect(track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } })).toBe(false);
		});

		it('prefers the resolution payload, falling back to the raise', () => {
			const { track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });

			expect(track.resolve({ key: 'k1', payload: { trackId: 't', duration: 900 } })?.payload)
				.toEqual({ trackId: 't', duration: 900 });

			track.raise({ key: 'k2', type: 'dry-outbound-track', payload: { trackId: 'u' } });

			expect(track.resolve({ key: 'k2' })?.payload).toEqual({ trackId: 'u' });
		});

		it('returns undefined for a key it never held', () => {
			const { track } = createChain();

			expect(track.resolve({ key: 'nope' })).toBeUndefined();
		});
	});

	describe('updating', () => {
		/** An update with no payload is a touch; overwriting would discard what the raise set. */
		it('keeps the existing payload when none is given', () => {
			const { track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			track.update({ key: 'k1' });

			expect(track.get('k1')?.payload).toEqual({ trackId: 't' });
		});

		it('replaces the payload when one is given', () => {
			const { client, track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' } });
			track.update({ key: 'k1', payload: { trackId: 't', duration: 12 } });

			expect(track.get('k1')?.payload).toEqual({ trackId: 't', duration: 12 });
			expect(client.get('k1')?.payload).toEqual({ trackId: 't', duration: 12 });
		});

		/** A re-raise may change its mind about sampling, and the resolution buffered later reads it. */
		it('can flip includeInSample', () => {
			const { track } = createChain();

			track.raise({ key: 'k1', type: 'dry-outbound-track', payload: { trackId: 't' }, includeInSample: true });
			track.update({ key: 'k1', includeInSample: false });

			expect(track.get('k1')?.includeInSample).toBe(false);
		});

		it('does nothing for a key it never held', () => {
			const { track } = createChain();

			expect(track.update({ key: 'nope' })).toBe(false);
		});
	});

	describe('indexing by type', () => {
		it('finds open issues by type and forgets the type once the last one closes', () => {
			const { track } = createChain();

			track.raise({ key: 'a', type: 'dry-outbound-track', payload: { trackId: 't1' } });
			track.raise({ key: 'b', type: 'dry-outbound-track', payload: { trackId: 't2' } });
			track.raise({ key: 'c', type: 'capture-bottleneck', payload: { trackId: 't1' } });

			expect(track.getByType('dry-outbound-track')?.size).toBe(2);
			expect(track.size).toBe(3);

			track.resolve({ key: 'a' });
			track.resolve({ key: 'b' });

			expect(track.hasType('dry-outbound-track')).toBe(false);
			expect(track.getByType('dry-outbound-track')).toBeUndefined();
			expect(track.hasType('capture-bottleneck')).toBe(true);
		});
	});

	describe('one-shot issues', () => {
		/** Nothing to resolve, so nothing is stored — but it still leaves by the same door. */
		it('forwards to the sink without becoming an active issue', () => {
			const { sink, client, track } = createChain();

			track.notify({ type: 'capture-bottleneck', payload: { trackId: 't' } });

			expect(track.size).toBe(0);
			expect(client.size).toBe(0);
			expect(sink.calls.filter((c) => c.op === 'notify')).toHaveLength(1);
		});

		/** The sink reads this field and nothing else, so dropping it overrules the detector. */
		it('carries the sampling choice, which the sink has no other way to learn', () => {
			const { sink, track } = createChain();

			track.notify({ type: 'capture-bottleneck', payload: { trackId: 't' }, includeInSample: false });

			expect(sink.calls.find((c) => c.op === 'notify')?.issue.includeInSample).toBe(false);
		});
	});
});
