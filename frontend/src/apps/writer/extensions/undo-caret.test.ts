import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, expect, it } from 'vitest'
import * as Y from 'yjs'

import { UndoCaret } from './undo-caret'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

it('puts the caret after the words a redo brings back', () => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: new Y.Doc() }),
      UndoCaret,
    ],
  })
  editor.commands.insertContent('Line')
  yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing()
  editor.commands.insertContent(' undo-me')

  editor.commands.undo()
  expect(editor.getText()).toBe('Line')
  editor.commands.redo()
  editor.commands.insertContent('!')

  expect(editor.getText()).toBe('Line undo-me!')
})
