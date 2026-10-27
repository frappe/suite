import { generateJSON, type JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { XmlText, type XmlElement } from 'yjs'

import { convertLegacy } from '@/apps/writer/collab/conversion'
import {
  bodyOf,
  convert,
  drawnColours,
  INK,
  legacyDoc,
  MAX_STATE,
  openConverted,
  SRC,
  stored,
  yAtom,
  yElement,
  yHeading,
  yMarked,
  yParagraph,
} from '@/apps/writer/collab/legacy-fixtures'
import { writerSchema } from '@/apps/writer/schema'

// Each block's tag, left margin with its priority, and line height, as the editor draws them
function blockLayout(state: Uint8Array) {
  return [...openConverted(state).view.dom.children].map((element) => {
    const { style } = element as HTMLElement
    const margin = style.getPropertyValue('margin-left')
    return [element.localName, margin, style.getPropertyPriority('margin-left'), style.lineHeight]
  })
}

// Each block's alignment, as stored and as the editor draws it
function alignments(state: Uint8Array) {
  const held = bodyOf(state).content.map((block: JSONContent) => block.attrs?.textAlign)
  const drawn = [...openConverted(state).view.dom.children].map(
    (element) => (element as HTMLElement).style.textAlign,
  )
  return { stored: held, drawn }
}

describe('convertLegacy', () => {
  it('refuses a Yjs body whose link holds an attribute the link mark lacks', () => {
    const legacy = stored(legacyDoc(yMarked('go', { link: { href: '/a', tracking: 'x1' } })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a Yjs body whose paragraph holds an attribute paragraphs lack', () => {
    const block = yParagraph('one')
    block.setAttribute('align', 'mid')

    expect(convertLegacy(stored(legacyDoc(block)), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("converts Drive's blocks that hold its default indent and heading line height (R331)", () => {
    const block = yParagraph('one')
    block.setAttribute('indent', 0 as never)
    block.setAttribute('lineHeight', '100%')
    const heading = yHeading('Two')
    heading.setAttribute('indent', 0 as never)
    heading.setAttribute('lineHeight', '100%')

    const result = convert(stored(legacyDoc(block, heading)))

    const blocks = bodyOf(result.state).content.map((converted: JSONContent) => [
      converted.type,
      converted.attrs?.lineHeight ?? null,
      converted.content?.[0].text,
    ])
    expect(blocks).toEqual([
      ['paragraph', '100%', 'one'],
      ['heading', null, 'Two'],
    ])
  })

  it("keeps Drive's indent and heading line height, drawn as Drive drew them", () => {
    const block = yParagraph('one')
    block.setAttribute('indent', 24 as never)
    const heading = yHeading('Two')
    heading.setAttribute('indent', 48 as never)
    heading.setAttribute('lineHeight', '150%')

    const result = convert(stored(legacyDoc(block, heading)))

    expect(bodyOf(result.state).content.map((converted: JSONContent) => converted.attrs)).toEqual([
      expect.objectContaining({ indent: 24, lineHeight: null }),
      expect.objectContaining({ indent: 48, lineHeight: '150%' }),
    ])
    expect(blockLayout(result.state)).toEqual([
      ['p', '24px', 'important', ''],
      ['h2', '48px', 'important', '150%'],
    ])
    expect(result.dropped).toEqual([])
  })

  it('keeps a negative indent and one past the widest Drive offered', () => {
    const block = yParagraph('one')
    block.setAttribute('indent', -24 as never)
    const heading = yHeading('Two')
    heading.setAttribute('indent', 264 as never)

    const result = convert(stored(legacyDoc(block, heading)))

    expect(blockLayout(result.state)).toEqual([
      ['p', '-24px', 'important', ''],
      ['h2', '264px', 'important', ''],
    ])
  })

  it.each([
    { name: 'a text zero indent', build: yParagraph, indent: '0' },
    { name: 'an indent in px', build: yParagraph, indent: '24px' },
    { name: 'an indent as text', build: yHeading, indent: '24' },
    { name: 'a fractional indent', build: yHeading, indent: 24.5 },
  ])('refuses a Yjs body holding $name', ({ build, indent }) => {
    const block = build('one')
    block.setAttribute('indent', indent as never)

    expect(convertLegacy(stored(legacyDoc(block)), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('refuses a Yjs list item holding a zero indent Drive never wrote there', () => {
    const item = yElement('listItem', yParagraph('one'))
    item.setAttribute('indent', 0 as never)

    expect(convertLegacy(stored(legacyDoc(yElement('bulletList', item))), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("keeps Drive's Yjs alignment on paragraphs and headings", () => {
    const centred = yParagraph('one')
    centred.setAttribute('textAlign', 'center')
    const heading = yHeading('Two')
    heading.setAttribute('textAlign', 'right')
    const left = yParagraph('three')
    left.setAttribute('textAlign', 'left')

    const result = convert(stored(legacyDoc(centred, heading, left)))

    expect(alignments(result.state)).toEqual({
      stored: ['center', 'right', 'left'],
      drawn: ['center', 'right', 'left'],
    })
    expect(result.dropped).toEqual([])
  })

  it("converts Drive's HTML blocks that hold its default indent (R331)", () => {
    const indent = 'style="margin-left: 0px!important;"'
    const html = `<p ${indent}>one</p><h2 ${indent}>Two</h2>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const blocks = bodyOf(result.state).content.map((block: JSONContent) => [
      block.type,
      block.content?.[0].text,
    ])
    expect(blocks).toEqual([
      ['paragraph', 'one'],
      ['heading', 'Two'],
    ])
    expect(blockLayout(result.state)).toEqual([
      ['p', '', '', ''],
      ['h2', '', '', ''],
    ])
  })

  it("keeps Drive's HTML indent and heading line height, bar its default line height", () => {
    const indent = 'margin-left: 24px!important;'
    const html =
      `<p style="${indent}">one</p><h2 style="${indent} line-height: 150%">Two</h2>` +
      '<h3 style="line-height: 100%">Three</h3>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect(blockLayout(result.state)).toEqual([
      ['p', '24px', 'important', ''],
      ['h2', '24px', 'important', '150%'],
      ['h3', '', '', ''],
    ])
    expect(result.dropped).toEqual([])
  })

  it('keeps HTML alignment on paragraphs and headings', () => {
    const html = '<p style="text-align: center">one</p><h2 style="text-align: justify">Two</h2>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect(alignments(result.state)).toEqual({
      stored: ['center', 'justify'],
      drawn: ['center', 'justify'],
    })
    expect(result.dropped).toEqual([])
  })

  it('converts HTML blocks aligned to start as the default alignment', () => {
    const html = '<p style="text-align: start">one</p><h2 style="text-align: start">Two</h2>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect(alignments(result.state)).toEqual({ stored: [null, null], drawn: ['', ''] })
    expect(result.dropped).toEqual([])
  })

  it('keeps the indent beside a start alignment', () => {
    const html = '<p style="margin-left: 24px!important; text-align: start">one</p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect(blockLayout(result.state)).toEqual([['p', '24px', 'important', '']])
    expect(result.dropped).toEqual([])
  })

  it.each([
    { name: 'aligned to end', html: '<p style="text-align: end">one</p>' },
    {
      name: "aligned to start and indented without Drive's priority",
      html: '<p style="text-align: start; margin-left: 24px">one</p>',
    },
    { name: "indented without Drive's priority", html: '<p style="margin-left: 24px">one</p>' },
    { name: "indented in a unit Drive didn't write", html: '<p style="margin-left: 2em">one</p>' },
    { name: 'holding formatting the editor has no mark for', html: '<p>x<sup>2</sup></p>' },
    { name: 'with a block attribute the editor drops', html: '<p dir="rtl">one</p>' },
  ])('refuses HTML $name', ({ html }) => {
    const legacy = { content: null, html, collab: 0, ycomments: null }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('converts a Yjs text style with a line height and keeps the line height', () => {
    const style = { textStyle: { color: 'red', lineHeight: '1.5' } }

    const result = convert(stored(legacyDoc(yMarked('tall', style))))

    const [{ content }] = bodyOf(result.state).content
    expect(content).toEqual([
      {
        type: 'text',
        text: 'tall',
        marks: [
          {
            type: 'textStyle',
            attrs: expect.objectContaining({ color: 'red', lineHeight: '1.5' }),
          },
        ],
      },
    ])
  })

  it('converts a Yjs text style whose values are all empty', () => {
    const empty = { color: null, fontFamily: null, fontSize: null, lineHeight: null }
    const style = { textStyle: { ...empty, backgroundColor: null } }

    const result = convert(stored(legacyDoc(yMarked('plain', style))))

    const [{ content }] = bodyOf(result.state).content
    expect(content.map(({ text }: { text: string }) => text)).toEqual(['plain'])
  })

  it('reads a line height on an HTML span as the text style line height', () => {
    const html = '<p><span style="line-height: 1.5">tall</span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(content).toEqual([
      {
        type: 'text',
        text: 'tall',
        marks: [{ type: 'textStyle', attrs: expect.objectContaining({ lineHeight: '1.5' }) }],
      },
    ])
  })

  it.each([
    { value: '#dc2626', name: 'red' },
    { value: '#1579d0', name: 'blue' },
    { value: '#1579D0', name: 'blue' },
    { value: 'rgb(220, 38, 38)', name: 'red' },
    { value: '#dd2222', name: 'red' },
    { value: 'pink', name: 'pink' },
    { value: '#6b7280', name: 'gray' },
    { value: 'rgb(107, 114, 128)', name: 'gray' },
    { value: '#808080', name: 'gray' },
    { value: ' #dc2626 ', name: 'red' },
    { value: 'var(--prose-color-red)', name: 'red' },
  ])('reads an old Yjs text colour $value as the palette colour $name', ({ value, name }) => {
    const result = convert(stored(legacyDoc(yMarked('word', { textStyle: { color: value } }))))

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['word', [['textStyle', name]]]])
  })

  it.each([
    '#1F272E',
    '#1f272e',
    'rgb(31, 39, 46)',
    'RGB(31, 39, 46)',
    '',
    'black',
    ' Black ',
    '#000000',
    'rgb(0, 0, 0)',
    '#111111',
    '#333333',
  ])(
    'drops an old Yjs text colour %j that looks like the default text or none, and keeps the rest of the style',
    (value) => {
      const style = { textStyle: { color: value, fontSize: '20px' } }

      const result = convert(stored(legacyDoc(yMarked('word', style))))

      const [{ content }] = bodyOf(result.state).content
      expect(content[0].marks).toEqual([
        { type: 'textStyle', attrs: expect.objectContaining({ color: null, fontSize: '20px' }) },
      ])
    },
  )

  it.each([
    '#333',
    'navy',
    'grey',
    '#6b7280junk',
    'x #6b7280 y',
    'rgb(107,114,128) junk',
    '#dc2626junk',
  ])('refuses an old Yjs text colour %s with no palette colour', (value) => {
    const legacy = stored(legacyDoc(yMarked('word', { textStyle: { color: value } })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('reads an old colour on a mention as its palette colour', () => {
    const mention = yAtom('mention', { id: 'x', label: 'Ann' })
    mention.setAttribute('textStyle', { color: '#dc2626' } as never)
    const legacy = stored(legacyDoc(yElement('paragraph', new XmlText('hi '), mention)))

    const result = convert(legacy)

    const shownMention = openConverted(result.state).state.doc.firstChild!.child(1)
    expect(shownMention.marks.map((mark) => mark.toJSON())).toEqual([
      { type: 'textStyle', attrs: expect.objectContaining({ color: 'red' }) },
    ])
  })

  it("moves an old Yjs text style's background colour onto the highlight as its palette colour", () => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { backgroundColor: '#fef9c3' } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(content[0].marks).toEqual([
      { type: 'namedHighlight', attrs: expect.objectContaining({ color: 'yellow' }) },
    ])
  })

  it.each([
    { value: '#e5e7eb', drawn: [['namedHighlight', 'gray']] },
    { value: 'rgb(229, 231, 235)', drawn: [['namedHighlight', 'gray']] },
    { value: 'transparent', drawn: [] },
    { value: 'rgba(254, 249, 195, 0)', drawn: [] },
    { value: 'rgb(254 249 195 / 0)', drawn: [] },
    { value: '#ffffff', drawn: [] },
    { value: 'rgb(255,255,255)', drawn: [] },
    { value: '#fafafa', drawn: [] },
    { value: 'rgba(255,255,255,0.5)', drawn: [] },
    { value: '#d1d5db', drawn: [['namedHighlight', 'gray']] },
    { value: '#f3f4f6', drawn: [] },
    { value: '#f1f2f4', drawn: [['namedHighlight', 'gray']] },
    { value: '#f6f2f1', drawn: [] },
    { value: '#f6f7eb', drawn: [] },
    { value: '#eafff1', drawn: [] },
    { value: '#e4fefa', drawn: [] },
    { value: '#f2f3f5', drawn: [] },
  ])('reads an old Yjs background colour $value as the highlight drawn', ({ value, drawn }) => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { backgroundColor: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', drawn]])
  })

  it.each(['black', 'navy', '#6b7280junk', 'x #6b7280 y', 'rgb(107,114,128) junk', 'x #fef9c3'])(
    'refuses an old Yjs background colour %s',
    (value) => {
      const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { backgroundColor: value } })))

      expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
    },
  )

  it.each([
    { value: '#fef9c3', drawn: [['namedHighlight', 'yellow']] },
    { value: '#e5e7eb', drawn: [['namedHighlight', 'gray']] },
    { value: 'yellow', drawn: [['namedHighlight', 'yellow']] },
    { value: 'transparent', drawn: [] },
    { value: '', drawn: [] },
  ])('reads an old Yjs highlight $value as the highlight drawn', ({ value, drawn }) => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', drawn]])
  })

  it('refuses an old Yjs highlight black', () => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: 'black' } })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([{}, { textStyle: { backgroundColor: '#fef9c3' } }])(
    'refuses an old Yjs highlight whose colour is not text, with the style %j',
    (style) => {
      const legacy = stored(legacyDoc(yMarked('lit', { ...style, namedHighlight: { color: 5 } })))

      expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
    },
  )

  it('reads an old highlight on a mention as its palette colour', () => {
    const mention = yAtom('mention', { id: 'x', label: 'Ann' })
    mention.setAttribute('namedHighlight', { color: '#fef9c3' } as never)
    const legacy = stored(legacyDoc(yElement('paragraph', new XmlText('hi '), mention)))

    const result = convert(legacy)

    const shownMention = openConverted(result.state).state.doc.firstChild!.child(1)
    expect(shownMention.marks.map((mark) => mark.toJSON())).toEqual([
      { type: 'namedHighlight', attrs: expect.objectContaining({ color: 'yellow' }) },
    ])
  })

  it.each([
    { value: '#e5e7eb', held: 'gray', drawn: [['namedHighlight', 'gray']] },
    { value: 'transparent', held: 'yellow', drawn: [['namedHighlight', 'yellow']] },
    { value: '#fef9c3', held: '', drawn: [['namedHighlight', 'yellow']] },
  ])(
    'reads an old background colour $value over a $held highlight as the highlight drawn',
    ({ value, held, drawn }) => {
      const marks = { textStyle: { backgroundColor: value }, namedHighlight: { color: held } }

      const result = convert(stored(legacyDoc(yMarked('lit', marks))))

      const [{ content }] = bodyOf(result.state).content
      expect(drawnColours(content)).toEqual([['lit', drawn]])
    },
  )

  it('converts an old background colour over a highlight of the same colour', () => {
    const marks = { textStyle: { backgroundColor: '#fef9c3' }, namedHighlight: { color: 'yellow' } }

    const result = convert(stored(legacyDoc(yMarked('lit', marks))))

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['namedHighlight', 'yellow']]]])
  })

  it.each([
    { value: '#fef9c3', held: 'red' },
    { value: '#e5e7eb', held: 'yellow' },
  ])('refuses an old background colour $value over a $held highlight', ({ value, held }) => {
    const marks = { textStyle: { backgroundColor: value }, namedHighlight: { color: held } }
    const legacy = stored(legacyDoc(yMarked('lit', marks)))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each(['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight'])(
    "refuses a Yjs text style whose %s holds a ';', which would end its style where it's drawn",
    (key) => {
      const style = { textStyle: { [key]: 'x; color: #dc2626' } }
      const legacy = stored(legacyDoc(yMarked('word', style)))

      expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
    },
  )

  it("refuses an HTML font family holding a ';' inside its quotes", () => {
    const html = `<p><span style="font-family: 'a; color: red'">word</span></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("converts a Yjs text style whose values hold no ';'", () => {
    const style = { color: 'red', fontFamily: 'Inter', fontSize: '20px', lineHeight: '1.5' }

    const result = convert(stored(legacyDoc(yMarked('word', { textStyle: style }))))

    const [{ content }] = bodyOf(result.state).content
    expect(content[0].marks).toEqual([{ type: 'textStyle', attrs: expect.objectContaining(style) }])
  })

  it.each([
    ['Inter;', 'Inter'],
    ['"Open Sans", serif; ', 'Open Sans, serif'],
    ['Inter; x', 'Inter'],
    ['Inter; Arial, sans-serif', 'Inter'],
    ['Inter; x; y; z', 'Inter'],
    ['"Brand Sans"; Fallback', 'Brand Sans'],
    ['Inter;  ;', 'Inter'],
    ['Inter; Noto Sans 日本', 'Inter'],
  ])("converts a Yjs font family %j as the family before its first ';'", (value, family) => {
    const legacy = stored(legacyDoc(yMarked('word', { textStyle: { fontFamily: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect([content[0].marks, result.dropped]).toEqual([
      [{ type: 'textStyle', attrs: expect.objectContaining({ fontFamily: family }) }],
      [],
    ])
  })

  it.each([';', '; x'])(
    "converts a Yjs font family %j with nothing before its ';' as no font",
    (value) => {
      const legacy = stored(legacyDoc(yMarked('word', { textStyle: { fontFamily: value } })))

      const result = convert(legacy)

      const [{ content }] = bodyOf(result.state).content
      expect([content[0].marks, result.dropped]).toEqual([undefined, []])
    },
  )

  it.each([
    '"Inter;',
    'Inter !important;',
    'foo(;',
    '"In\nter;',
    'In\nter; x',
    'Inter; color: red',
    'Inter; x color: red',
    'Inter; colour: red',
    'Inter; x (',
    'Inter; "x',
    "'Brand;Sans'",
    '"A;B"; C',
    'Inter; x /* y',
    'Inter; x\\',
    'Inter; x\ny',
    'Inter\\; x, sans-serif',
    'Inter /*; x',
  ])("refuses a Yjs font family %j that doesn't read as drawn before its first ';'", (value) => {
    const legacy = stored(legacyDoc(yMarked('word', { textStyle: { fontFamily: value } })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it("keeps Drive's HTML text colour and highlight as palette colours, and its ink as none", () => {
    const highlight = 'data-color="#fef9c3" style="background-color: #fef9c3; color: inherit"'
    const html = [
      '<p><span style="color: #dc2626">red</span>',
      `<mark ${highlight}>lit</mark>`,
      '<span style="color: #1F272E">ink</span></p>',
    ].join('')

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['red', [['textStyle', 'red']]],
      ['lit', [['namedHighlight', 'yellow']]],
      ['ink', []],
    ])
  })

  it("refuses Drive's ink inside a coloured span, which would draw in that colour", () => {
    const html = `<p><span style="color: #dc2626">a<span ${INK}>b</span></span></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("drops Drive's ink inside its ink", () => {
    const html = `<p><span ${INK}>a<span ${INK}>b</span></span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', []]])
  })

  it("drops Drive's ink inside a highlight", () => {
    const html = `<p><mark style="background-color: #fef08a">a<span ${INK}>b</span></mark></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const yellow = [['namedHighlight', 'yellow']]
    expect(drawnColours(content)).toEqual([
      ['a', yellow],
      ['b', yellow],
    ])
  })

  it("drops Drive's ink inside Drive's highlight, whose colour is inherit", () => {
    const highlight = 'data-color="#fef08a" style="background-color: #fef08a; color: inherit"'
    const html = `<p><mark ${highlight}>a<span ${INK}>b</span></mark></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const yellow = [['namedHighlight', 'yellow']]
    expect(drawnColours(content)).toEqual([
      ['a', yellow],
      ['b', yellow],
    ])
  })

  it("drops Drive's ink inside a span whose colour is inherit", () => {
    const html = `<p><span style="color: inherit">a<span ${INK}>b</span></span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', []]])
  })

  it("refuses Drive's ink under formatting inside a coloured span", () => {
    const red = 'style="color: #dc2626"'
    const html = `<p><span ${red}>a<strong><span ${INK}>b</span></strong></span></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("refuses Drive's ink inside an important colour beside inherit, which still draws", () => {
    const red = 'style="color: #dc2626 !important; color: inherit"'
    const html = `<p><span ${red}>a<span ${INK}>b</span></span></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })
})

describe('convertLegacy on the raw HTML (R439)', () => {
  it.each(['foo-bar: 1', 'color: notacolour', 'color red', 'color: #dc2626 !important'])(
    'refuses a span styled "%s", which the editor would lose',
    (style) => {
      const html = `<p>a<span style="${style}">b</span></p>`

      expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual(
        {
          kind: 'failed',
          reason: 'check',
        },
      )
    },
  )

  it("refuses a font shorthand whose other longhands the editor doesn't keep", () => {
    const html = '<p>a<span style="font: 12px Arial; font-size: 20px">b</span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("refuses a class the editor doesn't draw", () => {
    const html = '<p class="MsoNormal">one</p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("converts Word's own style properties, recording each once", () => {
    const word = 'style="mso-spacerun: yes"'
    const html = `<p style="mso-line-height-rule: exactly"><span ${word}>a</span> <span ${word}>b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [block] = bodyOf(result.state).content
    expect(block.content.map(({ text }: JSONContent) => text).join('')).toBe('a b')
    expect(result.dropped).toEqual([
      { kind: 'noise', name: 'mso-line-height-rule' },
      { kind: 'noise', name: 'mso-spacerun' },
    ])
  })

  it('converts a spellcheck, recording it', () => {
    const result = convert({
      content: null,
      html: '<p spellcheck="false">one</p>',
      collab: 0,
      ycomments: null,
    })

    expect(result.dropped).toEqual([{ kind: 'noise', name: 'spellcheck' }])
  })

  it('records an image loading hint the editor draws as its own loading="false"', () => {
    const html = `<p><img src="${SRC}" loading="lazy"></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect(result.dropped).toEqual([{ kind: 'noise', name: 'loading' }])
  })
})

describe("convertLegacy on old HTML's other tags for the editor's marks (R577)", () => {
  it('draws bold, italic and strike as strong, em and s', () => {
    const html = '<p><strong>a</strong><em>b</em><s>c</s></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const element = document.createElement('div')
    element.innerHTML = openConverted(result.state).getHTML()
    const tags = [...element.querySelectorAll('p *')].map(({ localName }) => localName)
    expect(tags).toEqual(['strong', 'em', 's'])
  })

  it.each([
    ['b', 'bold'],
    ['i', 'italic'],
    ['del', 'strike'],
    ['strike', 'strike'],
  ])('converts <%s> as the %s mark', (tag, mark) => {
    const html = `<p><${tag}>a</${tag}></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [block] = bodyOf(result.state).content
    expect([block.content, result.dropped]).toEqual([
      [{ type: 'text', text: 'a', marks: [{ type: mark }] }],
      [],
    ])
  })

  it('refuses a <b> set to normal weight, which the editor draws plain', () => {
    const html = '<p><b style="font-weight: normal">a</b></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('keeps both the bold and the link of a <b> holding a link', () => {
    const html = '<p><b><a href="https://x.test">a</a></b></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [block] = bodyOf(result.state).content
    const marks = block.content[0].marks.map(({ type }: JSONContent) => type)
    expect(marks.toSorted()).toEqual(['bold', 'link'])
  })
})

describe('convertLegacy on old HTML spans', () => {
  const YELLOW = 'background-color: #fef08a'

  it("keeps a span's background as the highlight on the same characters", () => {
    const html = `<p>a<span style="${YELLOW}">b</span>c</p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', 'yellow']]],
      ['c', []],
    ])
    expect(result.dropped).toEqual([])
  })

  it("keeps a span's colour as the text colour and its background as the highlight", () => {
    const html = `<p><span style="color: #dc2626; ${YELLOW}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      [
        'b',
        [
          ['textStyle', 'red'],
          ['namedHighlight', 'yellow'],
        ],
      ],
    ])
  })

  it('keeps nested spans as one text style holding both', () => {
    const html = '<p><span style="color: #dc2626"><span style="font-size: 18px">b</span></span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const style = { color: 'red', fontSize: '18px' }
    expect(content[0].marks).toEqual([{ type: 'textStyle', attrs: expect.objectContaining(style) }])
  })

  it("keeps the inner span's size where nested spans both set one", () => {
    const html =
      '<p><span style="font-size: 12px"><span style="font-size: 18px">b</span></span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const style = { fontSize: '18px' }
    expect(content[0].marks).toEqual([{ type: 'textStyle', attrs: expect.objectContaining(style) }])
  })

  it("keeps an inner span's background as the highlight under the outer span's size", () => {
    const html = `<p><span style="font-size: 18px"><span style="${YELLOW}">b</span></span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(content[0].marks).toEqual([
      { type: 'textStyle', attrs: expect.objectContaining({ fontSize: '18px' }) },
      { type: 'namedHighlight', attrs: { color: 'yellow' } },
    ])
  })

  it.each(['0.5em', '150%', 'smaller', 'larger'])(
    'refuses a relative font size %s inside a span setting a size',
    (size) => {
      const inner = `<span style="font-size: ${size}">b</span>`
      const html = `<p><span style="font-size: 18px">${inner}</span></p>`

      expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual(
        {
          kind: 'failed',
          reason: 'check',
        },
      )
    },
  )

  it('refuses an empty span background', () => {
    const html = '<p>a<span style="background-color: ">b</span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('keeps a span background of inherit as no highlight, which it sets none of', () => {
    const html = '<p>a<span style="background-color: inherit">b</span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const types = content.flatMap(({ marks = [] }: JSONContent) => marks.map(({ type }) => type))
    expect([content.map(({ text }: JSONContent) => text).join(''), types]).toEqual([
      'ab',
      ['textStyle'],
    ])
    expect(result.dropped).toEqual([])
  })
})

describe("convertLegacy on old Drive's highlight colours (R523)", () => {
  // Old Drive's highlight picker, from its DocMenuAndInfoBar
  const OLD_HIGHLIGHTS = [
    ['yellow', '#fef9c3', 'rgb(254, 249, 195)'],
    ['orange', '#ffedd5', 'rgb(255, 237, 213)'],
    ['red', '#fee2e2', 'rgb(254, 226, 226)'],
    ['green', '#dcfce7', 'rgb(220, 252, 231)'],
    ['blue', '#D3E9FC', 'rgb(211, 233, 252)'],
    ['purple', '#f3e8ff', 'rgb(243, 232, 255)'],
    ['pink', '#fce7f3', 'rgb(252, 231, 243)'],
  ]
  const FORMS = OLD_HIGHLIGHTS.flatMap(([name, hex, rgb]) =>
    [hex, rgb, rgb.replaceAll(' ', '')].map((value) => ({ name, value })),
  )

  it.each(FORMS)('keeps an HTML span background $value as $name', ({ name, value }) => {
    const html = `<p>a<span style="background-color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', name]]],
    ])
    expect(result.dropped).toEqual([])
  })

  it.each(FORMS)("keeps Drive's HTML highlight $value as $name", ({ name, value }) => {
    const mark = `<mark data-color="${value}" style="background-color: ${value}; color: inherit">`
    const html = `<p>a${mark}b</mark></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', name]]],
    ])
  })

  it.each(FORMS)('keeps an old Yjs highlight $value as $name', ({ name, value }) => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['namedHighlight', name]]]])
  })

  it.each(FORMS)('keeps an old Yjs background colour $value as $name', ({ name, value }) => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { backgroundColor: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['namedHighlight', name]]]])
  })
})

describe('convertLegacy on nested spans resetting a style (R525)', () => {
  const OUTER = { 'font-size': '18px', 'font-family': 'Arial', 'line-height': '1.5' }
  const RESETS = Object.entries(OUTER).flatMap(([property, outer]) =>
    ['inherit', 'unset', 'revert'].map((reset) => ({ property, outer, reset })),
  )

  it.each(RESETS)(
    'refuses an inner $property: $reset under $outer',
    ({ property, outer, reset }) => {
      const inner = `<span style="${property}: ${reset}">b</span>`
      const html = `<p><span style="${property}: ${outer}">a${inner}</span></p>`

      expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual(
        {
          kind: 'failed',
          reason: 'check',
        },
      )
    },
  )
})

describe("convertLegacy on old Drive's text colours", () => {
  // Old Drive's font colour picker, from its DocMenuAndInfoBar
  const OLD_TEXT_COLOURS = [
    ['yellow', '#ca8a04', 'rgb(202, 138, 4)'],
    ['orange', '#ea580c', 'rgb(234, 88, 12)'],
    ['red', '#dc2626', 'rgb(220, 38, 38)'],
    ['green', '#16a34a', 'rgb(22, 163, 74)'],
    ['blue', '#1579D0', 'rgb(21, 121, 208)'],
    ['purple', '#9333ea', 'rgb(147, 51, 234)'],
    ['pink', '#db2777', 'rgb(219, 39, 119)'],
  ]
  const FORMS = OLD_TEXT_COLOURS.flatMap(([name, hex, rgb]) =>
    [hex, rgb, rgb.replaceAll(' ', '')].map((value) => ({ name, value })),
  )

  it.each(FORMS)('keeps an HTML span colour $value as $name', ({ name, value }) => {
    const html = `<p>a<span style="color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['textStyle', name]]],
    ])
    expect(result.dropped).toEqual([])
  })

  it.each(FORMS)('keeps an old Yjs text colour $value as $name', ({ name, value }) => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['textStyle', name]]]])
  })
})

describe("convertLegacy on old Drive's highlights with a percent alpha (R531)", () => {
  const OPAQUE = ['rgba(254, 249, 195, 100%)', 'rgb(254 249 195 / 100%)']
  const EIGHT_DIGITS = '#fef9c3ff'

  it.each(OPAQUE)('keeps an HTML span background %s as yellow', (value) => {
    const html = `<p>a<span style="background-color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', 'yellow']]],
    ])
  })

  it.each(OPAQUE)("keeps Drive's HTML highlight %s as yellow", (value) => {
    const mark = `<mark data-color="${value}" style="background-color: ${value}; color: inherit">`
    const html = `<p>a${mark}b</mark></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', 'yellow']]],
    ])
  })

  it.each(OPAQUE)('keeps an old Yjs highlight %s as yellow', (value) => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['namedHighlight', 'yellow']]]])
  })

  it.each(OPAQUE)('keeps an old Yjs background colour %s as yellow', (value) => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { backgroundColor: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['namedHighlight', 'yellow']]]])
  })

  it('refuses an old Yjs highlight in 8-digit hex', () => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: EIGHT_DIGITS } })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps an HTML span background in 8-digit hex as yellow', () => {
    const html = `<p>a<span style="background-color: ${EIGHT_DIGITS}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', 'yellow']]],
    ])
  })
})

describe('convertLegacy on highlight colours no one could see (R533)', () => {
  const SEE_THROUGH = ['rgba(254, 249, 195, 0)', 'rgba(220, 38, 38, 0)', 'rgb(254 249 195 / 0%)']

  it.each(SEE_THROUGH)('keeps an HTML span background %s as no highlight', (value) => {
    const html = `<p>a<span style="background-color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', []],
    ])
    expect(result.dropped).toEqual([])
  })

  it.each(SEE_THROUGH)("keeps Drive's HTML highlight %s as no highlight", (value) => {
    const mark = `<mark data-color="${value}" style="background-color: ${value}; color: inherit">`
    const html = `<p>a${mark}b</mark></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', []]])
    expect(result.dropped).toEqual([])
  })

  it('refuses a see-through HTML highlight holding more than its colour', () => {
    const mark = '<mark style="background-color: rgba(254, 249, 195, 0)" title="t">'
    const html = `<p>a${mark}b</mark></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it.each(SEE_THROUGH)('keeps an old Yjs highlight %s as no highlight', (value) => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', []]])
  })

  it.each(SEE_THROUGH)('keeps an old Yjs background colour %s as no highlight', (value) => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { backgroundColor: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', []]])
  })
})

