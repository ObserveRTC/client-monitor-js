import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(
  readFileSync('./package.json', 'utf8')
);

const banner = `/**
 * @observertc/client-monitor-js v${packageJson.version}
 * (c) ${new Date().getFullYear()} ObserveRTC
 * @license Apache-2.0
 */`;

// Only create bundled version for CDN usage
export default defineConfig([
  {
    input: 'src/index.ts',
    external: [], // Bundle all dependencies for standalone usage
    plugins: [
      nodeResolve({
        browser: true,
        preferBuiltins: false,
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
      terser({
        format: {
          comments: /^!/,
        },
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.debug'],
          passes: 2,
          unused: true,
        },
        mangle: {
          properties: {
            regex: /^_/,
          },
        },
      }),
    ],
    output: {
      file: 'dist/index.bundle.min.js',
      format: 'es',
      banner,
    },
  },
]); 