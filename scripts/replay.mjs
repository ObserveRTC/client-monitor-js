/**
 * Bootstrap for `npm run replay`.
 *
 * The package is ESM with bundler module resolution, so its TypeScript is not
 * directly runnable by Node (extensionless relative imports), and the repo has
 * no ts-node/tsx. This compiles `scripts/replay.ts` and everything it pulls in
 * to CommonJS under `.replay/` (marked `"type":"commonjs"` so Node reads it
 * that way despite the package being ESM), then runs it with the CLI's own
 * arguments. Compilation is incremental, so repeat runs are fast.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.replay');

const compiled = spawnSync(
	process.execPath,
	[join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.replay.json')],
	{ stdio: 'inherit', cwd: root },
);

if (compiled.status !== 0) process.exit(compiled.status ?? 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

const ran = spawnSync(
	process.execPath,
	[join(outDir, 'scripts', 'replay.js'), ...process.argv.slice(2)],
	{ stdio: 'inherit', cwd: process.cwd() },
);

process.exit(ran.status ?? 1);
