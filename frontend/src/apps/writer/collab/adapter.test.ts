import type { CollabRoom } from '@suite/collab-client'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { writerEditorExtensions } from '../editor-extensions'
import { writerAdapter } from './adapter'
import { BODY_FIELD } from './field'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function element(name: string, text: string) {
  const node = new Y.XmlElement(name)
  node.insert(0, [new Y.XmlText(text)])
  return node
}

// A room whose body holds `blocks`
function roomWith(...blocks: Y.XmlElement[]) {
  const doc = new Y.Doc()
  doc.getXmlFragment(BODY_FIELD).insert(0, blocks)
  const presence = { awareness: new Awareness(doc), peers: [], onChange: () => () => true }
  return { doc, presence, restoreRev: 0, onChange: () => () => true } as unknown as CollabRoom
}

function openEditor(room: CollabRoom, onFrozen: () => void) {
  const host = document.createElement('div')
  document.body.append(host)
  const extensions = [Document, Paragraph, Text, ...writerAdapter.bind(room, onFrozen)]
  const editor = new Editor({ element: host, extensions })
  editors.push(editor)
  return editor
}

// The editor Writer opens, so a node that absorbs unknown blocks would show here
function openWriter(room: CollabRoom, onFrozen: () => void) {
  const host = document.createElement('div')
  document.body.append(host)
  const writerExtensions = writerEditorExtensions({
    collaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
    comments: room.doc.getMap('comments'),
    ydoc: room.doc,
    activeComment: ref(null),
    showComments: ref(false),
    showResolved: ref(false),
    edited: ref(false),
    onCommentsPainted: () => {},
  })
  const extensions = [...writerExtensions, ...writerAdapter.bind(room, onFrozen)]
  const editor = new Editor({ element: host, extensions })
  editors.push(editor)
  return editor
}

describe("Writer's binding to a room", () => {
  it("tells the page once when the document holds text the editor can't show", () => {
    const onFrozen = vi.fn()
    const editor = openEditor(
      roomWith(element('paragraph', 'Shown'), element('mystery', 'Kept')),
      onFrozen,
    )

    expect([onFrozen.mock.calls.length, editor.isEditable]).toEqual([1, false])
  })

  it('stays quiet for a document the editor can show', () => {
    const onFrozen = vi.fn()
    const editor = openEditor(roomWith(element('paragraph', 'Shown')), onFrozen)

    expect([onFrozen.mock.calls.length, editor.isEditable]).toEqual([0, true])
  })

  it("freezes Writer's own editor over a block it doesn't know", () => {
    const onFrozen = vi.fn()
    const editor = openWriter(
      roomWith(element('paragraph', 'Shown'), element('mystery', 'Kept')),
      onFrozen,
    )

    expect([onFrozen.mock.calls.length, editor.isEditable]).toEqual([1, false])
  })
})
