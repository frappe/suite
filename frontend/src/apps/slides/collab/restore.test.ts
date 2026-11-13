import { createDocument } from '@tiptap/core'
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { addElement, addSlide, deleteElement, elementText, setElement, writeDeck } from './deck'
import { deckSchema, drawnSlides } from './drawnDeck'
import { restoreEdit } from './restore'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const FRAME = { left: 10, top: 10, width: 100, height: 50 }

function writeHTML(doc: Y.Doc, id: string, html: string) {
  doc.transact(() => {
    prosemirrorToYXmlFragment(createDocument(html, deckSchema), elementText(doc, id)!)
  })
}

// A presentation of two slides: a title and a picture on the first, a note on the second
function presentation() {
  const doc = new Y.Doc()
  writeDeck(doc, [
    {
      id: 'one',
      background: '#ffffff',
      elements: [
        { id: 'title', type: 'text', frame: FRAME },
        { id: 'photo', type: 'image', src: 'media-1', frame: FRAME },
      ],
    },
    { id: 'two', elements: [{ id: 'note', type: 'text', frame: FRAME }] },
  ])
  writeHTML(doc, 'title', '<p>Quarterly plan</p>')
  writeHTML(doc, 'note', '<p>Ask Amira</p>')
  return doc
}

// How the deck draws a plain paragraph: with its default line height
function drawnParagraph(words: string) {
  return `<p style="line-height: 1.5;">${words}</p>`
}

function opened(state: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return doc
}

describe('restoreEdit', () => {
  it('makes the presentation read exactly as the version', () => {
    const doc = presentation()
    const version = Y.encodeStateAsUpdate(doc)
    writeHTML(doc, 'title', '<p>Yearly <strong>plan</strong></p>')
    setElement(doc, 'photo', { opacity: 40, frame: { ...FRAME, left: 300 } })
    deleteElement(doc, 'note')
    const added = addSlide(doc, { background: '#000000' })
    addElement(doc, added, { type: 'text', frame: FRAME })

    restoreEdit(doc, version)

    const restored = drawnSlides(doc)
    expect(restored).toEqual(drawnSlides(opened(version)))
    expect(restored.map((slide) => slide.elements.map((element) => element.content))).toEqual([
      [drawnParagraph('Quarterly plan'), undefined],
      [drawnParagraph('Ask Amira')],
    ])
    expect(doc.getMap('elements').toJSON()).toEqual(opened(version).getMap('elements').toJSON())
  })

  it('keeps each slide, element and text both hold as the same item, so carets and selections stay on it', () => {
    const doc = presentation()
    const version = Y.encodeStateAsUpdate(doc)
    const title = doc.getMap('elements').get('title')
    const titleText = elementText(doc, 'title')
    const first = doc.getMap('slides').get('one')
    writeHTML(doc, 'title', '<p>Yearly plan</p>')
    setElement(doc, 'title', { opacity: 40 })

    restoreEdit(doc, version)

    expect([
      doc.getMap('elements').get('title') === title,
      elementText(doc, 'title') === titleText,
      doc.getMap('slides').get('one') === first,
    ]).toEqual([true, true, true])
  })

  it('brings back a deleted element with its text', () => {
    const doc = presentation()
    const version = Y.encodeStateAsUpdate(doc)
    deleteElement(doc, 'note')

    restoreEdit(doc, version)

    const [, second] = drawnSlides(doc)
    expect(second.elements.map((element) => element.content)).toEqual([drawnParagraph('Ask Amira')])
  })

  it('changes nothing when the presentation already is the version', () => {
    const doc = presentation()
    const version = Y.encodeStateAsUpdate(doc)
    let updates = 0
    doc.on('update', () => {
      updates += 1
    })

    restoreEdit(doc, version)

    expect(updates).toBe(0)
  })
})
