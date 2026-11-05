import { getSchema } from '@tiptap/core'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
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
  writeDeck,
} from './deck'
import { drawnSlides } from './drawnDeck'
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

  it('carries a list item style to the text the old view inherited it on', () => {
    const content =
      '<ul><li style="color: red; font-family: Inter; font-size: 24px; letter-spacing: 2px">' +
      '<p>a<span style="color: blue">b</span></p></li></ul>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [{ content: items }] = bodyOf(doc, 'box').content
    const [first, second] = items[0].content[0].content
    const inherited = { fontFamily: 'Inter', fontSize: '24px', letterSpacing: '2px' }
    expect(first.marks[0].attrs).toMatchObject({ color: 'red', ...inherited })
    expect(second.marks[0].attrs).toMatchObject({ color: 'blue', ...inherited })
  })

  it('carries an outer list item style to a nested list that inherited it', () => {
    const content = '<ul><li style="color: red"><p>a</p><ul><li><p>b</p></li></ul></li></ul>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [{ content: items }] = bodyOf(doc, 'box').content
    const [, nested] = items[0].content
    expect(nested.content[0].content[0].content[0].marks[0].attrs.color).toBe('red')
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

  it('keeps whitespace the old view draws', () => {
    const { doc, dropped } = converted([{ id: 'box', type: 'text', content: '<p>A  B\tC\nD</p>' }])
    expect(bodyOf(doc, 'box').content[0].content[0].text).toBe('A  B\tC\nD')
    expect(dropped).toEqual([])
  })

  it('keeps a styled run of spaces', () => {
    const content = '<p>a<span style="font-size: 40px">  </span>b</p>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [, spaces] = bodyOf(doc, 'box').content[0].content
    expect(spaces.text).toBe('  ')
    expect(spaces.marks[0].attrs.fontSize).toBe('40px')
  })

  it('keeps a line at the height the box gave it', () => {
    const { doc } = converted([
      { id: 'box', type: 'text', lineHeight: 3, content: '<p>A<br>B</p>' },
    ])
    const [paragraph] = bodyOf(doc, 'box').content
    expect(paragraph.attrs.lineHeight).toBe('3')
  })

  it('leaves a line height the old HTML states', () => {
    const content = '<p style="line-height: 2">A</p>'
    const { doc } = converted([{ id: 'box', type: 'text', lineHeight: 3, content }])
    const [paragraph] = bodyOf(doc, 'box').content
    expect(paragraph.attrs.lineHeight).toBe('2')
  })

  it('saves no empty colour where the old HTML has none', () => {
    const { doc } = converted([
      { id: 'box', type: 'text', content: '<p><span style="font-size: 24px">a</span></p>' },
    ])
    const [{ attrs }] = bodyOf(doc, 'box').content[0].content[0].marks
    expect(attrs.fontSize).toBe('24px')
    expect(attrs.color).toBeNull()
  })

  it('keeps an item style on a break, where it sets a blank line', () => {
    const content = '<ul><li style="font-size: 40px"><p>x<br><br>y</p></li></ul>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [{ content: items }] = bodyOf(doc, 'box').content
    const inline = items[0].content[0].content
    expect(inline.map((node: { type: string }) => node.type)).toEqual([
      'text',
      'hardBreak',
      'hardBreak',
      'text',
    ])
    expect(inline[1].marks[0].attrs.fontSize).toBe('40px')
    expect(inline[2].marks[0].attrs.fontSize).toBe('40px')
  })

  it('draws a document body as the old view did, its first colour on the rest of the item', () => {
    const red = [{ type: 'textStyle', attrs: { color: 'red' } }]
    const paragraph = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'c', marks: red },
        { type: 'text', text: 'd' },
      ],
    }
    const item = { type: 'listItem', content: [paragraph] }
    const content = { type: 'doc', content: [{ type: 'bulletList', content: [item] }] }
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(run.text).toBe('cd')
    expect(run.marks[0].attrs.color).toBe('red')
  })

  it('fades the text under a faded list item', () => {
    const content =
      '<ul><li style="opacity: 0.5"><p>a<span style="opacity: 0.5">b</span></p></li></ul>'
    const { doc, dropped } = converted([{ id: 'box', type: 'text', content }])
    const [first, second] = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(first.marks[0].attrs.opacity).toBe(50)
    expect(second.marks[0].attrs.opacity).toBe(25)
    expect(dropped).toEqual([])
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

describe('what the deck draws, against the old view', () => {
  // As CSS inheritance does, from the element a character sits in up to the box
  function drawn(root: Element, name: string) {
    for (let at: Element | null = root; at; at = at.parentElement) {
      const value = (at as HTMLElement).style?.getPropertyValue(name)
      if (value) {
        return value
      }
    }

    return ''
  }

  // Through what the converted view draws: `drawnSlides`, so the editor's list item renderer
  function contentOf(doc: Y.Doc) {
    const [slide] = drawnSlides(doc)
    const [box] = slide.elements
    return box.content as string
  }

  function drawnParts(html: string) {
    const { body } = new DOMParser().parseFromString(html, 'text/html')
    function textOf(text: string) {
      const holders = [...body.querySelectorAll('p, span')]
      return holders.find((holder) =>
        [...holder.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent === text,
        ),
      )!
    }

    return { item: body.querySelector('li')!, textOf }
  }

  function drawnDeck(box: OldBox) {
    const { doc, dropped } = converted([box])
    return { dropped, ...drawnParts(contentOf(doc)) }
  }

  function textBox(content: string): OldBox {
    return { id: 'box', type: 'text', content }
  }

  // A deck holding this list body as it stands, which the converter would not save
  function deckHolding(content: unknown[]) {
    const item = { type: 'listItem', content: [{ type: 'paragraph', content }] }
    const list = { type: 'bulletList', content: [item] }
    const doc = new Y.Doc()
    writeDeck(doc, [{ id: 'slide', boxes: [{ id: 'box', type: 'text' }] }])
    prosemirrorToYXmlFragment(
      schema.nodeFromJSON({ type: 'doc', content: [list] }),
      boxText(doc, 'box') as Y.XmlFragment,
    )
    return drawnParts(contentOf(doc))
  }

  it('refuses a first text size the item renderer would spread to the next text and the indent', () => {
    const html =
      '<ul><li style="color: red"><p><span style="font-size: 40px">A</span>B</p></li></ul>'
    const big = [{ type: 'textStyle', attrs: { color: 'red', fontSize: '40px' } }]
    const red = [{ type: 'textStyle', attrs: { color: 'red' } }]
    const saved = deckHolding([
      { type: 'text', text: 'A', marks: big },
      { type: 'text', text: 'B', marks: red },
    ])
    const old = drawnParts(html)
    expect(drawn(old.textOf('B'), 'font-size')).toBe('')
    expect(drawn(old.item, 'font-size')).toBe('')
    expect(drawn(saved.textOf('B'), 'font-size')).toBe('40px')
    expect(drawn(saved.item, 'font-size')).toBe('40px')
    expect(refusal({ content: html })).toMatchObject({ detail: 'html' })
  })

  it('refuses an unstyled item whose first text size the renderer would spread', () => {
    const html = '<ul><li><p><span style="font-size: 40px">a</span>b</p></li></ul>'
    const big = [{ type: 'textStyle', attrs: { fontSize: '40px' } }]
    const saved = deckHolding([
      { type: 'text', text: 'a', marks: big },
      { type: 'text', text: 'b' },
    ])
    expect(drawn(drawnParts(html).item, 'font-size')).toBe('')
    expect(drawn(saved.item, 'font-size')).toBe('40px')
    expect(drawn(saved.textOf('b'), 'font-size')).toBe('40px')
    expect(refusal({ content: html })).toMatchObject({ detail: 'html' })
  })

  it('draws an unstyled item with one coloured text the same but for its bullet, and says so', () => {
    const html = '<ul><li><p><span style="color: red">a</span></p></li></ul>'
    const { item, textOf, dropped } = drawnDeck(textBox(html))
    const old = drawnParts(html)
    expect(drawn(textOf('a'), 'color')).toBe(drawn(old.textOf('a'), 'color'))
    expect(drawn(item, 'font-size')).toBe(drawn(old.item, 'font-size'))
    expect(drawn(old.item, 'color')).toBe('')
    expect(drawn(item, 'color')).toBe('red')
    expect(dropped).toEqual([{ kind: 'list-marker-style' }])
  })

  it('draws an item style on text, bullet and indent as the old view did', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox(
        '<ul><li style="color: red; font-size: 40px"><p>a<span style="color: blue">b</span></p></li></ul>',
      ),
    )
    expect(drawn(textOf('a'), 'color')).toBe('red')
    expect(drawn(textOf('b'), 'color')).toBe('blue')
    expect(drawn(textOf('b'), 'font-size')).toBe('40px')
    expect(drawn(item, 'color')).toBe('red')
    expect(drawn(item, 'font-size')).toBe('40px')
    expect(dropped).toEqual([])
  })

  it.each([
    [
      'an item colour its text overrides',
      '<ul><li style="color: red"><p><span style="color: blue">a</span></p></li></ul>',
    ],
    ['an item colour with no text', '<ul><li style="color: red"><p></p></li></ul>'],
    [
      'an item spacing its text overrides',
      '<ul><li style="letter-spacing: 2px"><p><span style="letter-spacing: 1px">a</span></p></li></ul>',
    ],
    [
      'an unstyled item with coloured first text',
      '<ul><li><p><span style="color: red">a</span></p></li></ul>',
    ],
    [
      'a marker faded from the first text',
      '<ul><li><p><span style="opacity: 0.5">a</span></p></li></ul>',
    ],
  ])('records a bullet-only change: %s', (_name, content) => {
    const { dropped } = converted([textBox(content)])
    expect(dropped).toEqual([{ kind: 'list-marker-style' }])
  })

  it('keeps the body when the bullet alone changes', () => {
    const { textOf } = drawnDeck(
      textBox('<ul><li style="color: red"><p><span style="color: blue">a</span></p></li></ul>'),
    )
    expect(drawn(textOf('a'), 'color')).toBe('blue')
  })

  it('carries rather than drops an item style that reaches body text', () => {
    const { textOf, dropped } = drawnDeck(
      textBox('<ul><li style="color: red"><p>a<span style="color: blue">b</span></p></li></ul>'),
    )
    expect(drawn(textOf('a'), 'color')).toBe('red')
    expect(dropped).toEqual([])
  })

  it('drops a horizontal rule and keeps the text around it', () => {
    const { doc, dropped } = converted([textBox('<p>a</p><hr><p>b</p>')])
    expect(dropped).toEqual([{ kind: 'horizontal-rule' }])
    expect(
      bodyOf(doc, 'box').content.map(
        ({ content }: { content: { text: string }[] }) => content[0].text,
      ),
    ).toEqual(['a', 'b'])
  })

  it.each([
    [
      'a table as wide as its box',
      '<table style="width: 100%"><tr><td><p>a</p></td><td><p>b</p></td></tr></table>',
      300,
      150,
    ],
    [
      'a stated width with an equal minimum',
      '<table style="width: 50px; min-width: 50px"><tr><td><p>a</p></td><td><p>b</p></td></tr></table>',
      500,
      25,
    ],
  ])('carries %s to its cells', (_name, content, width, column) => {
    const { doc, dropped } = converted([{ id: 'box', type: 'table', width, content }])
    const [{ content: rows }] = bodyOf(doc, 'box').content
    expect(rows[0].content[0].attrs.colwidth).toEqual([column])
    expect(rows[0].content[1].attrs.colwidth).toEqual([column])
    expect(dropped).toEqual([])
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
      'a list item size only its first text holds, which reaches the indent and the next text',
      {
        content:
          '<ul><li style="color: red"><p><span style="font-size: 40px">A</span>B</p></li></ul>',
      },
      'html',
    ],
    [
      'an unstyled list item whose first colour would reach its next text',
      { content: '<ul><li><p><span style="color: red">a</span>b</p></li></ul>' },
      'html',
    ],
    [
      'an unstyled list item whose first size would change its indent',
      { content: '<ul><li><p><span style="font-size: 40px">a</span></p></li></ul>' },
      'html',
    ],
    [
      'a first text colour that would spread to an unstyled nested list',
      {
        content:
          '<ul><li><p><span style="color: red">a</span></p><ul><li><p>b</p></li></ul></li></ul>',
      },
      'html',
    ],
    [
      'a list item with text in no paragraph, which draws no bullet',
      { content: '<ul><li>a</li></ul>' },
      'html',
    ],
    [
      'a table with column widths and no width of its own, which only a browser can lay out',
      {
        type: 'table',
        content:
          '<table><colgroup><col style="width: 50px"></colgroup><tr><td><p>a</p></td></tr></table>',
      },
      'html',
    ],
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
