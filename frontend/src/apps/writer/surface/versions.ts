import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'

/** What one stored version shows: HTML, or a document read from its Yjs state. */
export type VersionContent = string | JSONContent

/** Reads a stored Writer version by its schema. Throws on bytes it cannot show. */
export async function readVersion(bytes: Uint8Array): Promise<VersionContent> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const text = decoder.decode(bytes)
  let payload: unknown = null
  try {
    payload = JSON.parse(text)
  } catch {
    // Migrated history is raw HTML.
  }

  const isRecord = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
  if (!isRecord) return text

  const version = payload as Record<string, unknown>
  const isHtmlVersion = version.schema === 'writer-document/1'
  const hasContent = typeof version.content === 'string' && version.content !== ''
  const isKnownCollab = [0, 1, false, true, undefined].includes(
    version.collab as number | boolean | undefined,
  )
  if (isHtmlVersion && hasContent && typeof version.html === 'string' && isKnownCollab) {
    return version.html
  }

  const isYjsVersion = version.schema === 'writer-document/2' && version.codec === 'yjs1'
  if (isYjsVersion && typeof version.state === 'string') {
    const ydoc = new Y.Doc()
    try {
      const compressed = fromBase64(version.state)
      const update = await gunzip(compressed)
      Y.applyUpdate(ydoc, update)
      const fragment = ydoc.getXmlFragment(BODY_FIELD)
      return yXmlFragmentToProsemirrorJSON(fragment)
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
  const compressed = new Response(bytes).body!
  const stream = compressed.pipeThrough(new DecompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}
