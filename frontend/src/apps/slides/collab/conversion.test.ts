import { getSchema } from '@tiptap/core'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { convertLegacy, type OldBox } from './conversion'
import {
  addBox,
  addSlide,
  boxIds,
  boxText,
  moveBox,
  moveSlide,
  readSlides,
  ROOT,
  slideIds,
} from './deck'
import { slidesFault } from './fault'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const MAX_STATE = 4 * 1024 * 1024
const ALPHABET = /^[0-9A-Za-z]*[1-9A-Za-z]$/
const schema = getSchema(extensions)

function converted(...elementLists: OldBox[][]) {
  const slides = elementLists.map((elements, at) => ({ id: `slide${at}`, elements }))
  const answer = convertLegacy({ slides }, MAX_STATE)
  if (answer.kind !== 'converted') {
    throw new Error(JSON.stringify(answer))
  }

  const doc = new Y.Doc()
  Y.applyUpdate(doc, answer.state)
  return { doc, dropped: answer.dropped }
}

function refusal(box: Record<string, unknown>) {
  const elements = [{ id: 'box', type: 'text', content: '<p>a</p>', ...box }] as OldBox[]
  return convertLegacy({ slides: [{ id: 'slide', elements }] }, MAX_STATE)
}

function boxOf(doc: Y.Doc, id: string) {
  return readSlides(doc)
    .flatMap(({ boxes }) => boxes)
    .find((box) => box.id === id)!
}

function bodyOf(doc: Y.Doc, id: string) {
  return yXmlFragmentToProseMirrorRootNode(boxText(doc, id)!, schema).toJSON()
}

describe('old forms', () => {
  it('turns the old pixel shadow into the size-relative one and keeps none of the old keys', () => {
    // 200 wide: an offset of (30, 40) is 50 px at 53 degrees, 25%, and a spread of 10 px is 5%
    const old = {
      id: 'box',
      type: 'image',
      width: 200,
      shadowOffsetX: 30,
      shadowOffsetY: 40,
      shadowSpread: 10,
      shadowColor: '#00000080',
    }
    const box = boxOf(converted([old]).doc, 'box')
    expect(box).toMatchObject({
      shadowOffset: 25,
      shadowAngle: 53,
      shadowBlur: 5,
      shadowOpacity: 50,
    })
    for (const key of ['shadowOffsetX', 'shadowOffsetY', 'shadowSpread']) {
      expect(box).not.toHaveProperty(key)
    }
  })

  it('takes the line height out of the old metadata', () => {
    const old = { id: 'box', type: 'text', content: '<p>a</p>', editorMetadata: { lineHeight: 2 } }
    expect(boxOf(converted([old]).doc, 'box').lineHeight).toBe(2)
  })

  it('renames a circle and reads colours as today', () => {
    const old = {
      id: 'box',
      type: 'shape',
      shapeType: 'circle',
      fillColor: 'red',
      strokeColor: '#123',
    }
    const box = boxOf(converted([old]).doc, 'box')
    expect(box.shapeType).toBe('oval')
    expect(box.fillColor).toBe('#ff0000ff')
    expect(box.strokeColor).toBe('#123')
  })

  it('reads a slide background colour as today', () => {
    const slides = [{ id: 'slide', elements: [], background: 'rgb(255, 0, 0)' }]
    const answer = convertLegacy({ slides }, MAX_STATE)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (answer as { state: Uint8Array }).state)
    const [slide] = readSlides(doc)
    expect(slide.background).toBe('#ff0000ff')
  })

  it('drops the default style and says so', () => {
    const old = { id: 'box', type: 'text', content: '<p>a</p>', defaultStyle: { color: 'red' } }
    const { doc, dropped } = converted([old])
    expect(boxOf(doc, 'box')).not.toHaveProperty('defaultStyle')
    expect(dropped).toEqual([{ kind: 'default-style' }])
  })

  it('drops a video box content and says so', () => {
    const old = { id: 'box', type: 'video', src: '/x.mp4', content: '<p>a</p>' }
    const { doc, dropped } = converted([old])
    expect(doc.getMap(ROOT.boxes).get('box')).toBeInstanceOf(Y.Map)
    expect(boxText(doc, 'box')).toBeUndefined()
    expect(dropped).toEqual([{ kind: 'video-content' }])
  })

  it('splits a connector into its ends and route', () => {
    const start = { elementId: 'a', anchor: 'right' }
    const old = { id: 'box', type: 'shape', connector: { start, end: null, route: 'elbow' } }
    const box = boxOf(converted([{ id: 'a', type: 'shape' }, old]).doc, 'box')
    expect(box).toMatchObject({ connectorStart: start, connectorEnd: null, route: 'elbow' })
    expect(box).not.toHaveProperty('connector')
  })

  it('carries an old file url as it stands, so the picture still loads', () => {
    const old = { id: 'box', type: 'image', src: '/private/files/old.png' }
    expect(boxOf(converted([old]).doc, 'box').src).toBe('/private/files/old.png')
  })
})

