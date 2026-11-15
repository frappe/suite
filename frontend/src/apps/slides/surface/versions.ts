import * as Y from 'yjs'

import { api, client } from '@/api'
import {
  askUntilConverted,
  readStoredState,
  type ConvertedState,
  type DocumentSession,
  type VersionImage,
} from '@/apps/drive'
import { ROOT } from '@/apps/slides/collab/deck'
import { isMediaNodeId } from '@/apps/slides/stores/documentMedia'

function field(value: unknown, key: string): unknown {
  return isFieldRecord(value) && key in value ? value[key] : undefined
}

function isFieldRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A stored version's body: the Yjs state of a converted presentation, or an old row version's slides. */
export type VersionBody = { state: Uint8Array } | { legacySlides: unknown[] }

/** Reads a stored Slides version by its schema. Throws on bytes it cannot read. */
export async function readVersionBody(bytes: Uint8Array): Promise<VersionBody> {
  const version: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const schema = field(version, 'schema')
  if (schema === 'presentation/1') {
    const slides = field(version, 'slides')
    if (!Array.isArray(slides)) {
      throw new Error('This version cannot be read.')
    }

    return { legacySlides: slides }
  }

  const state = field(version, 'state')
  const isYjs = schema === 'slides-document/2' && field(version, 'codec') === 'yjs1'
  if (!isYjs || typeof state !== 'string') {
    throw new Error('This version cannot be read.')
  }

  return { state: await readStoredState(state) }
}

/** Runs old version `seq` through the server's converter, asking until it answers or the wait runs out. */
export function convertedVersion(session: DocumentSession, seq: number): Promise<ConvertedState> {
  return askUntilConverted(() => askToConvert(session, seq))
}

function askToConvert(session: DocumentSession, seq: number) {
  return client.mutation(
    api.slides.versions.convert,
    { node: session.nodeId, seq },
    { context: session.credentials.context, silent: true },
  )
}

// Colours and old links are not stored pictures
function mediaOf(values: unknown[], alt: string): VersionImage[] {
  return values.flatMap((id) => (isMediaNodeId(id) ? [{ id, alt }] : []))
}

/** The pictures a version shows, by media node id, each once: element pictures and slide backgrounds. */
export function versionImages(body: VersionBody): VersionImage[] {
  let found: VersionImage[]
  if ('state' in body) {
    found = stateImages(body.state)
  } else {
    found = legacyImages(body.legacySlides)
  }

  const seen = new Set<string>()
  return found.filter((image) => !seen.has(image.id) && seen.add(image.id))
}

// An old version keeps each slide's elements as the row's JSON text
function legacyImages(slides: unknown[]): VersionImage[] {
  return slides.flatMap((slide) => {
    const elements = parsedList(field(slide, 'elements'))
    return [
      ...elements.flatMap((element) => {
        const name = field(element, 'attachmentName')
        const alt = typeof name === 'string' ? name : ''
        return mediaOf([field(element, 'src'), field(element, 'poster')], alt)
      }),
      ...mediaOf([field(slide, 'background')], ''),
    ]
  })
}

// Rows that don't parse show no pictures; the server refuses them on restore
function parsedList(value: unknown): unknown[] {
  if (typeof value !== 'string') {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
  } catch {
    return []
  }
}

function stateImages(state: Uint8Array): VersionImage[] {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    const slides = doc.getMap<Y.Map<unknown>>(ROOT.slides)
    const elements = doc.getMap<Y.Map<unknown>>(ROOT.elements)
    return [
      ...[...elements.values()].flatMap((element) => {
        const name = element.get('attachmentName')
        const alt = typeof name === 'string' ? name : ''
        return mediaOf([element.get('src'), element.get('poster')], alt)
      }),
      ...[...slides.values()].flatMap((slide) => mediaOf([slide.get('background')], '')),
    ]
  } finally {
    doc.destroy()
  }
}
