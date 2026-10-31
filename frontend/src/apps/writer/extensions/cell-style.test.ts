import { Editor, generateHTML, generateJSON, type JSONContent } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { RichTextKit } from 'frappe-ui/editor'
import { afterEach, describe, expect, it } from 'vitest'

import { HIGHLIGHT_ANCHORS } from '@/apps/writer/extensions/cell-style'
import { writerSchema } from '@/apps/writer/schema'

function table(...cells: string[]) {
  const row = cells.join('')
  return `<table><tr>${row}</tr></table>`
}

function cell(style: string) {
  return `<td style="${style}"><p>x</p></td>`
}

function cellsOf(json: JSONContent) {
  return json.content?.[0].content?.[0].content ?? []
}

// The background name and style the editor reads from a pasted cell with this style
function pasted(style: string) {
  const [read] = cellsOf(generateJSON(table(cell(style)), writerSchema()))
  return { backgroundColor: read.attrs?.backgroundColor, style: read.attrs?.style }
}

describe('cell style on paste', () => {
  it.each([
    ['#fef08a', 'yellow'],
    ['rgb(191, 219, 254)', 'blue'],
    ['var(--prose-highlight-pink)', 'pink'],
  ])('names a %s background, drawn by the name alone', (colour, name) => {
    expect(pasted(`background-color: ${colour}`)).toEqual({ backgroundColor: name, style: null })
  })

  it.each([
    '#123456',
    '#fef08b',
    'hsl(10, 50%, 50%)',
    'red',
    'inherit',
    'var(--prose-highlight-brown)',
  ])('keeps a %s background as written, with no name', (colour) => {
    expect(pasted(`background-color: ${colour}`)).toEqual({
      backgroundColor: null,
      style: `background-color: ${colour};`,
    })
  })

  it('reads a see-through palette colour as no background, keeping it as written', () => {
    expect(pasted('background-color: rgba(254, 240, 138, 0)')).toEqual({
      backgroundColor: null,
      style: 'background-color: rgba(254, 240, 138, 0);',
    })
  })

  it('keeps the border, padding and vertical alignment, and nothing else', () => {
    const style =
      'border: 1px solid red; position: absolute; padding: 4px 8px !important; ' +
      'background-image: url(/x.png); vertical-align: top'

    expect(pasted(style)).toEqual({
      backgroundColor: null,
      style: 'border: 1px solid red; padding: 4px 8px !important; vertical-align: top;',
    })
  })

  it('keeps the overflow and overflow wrap, as written', () => {
    expect(pasted('overflow: hidden; overflow-wrap: break-word; white-space: nowrap').style).toBe(
      'overflow: hidden; overflow-wrap: break-word;',
    )
  })

  it.each(['overflow-x: hidden', 'overflow-y: hidden'])('drops an overflow side, %s', (style) => {
    expect(pasted(style).style).toBeNull()
  })

  it('keeps one border side set after the whole border, as written', () => {
    expect(pasted('border: 1px solid red; border-top-color: blue').style).toBe(
      'border: 1px solid red; border-top-color: blue;',
    )
  })

  it('keeps the background a dropped shorthand set after it', () => {
    expect(pasted('background-color: red; background: #123456; padding: 4px')).toEqual({
      backgroundColor: null,
      style: 'padding: 4px; background-color: rgb(18, 52, 86);',
    })
  })

  it('names a palette background beside a border, leaving it out of the style', () => {
    expect(pasted('border: 1px solid red; background-color: #fef08a')).toEqual({
      backgroundColor: 'yellow',
      style: 'border: 1px solid red;',
    })
  })

  it('reads a header cell the same way', () => {
    const html = '<table><tr><th style="background-color: #123456"><p>x</p></th></tr></table>'

    const [read] = cellsOf(generateJSON(html, writerSchema()))

    expect(read).toMatchObject({
      type: 'tableHeader',
      attrs: { backgroundColor: null, style: 'background-color: #123456;' },
    })
  })
})

describe('cell style drawn', () => {
  it('draws only the kept properties of a stored style', () => {
    const style = 'position: fixed; border: 1px solid red; background-image: url(/x.png)'
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', attrs: { style }, content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      ],
    }
    const host = document.createElement('div')
    host.innerHTML = generateHTML(doc, writerSchema())

    expect(host.querySelector('td')!.style.cssText).toBe('border: 1px solid red;')
  })
})

// frappe-ui names no pasted gray, so its parse can't vouch for that anchor
const PASTED_ANCHORS = [...HIGHLIGHT_ANCHORS].filter(([name]) => name !== 'gray')

describe('highlight anchors', () => {
  it.each(PASTED_ANCHORS)("are frappe-ui's own: %s from %s", (name, anchor) => {
    const json = generateJSON(table(cell(`background-color: ${anchor}`)), [RichTextKit])

    const [read] = cellsOf(json)

    expect(read.attrs?.backgroundColor).toBe(name)
  })

  it.each([...HIGHLIGHT_ANCHORS.keys()])('name a colour frappe-ui draws: %s', (name) => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { backgroundColor: name },
                  content: [{ type: 'paragraph' }],
                },
              ],
            },
          ],
        },
      ],
    }
    const host = document.createElement('div')
    host.innerHTML = generateHTML(doc, [RichTextKit])

    expect(host.querySelector('td')!.style.backgroundColor).toBe(`var(--prose-highlight-${name})`)
  })
})

describe('cell colour menu', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  function open(...cells: string[]) {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: writerSchema(),
      content: table(...cells),
    })
    return editor
  }

  function cellAttrs(opened: Editor) {
    return cellsOf(opened.getJSON()).map(({ attrs }) => [attrs?.backgroundColor, attrs?.style])
  }

  it('sets a colour over a pasted one, which leaves the style', () => {
    const opened = open(cell('background-color: #123456; padding: 4px'))
    opened.commands.setTextSelection(4)

    expect(opened.commands.setCellBackground('blue')).toBe(true)
    expect(cellAttrs(opened)).toEqual([['blue', 'padding: 4px;']])
  })

  it('clears a pasted colour, the style left with what else it holds', () => {
    const opened = open(cell('background-color: #123456; padding: 4px'))
    opened.commands.setTextSelection(4)

    expect(opened.commands.setCellBackground(null)).toBe(true)
    expect(cellAttrs(opened)).toEqual([[null, 'padding: 4px;']])
  })

  it('clears a pasted colour that was all the style held', () => {
    const opened = open(cell('background-color: #123456'))
    opened.commands.setTextSelection(4)

    opened.commands.setCellBackground(null)

    expect(cellAttrs(opened)).toEqual([[null, null]])
  })

  it('does nothing clearing a cell with no colour', () => {
    const opened = open(cell('padding: 4px'))
    opened.commands.setTextSelection(4)

    expect(opened.commands.setCellBackground(null)).toBe(false)
    expect(cellAttrs(opened)).toEqual([[null, 'padding: 4px;']])
  })

  it('clears the pasted colours of every selected cell', () => {
    const opened = open(cell('background-color: #123456'), cell('background-color: red'))
    const { state, view } = opened
    view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, 2, 7)))

    opened.commands.setCellBackground(null)

    expect(cellAttrs(opened)).toEqual([
      [null, null],
      [null, null],
    ])
  })
})
