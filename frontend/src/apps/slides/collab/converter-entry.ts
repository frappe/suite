import { JSDOM } from 'jsdom'

import { readFrames } from './child-input'
import { convertLegacy, type LegacyDeck } from './conversion'

// The Node child the server runs to convert one old deck (suite/content/convert.py), as Writer's and
// Sheets' converter-entry.ts: on stdin, a frame of a JSON header; on stdout, the answer and the
// converter's version. An empty header asks for the version alone
type ConverterInput = { legacy: LegacyDeck; maxState: number } | Record<string, never>

// The editor parses old HTML into a document that loads nothing; each window name is read only when
// used, since some, like localStorage, throw on the blank page's origin
const { window } = new JSDOM('')
function isWindowKey(name: string): name is Extract<keyof typeof window, string> {
  return name in window
}
for (const name of Object.getOwnPropertyNames(window)) {
  if (!(name in globalThis) && isWindowKey(name)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => window[name],
    })
  }
}

// Node's permission model can't block the network, so the child drops the network globals;
// converting never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
  Reflect.deleteProperty(window, name)
}

const stdinChunks: Buffer[] = []

function convertInput() {
  const [headerFrame] = readFrames(Buffer.concat(stdinChunks))
  // SAFETY: this private stdin pipe is written by suite/content/convert.py, which
  // constructs {legacy, maxState} from this app's read_old result, or {} for version probes.
  // The conversion owner checks unsupported nested legacy content before producing state.
  const input = JSON.parse(headerFrame!.toString()) as ConverterInput
  const result = 'legacy' in input ? convertLegacy(input.legacy, input.maxState) : undefined
  const answer =
    result?.kind === 'converted'
      ? { ...result, state: Buffer.from(result.state).toString('base64') }
      : result

  process.stdout.write(JSON.stringify({ ...answer, version: __CONVERTER_VERSION__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', convertInput)
