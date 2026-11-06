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
import { drawnSlides } from './drawnDeck'
import { slidesFault } from './fault'
import { compareBodies } from './oldBody'

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
    expect(items[0].content[0].content.at(-1).marks[0].attrs.opacity).toBe(50)
  })

  it('takes italic written as a style', () => {
    const content = '<p><span style="font-style: italic">a</span></p>'
    const { doc } = converted([{ id: 'box', type: 'text', content }])
    expect(bodyOf(doc, 'box').content[0].content[0].marks).toContainEqual({ type: 'italic' })
  })

  it.each(['700', 'bold'])('takes a %s weight as bold', (weight) => {
    const content = `<p><span style="font-weight: ${weight}">a</span></p>`
    const { doc, dropped } = converted([{ id: 'box', type: 'text', content }])
    expect(bodyOf(doc, 'box').content[0].content[0].marks).toContainEqual({ type: 'bold' })
    expect(dropped).toEqual([])
  })

  it.each([
    ['alone', '<p><span style="font-weight: 400">a</span></p>'],
    ['inside bold', '<p><strong><span style="font-weight: 400">a</span></strong></p>'],
    ['written as normal', '<p><span style="font-weight: normal">a</span></p>'],
  ])('takes a normal weight %s as plain text', (_name, content) => {
    const { doc, dropped } = converted([{ id: 'box', type: 'text', content }])
    expect(bodyOf(doc, 'box').content[0].content[0].marks ?? []).not.toContainEqual({
      type: 'bold',
    })
    expect(dropped).toEqual([])
  })

  it('takes a bold list item, saying its bullet changes and adding no text', () => {
    const content = '<ul><li style="font-weight: 700"><p>a</p></li></ul>'
    const { doc, dropped } = converted([{ id: 'box', type: 'text', content }])
    const [{ content: texts }] = bodyOf(doc, 'box').content[0].content[0].content
    expect(texts.map(({ text }: { text: string }) => text)).toEqual(['a'])
    expect(texts[0].marks).toContainEqual({ type: 'bold' })
    expect(dropped).toEqual([{ kind: 'list-marker-style' }])
  })

  it('keeps the bullet of an item whose text alone is bold', () => {
    const content = '<ul><li><p><span style="font-weight: 700">a</span></p></li></ul>'
    expect(converted([{ id: 'box', type: 'text', content }]).dropped).toEqual([])
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

  it('holds an unstyled item look on a zero-width run, so only its first text changes colour', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox('<ul><li><p><span style="color: red">a</span>b</p></li></ul>'),
    )
    expect(drawn(textOf('a'), 'color')).toBe('red')
    expect(drawn(textOf('b'), 'color')).toBe('')
    expect(drawn(item, 'color')).toBe('')
    expect(dropped).toEqual([])
  })

  it('keeps an item indent and its next text when only the first text is big', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox('<ul><li><p><span style="font-size: 40px">a</span>b</p></li></ul>'),
    )
    expect(drawn(textOf('a'), 'font-size')).toBe('40px')
    expect(drawn(textOf('b'), 'font-size')).toBe('')
    expect(drawn(item, 'font-size')).toBe('')
    expect(dropped).toEqual([])
  })

  it('keeps a nested list from the colour of its parent item first text', () => {
    const { textOf, dropped } = drawnDeck(
      textBox(
        '<ul><li><p><span style="color: red">a</span></p><ul><li><p>b</p></li></ul></li></ul>',
      ),
    )
    expect(drawn(textOf('b'), 'color')).toBe('')
    expect(dropped).toEqual([])
  })

  it('keeps a styled item bullet when its first text differs', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox('<ul><li style="color: red"><p><span style="color: blue">a</span></p></li></ul>'),
    )
    expect(drawn(item, 'color')).toBe('red')
    expect(drawn(textOf('a'), 'color')).toBe('blue')
    expect(dropped).toEqual([])
  })

  it('keeps an ordered item marker font, which sets its column', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox(
        '<ol><li style="font-family: Inter"><p><span style="font-family: Arial">a</span></p></li></ol>',
      ),
    )
    expect(drawn(item, 'font-family')).toBe('Inter')
    expect(drawn(textOf('a'), 'font-family')).toBe('Arial')
    expect(dropped).toEqual([])
  })

  it('adds no words to hold a look, only one zero-width space', () => {
    const { doc } = converted([
      textBox('<ul><li><p><span style="color: red">a</span>b</p></li></ul>'),
    ])
    const runs = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(runs.map(({ text }: { text: string }) => text).join('')).toBe('​ab')
  })

  it('adds nothing to an item whose first text already draws its look', () => {
    const { doc, dropped } = converted([textBox('<ul><li><p>a</p></li></ul>')])
    const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(run.text).toBe('a')
    expect(dropped).toEqual([])
  })

  it('adds nothing for a bullet letter spacing, which moves no pixel', () => {
    const { doc, dropped } = converted([
      textBox('<ul><li><p><span style="letter-spacing: 2px">a</span></p></li></ul>'),
    ])
    const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(run.text).toBe('a')
    expect(dropped).toEqual([])
  })

  it('holds an ordered item letter spacing, which moves its right-aligned number', () => {
    const { doc, dropped } = converted([
      textBox('<ol><li><p><span style="letter-spacing: 2px">a</span></p></li></ol>'),
    ])
    const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(run.text).toBe('​')
    expect(dropped).toEqual([])
  })

  it('keeps a red bullet and blue text when the item colour is marked important', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox(
        '<ul><li style="color: #ff0000 !important"><p><span style="color: blue">a</span></p></li></ul>',
      ),
    )
    expect(drawn(item, 'color')).toBe('rgb(255, 0, 0)')
    expect(drawn(textOf('a'), 'color')).toBe('blue')
    expect(dropped).toEqual([])
  })

  it('keeps text after a spaced first text off its letter spacing', () => {
    const { item, textOf, dropped } = drawnDeck(
      textBox('<ul><li><p><span style="letter-spacing: 10px">a</span>b</p></li></ul>'),
    )
    expect(drawn(item, 'letter-spacing')).toBe('')
    expect(drawn(textOf('b'), 'letter-spacing')).toBe('')
    expect(dropped).toEqual([])
  })

  describe('whitespace a table cell draws', () => {
    function tableBox(cell: string) {
      return {
        id: 'box',
        type: 'table',
        width: 200,
        content: `<table style="width: 200px"><colgroup><col style="width: 200px"></colgroup><tbody><tr><td colwidth="200">${cell}</td></tr></tbody></table>`,
      }
    }

    function isRefused(cell: string) {
      return refusal(tableBox(cell)).kind === 'failed'
    }

    it('keeps the plain space after a spaced first text off its letter spacing', () => {
      const { item, textOf, dropped } = drawnDeck(
        tableBox(
          '<ul><li style="font-size: 18px"><p><span style="letter-spacing: 10px">a</span> <span style="letter-spacing: 0px">b</span></p></li></ul>',
        ),
      )
      expect(drawn(item, 'letter-spacing')).toBe('')
      expect(drawn(textOf('a'), 'letter-spacing')).toBe('10px')
      expect(drawn(textOf('b'), 'letter-spacing')).toBe('0px')
      expect(dropped).toEqual([])
    })

    it('refuses a style on a space between words that the saved body has no place for', () => {
      expect(isRefused('<p>a<span style="word-spacing: 5px"> </span>b</p>')).toBe(true)
    })

    it('keeps a space between words in the size it drew at', () => {
      const { doc } = converted([
        tableBox('<p>a<span style="font-size: 40px"> </span>b</p>') as OldBox,
      ])
      const [, space] = bodyOf(doc, 'box').content[0].content[0].content[0].content[0].content
      expect(space.text).toBe(' ')
      expect(space.marks[0].attrs.fontSize).toBe('40px')
    })

    it('ignores whitespace a cell folds away when only marks and inherited styles hold it', () => {
      expect(isRefused('\n<p> a  b\n</p>\n')).toBe(false)
      expect(isRefused('<p><strong> </strong>a <em> </em>b</p>')).toBe(false)
      expect(isRefused('<p>a <span style="color: red"> </span>b</p>')).toBe(false)
    })

    it.each([
      ['padding', '<p><span style="padding: 20px"> </span>A</p>'],
      [
        'own box',
        '<p><span style="display: inline-block; width: 40px; height: 40px"> </span>A</p>',
      ],
      ['border', '<p>A<span style="border: 2px solid red"> </span></p>'],
      ['margin', '<p>A <span style="margin-left: 20px"> </span>B</p>'],
      ['outline', '<p>A <span style="outline: 2px solid red">  </span>B</p>'],
      ['class', '<p><span class="box"> </span>A</p>'],
      ['word spacing', '<p>a<span style="word-spacing: 5px"> </span></p>'],
      ['padding, in a list item', '<ul><li><p><span style="padding: 20px"> </span>A</p></li></ul>'],
      ['padding, on no text at all', '<p>A<span style="padding: 20px"></span>B</p>'],
    ])('refuses a space that folds away while its run holds %s', (_n, cell) => {
      expect(isRefused(cell)).toBe(true)
    })

    it.each([
      ['between words', '<p>a <span style="font-size: 40px"> </span>b</p>'],
      ['at the end of a line', '<p>a<span style="font-size: 40px"> </span></p>'],
      ['at the start of a line', '<p><span style="line-height: 3"> </span>a</p>'],
    ])('refuses a folded space %s that a browser still makes its line taller for', (_n, cell) => {
      expect(isRefused(cell)).toBe(true)
    })

    it('keeps a space between bare runs in a cell', () => {
      const { doc } = converted([tableBox('<span>a</span> <span>b</span>') as OldBox])
      const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content[0].content
      expect(run.text).toBe('a b')
    })

    it('refuses a look run that would make a folded leading space draw', () => {
      expect(
        isRefused(
          '<ul><li style="color: red"><p><span style="color: blue"> a</span></p></li></ul>',
        ),
      ).toBe(true)
    })
  })

  describe('a box an empty run draws in a text box', () => {
    it.each([
      ['padding', '<p>A<span style="padding: 20px"></span>B</p>'],
      ['own box', '<p><span style="display: inline-block; width: 40px"></span>A</p>'],
      ['padding, in a list item', '<ul><li><p>A<span style="padding: 20px"></span></p></li></ul>'],
    ])('refuses an empty run that holds %s', (_n, content) => {
      expect(refusal({ content }).kind).toBe('failed')
    })

    it('still converts an empty run of marks', () => {
      expect(refusal({ content: '<p>A<strong></strong>B</p>' }).kind).toBe('converted')
    })
  })

  describe('a first character a look run can change', () => {
    it.each([
      ['a combining accent', '́'],
      ['a spacing mark', 'ः'],
      ['an enclosing mark', '⃝'],
      ['a zero-width joiner', '‍'],
      ['a zero-width non-joiner', '‌'],
      ['a word joiner', '⁠'],
      ['a variation selector', '️'],
      ['a supplementary variation selector', '\u{e0100}'],
      ['an emoji modifier', '\u{1f3fb}'],
      ['a conjoining Hangul vowel', 'ᅠ'],
    ])('refuses %s where a run is needed', (_name, first) => {
      const content = `<ol><li style="letter-spacing: 10px"><p><span style="color: red">${first}ab</span></p></li></ol>`
      expect(refusal({ content })).toEqual({ kind: 'failed', reason: 'check', detail: 'html' })
    })

    it('leaves it alone where no run is needed', () => {
      const { doc, dropped } = converted([textBox('<ul><li><p>́ab</p></li></ul>')])
      const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content
      expect(run.text).toBe('́ab')
      expect(dropped).toEqual([])
    })

    it('still compares a zero-width space the old body had, which is not the look run', () => {
      function parsed(html: string) {
        return new DOMParser().parseFromString(`<body>${html}`, 'text/html').body
      }

      const rules = { lineHeight: '1.5', isWhitespaceKept: true }
      const { isSameBody } = compareBodies(
        parsed('<ul><li><p>​a</p></li></ul>'),
        parsed('<ul><li><p>a</p></li></ul>'),
        rules,
        new Set(),
      )
      expect(isSameBody).toBe(false)
    })
  })

  describe('a run only where the bullet needs one', () => {
    it('adds none for a first text whose size reads the same on the bullet', () => {
      const { doc, dropped } = converted([
        textBox(
          '<ul><li style="font-size: 28px"><p><span style="font-size: 28.5px">a</span></p></li></ul>',
        ),
      ])
      const [run] = bodyOf(doc, 'box').content[0].content[0].content[0].content
      expect(run.text).toBe('a')
      expect(dropped).toEqual([])
    })

    it('adds none on a nested item that inherits its fade from the item above', () => {
      const { doc, dropped } = converted([
        textBox(
          '<ul><li style="--marker-opacity: 0.5"><p>a</p><ul><li><p>b</p></li></ul></li></ul>',
        ),
      ])
      const outer = bodyOf(doc, 'box').content[0].content[0].content
      const nested = outer[1].content[0].content[0].content
      expect(nested[0].text).toBe('b')
      expect(outer[0].content[0].text).toBe('​')
      expect(dropped).toEqual([])
    })

    it('holds a bullet behind a leading run the deck already had, with no record', () => {
      const { doc, dropped } = converted([
        textBox('<ul><li><p><span style="opacity: 0.5">​a</span>b</p></li></ul>'),
      ])
      const runs = bodyOf(doc, 'box').content[0].content[0].content[0].content
      expect(runs.map(({ text }: { text: string }) => text).join('')).toBe('​​ab')
      expect(dropped).toEqual([])
    })
  })

  it.each([
    ['a fade over text faded differently', '0.504', '<span style="opacity: 0.5">a</span>'],
    ['a fade that no whole percent holds', '0.504', 'a'],
    ['an unreadable word', 'lots', 'a'],
    ['not a number', 'nan', 'a'],
    ['a percent', '50%', 'a'],
    ['nothing', '', 'a'],
  ])('refuses a bullet with %s', (_name, value, text) => {
    const content = `<ul><li style="--marker-opacity: ${value}"><p>${text}</p></li></ul>`
    expect(refusal({ content })).toEqual({ kind: 'failed', reason: 'check', detail: 'html' })
  })

  it('takes the declaration that wins by priority, not the last one written', () => {
    const { textOf } = drawnDeck(
      textBox('<ul><li style="color: red !important; color: blue"><p>a</p></li></ul>'),
    )
    expect(drawn(textOf('a'), 'color')).toBe('red')
  })

  it('takes an inherit keyword with no outer value as saying nothing', () => {
    const { dropped } = converted([textBox('<p><span style="color: inherit">a</span></p>')])
    expect(dropped).toEqual([])
  })

  it('carries an item colour past a span that says to inherit it', () => {
    const { textOf } = drawnDeck(
      textBox('<ul><li style="color: red"><p><span style="color: inherit">a</span></p></li></ul>'),
    )
    expect(drawn(textOf('a'), 'color')).toBe('red')
  })

  it('keeps the blank line that leading whitespace draws', () => {
    const { doc, dropped } = converted([textBox('\n<p>a</p>')])
    const { content } = bodyOf(doc, 'box')
    expect(
      content.map(({ content: runs }: { content: { text: string }[] }) => runs[0].text),
    ).toEqual(['\n', 'a'])
    expect(dropped).toEqual([])
  })

  it('takes a product of whole percents as whole, whatever the floats answer', () => {
    const { doc } = converted([
      textBox('<ul><li style="opacity: 0.7"><p><span style="opacity: 0.3">a</span></p></li></ul>'),
    ])
    const runs = bodyOf(doc, 'box').content[0].content[0].content[0].content
    expect(runs.at(-1).marks[0].attrs.opacity).toBe(21)
  })

  it('keeps a table as the editor saved it, with its whole widths and minimum', () => {
    const content = `<table style="width: 100px"><colgroup><col style="width: 40px"><col style="width: 60px"></colgroup><tbody><tr><td colspan="1" rowspan="1" colwidth="40"><p>a</p></td><td colspan="1" rowspan="1" colwidth="60"><p>b</p></td></tr></tbody></table>`
    const { doc, dropped } = converted([{ id: 'box', type: 'table', width: 100, content }])
    const [{ content: rows }] = bodyOf(doc, 'box').content
    expect(rows[0].content[1].attrs.colwidth).toEqual([60])
    expect(dropped).toEqual([])
  })

  it('keeps a table with no widths at the minimum the editor draws', () => {
    const content =
      '<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><td colspan="1" rowspan="1"><p>a</p></td></tr></tbody></table>'
    const { dropped } = converted([{ id: 'box', type: 'table', width: 100, content }])
    expect(dropped).toEqual([])
  })

  it('keeps bold in a header cell', () => {
    const content =
      '<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p><strong>a</strong></p></th></tr></tbody></table>'
    expect(converted([{ id: 'box', type: 'table', width: 100, content }]).dropped).toEqual([])
  })

  // A header cell draws at 600, so its bold draws heavier than 700
  it('refuses a 700 weight in a header cell, which saved as bold would draw heavier', () => {
    const content =
      '<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p><span style="font-weight: 700">a</span></p></th></tr></tbody></table>'
    expect(refusal({ type: 'table', width: 100, content })).toEqual({
      kind: 'failed',
      reason: 'check',
      detail: 'html',
    })
  })

  it.each([
    ['text after it', '<p>x<hr>y</p>'],
    ['text before it', 'x<hr><p>y</p>'],
  ])(
    'refuses a horizontal rule with %s, which the parser splits out of a paragraph',
    (_n, content) => {
      expect(refusal({ content })).toEqual({ kind: 'failed', reason: 'check', detail: 'html' })
    },
  )

  it('drops a horizontal rule and keeps the text around it', () => {
    const { doc, dropped } = converted([textBox('<p>a</p><hr><p>b</p>')])
    expect(dropped).toEqual([{ kind: 'horizontal-rule' }])
    expect(
      bodyOf(doc, 'box').content.map(
        ({ content }: { content: { text: string }[] }) => content[0].text,
      ),
    ).toEqual(['a', 'b'])
  })

  it('saves a box that holds only rules as an empty box, as the old view draws it', () => {
    const { doc, dropped } = converted([
      textBox('<hr><hr>'),
      { id: 'empty', type: 'text', content: '' },
    ])
    expect(dropped).toEqual([{ kind: 'horizontal-rule' }])
    expect(bodyOf(doc, 'box')).toEqual(bodyOf(doc, 'empty'))
  })
})

