// What Slides tells the content layer's client (platform/collab) about its decks

import type { CollabAdapter } from '@/platform/collab'
import { caretPosition } from '@/platform/collab/carets'

import declared from '../../../../../suite/slides/content/schema.json'
import { MAX_SHARED_ELEMENTS, selectionOf } from './livePresence'

// A peer's position: a caret, the elements they have selected, or both
function toPeerPosition(raw: unknown) {
  const caret = caretPosition(raw)
  const selection = selectionOf(raw)
  if (!selection) {
    return caret
  }

  const elements = selection.elements.slice(0, MAX_SHARED_ELEMENTS)
  return { ...caret, elements, count: Math.max(selection.count, elements.length) }
}

export const slidesAdapter: CollabAdapter = {
  app: 'slides',
  schemaVersion: declared.schema,
  toPeerPosition,
}
