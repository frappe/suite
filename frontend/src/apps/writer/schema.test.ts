import { Editor, getSchema } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Schema } from '@tiptap/pm/model'
import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { writerEditorExtensions, type WriterEditorOptions } from './editor-extensions'
import { writerSchema } from './schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

function buildEditorSchema(isCollaborative: boolean) {
  const ydoc = new yjs.Doc()
  const options: WriterEditorOptions = {
    isCollaborative,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => null,
    media: null,
  }
  const extensions = writerEditorExtensions(options)
  if (isCollaborative) {
    extensions.push(Collaboration.configure({ document: ydoc, field: 'default' }))
  }

  const editor = new Editor({ extensions })
  const { schema } = editor
  editor.destroy()
  return schema
}

function functionAsText(_key: string, value: unknown) {
  if (typeof value === 'function') {
    return value.toString()
  }

  return value
}

function describeSchema(schema: Schema) {
  const specs = {
    nodes: schema.spec.nodes.toObject(),
    marks: schema.spec.marks.toObject(),
  }
  const specsText = JSON.stringify(specs, functionAsText)
  return JSON.parse(specsText)
}

describe('writer schema', () => {
  it('holds every node and mark the editor does, with the same specs', () => {
    const standaloneSchema = getSchema(writerSchema())
    for (const isCollaborative of [false, true]) {
      const editorSchema = buildEditorSchema(isCollaborative)
      expect(Object.keys(standaloneSchema.nodes)).toEqual(Object.keys(editorSchema.nodes))
      expect(Object.keys(standaloneSchema.marks)).toEqual(Object.keys(editorSchema.marks))
      expect(describeSchema(standaloneSchema)).toEqual(describeSchema(editorSchema))
    }
  })
})
