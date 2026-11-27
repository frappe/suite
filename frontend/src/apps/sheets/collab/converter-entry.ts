import { setFlagsFromString } from 'node:v8'
import { initSync } from '@ironcalc/wasm'

import { agentAnswer, valuesAnswer, type AgentHeader } from './agent'
import { readFrames } from './child-input'
import { convertSheetsData } from './conversion'

// The Node child the server runs per sheet (suite/content/convert.py), with
// Writer's frame protocol: on stdin, frames whose first is the JSON header
// {legacy, maxState}; on stdout, the conversion with its state in base64 and
// the converter version. An empty header answers the version alone. An agent
// header (collab/agent.ts) answers on the frames after it, a doc's checkpoint
// and rows
//
// The server runs it under --permission, which lets it read only this bundle,
// so IronCalc's wasm is inside it (vite.sheets-checker.config.ts).

// Node's permission model can't block the network, so the child drops the
// network globals; converting never calls them.
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
}

interface ConverterInput extends AgentHeader {
  // suite/sheets/content/conversion.py `read_old`: the stored JSON, decoded.
  legacy?: { sheets_data: string | null }
  maxState?: number
}

// A values read's IronCalc memory, in wasm pages of 64 KiB: 1 GiB
const VALUES_WASM_PAGES = 16_384

const stdinChunks: Buffer[] = []

async function convertInput() {
  // Trusted as the server's own request; anything else throws, and the server sees the child fail.
  const [headerFrame, ...parts] = readFrames(Buffer.concat(stdinChunks))
  stdinChunks.length = 0
  // SAFETY: this private stdin pipe is written by suite/content/convert.py, which
  // constructs {legacy, maxState} from this app's read_old result, or {} for version probes.
  // suite/sheets/content/agent.py writes it too, with an agent header and a doc's parts
  // The conversion owner checks unsupported nested legacy content before producing state.
  const input = JSON.parse(headerFrame!.toString()) as ConverterInput

  let result: Awaited<ReturnType<typeof convertSheetsData>> | undefined
  // Past it a values read exits non-zero and agent.py refuses it as too heavy; legacy conversion keeps its room
  if (input.values) setFlagsFromString(`--wasm-max-mem-pages=${VALUES_WASM_PAGES}`)
  if (input.legacy || input.values) initSync({ module: Buffer.from(__IRONCALC_WASM__, 'base64') })
  if (input.legacy) {
    result = await convertSheetsData(input.legacy.sheets_data, input.maxState ?? 0)
  }
  const answer =
    result?.kind === 'converted'
      ? { ...result, state: Buffer.from(result.state).toString('base64') }
      : result
  const agent = input.values ? await valuesAnswer(parts) : agentAnswer(input, parts)
  process.stdout.write(JSON.stringify({ ...answer, ...agent, version: __CONVERTER_VERSION__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', () => void convertInput())
