import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'

import { BlurredSelection } from './blurred-selection'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

function mountEditor() {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, BlurredSelection],
    content: '<p>Goals for the quarter</p><p>Second paragraph</p>',
  })
  editors.push(editor)
  editor.commands.setTextSelection({ from: 1, to: 6 })
  return editor
}

const highlighted = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.selection')].map((element) => element.textContent)

describe('BlurredSelection', () => {
  it('draws the selection while the editor is blurred', () => {
    const editor = mountEditor()
    expect(highlighted(editor)).toEqual(['Goals'])
  })

  it('keeps the drawing through a click that focuses the editor, until the click selects', () => {
    const editor = mountEditor()
    // jsdom has no layout for ProseMirror's own mousedown handler, so only the plugins see the press
    const press = new MouseEvent('mousedown')
    editor.view.someProp('handleDOMEvents', (handlers) => handlers.mousedown?.(editor.view, press))
    editor.view.focus()
    expect(highlighted(editor)).toEqual(['Goals'])

    editor.commands.setTextSelection(25)
    expect(highlighted(editor)).toEqual([])
  })

  it('drops the drawing when focus arrives without a click', () => {
    const editor = mountEditor()
    editor.view.focus()
    expect(highlighted(editor)).toEqual([])
  })
})
