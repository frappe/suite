import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'
import { loadVersion } from '@/apps/writer/collab/old-media'
import type { DocumentMedia } from '@/apps/writer/extensions/drive-media'
import { orderedHTML, storedFirstTabLabel } from '@/apps/writer/extensions/tabs'
import { previewEditor } from '@/apps/writer/utils/preview-editor'

/** What one stored version shows: HTML, or a document read from its Yjs state, and its first tab's label. */
export interface StoredVersion {
  content: string | JSONContent
  firstTabLabel: string | null
}

/** A stored version's body: a Yjs state and the lineage it belongs to, or HTML. */
export type VersionBody = { lineage: string; state: Uint8Array } | { html: string }

/** The stored bytes of version `seq`. */
export async function fetchVersion(session: DocumentSession, seq: number): Promise<Uint8Array> {
  const url = session.versions.contentUrl(String(seq))
  const response = await session.credentials.fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** Reads a stored Writer version by its schema. Throws on bytes it cannot show. */
export async function readVersion(bytes: Uint8Array): Promise<StoredVersion> {
  const body = await readVersionBody(bytes)
  if ('html' in body) {
    return { content: body.html, firstTabLabel: null }
  }

  const ydoc = new Y.Doc()
  try {
    loadVersion(ydoc, body.state)
    const content = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(BODY_FIELD))
    return { content, firstTabLabel: storedFirstTabLabel(ydoc) }
  } finally {
    ydoc.destroy()
  }
}

/** Version `seq` as the live document's "All tabs" export writes it. Throws on a version that can't be shown. */
export async function storedVersionHTML(
  session: DocumentSession,
  seq: number,
  media: DocumentMedia | null,
): Promise<string> {
  const version = await readVersion(await fetchVersion(session, seq))
  let isBroken = false
  const editor = previewEditor(version.content, media, () => {
    isBroken = true
  })
  try {
    if (isBroken) {
      throw new Error("This version can't be shown.")
    }

    return orderedHTML(editor.state.doc, version.firstTabLabel)
  } finally {
    editor.destroy()
  }
}

/** Reads a stored Writer version's body by its schema. Throws on bytes it cannot read. */
export async function readVersionBody(bytes: Uint8Array): Promise<VersionBody> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const payload = parsedOrNull(text)
  const isRecord = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
  if (!isRecord) {
    return { html: text }
  }

  const version = payload as Record<string, unknown>
  const isHtmlVersion = version.schema === 'writer-document/1'
  const hasContent = typeof version.content === 'string' && version.content !== ''
  const isKnownCollab = [0, 1, false, true, undefined].includes(
    version.collab as number | boolean | undefined,
  )
  if (isHtmlVersion && hasContent && typeof version.html === 'string' && isKnownCollab) {
    return { html: version.html }
  }

  const isYjsVersion = version.schema === 'writer-document/2' && version.codec === 'yjs1'
  if (isYjsVersion && typeof version.state === 'string' && typeof version.lineage === 'string') {
    return { lineage: version.lineage, state: await gunzip(fromBase64(version.state)) }
  }

  throw new Error('This version cannot be read.')
}

function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Migrated history is raw HTML
    return null
  }
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
