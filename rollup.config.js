import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(
  readFileSync('./package.json', 'utf8')
);

const banner = `/**
 * @observertc/client-monitor-js v${packageJson.version}
 * (c) ${new Date().getFullYear()} ObserveRTC
 * @license Apache-2.0
 */`;

const external = [
  'eventemitter3',
  'ua-parser-js', 
  'uuid'
];

// Base configuration
const baseConfig = {
  input: 'src/index.ts',
  external,
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
      sourceMap: true,
    }),
  ],
};

export default defineConfig([
  // ESM build
  {
    ...baseConfig,
    output: {
      file: 'dist/index.js',
      format: 'es',
      sourcemap: true,
      banner,
    },
  },

  // CommonJS build
  {
    ...baseConfig,
    output: {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: true,
      banner,
      exports: 'named',
    },
  },

  // Browser UMD build
  {
    ...baseConfig,
    external: [], // Bundle all dependencies for browser
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
        sourceMap: true,
      }),
    ],
    output: {
      file: 'dist/index.browser.js',
      format: 'umd',
      name: 'ObserveRTCClientMonitor',
      sourcemap: true,
      banner,
    },
  },

  // Browser UMD minified build
  {
    ...baseConfig,
    external: [], // Bundle all dependencies for browser
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
        sourceMap: true,
      }),
      terser({
        format: {
          comments: false,
        },
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      }),
    ],
    output: {
      file: 'dist/index.browser.min.js',
      format: 'umd',
      name: 'ObserveRTCClientMonitor',
      sourcemap: true,
      banner,
    },
  },

  // IIFE build for direct browser usage
  {
    ...baseConfig,
    external: [], // Bundle all dependencies for browser
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
        sourceMap: true,
      }),
    ],
    output: {
      file: 'dist/index.iife.js',
      format: 'iife',
      name: 'ObserveRTCClientMonitor',
      sourcemap: true,
      banner,
    },
  },

  // TypeScript declarations
  {
    input: 'src/index.ts',
    external,
    plugins: [dts()],
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
      banner,
    },
  },
]); 