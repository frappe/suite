import { Editor, Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { afterEach, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { TablePointer } from './table-pointer'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function mountEditor(content: string, extensions: Extension[] = []) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: [...writerSchema(), TablePointer, ...extensions],
    content,
  })
  return editor
}

const table = '<table><tr><td><p>Ann</p></td><td><p>Bo</p></td></tr></table>'

function press(instance: Editor, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  instance.view.someProp('handleKeyDown', (handle) => handle(instance.view, event))
}

describe('table pointer', () => {
  it('does not drag selected cells out of the table', () => {
    const instance = mountEditor(table)
    instance.commands.setCellSelection({ anchorCell: 2, headCell: 9 })
    expect(instance.state.selection).toBeInstanceOf(CellSelection)

    const drag = new Event('dragstart', { bubbles: true, cancelable: true })
    instance.view.dom.querySelector('td')?.dispatchEvent(drag)
    expect(drag.defaultPrevented).toBe(true)
  })

  it('starts a new line in the cell on Enter, and the next keys go on that line', () => {
    const instance = mountEditor(table)
    // The end of "Ann"
    instance.commands.setTextSelection(7)
    press(instance, 'Enter')
    instance.commands.insertContent('Kim')

    expect(instance.state.selection).not.toBeInstanceOf(CellSelection)
    const firstCell = instance.state.doc.nodeAt(2)
    expect(firstCell?.childCount).toBe(2)
    expect(firstCell?.child(1).textContent).toBe('Kim')
  })

  it('gives arrow keys, Tab and Escape to an open popup first', () => {
    const received: string[] = []
    // Stands in for the @, / and : menus, which sit below TableNavigation
    const popup = Extension.create({
      name: 'popup',
      priority: 100,
      addProseMirrorPlugins: () => [
        new Plugin({ props: { handleKeyDown: (_view, event) => !!received.push(event.key) } }),
      ],
    })
    const instance = mountEditor(table, [popup])
    instance.commands.setTextSelection(7)
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Escape']) press(instance, key)

    expect(received).toEqual(['ArrowDown', 'ArrowUp', 'Tab', 'Escape'])
    expect(instance.state.selection).not.toBeInstanceOf(CellSelection)
    expect(instance.state.selection.from).toBe(7)
  })

  it('collapses selected text on Escape, and selects the cell on the next Escape', () => {
    const instance = mountEditor(table)
    instance.commands.setTextSelection({ from: 4, to: 7 })
    press(instance, 'Escape')
    expect(instance.state.selection).not.toBeInstanceOf(CellSelection)
    expect(instance.state.selection.empty).toBe(true)

    press(instance, 'Escape')
    expect(instance.state.selection).toBeInstanceOf(CellSelection)
  })

  it('indents and outdents a list item in a cell with Tab', () => {
    const instance = mountEditor(
      '<table><tr><td><ul><li><p>one</p></li><li><p>two</p></li></ul></td><td><p>Bo</p></td></tr></table>',
    )
    instance.commands.setTextSelection(positionOf(instance, 'two'))
    press(instance, 'Tab')
    expect(instance.getHTML()).toContain('<li><p>one</p><ul><li><p>two</p></li></ul></li>')

    press(instance, 'Tab', true)
    expect(instance.getHTML()).toContain('<li><p>one</p></li><li><p>two</p></li>')
  })

  it('moves into the first cell on Delete at the end of the paragraph above a table', () => {
    const instance = mountEditor(`<p>Above</p>${table}`)
    instance.commands.setTextSelection(6)
    press(instance, 'Delete')

    expect(instance.state.doc.childCount).toBe(2)
    expect(instance.state.selection.$head.parent.textContent).toBe('Ann')
  })
})

function positionOf(instance: Editor, text: string) {
  let found = -1
  instance.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text)
  })
  return found
}