describe("convertLegacy on old Drive's yellow at half alpha", () => {
  // A see-through tone isn't the one old Drive's picker drew, so it goes by distance
  const HALF = 'rgba(254, 249, 195, 0.5)'

  it('keeps an HTML span background by distance, not as yellow', () => {
    const html = `<p>a<span style="background-color: ${HALF}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['namedHighlight', 'orange']]],
    ])
  })

  it('keeps an old Yjs highlight by distance, not as yellow', () => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: HALF } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', [['namedHighlight', 'orange']]]])
  })
})

describe('convertLegacy on a highlight whose colours disagree (R534, R535)', () => {
  const SEE_THROUGH = 'rgba(254, 249, 195, 0)'
  const DISAGREEING = [
    { background: SEE_THROUGH, dataColor: '#fef9c3' },
    { background: SEE_THROUGH, dataColor: '#fee2e2' },
    { background: '#fee2e2', dataColor: '#fef9c3' },
  ]
  const AGREEING = [
    { background: '#fef9c3', dataColor: 'rgb(254, 249, 195)' },
    { background: 'rgb(254, 249, 195)', dataColor: '#FEF9C3' },
  ]

  it.each(DISAGREEING)(
    'refuses an HTML highlight $background with data-color $dataColor',
    ({ background, dataColor }) => {
      const style = `background-color: ${background}; color: inherit`
      const html = `<p>a<mark data-color="${dataColor}" style="${style}">b</mark></p>`

      expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual(
        {
          kind: 'failed',
          reason: 'check',
        },
      )
    },
  )

  it.each(AGREEING)(
    'keeps an HTML highlight $background with data-color $dataColor as yellow',
    ({ background, dataColor }) => {
      const style = `background-color: ${background}; color: inherit`
      const html = `<p>a<mark data-color="${dataColor}" style="${style}">b</mark></p>`

      const result = convert({ content: null, html, collab: 0, ycomments: null })

      const [{ content }] = bodyOf(result.state).content
      expect(drawnColours(content)).toEqual([
        ['a', []],
        ['b', [['namedHighlight', 'yellow']]],
      ])
      expect(result.dropped).toEqual([])
    },
  )

  it('refuses an HTML highlight inherit with data-color inherit, which no colour matches (R538)', () => {
    const style = 'background-color: inherit; color: inherit'
    const html = `<p>a<mark data-color="inherit" style="${style}">b</mark></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('refuses a see-through HTML highlight with another inherited style', () => {
    const mark = `<mark style="background-color: ${SEE_THROUGH}; display: inherit">`
    const html = `<p>a${mark}b</mark></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })
})

describe('convertLegacy on a highlight alpha outside 0 to 1 (R536)', () => {
  const ALPHAS = [
    { value: 'rgba(254, 249, 195, -1)', drawn: [] },
    { value: 'rgba(254, 249, 195, 150%)', drawn: [['namedHighlight', 'yellow']] },
    { value: 'rgba(254, 249, 195, 2)', drawn: [['namedHighlight', 'yellow']] },
  ]

  it.each(ALPHAS)('keeps an HTML span background $value as $drawn', ({ value, drawn }) => {
    const html = `<p>a<span style="background-color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', drawn],
    ])
  })

  it.each(ALPHAS)('keeps an old Yjs highlight $value as $drawn', ({ value, drawn }) => {
    const legacy = stored(legacyDoc(yMarked('lit', { namedHighlight: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', drawn]])
  })
})

describe('convertLegacy on text colours no one could see (R537)', () => {
  const SEE_THROUGH = ['rgba(220, 38, 38, 0)', 'rgba(254, 249, 195, 0)', 'rgb(220 38 38 / 0%)']

  it.each(SEE_THROUGH)('keeps an HTML span colour %s as no colour', (value) => {
    const html = `<p>a<span style="color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', []],
    ])
    expect(result.dropped).toEqual([])
  })

  it('keeps a see-through paragraph colour as no colour (R539)', () => {
    const html = '<p style="color: rgba(220, 38, 38, 0)">ab</p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', []]])
    expect(result.dropped).toEqual([])
  })

  it.each(SEE_THROUGH)('keeps an old Yjs text colour %s as no colour', (value) => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { color: value } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', []]])
  })
})

describe('convertLegacy on pasted HTML span colours, read as on the Yjs path', () => {
  const TEXT = [
    { value: 'rgb(0, 0, 0)', drawn: [] },
    { value: 'black', drawn: [] },
    { value: 'rgb(67, 67, 67)', drawn: [] },
    { value: 'transparent', drawn: [] },
    { value: '#7c7c7c', drawn: [['textStyle', 'gray']] },
    { value: 'rgb(124, 124, 124)', drawn: [['textStyle', 'gray']] },
    { value: 'rgb(206, 145, 120)', drawn: [['textStyle', 'gray']] },
    { value: 'rgb(255, 255, 255)', drawn: [['textStyle', 'gray']] },
    { value: 'red', drawn: [['textStyle', 'red']] },
    { value: 'hsl(0, 70%, 50%)', drawn: [['textStyle', 'red']] },
  ]
  const HIGHLIGHTS = [
    { value: 'transparent', drawn: [] },
    { value: 'rgb(255, 255, 255)', drawn: [] },
    { value: 'rgb(217, 248, 233)', drawn: [['namedHighlight', 'gray']] },
    { value: 'rgb(52, 53, 65)', drawn: [['namedHighlight', 'gray']] },
  ]

  it.each(TEXT)('keeps an HTML span colour $value as $drawn', ({ value, drawn }) => {
    const html = `<p>a<span style="color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', drawn],
    ])
    expect(result.dropped).toEqual([])
  })

  it.each(HIGHLIGHTS)('keeps an HTML span background $value as $drawn', ({ value, drawn }) => {
    const html = `<p>a<span style="background-color: ${value}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', drawn],
    ])
    expect(result.dropped).toEqual([])
  })

  it('keeps an HTML highlight of transparent as its text, with no mark', () => {
    const html = '<p>a<mark style="background-color: transparent">b</mark></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(content).toEqual([{ type: 'text', text: 'ab' }])
  })

  it('keeps a transparent span inside a highlight as the highlight', () => {
    const inner = '<span style="background-color: transparent">b</span>'
    const html = `<p><span style="background-color: rgb(207, 226, 243)">a${inner}</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', [['namedHighlight', 'blue']]]])
  })

  it('refuses an HTML highlight whose data-color is another colour', () => {
    const style = 'background-color: transparent'
    const html = `<p>a<mark data-color="#fef9c3" style="${style}">b</mark></p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("refuses an HTML span colour the editor can't read, whose alpha is a variable", () => {
    const html = '<p>a<span style="color: rgb(0 0 0 / var(--tw-text-opacity))">b</span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('refuses a black span inside a red one, which drew black over the red', () => {
    const html = '<p><span style="color: red">a<span style="color: black">b</span></span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('keeps an HTML span font family of empty quotes as no font family', () => {
    const html = '<p>a<span style=\'font-family: ""\'>b</span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const fonts = content.map(({ text, marks = [] }: JSONContent) => [
      text,
      marks.map(({ attrs }) => attrs?.fontFamily).filter(Boolean),
    ])
    expect(fonts).toEqual([
      ['a', []],
      ['b', []],
    ])
    expect(result.dropped).toEqual([])
  })

  it('keeps an HTML span font family in closed quotes, with a declaration after it', () => {
    const html = '<p>a<span style=\'font-family: "Inter"; color: red\'>b</span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    const fonts = content.map(({ text, marks = [] }: JSONContent) => [
      text,
      marks.map(({ attrs }) => attrs?.fontFamily).filter(Boolean),
    ])
    expect(fonts).toEqual([
      ['a', []],
      ['b', ['Inter']],
    ])
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', [['textStyle', 'red']]],
    ])
    expect(result.dropped).toEqual([])
  })

  // The check splits the raw style on ';' with no quote handling (inventory.ts checkedStyle, isRebuilt)
  it('refuses an HTML span font family whose quotes hold a semicolon', () => {
    const html = '<p>a<span style="font-family: &quot;A;B&quot;; color: red">b</span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  // jsdom's CSSOM read; the Chrome paste check is with the owner
  it('reads a pasted span font family whose quotes hold a semicolon as the editor does', () => {
    const html = '<p>a<span style="font-family: &quot;A;B&quot;; color: red">b</span></p>'

    const [, pasted] = generateJSON(html, writerSchema()).content[0].content
    const [{ attrs }] = pasted.marks

    expect([attrs.fontFamily, attrs.color]).toEqual(['A;B', null])
  })
})

describe('convertLegacy on an HTML font family whose quote never closes', () => {
  function runs(html: string) {
    const result = convert({ content: null, html, collab: 0, ycomments: null })
    const [{ content }] = bodyOf(result.state).content
    expect(result.dropped).toEqual([])
    return content.map(({ text, marks = [] }: JSONContent) => [
      text,
      Object.fromEntries(
        marks.flatMap(({ attrs = {} }) => Object.entries(attrs).filter(([, value]) => value)),
      ),
    ])
  }

  function refused(style: string) {
    const html = `<p>a<span style="${style}">b</span></p>`
    return convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)
  }

  // Headless Chromium reads it as one family name to the end: no size (16px under 16px), a fallback face
  it('reads the declarations after it as never drawn, and the family as none', () => {
    const style = 'font-family: "; font-size: 12pt; color: var(--prose-color-blue)'

    expect(runs(`<p>a<span style='${style}'>b</span></p>`)).toEqual([['ab', {}]])
  })

  it('keeps the declarations before it', () => {
    const style = 'color: var(--prose-color-red); font-family: "; font-size: 12pt'

    expect(runs(`<p>a<span style='${style}'>b</span></p>`)).toEqual([
      ['a', {}],
      ['b', { color: 'red' }],
    ])
  })

  it('reads past an escaped quote inside it', () => {
    const style = 'font-family: "x\\"; font-size: 12pt'

    expect(runs(`<p>a<span style='${style}'>b</span></p>`)).toEqual([['ab', {}]])
  })

  it('refuses a quote that closes later in the style text', () => {
    expect(refused('font-family: &quot;; x: &quot;y')).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps a family that names itself to the end of the style text, its quote dropped', () => {
    expect(runs('<p>a<span style="font-family: &quot;Arial">b</span></p>')).toEqual([
      ['a', {}],
      ['b', { fontFamily: 'Arial' }],
    ])
  })

  it('reads a line end as ending the quote before a later one opens', () => {
    const style = 'font-family: &quot;x\n; color: var(--prose-color-red); y: &quot;a&quot;'

    expect(refused(style)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps a family whose comment holds a quote', () => {
    const style = "font-family: Inter /* don't */; color: var(--prose-color-red)"

    expect(runs(`<p>a<span style="${style}">b</span></p>`)).toEqual([
      ['a', {}],
      ['b', { fontFamily: 'Inter', color: 'red' }],
    ])
  })

  it('refuses one broken by a line end, which CSS reads another way', () => {
    expect(refused('font-family: &quot;x\nfont-size: 12pt')).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('refuses an unclosed quote in another property', () => {
    expect(refused('color: &quot;; font-size: 12pt')).toEqual({ kind: 'failed', reason: 'check' })
  })
})

describe('convertLegacy on pasted HTML colours beside a priority or a drawn parent (R601-R605)', () => {
  function refused(html: string) {
    return convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)
  }

  it('keeps a transparent paragraph colour as no colour', () => {
    const html = '<p style="color: transparent">ab</p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', []]])
    expect(result.dropped).toEqual([])
  })

  it('keeps an old Yjs text colour transparent as no colour', () => {
    const legacy = stored(legacyDoc(yMarked('lit', { textStyle: { color: 'transparent' } })))

    const result = convert(legacy)

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['lit', []]])
  })

  it('keeps an important black span colour as no colour', () => {
    const html = '<p>a<span style="color: black !important">b</span></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([
      ['a', []],
      ['b', []],
    ])
    expect(result.dropped).toEqual([])
  })

  it.each([
    '<p>a<span style="color: rgb(124, 124, 124) !important">b</span></p>',
    '<p>a<mark style="background-color: #fef9c3 !important">b</mark></p>',
  ])('refuses an important colour a palette name would draw without its priority: %s', (html) => {
    expect(refused(html)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it("refuses Drive's highlight whose data-color is another of its colours", () => {
    const html = '<p>a<mark data-color="#fee2e2" style="background-color: #fef9c3">b</mark></p>'

    expect(refused(html)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it("refuses a span background of the keyword white, which the Yjs path doesn't read either", () => {
    const html = '<p>a<span style="background-color: white">b</span></p>'

    expect(refused(html)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([
    '<table><tr><th><p>a<span style="background-color: rgb(255, 255, 255)">b</span></p></th></tr></table>',
    '<p><code>a<span style="background-color: rgb(255, 255, 255)">b</span></code></p>',
    '<blockquote><p>a<span style="color: black">b</span></p></blockquote>',
    '<pre><code>a<span style="background-color: rgb(255, 255, 255)">b</span></code></pre>',
    '<pre><code>a<span style="color: rgb(13, 13, 13)">b</span></code></pre>',
  ])('refuses a colour reading as none over one the editor draws: %s', (html) => {
    expect(refused(html)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it("keeps a black span inside Drive's ink as no colour", () => {
    const html = `<p><span ${INK}>a<span style="color: black">b</span></span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const [{ content }] = bodyOf(result.state).content
    expect(drawnColours(content)).toEqual([['ab', []]])
  })

  it('draws a gray span colour and highlight as the palette variables', () => {
    const colours = 'color: rgb(124, 124, 124); background-color: rgb(217, 248, 233)'
    const html = `<p>a<span style="${colours}">b</span></p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const element = document.createElement('div')
    element.innerHTML = openConverted(result.state).getHTML()
    const drawn = [...element.querySelectorAll<HTMLElement>('p [style]')].map(({ style }) => [
      style.getPropertyValue('color'),
      style.getPropertyValue('background-color'),
    ])
    expect(drawn.flat().filter(Boolean).sort()).toEqual([
      'var(--prose-color-gray)',
      'var(--prose-highlight-gray)',
    ])
  })
})

function htmlCell(attributes: string) {
  return `<table><tr><td ${attributes}><p>x</p></td></tr></table>`
}

function yCell(name: string, attributes: Record<string, unknown>) {
  const cell = yElement(name, yParagraph('x'))
  for (const [key, value] of Object.entries(attributes)) {
    cell.setAttribute(key, value as never)
  }

  return cell
}

function yTable(cell: XmlElement) {
  return stored(legacyDoc(yElement('table', yElement('tableRow', cell))))
}

function cellOf(state: Uint8Array) {
  const [table] = bodyOf(state).content
  return table.content[0].content[0]
}

describe('convertLegacy on table cell styles', () => {
  const KEPT = [
    ['background-color: #fef08a; border: 1px solid red', 'yellow', 'border: 1px solid red;'],
    ['background-color: var(--prose-highlight-blue)', 'blue', null],
    ['background-color: #123456', null, 'background-color: #123456;'],
    ['background-color: hsl(10, 50%, 50%)', null, 'background-color: hsl(10, 50%, 50%);'],
    ['background-color: red', null, 'background-color: red;'],
    ['background-color: inherit', null, 'background-color: inherit;'],
    ['background-color: #123456 !important', null, 'background-color: #123456 !important;'],
    ['background-color: rgba(254, 240, 138, 0)', null, 'background-color: rgba(254, 240, 138, 0);'],
    [
      'padding: 4px !important; vertical-align: top',
      null,
      'padding: 4px !important; vertical-align: top;',
    ],
    [
      'overflow: hidden; overflow-wrap: break-word; padding: 5pt; vertical-align: top',
      null,
      'overflow: hidden; overflow-wrap: break-word; padding: 5pt; vertical-align: top;',
    ],
  ]

  it.each(KEPT)('keeps an HTML cell styled "%s"', (style, name, kept) => {
    const result = convert({
      content: null,
      html: htmlCell(`style="${style}"`),
      collab: 0,
      ycomments: null,
    })

    expect(cellOf(result.state).attrs).toMatchObject({ backgroundColor: name, style: kept })
    expect(result.dropped).toEqual([])
  })

  it.each(KEPT)('keeps an old Yjs cell styled "%s"', (style, name, kept) => {
    const result = convert(yTable(yCell('tableCell', { style })))

    expect(cellOf(result.state).attrs).toMatchObject({ backgroundColor: name, style: kept })
    expect(result.dropped).toEqual([])
  })

  it('keeps an old Yjs header cell style', () => {
    const result = convert(yTable(yCell('tableHeader', { style: 'border-top: 2px dashed red' })))

    expect(cellOf(result.state)).toMatchObject({
      type: 'tableHeader',
      attrs: { style: 'border-top: 2px dashed red;' },
    })
  })

  it.each([
    'border: 1px solid red; position: absolute',
    'background: #123456',
    'background-color: #fef08a !important',
    'overflow-x: hidden',
    'overflow: hidden; overflow-x: auto',
  ])('refuses an HTML cell styled "%s", which a cell does not keep', (style) => {
    const html = htmlCell(`style="${style}"`)

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it.each([
    { style: 'border: 1px solid red; position: absolute' },
    { style: 'background: #123456' },
    { style: 'padding: notapadding' },
    { style: { border: '1px solid red' } },
    { style: 'background-color: #123456', backgroundColor: 'blue' },
    { style: 'background-color: #fef08a', backgroundColor: 'yellow' },
    { style: 'background-color: #fef08a !important' },
    { style: 'background-color: var(--prose-highlight-blue) !important' },
    { style: 'background-color: #fef08a !important /* c */' },
    { style: 'overflow-x: hidden' },
    { style: 'overflow: hidden; overflow-x: auto' },
  ])('refuses an old Yjs cell holding %o', (attributes) => {
    expect(convertLegacy(yTable(yCell('tableCell', attributes)), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  // frappe-ui's old table menu drew a width in the default border colour, #EDEDED; Writer's default
  // border colour is outline-gray-2
  it.each([
    [{ borderWidth: '0px' }, 'border-width: 0px;'],
    [{ borderWidth: '1px' }, 'border-width: 1px;'],
    [{ borderWidth: '2.5px' }, 'border-width: 2.5px;'],
    [{ borderColor: 'transparent' }, 'border: 2px solid transparent;'],
    [{ borderColor: 'gray' }, 'border: 2px solid #999999;'],
    [{ borderColor: 'gray', borderWidth: '1px' }, 'border: 2px solid #999999; border-width: 1px;'],
  ])('keeps an old Yjs cell border %o as the border it drew', (attributes, style) => {
    for (const name of ['tableCell', 'tableHeader']) {
      const result = convert(yTable(yCell(name, attributes)))

      const { attrs } = cellOf(result.state)
      expect(attrs.style).toBe(style)
      expect(attrs).not.toHaveProperty('borderWidth')
      expect(attrs).not.toHaveProperty('borderColor')
      expect(result.dropped).toEqual([])
    }
  })

  it('keeps an old Yjs cell background beside its border', () => {
    const result = convert(
      yTable(yCell('tableCell', { backgroundColor: 'yellow', borderWidth: '2px' })),
    )

    expect(cellOf(result.state).attrs).toMatchObject({
      backgroundColor: 'yellow',
      style: 'border-width: 2px;',
    })
  })

  it.each([
    { borderColor: 'red' },
    { borderColor: 'Gray' },
    { borderColor: '#999999' },
    { borderWidth: '1em' },
    { borderWidth: '1' },
    { borderWidth: 1 },
    { borderWidth: '-1px' },
    { borderColor: 'red', borderWidth: '1px' },
    { borderWidth: '1px', style: 'padding: 4px' },
  ])('refuses an old Yjs cell border %o it could not have drawn', (attributes) => {
    expect(convertLegacy(yTable(yCell('tableCell', attributes)), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('keeps an HTML merged cell whose width is shorter than its span, as stored', () => {
    const result = convert({
      content: null,
      html: htmlCell('colspan="2" colwidth="100"'),
      collab: 0,
      ycomments: null,
    })

    expect(cellOf(result.state).attrs).toMatchObject({ colspan: 2, colwidth: [100] })
  })

  it('keeps an old Yjs merged cell whose width is shorter than its span, as stored', () => {
    const result = convert(yTable(yCell('tableCell', { colspan: 2, colwidth: [100] })))

    expect(cellOf(result.state).attrs).toMatchObject({ colspan: 2, colwidth: [100] })
  })
})

describe('convertLegacy on table cell spans', () => {
  const REPAIRED = [{ kind: 'table-span', count: 1 }]

  it.each([
    [{ colspan: '2' }, { colspan: 2 }],
    [{ colspan: 0 }, { colspan: 1 }],
    [{ colspan: -1 }, { colspan: 1 }],
    [{ colspan: '' }, { colspan: 1 }],
    [{ colspan: 'abc' }, { colspan: 1 }],
    [{ colspan: '2.5' }, { colspan: 2 }],
    [{ colspan: ' 3 ' }, { colspan: 3 }],
    [{ rowspan: '1' }, { rowspan: 1 }],
    [{ rowspan: 0 }, { rowspan: 1 }],
  ])('repairs an old Yjs cell span %o, recording it', (attributes, spans) => {
    const result = convert(yTable(yCell('tableCell', attributes)))

    expect(cellOf(result.state).attrs).toMatchObject(spans)
    expect(result.dropped).toEqual(REPAIRED)
  })

  it.each([
    ['colspan="0"', { colspan: 1 }],
    ['colspan="-1"', { colspan: 1 }],
    ['colspan="abc"', { colspan: 1 }],
    ['colspan="2.5"', { colspan: 2 }],
    ['colspan=" 3 "', { colspan: 3 }],
    ['rowspan="0"', { rowspan: 1 }],
  ])('repairs an HTML cell span "%s", recording it', (attributes, spans) => {
    const result = convert({
      content: null,
      html: htmlCell(attributes),
      collab: 0,
      ycomments: null,
    })

    expect(cellOf(result.state).attrs).toMatchObject(spans)
    expect(result.dropped).toEqual(REPAIRED)
  })

  it('records each span it repairs on an old Yjs cell', () => {
    const result = convert(yTable(yCell('tableCell', { colspan: '2', rowspan: 0 })))

    expect(cellOf(result.state).attrs).toMatchObject({ colspan: 2, rowspan: 1 })
    expect(result.dropped).toEqual([{ kind: 'table-span', count: 2 }])
  })

  it('keeps a cell span it need not repair, recording nothing', () => {
    const yjs = convert(yTable(yCell('tableCell', { colspan: 2 })))
    const html = convert({
      content: null,
      html: htmlCell('colspan="2"'),
      collab: 0,
      ycomments: null,
    })

    for (const result of [yjs, html]) {
      expect(cellOf(result.state).attrs).toMatchObject({ colspan: 2, rowspan: 1 })
      expect(result.dropped).toEqual([])
    }
  })

  it('converts a table its repaired spans leave uneven, as it stands', () => {
    const result = convert(yTable(yCell('tableCell', { rowspan: '2' })))

    expect(cellOf(result.state).attrs).toMatchObject({ rowspan: 2 })
    expect(result.dropped).toEqual(REPAIRED)
  })
})

describe("convertLegacy on old Drive's class sets", () => {
  function list(classes: string) {
    return `<ul><li class="${classes}"><p>one</p></li></ul>`
  }

  function task(classes: string) {
    return `<ul data-type="taskList"><li data-type="taskItem" data-checked="false" class="${classes}"><p>one</p></li></ul>`
  }

  function tasks(classes: string) {
    return `<ul data-type="taskList" class="${classes}"><li data-type="taskItem" data-checked="false"><p>one</p></li></ul>`
  }

  function block(tag: string) {
    return (classes: string) => `<${tag} class="${classes}">one</${tag}>`
  }

  function items(tag: string) {
    return (classes: string) => `<${tag} class="${classes}"><li><p>one</p></li></${tag}>`
  }

  function quote(classes: string) {
    return `<blockquote class="${classes}"><p>one</p></blockquote>`
  }

  function pre(classes: string) {
    return `<pre class="${classes}"><code>one</code></pre>`
  }

  function code(classes: string) {
    return `<p><code class="${classes}">one</code></p>`
  }

  function span(classes: string) {
    return `<p>a<span class="${classes}">b</span></p>`
  }

  // Each set as old Drive's DocEditor/TextEditor.vue wrote it
  const SETS: [string, (classes: string) => string, string][] = [
    ['listItem, 81496fa39:313', list, 'prose-list-item'],
    ['taskItem, d495bcef8:342', task, 'my-task-item'],
    ['paragraph, 8b59604c7:450', block('p'), 'legacy'],
    ['paragraph, 44ba54162^:450', block('p'), 'not-prose'],
    ['paragraph, d3dbf0f92:449', block('p'), 'legacy-p'],
    ['heading 1, 8b59604c7:456', block('h1'), 'legacy'],
    ['heading 2, 8b59604c7:456', block('h2'), 'legacy'],
    ['heading 3, 8b59604c7:456', block('h3'), 'legacy'],
    ['heading 4, 8b59604c7:456', block('h4'), 'legacy'],
    ['heading 5, 8b59604c7:456', block('h5'), 'legacy'],
    ['heading 1, d081e381d:310', block('h1'), 'not-prose'],
    ['heading 2, d081e381d:310', block('h2'), 'not-prose'],
    ['heading 3, d081e381d:310', block('h3'), 'not-prose'],
    ['heading 4, 637c3281d:316', block('h4'), 'not-prose'],
    ['heading 1, 802065431:351', block('h1'), 'not-prose leading-7'],
    ['heading 2, 802065431:351', block('h2'), 'not-prose leading-7'],
    ['heading 3, 802065431:351', block('h3'), 'not-prose leading-7'],
    ['heading 4, 802065431:351', block('h4'), 'not-prose leading-7'],
    ['bulletList, d081e381d:327', items('ul'), 'not-prose'],
    ['orderedList, d081e381d:334', items('ol'), 'not-prose'],
    ['taskList, d495bcef8:337', tasks, 'not-prose'],
    [
      'blockquote, f5936ffea:408',
      quote,
      'prose-quoteless text-black border-l-2 pl-2 border-gray-400 text-[0.9em]',
    ],
    [
      'codeBlock, c52d39e28:393',
      pre,
      'not-prose my-5 px-4 py-2 text-[0.9em] font-mono text-black bg-gray-50 rounded border border-gray-300 overflow-x-auto',
    ],
    [
      'codeBlock, f5936ffea:402',
      pre,
      'not-prose my-5 px-4 pt-4 pb-2 text-[0.9em] font-mono text-black bg-gray-50 rounded border border-gray-300 overflow-x-scroll',
    ],
    [
      'code, f5936ffea:414',
      code,
      'not-prose px-px font-mono bg-gray-50 text-[0.85em] rounded-sm border border-gray-300',
    ],
    ['annotation, e88592e0:517', span, 'cursor-pointer annotation'],
  ]

  it.each(SETS)('converts the %s set, recording the class', (_, html, classes) => {
    const result = convert({ content: null, html: html(classes), collab: 0, ycomments: null })

    expect(result.dropped).toEqual([{ kind: 'noise', name: 'class' }])
  })

  it.each(SETS)('refuses the %s set with a token more', (_, html, classes) => {
    const legacy = {
      content: null,
      html: html(`${classes} text-red-500`),
      collab: 0,
      ycomments: null,
    }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each(SETS.filter(([, , classes]) => classes.includes(' ')))(
    'refuses the %s set with a token less',
    (_, html, classes) => {
      const fewer = classes.split(' ').slice(1).join(' ')
      const legacy = { content: null, html: html(fewer), collab: 0, ycomments: null }

      expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
    },
  )

  it('refuses the annotation set on a span that still holds its annotation', () => {
    const html = '<p>a<span class="cursor-pointer annotation" data-annotation-id="a1">b</span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('converts a set written in another order', () => {
    const html = pre(
      'overflow-x-auto border-gray-300 border rounded bg-gray-50 text-black font-mono text-[0.9em] py-2 px-4 my-5 not-prose',
    )

    expect(convert({ content: null, html, collab: 0, ycomments: null }).dropped).toEqual([
      { kind: 'noise', name: 'class' },
    ])
  })

  it.each([
    ['a list item set on a paragraph', block('p')('prose-list-item')],
    ['a heading set on a paragraph', block('p')('not-prose leading-7')],
    [
      "a blockquote set only Drive's read-only preview drew",
      quote('prose-quoteless text-black border-l-2 pl-2 border-outline-gray-3 text-[0.9em]'),
    ],
    ['a paragraph set on a list item', list('legacy')],
    ['a heading 1 to 4 set on a fifth heading', block('h5')('not-prose')],
    ['a list set on a list item', list('not-prose')],
  ])('refuses %s', (_, html) => {
    const legacy = { content: null, html, collab: 0, ycomments: null }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('records the class once for many sets', () => {
    const html = [block('p')('legacy'), block('h1')('legacy'), list('prose-list-item')].join('')

    expect(convert({ content: null, html, collab: 0, ycomments: null }).dropped).toEqual([
      { kind: 'noise', name: 'class' },
    ])
  })
})
