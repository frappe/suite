import { JSDOM } from 'jsdom'
import { applyUpdate, Doc } from 'yjs'

import { readFrames } from '@/apps/writer/collab/child-input'
import { convertLegacy } from '@/apps/writer/collab/conversion'
import { addInnerText } from '@/apps/writer/collab/headless-dom'
import type { LegacyBody } from '@/apps/writer/collab/legacy-read'
import { markdownOf } from '@/apps/writer/collab/markdown'
import { writerRender } from '@/apps/writer/collab/render'

type ConverterInput =
  { legacy: LegacyBody; maxState: number } | { markdown: true } | Record<string, never>

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

addInnerText(window)

// jsdom has none and a table's node view builds one; nothing ever resizes here
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Node's permission model can't block the network, so the child drops the globals the editor's
// paste and upload code would reach it with, on Node and on the window; converting never calls them
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name)
  Reflect.deleteProperty(window, name)
}

// The Node child the server runs per document: on stdin, frames whose first is the JSON header
// {legacy, maxState}; on stdout, the conversion with its state in base64 and the converter
// version. A header {markdown} answers the frames after it, a log's checkpoint and rows, as
// Markdown, and an empty one the version alone
const stdinChunks: Buffer[] = []

// The document the log's parts make, rendered as a tab renders it and written as Markdown
function logMarkdown(parts: Buffer[]) {
  const doc = new Doc()
  for (const part of parts) {
    // A log with no checkpoint sends an empty frame in its place
    if (part.length) applyUpdate(doc, part)
  }

  const { html } = writerRender(doc)
  return markdownOf(new DOMParser().parseFromString(html, 'text/html').body)
}

function convertInput() {
  // Trusted as the server's own request; anything else throws, and the server sees the child fail
  const [headerFrame, ...parts] = readFrames(Buffer.concat(stdinChunks))
  // SAFETY: this private stdin pipe is written by suite/content/convert.py, which
  // constructs {legacy, maxState} from this app's read_old result, or {} for version probes.
  // The conversion owner checks unsupported nested legacy content before producing state.
  // suite/writer/content/converter.py writes it too, with {markdown} and a log's parts for a Markdown read
  const input = JSON.parse(headerFrame.toString()) as ConverterInput

  const result = 'legacy' in input ? convertLegacy(input.legacy, input.maxState) : undefined
  const answer =
    result?.kind === 'converted'
      ? { ...result, state: Buffer.from(result.state).toString('base64') }
      : result

  const markdown = 'markdown' in input ? logMarkdown(parts) : undefined

  const reply = {
    ...answer,
    markdown,
    version: __CONVERTER_VERSION__,
  }
  process.stdout.write(JSON.stringify(reply))
}

process.stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk))
process.stdin.on('end', convertInput)