describe('refusals', () => {
  // The old view's sanitizer takes these off, so they never reach the screen
  it.each([
    ['a plain link', '<p><a>a</a></p>'],
    ['a styled link', '<p><a href="x" style="color: red">a</a></p>'],
    ['a code tag', '<p><code>a</code></p>'],
    ['href on a span', '<p><span href="x">a</span></p>'],
    ['start on a bullet list', '<ul start="3"><li><p>a</p></li></ul>'],
  ])('converts %s, which the old view never draws', (_name, content) => {
    expect(refusal({ content }).kind).toBe('converted')
  })

  // Old draws plain text here and the saved deck would draw a line through it
  it.each(['del', 'strike'])('refuses %s, whose line the old view never drew', (tag) => {
    expect(refusal({ content: `<p><${tag}>a</${tag}></p>` })).toEqual({
      kind: 'failed',
      reason: 'check',
      detail: 'html',
    })
  })

  it.each([
    ['HTML the editor has no place for', { content: '<p>a</p><img src="x.png">' }, 'html'],
    ['a heading the editor would flatten', { content: '<h1>a</h1>' }, 'html'],
    [
      'a style the editor would lose',
      { content: '<p><span style="text-shadow: 1px 1px red">a</span></p>' },
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
      'a span that inherits a colour its saved mark would lose',
      { content: '<p><span style="color: red"><span style="color: inherit">a</span></span></p>' },
      'html',
    ],
    [
      'a span that inherits a font its saved mark would lose',
      {
        content:
          '<p><span style="font-family: serif"><span style="font-family: inherit">a</span></span></p>',
      },
      'html',
    ],
    ['a hidden break', { content: '<p>a<br style="display: none">b</p>' }, 'html'],
    ['a classed break', { content: '<p>a<br class="hidden">b</p>' }, 'html'],
    ['a sized break', { content: '<p>a<br style="font-size: 80px">b</p>' }, 'html'],
    [
      'a table minimum the editor would replace',
      {
        type: 'table',
        content: '<table style="min-width: 1000px"><tr><td><p>a</p></td></tr></table>',
      },
      'html',
    ],
    [
      'a fractional table width',
      {
        type: 'table',
        content:
          '<table style="width: 100.4px"><tr><td><p>a</p></td><td><p>b</p></td></tr></table>',
      },
      'html',
    ],
    [
      'a table as wide as its box, whose equal columns need a browser',
      {
        type: 'table',
        width: 100,
        content:
          '<table style="width: 100%"><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></table>',
      },
      'html',
    ],
    [
      'a stated width with an equal minimum and no cell widths',
      {
        type: 'table',
        content:
          '<table style="width: 50px; min-width: 50px"><tr><td><p>a</p></td><td><p>b</p></td></tr></table>',
      },
      'html',
    ],
    [
      'an opacity a whole percent would change',
      { content: '<ul><li><p><span style="opacity: 0.504">a</span></p></li></ul>' },
      'html',
    ],
    [
      'a faded item a whole percent would hide',
      { content: '<ul><li style="opacity: 0.004"><p>a</p></li></ul>' },
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
