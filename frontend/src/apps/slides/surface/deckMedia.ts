import { shallowReactive } from 'vue'

import { openMediaReader, type CredentialGrouper, type MediaReader } from '@/apps/drive'
import { isMediaNodeId, type DocumentMedia } from '@/apps/slides/stores/documentMedia'
import type { ImperativeClient } from '@/platform/server-state/types'

import type { CompositeItem } from './compositeGroups'

/**
 * The media of an open deck. A composite shows the slides of the decks it
 * references, and each of those decks keeps its own pictures as Drive
 * children, so a picture of a referenced slide is read through the deck that
 * holds it, with that deck's link credentials. Every other picture, and every
 * picture of an ordinary deck, is read through the deck's own session.
 */
export interface DeckMedia {
  readonly media: DocumentMedia
  /** Records which readable reference holds each picture its slides show. */
  addReferences(items: readonly CompositeItem[]): void
  dispose(): void
}

export function createDeckMedia(
  own: DocumentMedia,
  credentials: Pick<CredentialGrouper, 'group' | 'context'>,
  client: ImperativeClient,
): DeckMedia {
  const readers = new Map<string, MediaReader>()
  // reactive, so a picture drawn before its reference answered follows it there
  const holders = shallowReactive(new Map<string, MediaReader>())

  function readerOf(node: string): MediaReader {
    let reader = readers.get(node)
    if (!reader) {
      const context = credentials.group([node])[0]?.context ?? credentials.context
      reader = openMediaReader(node, { client, context })
      readers.set(node, reader)
    }
    return reader
  }

  return {
    media: (id) => holders.get(id)?.media(id) ?? own(id),
    addReferences(items) {
      for (const { answer } of items) {
        if (!answer?.readable || !answer.node || !answer.slides) continue

        const reader = readerOf(answer.node)
        for (const id of answer.slides.flatMap(slideMediaIds)) {
          if (holders.get(id) !== reader) holders.set(id, reader)
        }
      }
    },
    dispose() {
      for (const reader of readers.values()) reader.dispose()
      readers.clear()
      holders.clear()
    },
  }
}

/** A slide's pictures by media node id: element pictures and posters, and its background. */
function slideMediaIds(slide: unknown): string[] {
  if (!isRecord(slide)) return []

  const elements = listOf(slide.elements).filter(isRecord)
  return [...elements.flatMap((element) => [element.src, element.poster]), slide.background].filter(
    isMediaNodeId,
  )
}

// A slide row keeps its elements as JSON text; a saved state's slide keeps a list
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
