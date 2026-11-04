import { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'

import { bubbleMenuOptions } from './components/core-editor/bubble-menu'
import { writerEditorExtensions, type WriterEditorOptions } from './editor-extensions'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

function writerEditor(content: string, changes: Partial<WriterEditorOptions> = {}) {
  const options: WriterEditorOptions = {
    isCollaborative: false,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => null,
    media: null,
  }
  const extensions = writerEditorExtensions({ ...options, ...changes })
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

describe('collab editor without a comments map', () => {
  it('runs without the comment extension and still shows the bubble menu over a selection', () => {
    const editor = writerEditor('<p>plain text</p>', {
      isCollaborative: true,
    })
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const { state } = editor
    const { from, to } = state.selection
    const names = editor.extensionManager.extensions.map((extension) => extension.name)

    expect(names).not.toContain('commentExtension')
    expect(bubbleMenuOptions().shouldShow({ state, from, to })).toBe(true)
    editor.destroy()
  })
})
