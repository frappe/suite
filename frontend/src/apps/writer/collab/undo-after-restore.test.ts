import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as yjs from 'yjs'

import type { CollabRoom } from '@/platform/collab'

import { writerBinding } from './binding'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

// A room whose restore rev the test moves, telling its listeners as a room does
function fakeRoom() {
  const listeners = new Set<() => void>()
  const presence = {
    awareness: new Awareness(new yjs.Doc()),
    peers: [],
    onChange: () => () => true,
  }
  const room = {
    doc: new yjs.Doc(),
    presence,
    status: { restoreRev: 0 },
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    land(rev: number) {
      room.status = { restoreRev: rev }
      for (const listener of listeners) {
        listener()
      }
    },
  }
  return room
}

function openEditor(room: ReturnType<typeof fakeRoom>) {
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
  return editor
}

describe('undo after a restore', () => {
  it('undo reaches nothing typed before the restore', () => {
    const room = fakeRoom()
    const editor = openEditor(room)
    editor.commands.insertContent('before')

    room.land(3)

    expect([editor.commands.undo(), editor.getText()]).toEqual([false, 'before'])
  })

  it('undo still works when nothing was restored', () => {
    const room = fakeRoom()
    const editor = openEditor(room)
    editor.commands.insertContent('typed')

    room.land(0)

    expect([editor.commands.undo(), editor.getText()]).toEqual([true, ''])
  })
})
