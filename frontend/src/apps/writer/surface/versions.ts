import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { FIELD } from '@/apps/writer/collab'

/** What one stored version shows: HTML, or a document read from its Yjs state. */
export type VersionContent = string | JSONContent

/** Reads a stored Writer version by its schema. Throws on bytes it cannot show. */
export async function readVersion(bytes: Uint8Array): Promise<VersionContent> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  let payload: unknown = null
  try {
    payload = JSON.parse(text)
  } catch {
    // Migrated history is raw HTML.
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return text
  const version = payload as Record<string, unknown>
  if (version.schema === 'writer-document/1' && typeof version.html === 'string') {
    return version.html
  }
  if (
    version.schema === 'writer-document/2' &&
    version.codec === 'yjs1' &&
    typeof version.state === 'string'
  ) {
    const ydoc = new Y.Doc()
    try {
      Y.applyUpdate(ydoc, await gunzip(fromBase64(version.state)))
      return yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(FIELD))
    } finally {
      ydoc.destroy()
    }
  }
  throw new Error('This version cannot be read.')
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
