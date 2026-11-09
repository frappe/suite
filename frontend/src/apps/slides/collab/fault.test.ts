// @vitest-environment node
// No DOM, as in the Node child the server runs: the schema has to load without one
import { judge } from '@suite/collab-client'
import { getSchema } from '@tiptap/core'
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { addElement, addSlide, deleteElement, elementText, ROOT, setElement } from './deck'
import { slidesFault } from './fault'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const schema = getSchema(extensions)
const FRAME = { left: 10, top: 10, width: 100, height: 50 }

// A deck a tab would write: a text element with a marked hard break, an image and a line
function goodDeck() {
  const doc = new Y.Doc()
  const slide = addSlide(doc, { background: '#fff' })
  const textElement = addElement(doc, slide, { type: 'text', frame: FRAME })
  addElement(doc, slide, { type: 'image', frame: FRAME, src: 'media-1' })
  addElement(doc, slide, { type: 'line', frame: FRAME, connectorStart: { elementId: textElement } })
  const bold = schema.marks.bold.create()
  const line = schema.nodes.paragraph.create(null, [
    schema.text('one', [bold]),
    schema.nodes.hardBreak.create(null, null, [bold]),
    schema.text('two'),
  ])
  prosemirrorToYXmlFragment(schema.nodes.doc.create(null, line), elementText(doc, textElement)!)

  return { doc, slide, textElement }
}

// The doc as the server's checker sees it: rebuilt from its update alone
function rebuilt(doc: Y.Doc) {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))

  return copy
}

function verdictOn(doc: Y.Doc) {
  return judge(null, [Y.encodeStateAsUpdate(doc)], slidesFault, () => {})
}

describe('slidesFault: what the checker refuses', () => {
  it('accepts a deck a tab wrote and an empty doc', () => {
    expect(slidesFault(rebuilt(goodDeck().doc))).toBeNull()
    expect(slidesFault(new Y.Doc())).toBeNull()
  })

  it('accepts an element undo left without its keys', () => {
    const { doc, textElement } = goodDeck()
    const element = doc.getMap<Y.Map<unknown>>(ROOT.elements).get(textElement)!
    element.delete('order')
    element.delete('parent')

    expect(slidesFault(rebuilt(doc))).toBeNull()
  })

  it('accepts a deck after an element is deleted', () => {
    const { doc, textElement } = goodDeck()
    deleteElement(doc, textElement)

    expect(slidesFault(rebuilt(doc))).toBeNull()
  })

  it('refuses a root the deck has no place for', () => {
    const { doc } = goodDeck()
    doc.getMap('cells').set('x', 1)

    expect(slidesFault(rebuilt(doc))).toBe('schema: unknown root')
  })

  it('refuses a root written as a list', () => {
    const doc = new Y.Doc()
    doc.getArray(ROOT.slides).push(['slide'])

    expect(slidesFault(rebuilt(doc))).toBe('schema: slides is not a map')
  })

  it('refuses an item that is not a map', () => {
    const { doc } = goodDeck()
    doc.getMap(ROOT.elements).set('flat', 'value')

    expect(slidesFault(rebuilt(doc))).toBe('schema: elements holds a bad value')
  })

  it('refuses a key the shape does not declare, without naming it', () => {
    const { doc, slide } = goodDeck()
    doc.getMap<Y.Map<unknown>>(ROOT.slides).get(slide)!.set('private note', 1)

    expect(slidesFault(rebuilt(doc))).toBe('schema: slides holds an unknown key')
  })

  it('refuses a shared type under a plain field', () => {
    const { doc, textElement } = goodDeck()
    doc.getMap<Y.Map<unknown>>(ROOT.elements).get(textElement)!.set('frame', new Y.Map())

    expect(slidesFault(rebuilt(doc))).toBe('schema: elements holds a bad value')
  })

  it('refuses text that is not a fragment', () => {
    const { doc, textElement } = goodDeck()
    setElement(doc, textElement, { type: 'text' })
    doc.getMap<Y.Map<unknown>>(ROOT.elements).get(textElement)!.set('text', 'plain words')

    expect(slidesFault(rebuilt(doc))).toBe('schema: elements holds a bad value')
  })

  it('refuses text the editor would drop', () => {
    const { doc, textElement } = goodDeck()
    elementText(doc, textElement)!.push([new Y.XmlElement('heading')])

    expect(slidesFault(rebuilt(doc))).toBe('schema: elements holds text the editor cannot place')
  })
})

describe('judge with slidesFault', () => {
  it('passes a good deck and fails a corrupt one', () => {
    const { doc } = goodDeck()
    expect(verdictOn(doc)).toMatchObject({ verdict: 'clean' })

    doc.getMap('cells').set('x', 1)
    expect(verdictOn(doc)).toMatchObject({ verdict: 'bad' })
  })
})
