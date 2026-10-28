import { initSync } from '@ironcalc/wasm'
import wasmBase64 from 'virtual:ironcalc-wasm'

import { readFrames } from './child-input'
import { convertSheetsData } from './conversion'

// The Node child the server runs per sheet (suite/content/convert.py), with
// Writer's frame protocol: on stdin, frames whose first is the JSON header
// {legacy, maxState}; on stdout, the conversion with its state in base64 and
// the converter version. An empty header answers the version alone.
//
// The server runs it under --permission, which lets it read only this bundle,
// so IronCalc's wasm is inside it (vite.sheets-checker.config.ts).

// Node's permission model can't block the network, so the child drops the
// network globals; converting never calls them.
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
}

interface ConverterInput {
  // suite/sheets/content/conversion.py `read_old`: the stored JSON, decoded.
  legacy?: { sheets_data: string | null }
  maxState?: number
}

const stdinChunks: Buffer[] = []

async function convertInput() {
  // Trusted as the server's own request; anything else throws, and the server sees the child fail.
  const [headerFrame] = readFrames(Buffer.concat(stdinChunks))
  stdinChunks.length = 0
  const input = JSON.parse(headerFrame!.toString()) as ConverterInput

  let answer: object = {}
  if (input.legacy) {
    initSync({ module: Buffer.from(wasmBase64, 'base64') })
    const result = await convertSheetsData(input.legacy.sheets_data, input.maxState ?? 0)
    answer =
      result.kind === 'converted'
        ? { ...result, state: Buffer.from(result.state).toString('base64') }
        : result
  }
  process.stdout.write(JSON.stringify({ ...answer, version: __CONVERTER_VERSION__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', () => void convertInput())
