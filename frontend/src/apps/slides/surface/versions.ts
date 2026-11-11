import * as Y from 'yjs'

import type { DocumentSession, VersionImage } from '@/apps/drive'
import { ROOT } from '@/apps/slides/collab/deck'
import { isMediaNodeId } from '@/apps/slides/stores/documentMedia'

/** One row of `GET nodes/<id>/versions`, as the Versions panel shows it. */
export interface SlidesVersion {
  seq: string
  kind: string
  label: string | null
  pinned: boolean
  /** Who took it, by full name; their user id when Drive sent no name. */
  actor: string | null
  creation: string | null
}

export interface VersionPage {
  rows: SlidesVersion[]
  nextCursor: string | null
}

/** Reads a versions page. A row without a positive integer `seq` is dropped. */
export function readVersions(payload: unknown): VersionPage {
  const rows = field(payload, 'rows')
  return {
    rows: Array.isArray(rows) ? rows.flatMap(readVersion) : [],
    nextCursor: text(field(payload, 'next_cursor')),
  }
}

function readVersion(row: unknown): SlidesVersion[] {
  const seq = field(row, 'seq')
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return []
  return [
    {
      seq: String(seq),
      kind: text(field(row, 'kind')) ?? 'auto',
      label: text(field(row, 'label')) || null,
      pinned: Boolean(field(row, 'pinned')),
      actor: text(field(field(row, 'person'), 'full_name')) || text(field(row, 'actor')),
      creation: text(field(row, 'creation')),
    },
  ]
}

function field(value: unknown, key: string): unknown {
  return isFieldRecord(value) && key in value ? value[key] : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** A Drive time (`YYYY-MM-DD HH:MM:SS`, site time) as a short local label. */
export function stampLabel(stamp: string | null): string {
  if (!stamp) return ''
  const when = new Date(stamp.replace(' ', 'T'))
  if (Number.isNaN(when.getTime())) return stamp
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function isFieldRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A stored version's body: the Yjs state of a converted presentation, or an old row version. */
export type VersionBody = { state: Uint8Array } | { isLegacy: true }

/** The stored bytes of version `seq`. */
export async function fetchVersion(session: DocumentSession, seq: number): Promise<Uint8Array> {
  const response = await session.credentials.fetch(session.versions.contentUrl(String(seq)))
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** Reads a stored Slides version by its schema. Throws on bytes it cannot read. */
export async function readVersionBody(bytes: Uint8Array): Promise<VersionBody> {
  const version: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const schema = field(version, 'schema')
  if (schema === 'presentation/1') {
    return { isLegacy: true }
  }

  const state = field(version, 'state')
  const isYjs = schema === 'slides-document/2' && field(version, 'codec') === 'yjs1'
  if (!isYjs || typeof state !== 'string') {
    throw new Error('This version cannot be read.')
  }

  const compressed = Uint8Array.from(atob(state), (char) => char.charCodeAt(0))
  const stream = new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'))
  return { state: new Uint8Array(await new Response(stream).arrayBuffer()) }
}

/** The pictures a version shows, by media node id, each once: element pictures and slide backgrounds. */
// Colours and old links are not stored pictures
function mediaOf(values: unknown[], alt: string): VersionImage[] {
  return values.flatMap((id) => (isMediaNodeId(id) ? [{ id, alt }] : []))
}

export function versionImages(state: Uint8Array): VersionImage[] {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    const slides = doc.getMap<Y.Map<unknown>>(ROOT.slides)
    const elements = doc.getMap<Y.Map<unknown>>(ROOT.elements)
    const found = [
      ...[...elements.values()].flatMap((element) => {
        const name = element.get('attachmentName')
        const alt = typeof name === 'string' ? name : ''
        return mediaOf([element.get('src'), element.get('poster')], alt)
      }),
      ...[...slides.values()].flatMap((slide) => mediaOf([slide.get('background')], '')),
    ]
    const seen = new Set<string>()
    return found.filter((image) => !seen.has(image.id) && seen.add(image.id))
  } finally {
    doc.destroy()
  }
}
