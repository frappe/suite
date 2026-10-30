import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type UserConfig } from 'vite'

// Sheets' Node builds, each one file with the browsers' Yjs and the doc layout in
// src/apps/sheets/collab/schema.ts: the checker, which the server runs on demand
// to judge rows (suite/content/checker.py), and with `--mode converter` the
// converter, which turns an old sheet into a collab doc (suite/content/convert.py).
// Writer's are built by vite.checker.config.ts.
const requireFromFrontend = createRequire(path.resolve(__dirname, 'package.json'))
const yjsVersion = requireFromFrontend('yjs/package.json').version
const converterVersion = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../suite/sheets/content/converter-version.json'),
    'utf8',
  ),
).version

// The --permission sandbox allows reading only the bundle, so IronCalc's wasm goes inside it, as
// base64. A constant rather than a virtual module, so tools that read the entry without this config
// (vitest's coverage) still parse it
const ironcalcWasm = fs
  .readFileSync(requireFromFrontend.resolve('@ironcalc/wasm/wasm_bg.wasm'))
  .toString('base64')

const define = {
  __CHECKER_YJS__: JSON.stringify(yjsVersion),
  __CONVERTER_VERSION__: JSON.stringify(converterVersion),
  __IRONCALC_WASM__: JSON.stringify(ironcalcWasm),
}

function sheetsBuild(name: 'checker' | 'converter'): UserConfig {
  const entry = path.resolve(__dirname, `src/apps/sheets/collab/${name}-entry.ts`)
  return {
    root: __dirname,
    define,
    publicDir: false,
    configFile: false,
    resolve: {
      alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
      dedupe: ['yjs'],
    },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: entry,
      outDir: '../suite/sheets/content/dist',
      // Each build writes only its own file, so neither clears the other's
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: `${name}.cjs` } },
    },
  }
}

export default defineConfig(({ mode }) =>
  sheetsBuild(mode === 'converter' ? 'converter' : 'checker'),
)
