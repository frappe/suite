// The presentation in the form the slide store holds and its components draw: one
// flat old-format element per element, stacked in `order`, with its rich text as HTML

import { generateHTML, getSchema } from '@tiptap/core'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { elementText, readSlides, TYPES_WITH_TEXT, type DeckItem } from './deck'

export const deckSchema = getSchema(extensions)

export interface DrawnSlide extends Record<string, unknown> {
  clientId: string
  elements: DrawnElement[]
}

export interface DrawnElement extends Record<string, unknown> {
  id: string
}

function connectorOf({ connectorStart, connectorEnd, route }: DeckItem) {
  if (connectorStart === undefined && connectorEnd === undefined && route === undefined) {
    return {}
  }

  return { connector: { start: connectorStart, end: connectorEnd, route } }
}

function textOf(doc: Y.Doc, { id, type }: DeckItem, htmlById: Map<string, string>) {
  const fragment = elementText(doc, id)
  if (typeof type !== 'string' || !TYPES_WITH_TEXT.has(type) || !fragment) {
    return {}
  }

  if (!htmlById.has(id)) {
    const root = yXmlFragmentToProseMirrorRootNode(fragment, deckSchema)
    htmlById.set(id, generateHTML(root.toJSON(), extensions))
  }

  return { content: htmlById.get(id) }
}

// `htmlById` keeps each element's HTML between calls; the caller drops the ones that change
export function drawnSlides(doc: Y.Doc, htmlById = new Map<string, string>()): DrawnSlide[] {
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
        ...textOf(doc, element, htmlById),
        zIndex: index + 1,
      }
    }),
  }))
}
