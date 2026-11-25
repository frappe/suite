import { getSchema } from '@tiptap/core'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import { applyUpdate, Doc } from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { convertLegacy, type LegacyDeck, type OldSlide } from './conversion'
import { elementText, readSlides } from './deck'
import { deckJson } from './deckJson'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const MAX_STATE = 4 * 1024 * 1024
const schema = getSchema(extensions)
const TABLE = `<table style="width: 100px"><colgroup><col style="width: 40px"><col style="width: 60px"></colgroup><tbody><tr><td colspan="1" rowspan="1" colwidth="40"><p>a</p></td><td colspan="1" rowspan="1" colwidth="60"><p><strong>b</strong></p></td></tr></tbody></table>`
const FRAME = { left: 10, top: 20, width: 300, height: 100 }

// Every element in the form the deck already keeps, listed bottom first, with zIndex as its place
const LEGACY: LegacyDeck = {
  slides: [
    {
      id: 'first',
      background: '#112233',
      transition: 'fade',
      transitionDuration: 0.8,
      fadeUnmatchedElements: 1,
      advanceAfter: 5,
      elements: [
        {
          id: 'title',
          type: 'text',
          zIndex: 1,
          ...FRAME,
          transform: 'translate(-50%, -50%)',
          transformOrigin: 'center',
          lineHeight: '1.2',
          content: '<p><strong>Hello</strong> <em>there</em></p><ul><li><p>one</p></li></ul>',
        },
        {
          id: 'box',
          type: 'shape',
          zIndex: 2,
          ...FRAME,
          shapeType: 'oval',
          fillColor: '#ff0000ff',
          strokeColor: '#000000ff',
          strokeWidth: 2,
          shadowColor: '#000000',
          shadowOffset: 25,
          shadowAngle: 53,
          shadowBlur: 5,
          shadowOpacity: 50,
          content: '<p>inside</p>',
        },
        {
          id: 'arrow',
          type: 'shape',
          zIndex: 3,
          ...FRAME,
          shapeType: 'line',
          markerEnd: 'arrow',
          connector: { start: { elementId: 'box', anchor: 'right' }, end: null, route: 'elbow' },
        },
      ],
    },
    {
      id: 'second',
      elements: [
        {
          id: 'grid',
          type: 'table',
          zIndex: 1,
          ...FRAME,
          width: 100,
          gridColor: '#cccccc',
          content: TABLE,
        },
        {
          id: 'picture',
          type: 'image',
          zIndex: 2,
          ...FRAME,
          src: '/private/files/cat.png',
          attachmentName: 'cat.png',
          crop: { left: 1, top: 2, right: 3, bottom: 4 },
          opacity: 80,
          locked: true,
        },
      ],
    },
    { id: 'third', elements: [] },
  ],
}

function docOf(legacy: LegacyDeck) {
  const answer = convertLegacy(legacy, MAX_STATE)
  if (answer.kind !== 'converted') {
    throw new Error(JSON.stringify(answer))
  }

  const doc = new Doc()
  applyUpdate(doc, answer.state)
  return doc
}

// Each element's text body, by id, for the elements that hold one
function bodies(doc: Doc) {
  const ids = readSlides(doc).flatMap(({ elements }) => elements.map(({ id }) => id))
  return ids.flatMap((id) => {
    const text = elementText(doc, id)
    if (!text) {
      return []
    }

    return [[id, yXmlFragmentToProseMirrorRootNode(text, schema).toJSON()]]
  })
}

function withoutContent({ slides }: { slides: OldSlide[] }) {
  return slides.map(({ elements, ...slide }) => ({
    ...slide,
    elements: elements.map(({ content: _content, ...element }) => element),
  }))
}

describe('a presentation read back as the old JSON', () => {
  it('answers the slides and elements it was converted from, and converts back to the same doc', () => {
    const doc = docOf(LEGACY)
    const exported = deckJson(doc)

    // A centred text element keeps its transform; the HTML is the editor's own serialization
    expect(withoutContent(exported)).toEqual(withoutContent(LEGACY))
    const again = docOf(exported)
    expect(readSlides(again)).toEqual(readSlides(doc))
    expect(bodies(again)).toEqual(bodies(doc))
    expect(bodies(doc).map(([id]) => id)).toEqual(['title', 'box', 'arrow', 'grid'])
  })

  it('answers old forms in the form the deck keeps them', () => {
    const old: LegacyDeck = {
      slides: [
        {
          id: 'slide',
          background: 'red',
          elements: [
            { id: 'a', type: 'image', zIndex: 5, width: 200, shadowOffsetX: 30, shadowOffsetY: 40 },
            { id: 'b', type: 'shape', shapeType: 'circle', fillColor: 'rgb(0, 0, 255)' },
            { id: 'c', type: 'text', editorMetadata: { lineHeight: '2' }, content: '<p>a</p>' },
          ],
        },
      ],
    }
    const [slide] = deckJson(docOf(old)).slides

    expect(slide.background).toBe('#ff0000ff')
    // Stacked by zIndex and numbered from 1
    expect(slide.elements.map(({ id, zIndex }) => [id, zIndex])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ])
    expect(slide.elements[0]).toMatchObject({ shapeType: 'oval', fillColor: '#0000ffff' })
    expect(slide.elements[1]).toMatchObject({
      lineHeight: '2',
      transform: 'none',
      transformOrigin: 'top left',
    })
    expect(slide.elements[1]).not.toHaveProperty('editorMetadata')
    expect(slide.elements[2]).toMatchObject({ shadowOffset: 25, shadowAngle: 53 })
    expect(slide.elements[2]).not.toHaveProperty('shadowOffsetX')
  })

  it('answers no slides for a presentation with none', () => {
    expect(deckJson(new Doc())).toEqual({ slides: [] })
  })
})
