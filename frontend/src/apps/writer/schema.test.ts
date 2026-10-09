import { Editor, getSchema } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Schema } from '@tiptap/pm/model'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { writerEditorExtensions, type WriterEditorOptions } from './editor-extensions'
import { writerSchema } from './schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const editorSchema = (collaborative: boolean) => {
  const ydoc = new Y.Doc()
  const options: WriterEditorOptions = {
    collaborative,
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
  const binding = collaborative
    ? [Collaboration.configure({ document: ydoc, field: 'default' })]
    : []
  const extensions = [...writerEditorExtensions(options), ...binding]
  const editor = new Editor({ extensions })
  const { schema } = editor
  editor.destroy()
  return schema
}

const functionAsText = (_key: string, value: unknown) =>
  typeof value === 'function' ? value.toString() : value

const describeSchema = (schema: Schema) => {
  const specs = {
    nodes: schema.spec.nodes.toObject(),
    marks: schema.spec.marks.toObject(),
  }
  const specsText = JSON.stringify(specs, functionAsText)
  return JSON.parse(specsText)
}

describe('writer schema', () => {
  it('holds every node and mark the editor does, with the same specs', () => {
    const schema = getSchema(writerSchema())
    for (const collaborative of [false, true]) {
      const editor = editorSchema(collaborative)
      expect(Object.keys(schema.nodes)).toEqual(Object.keys(editor.nodes))
      expect(Object.keys(schema.marks)).toEqual(Object.keys(editor.marks))
      expect(describeSchema(schema)).toEqual(describeSchema(editor))
    }
  })
})
