// The presentation in the form the slide store holds and its components draw: one
// flat old-format element per element, stacked in `order`, with its rich text as HTML

import { generateHTML, getSchema } from '@tiptap/core'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { elementText, readSlides, TYPES_WITH_TEXT, type DeckItem } from './deck'

const schema = getSchema(extensions)

export interface DrawnSlide extends Record<string, unknown> {
  clientId: string
  elements: Record<string, unknown>[]
}

function connectorOf({ connectorStart, connectorEnd, route }: DeckItem) {
  if (connectorStart === undefined && connectorEnd === undefined && route === undefined) {
    return {}
  }

  return { connector: { start: connectorStart, end: connectorEnd, route } }
}

function textOf(doc: Y.Doc, { id, type }: DeckItem) {
  const fragment = elementText(doc, id)
  if (typeof type !== 'string' || !TYPES_WITH_TEXT.has(type) || !fragment) {
    return {}
  }

  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema)
  return { content: generateHTML(root.toJSON(), extensions) }
}

export function drawnSlides(doc: Y.Doc): DrawnSlide[] {
  return readSlides(doc).map(({ id, elements, ...slide }, at) => ({
    ...slide,
    clientId: id,
    // the thumbnail's number, as a row's idx gave it
    idx: at + 1,
    elements: elements.map((element, index) => {
      const {
        frame,
        connectorStart: _start,
        connectorEnd: _end,
        route: _route,
        ...fields
      } = element
      return {
        ...fields,
        ...(frame && typeof frame === 'object' ? frame : undefined),
        ...connectorOf(element),
        ...textOf(doc, element),
        zIndex: index + 1,
      }
    }),
  }))
}
