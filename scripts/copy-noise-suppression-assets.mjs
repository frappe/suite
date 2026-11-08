/**
 * Copy the prebundled DTLN AudioWorklet processor out of node_modules into
 * suite/public so Vite never fingerprints/emits ~40MB of wasm + models on
 * every production build.
 *
 * Frappe serves: /assets/suite/noise-suppression/audio-worklet-processor.js
 * Vite dev serves the same directory via vite.config middleware at
 * /noise-suppression/audio-worklet-processor.js
 *
 * The processor ships LiteRT wasm + DTLN models base64-inlined (package
 * README); only this single file is required for the worklet path.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The package manager decides where the package lives, so ask Node.
const require = createRequire(path.join(appRoot, 'package.json'))
const source = path.join(
  path.dirname(require.resolve('@workadventure/noise-suppression/package.json')),
  'dist/assets/audio-worklet-processor.js',
)

const dest = path.join(appRoot, 'suite/public/noise-suppression/audio-worklet-processor.js')

if (!fs.existsSync(source)) {
  console.error(
    `[copy-noise-suppression-assets] Source missing: ${source}\n` +
      'Install @workadventure/noise-suppression first (pnpm install).',
  )
  process.exit(1)
}

fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.copyFileSync(source, dest)
const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1)
console.log(`[copy-noise-suppression-assets] ${dest} (${mb} MB)`)