describe('where a box sits', () => {
  it('copies a centred text box as it is, with no measuring', () => {
    const old = {
      id: 'box',
      type: 'text',
      content: '<p>a</p>',
      left: 480,
      top: 270,
      width: 'auto',
      transform: 'translate(-50%, -50%)',
      transformOrigin: 'center',
    }
    expect(boxOf(converted([old]).doc, 'box').frame).toEqual({
      left: 480,
      top: 270,
      width: 'auto',
      transform: 'translate(-50%, -50%)',
      transformOrigin: 'center',
    })
  })

  it('gives a text box with no transform the plain form', () => {
    const old = { id: 'box', type: 'text', content: '<p>a</p>', left: 1, top: 2 }
    expect(boxOf(converted([old]).doc, 'box').frame).toEqual({
      left: 1,
      top: 2,
      transform: 'none',
      transformOrigin: 'top left',
    })
  })
})

describe('order', () => {
  it('stacks boxes as today: no zIndex or a zero counts as 1, ties keep their place', () => {
    const elements = [
      { id: 'top', type: 'image', zIndex: 3 },
      { id: 'none', type: 'image' },
      { id: 'zero', type: 'image', zIndex: 0 },
      { id: 'one', type: 'image', zIndex: 1 },
      { id: 'middle', type: 'image', zIndex: 2 },
    ]
    const { doc } = converted(elements)
    expect(boxIds(doc, 'slide0')).toEqual(['none', 'zero', 'one', 'middle', 'top'])
  })

  it('keeps slides in row order, past the ids sorting any other way', () => {
    const slides = ['z', 'a', 'm'].map((id) => ({ id, elements: [] }))
    const answer = convertLegacy({ slides }, MAX_STATE)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (answer as { state: Uint8Array }).state)
    expect(slideIds(doc)).toEqual(['z', 'a', 'm'])
  })

  // Enough items to run past the last digit, where a value grows a digit
  const MANY = 150
  const many = Array.from({ length: MANY }, (_, at) => ({
    id: `box${at}`,
    type: 'image',
    zIndex: at + 1,
  }))

  it('gives every item a distinct value from the alphabet with no trailing zero', () => {
    const { doc } = converted(many)
    const orders = [...doc.getMap<Y.Map<string>>(ROOT.boxes).values()].map((box) =>
      box.get('order')!,
    )
    expect(new Set(orders).size).toBe(MANY)
    for (const order of orders) {
      expect(order).toMatch(ALPHABET)
    }
  })

  it('leaves room to move and add on both ends of a converted list', () => {
    const { doc } = converted(many)
    const ids = boxIds(doc, 'slide0')
    const [first, last] = [ids[0], ids[MANY - 1]]
    moveBox(doc, last, null)
    const [bottom] = boxIds(doc, 'slide0')
    expect(bottom).toBe(last)
    moveBox(doc, first, ids[MANY - 2])
    expect(boxIds(doc, 'slide0').at(-1)).toBe(first)
    const added = addBox(doc, 'slide0', { type: 'image' })
    expect(boxIds(doc, 'slide0').at(-1)).toBe(added)
    // Between every neighbouring pair, past where the values grow a digit
    const others = boxIds(doc, 'slide0').filter((id) => id !== added)
    for (const [at, id] of others.entries()) {
      moveBox(doc, added, id)
      expect(boxIds(doc, 'slide0')).toEqual([
        ...others.slice(0, at + 1),
        added,
        ...others.slice(at + 1),
      ])
    }
  })

  it('leaves room on both ends of the slides', () => {
    const { doc } = converted([], [], [])
    moveSlide(doc, 'slide2', null)
    expect(slideIds(doc)).toEqual(['slide2', 'slide0', 'slide1'])
    const added = addSlide(doc)
    expect(slideIds(doc).at(-1)).toBe(added)
  })
})

