import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { CollabRoom } from '@/platform/collab'

import { writerBinding } from './binding'
import { BODY_FIELD } from './field'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function openEditor() {
  const doc = new Y.Doc()
  const presence = { awareness: new Awareness(doc), peers: [], onChange: () => () => true }
  const room = { doc, presence, status: { restoreRev: 0 }, onChange: () => () => true }
  const element = document.createElement('div')
  document.body.append(element)
  const extensions = [
    Document,
    Paragraph,
    Text,
    ...writerBinding(room as unknown as CollabRoom, () => {}),
  ]
  const editor = new Editor({ element, extensions })
  editors.push(editor)
  return { editor, body: doc.getXmlFragment(BODY_FIELD) }
}

function typeLines(editor: Editor, lines: string[]) {
  lines.forEach((line, index) => {
    if (index > 0) {
      editor.commands.splitBlock()
    }
    editor.commands.insertContent(line)
  })
}

function lines(editor: Editor) {
  const texts: string[] = []
  editor.state.doc.forEach((block) => texts.push(block.textContent))
  return texts
}

// Any later editor update, such as a caret move or a comment redraw
function touch(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta('touched', true))
}

// Runs `command` until it has nothing left to do, touching the editor after each run
function exhaust(editor: Editor, command: () => boolean) {
  for (let run = 0; run < 10 && command(); run++) {
    touch(editor)
  }
}

describe('undo steps in a shared document', () => {
  it('takes back one typed line per undo', () => {
    const { editor } = openEditor()
    typeLines(editor, ['One', 'Two', 'Three'])

    editor.commands.undo()
    expect(lines(editor)).toEqual(['One', 'Two'])
    editor.commands.undo()
    expect(lines(editor)).toEqual(['One'])
  })

  it('redoes everything after undoing to an empty document', () => {
    const { editor, body } = openEditor()
    typeLines(editor, ['One', 'Two', 'Three'])

    exhaust(editor, () => editor.commands.undo())
    expect(lines(editor)).toEqual([''])
    expect(body.length).toBe(0)

    touch(editor)
    expect(body.length).toBe(0)
    exhaust(editor, () => editor.commands.redo())
    expect(lines(editor)).toEqual(['One', 'Two', 'Three'])
  })

  it('still writes a body its own user empties', () => {
    const { editor, body } = openEditor()
    typeLines(editor, ['One'])

    editor.commands.selectAll()
    editor.commands.deleteSelection()
    expect(body.toJSON()).toBe('<paragraph></paragraph>')
  })
})
