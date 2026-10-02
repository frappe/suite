import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { ref } from 'vue'
import * as Y from 'yjs'
import { writerEditorExtensions } from './editor-extensions'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const writerEditor = (content: string) => {
  const ydoc = new Y.Doc()
  return new Editor({
    content,
    extensions: writerEditorExtensions({
      collaborative: false,
      mentionItems: () => [],
      onCommentActivated: () => {},
      onAnchors: () => {},
      scrollParent: () => null,
      comments: ydoc.getMap('comments'),
      ydoc,
      activeComment: ref(null),
      showComments: ref(false),
      showResolved: ref(false),
      edited: ref(false),
      onCommentsPainted: () => {},
    }),
  })
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
