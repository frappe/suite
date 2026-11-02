import { JSDOM } from 'jsdom'

import { readFrames } from '@/apps/writer/collab/child-input'
import { convertLegacy } from '@/apps/writer/collab/conversion'
import { addInnerText } from '@/apps/writer/collab/headless-dom'
import type { LegacyBody } from '@/apps/writer/collab/legacy-read'

type ConverterInput = { legacy: LegacyBody; maxState: number } | Record<string, never>

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

addInnerText(window)

// Node's permission model can't block the network, so the child drops the globals the editor's
// paste and upload code would reach it with, on Node and on the window; converting never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
  Reflect.deleteProperty(window, name)
}

// The Node child the server runs per document: on stdin, frames whose first is the JSON header
// {legacy, maxState}; on stdout, the conversion with its state in base64 and the converter
// version. An empty header answers the version alone
const stdinChunks: Buffer[] = []

function convertInput() {
  // Trusted as the server's own request; anything else throws, and the server sees the child fail
  const [headerFrame] = readFrames(Buffer.concat(stdinChunks))
  const input = JSON.parse(headerFrame.toString()) as ConverterInput

  let answer: object = {}
  if ('legacy' in input) {
    const result = convertLegacy(input.legacy, input.maxState)
    if (result.kind === 'converted') {
      answer = { ...result, state: Buffer.from(result.state).toString('base64') }
    } else {
      answer = result
    }
  }

  const reply = {
    ...answer,
    version: __CONVERTER_VERSION__,
  }
  process.stdout.write(JSON.stringify(reply))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', convertInput)