describe('text', () => {
  it('keeps a marked hard break', () => {
    const content = '<p><span style="font-size: 24px">one<br>two</span></p>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [{ content: inline }] = bodyOf(doc, 'box').content
    expect(inline[1].type).toBe('hardBreak')
    expect(inline[1].marks).toEqual(inline[0].marks)
    expect(inline[1].marks[0].attrs.fontSize).toBe('24px')
  })

  it('reads an old body held as a document', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }],
        },
      ],
    }
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    expect(bodyOf(doc, 'box').content[0].content[0]).toMatchObject({
      text: 'hello',
      marks: [{ type: 'bold' }],
    })
  })

  it('takes an old list item whose opacity CSS clamps to opaque', () => {
    const content =
      '<ul><li style="opacity: 100"><p><span style="opacity: 0.5">a</span></p></li></ul>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [{ content: items }] = bodyOf(doc, 'box').content
    expect(items[0].content[0].content[0].marks[0].attrs.opacity).toBe(50)
  })

  it('takes italic written as a style', () => {
    const content = '<p><span style="font-style: italic">a</span></p>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    expect(bodyOf(doc, 'box').content[0].content[0].marks).toContainEqual({ type: 'italic' })
  })

  it('gives a shape with no body an empty one', () => {
    const { doc } = converted([{ id: 'box', type: 'shape' }])
    expect(boxText(doc, 'box')).toBeInstanceOf(Y.XmlFragment)
  })

  it('answers a deck the server checker takes', () => {
    const content =
      '<p style="text-align: center"><strong>a</strong><br>b</p><ul><li><p>c</p></li></ul>'
    const { doc } = converted([
      { id: 'box', type: 'text', content },
      { id: 'pic', type: 'image' },
    ])
    expect(slidesFault(doc)).toBeNull()
  })
})

describe('refusals', () => {
  it.each([
    ['HTML the editor has no place for', { content: '<p>a</p><img src="x.png">' }, 'html'],
    ['a heading the editor would flatten', { content: '<h1>a</h1>' }, 'html'],
    [
      'a style the editor would lose',
      { content: '<p><span style="text-shadow: 1px 1px red">a</span></p>' },
      'html',
    ],
    [
      'a list item faded by its own style',
      { content: '<ul><li style="opacity: 0.5"><p>a</p></li></ul>' },
      'html',
    ],
    [
      'a list item colour its text does not carry',
      { content: '<ul><li style="color: red"><p>a</p></li></ul>' },
      'html',
    ],
    ['a horizontal rule', { content: '<p>a</p><hr><p>b</p>' }, 'html'],
    [
      'a body its schema has no place for',
      { content: { type: 'doc', content: [{ type: 'nope' }] } },
      'html',
    ],
    ['an undeclared box type', { type: 'chart' }, 'box_type'],
    ['no box type', { type: undefined }, 'box_type'],
    ['an undeclared setting', { sparkle: true }, 'setting'],
    ['a key the deck uses for itself', { order: 'a' }, 'setting'],
    [
      'old metadata beyond the line height',
      { editorMetadata: { lineHeight: 2, other: 1 } },
      'setting',
    ],
    ['an image with content', { type: 'image', content: '<p>a</p>' }, 'setting'],
  ])('refuses %s', (_name, box, detail) => {
    expect(refusal(box)).toEqual({ kind: 'failed', reason: 'check', detail })
  })

  it('refuses elements that did not parse', () => {
    expect(convertLegacy({ slides: [], isUnreadable: true }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
      detail: 'elements',
    })
  })

  it('refuses a deck past the size limit', () => {
    const elements = [{ id: 'box', type: 'text', content: '<p>a</p>' }]
    expect(convertLegacy({ slides: [{ id: 'slide', elements }] }, 10)).toEqual({
      kind: 'failed',
      reason: 'too_large',
    })
  })
})
