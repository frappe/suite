import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { paletteFill, TablePaste } from './table-paste'
import { TablePointer } from './table-pointer'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function mountEditor(content: string) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: [...writerSchema(), TablePointer, TablePaste],
    content,
  })
  return editor
}

const row = (...texts: string[]) =>
  `<tr>${texts.map((text) => `<td><p>${text}</p></td>`).join('')}</tr>`
const grid = `<table>${row('a1', 'b1', 'c1')}${row('a2', 'b2', 'c2')}${row('a3', 'b3', 'c3')}</table>`

function cells(instance: Editor) {
  const texts: string[] = []
  instance.state.doc.descendants((node) => {
    if (node.type.spec.tableRole !== 'cell') return true
    texts.push(node.textContent)
    return false
  })
  return texts
}

function cellPos(instance: Editor, text: string) {
  let found = -1
  instance.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.spec.tableRole === 'cell' && node.textContent === text) found = pos
  })
  return found
}

/** jsdom has no ClipboardEvent */
function paste(instance: Editor, html: string) {
  instance.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
}

describe('table paste', () => {
  it('keeps the colour of the pale fills in Google Sheets and Docs', () => {
    expect(paletteFill('#fff2cc')).toBe('yellow')
    expect(paletteFill('#fce5cd')).toBe('orange')
    expect(paletteFill('#f4cccc')).toBe('red')
    expect(paletteFill('#d9ead3')).toBe('green')
    expect(paletteFill('#cfe2f3')).toBe('blue')
    expect(paletteFill('#ead1dc')).toBe('pink')
    expect(paletteFill('rgb(255, 255, 0)')).toBe('yellow')
    expect(paletteFill('#f3f3f3')).toBeNull()
    expect(paletteFill('#ffffff')).toBeNull()
    expect(paletteFill('rgba(0, 0, 0, 0)')).toBeNull()
  })

  it('pastes a Sheets table with its fills and even columns', () => {
    const instance = mountEditor('<p></p>')
    const sheets =
      '<table><colgroup><col><col width="120"></colgroup><tr>' +
      '<td style="background-color:#fff2cc">Due</td><td style="background-color:#d9ead3" data-colwidth="120">Done</td>' +
      '</tr></table>'
    paste(instance, sheets)

    const fills: unknown[] = []
    const widths: unknown[] = []
    instance.state.doc.descendants((node) => {
      if (node.type.spec.tableRole !== 'cell') return true
      fills.push(node.attrs.backgroundColor)
      widths.push(node.attrs.colwidth)
      return false
    })
    expect(fills).toEqual(['yellow', 'green'])
    expect(widths).toEqual([null, null])
  })

  it('pastes a block of cells over one selected cell in full', () => {
    const instance = mountEditor(grid)
    const block = `<table>${row('X', 'Y')}${row('Z', 'W')}</table>`
    instance.commands.setCellSelection({ anchorCell: cellPos(instance, 'a1') })
    paste(instance, block)

    expect(cells(instance)).toEqual(['X', 'Y', 'c1', 'Z', 'W', 'c2', 'a3', 'b3', 'c3'])
  })

  it('copies cells as tab-separated rows', () => {
    const instance = mountEditor(grid)
    instance.commands.setCellSelection({
      anchorCell: cellPos(instance, 'a1'),
      headCell: cellPos(instance, 'b2'),
    })
    const slice = instance.state.selection.content()
    const text = instance.view.someProp('clipboardTextSerializer', (serialize) =>
      serialize(slice, instance.view),
    )
    expect(text).toBe('a1\tb1\na2\tb2')
  })
})
