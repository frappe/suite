import { JSDOM } from 'jsdom'
import { applyUpdate, Doc } from 'yjs'

import { readFrames } from './child-input'
import { convertLegacy, type LegacyDeck } from './conversion'
import { deckJson } from './deckJson'

// The Node child the server runs to convert one old deck (suite/content/convert.py), as Writer's and
// Sheets' converter-entry.ts: on stdin, a frame of a JSON header; on stdout, the answer and the
// converter's version. A header {deck} answers the frames after it, a log's checkpoint and rows, as the
// old JSON, and an empty one the version alone
type ConverterInput =
  { legacy: LegacyDeck; maxState: number } | { deck: true } | Record<string, never>

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

// The presentation a {deck} header's log parts make, as the old JSON
function logDeck(input: ConverterInput, parts: Buffer[]) {
  if (!('deck' in input)) {
    return undefined
  }

  const doc = new Doc()
  for (const part of parts) {
    // A log with no checkpoint sends an empty frame in its place
    if (part.length) {
      applyUpdate(doc, part)
    }
  }

  return deckJson(doc)
}

function convertInput() {
  const [headerFrame, ...parts] = readFrames(Buffer.concat(stdinChunks))
  // SAFETY: this private stdin pipe is written by suite/content/convert.py, which
  // constructs {legacy, maxState} from this app's read_old result, or {} for version probes.
  // The conversion owner checks unsupported nested legacy content before producing state.
  // suite/slides/content/converter.py writes it too, with {deck} and a log's parts for a JSON read
  const input = JSON.parse(headerFrame!.toString()) as ConverterInput
  const result = 'legacy' in input ? convertLegacy(input.legacy, input.maxState) : undefined
  const answer =
    result?.kind === 'converted'
      ? { ...result, state: Buffer.from(result.state).toString('base64') }
      : result

  const deck = logDeck(input, parts)
  process.stdout.write(JSON.stringify({ ...answer, deck, version: __CONVERTER_VERSION__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', convertInput)
