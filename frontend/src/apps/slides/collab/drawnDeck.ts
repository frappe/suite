// The deck in the form the slide components draw: one flat element per box,
// stacked in `order`, with its rich text as HTML

import { generateHTML, getSchema } from '@tiptap/core'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { boxText, readSlides, TYPES_WITH_TEXT, type DeckItem } from './deck'

const schema = getSchema(extensions)

export interface DrawnSlide {
  id: string
  background?: string
  elements: Record<string, unknown>[]
}

function connectorOf({ connectorStart, connectorEnd, route }: DeckItem) {
  if (connectorStart === undefined && connectorEnd === undefined && route === undefined) {
    return {}
  }

  return { connector: { start: connectorStart, end: connectorEnd, route } }
}

function textOf(doc: Y.Doc, { id, type }: DeckItem) {
  const fragment = boxText(doc, id)
  if (!TYPES_WITH_TEXT.has(type as string) || !fragment) {
    return {}
  }

  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema)
  return { content: generateHTML(root.toJSON(), extensions) }
}

export function drawnSlides(doc: Y.Doc): DrawnSlide[] {
  return readSlides(doc).map((slide) => ({
    id: slide.id,
    background: slide.background as string | undefined,
    elements: slide.boxes.map((box, index) => {
      const { frame, connectorStart: _start, connectorEnd: _end, route: _route, ...fields } = box
      return {
        ...fields,
        ...(frame as object),
        ...connectorOf(box),
        ...textOf(doc, box),
        zIndex: index + 1,
      }
    }),
  }))
}
