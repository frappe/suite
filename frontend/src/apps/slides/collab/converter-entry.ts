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
for (const name of Object.getOwnPropertyNames(window)) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => Reflect.get(window, name),
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
  const input = JSON.parse(headerFrame!.toString()) as ConverterInput
  let answer: object = {}
  if ('legacy' in input) {
    const result = convertLegacy(input.legacy, input.maxState)
    answer = result
    if (result.kind === 'converted') {
      answer = { ...result, state: Buffer.from(result.state).toString('base64') }
    }
  }

  process.stdout.write(JSON.stringify({ ...answer, version: __CONVERTER_VERSION__ }))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', convertInput)
