import { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { writerEditorExtensions, type WriterEditorOptions } from './editor-extensions'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const writerEditor = (content: string) => {
  const ydoc = new Y.Doc()
  const options: WriterEditorOptions = {
    collaborative: false,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => null,
    media: null,
    comments: ydoc.getMap('comments'),
    ydoc,
    activeComment: ref(null),
    showComments: ref(false),
    showResolved: ref(false),
    edited: ref(false),
    onCommentsPainted: () => {},
  }
  const extensions = writerEditorExtensions(options)
  return new Editor({ content, extensions })
}

describe('writer editor', () => {
  it('paints the styles of one selection onto another', () => {
    const editor = writerEditor('<p><strong>bold</strong> plain</p>')

    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor.commands.storeStyles()
    editor.commands.setTextSelection({ from: 6, to: 11 })
    editor.commands.applyStyles()

    expect(editor.getHTML()).toContain('<strong>plain</strong>')
    editor.destroy()
  })
})
