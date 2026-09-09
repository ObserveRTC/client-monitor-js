/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { isClientMonitorIssue, isClientMonitorResolvedIssue } from "../src/ClientMonitorIssues";

/**
 * `isClientMonitorIssue` is what lets an application narrow an issue off the `'issue'` event to a
 * typed payload. It is a hand-written switch listing every built-in issue type, sitting beside a
 * hand-written union listing the same set — two lists that have to agree and nothing but this
 * keeping them together.
 *
 * That shape has already gone wrong once in this library: the union carried `blocked-transport`
 * and `capture-bottleneck`, which no detector raises, while `blocked-stun-requests` and
 * `video-capture-bottleneck`, which are raised, were missing from it — and the same stale name in
 * the scoring table meant one issue silently cost nothing. These tests read all three lists off
 * the sources so the next drift fails here instead.
 */
const SRC = path.join(__dirname, '..', 'src');

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** The `type` literals of the `ClientMonitorIssue` union — the types an application can narrow to. */
function unionTypes(): Set<string> {
	return new Set(
		[ ...read('ClientMonitorIssues.ts').matchAll(/&\s*\{\s*type:\s*'([a-z][a-z-]+)'\s*\}/g) ]
			.map((m) => m[1]),
	);
}

/** The `case` labels of the guard's switch. */
function guardTypes(): Set<string> {
	const body = read('ClientMonitorIssues.ts').split('export function isClientMonitorIssue')[1];

	return new Set([ ...body.matchAll(/case '([a-z][a-z-]+)':/g) ].map((m) => m[1]));
}

/** Every issue type a detector can actually raise, read off the detector sources. */
function raisedTypes(): Set<string> {
	const dir = path.join(SRC, 'detectors');
	const types = new Set<string>();

	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith('Detector.ts')) continue;
		const source = fs.readFileSync(path.join(dir, file), 'utf8');
		const m = /ISSUE_TYPE(?:\s*:\s*[A-Za-z]+)?\s*=\s*'([a-z][a-z-]+)'/.exec(source)
			?? /^const ISSUE_TYPE = '([a-z][a-z-]+)'/m.exec(source);

		if (m) types.add(m[1]);
	}

	return types;
}

describe('the built-in issue type lists agree', () => {
	it('every type a detector raises is a member of the ClientMonitorIssue union', () => {
		// A raised type missing from the union cannot be narrowed by an application at all: the
		// switch an application writes over `issue.type` will not accept the case.
		expect([ ...raisedTypes() ].filter((t) => !unionTypes().has(t))).toEqual([]);
	});

	it('the union declares no type that no detector raises', () => {
		// A union member nothing raises is a case an application writes and never reaches.
		expect([ ...unionTypes() ].filter((t) => !raisedTypes().has(t))).toEqual([]);
	});

	it('the guard recognises exactly the union', () => {
		expect([ ...unionTypes() ].sort()).toEqual([ ...guardTypes() ].sort());
	});

	it('reads a plausible number of them, so a broken parse cannot pass the tests above', () => {
		expect(unionTypes().size).toBeGreaterThan(30);
		expect(raisedTypes().size).toBeGreaterThan(30);
	});
});

describe('isClientMonitorIssue', () => {
	it('accepts every built-in issue type', () => {
		for (const type of unionTypes()) {
			expect(isClientMonitorIssue({ type })).toBe(true);
		}
	});

	it('rejects a type an application invented', () => {
		expect(isClientMonitorIssue({ type: 'signalling-unreachable' })).toBe(false);
		expect(isClientMonitorIssue({ type: 'user-reported-bad-audio' })).toBe(false);
	});

	it('rejects a retired type rather than resolving it to its replacement', () => {
		// These were real issue types in 4.8.0. An application still matching on one should get
		// `false` and find out, rather than be silently aliased onto the type that replaced it.
		for (const retired of [
			'blocked-transport', 'capture-bottleneck', 'frozen-video-track',
			'keyframe-storm', 'video-choppy', 'capture-track-ended',
			'media-pipeline-stalled', 'audio-concealment', 'audio-desync',
		]) {
			expect(isClientMonitorIssue({ type: retired })).toBe(false);
		}
	});

	it('rejects an empty or nonsense type without throwing', () => {
		expect(isClientMonitorIssue({ type: '' })).toBe(false);
		expect(isClientMonitorIssue({ type: 'constructor' })).toBe(false);
		expect(isClientMonitorIssue({ type: '__proto__' })).toBe(false);
	});

	it('narrows the resolved counterpart on the same set', () => {
		for (const type of unionTypes()) {
			expect(isClientMonitorResolvedIssue({ type })).toBe(true);
		}
		expect(isClientMonitorResolvedIssue({ type: 'signalling-unreachable' })).toBe(false);
	});
});
