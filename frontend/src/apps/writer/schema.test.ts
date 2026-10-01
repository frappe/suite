import { describe, expect, it, vi } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Schema } from '@tiptap/pm/model'
import { ref } from 'vue'
import * as Y from 'yjs'
import { writerEditorExtensions } from './editor-extensions'
import { writerSchema } from './schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const editorSchema = (collaborative: boolean) => {
  const ydoc = new Y.Doc()
  const editor = new Editor({
    extensions: [
      ...writerEditorExtensions({
        collaborative,
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
      ...(collaborative ? [Collaboration.configure({ document: ydoc, field: 'default' })] : []),
    ],
  })
  const { schema } = editor
  editor.destroy()
  return schema
}

const describeSchema = (schema: Schema) =>
  JSON.parse(
    JSON.stringify(
      { nodes: schema.spec.nodes.toObject(), marks: schema.spec.marks.toObject() },
      (_key, value) => (typeof value === 'function' ? value.toString() : value),
    ),
  )

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
