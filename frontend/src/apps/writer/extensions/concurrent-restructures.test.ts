import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { BODY_FIELD } from '../collab/field'
import { writerEditorExtensions } from '../editor-extensions'
import { writerSchema } from '../schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

interface Side {
  ydoc: Y.Doc
  editor: Editor
}

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function bulletList(text: string) {
  return { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text)] }] }
}

function stored(...content: JSONContent[]) {
  const schema = getSchema(writerSchema())
  const ydoc = prosemirrorJSONToYDoc(schema, { type: 'doc', content }, BODY_FIELD)
  return Y.encodeStateAsUpdate(ydoc)
}

function open(state: Uint8Array): Side {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state, 'remote')
  const commentsDoc = new Y.Doc()
  const extensions = writerEditorExtensions({
    collaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
    comments: commentsDoc.getMap('comments'),
    ydoc: commentsDoc,
    activeComment: ref(null),
    showComments: ref(false),
    showResolved: ref(false),
    edited: ref(false),
    onCommentsPainted: () => {},
  })
  const element = document.createElement('div')
  document.body.append(element)
  const collaboration = Collaboration.configure({ document: ydoc, field: BODY_FIELD })
  const editor = new Editor({ element, extensions: [...extensions, collaboration] })
  editors.push(editor)
  return { ydoc, editor }
}

function exchange(left: Side, right: Side) {
  Y.applyUpdate(left.ydoc, Y.encodeStateAsUpdate(right.ydoc), 'remote')
  Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc), 'remote')
}

// The document position just inside `word`, plus `offset`
function inside(editor: Editor, word: string, offset = 1) {
  let found = -1
  editor.state.doc.descendants((node, position) => {
    if (found < 0 && node.isText && node.text!.includes(word)) {
      found = position + node.text!.indexOf(word)
    }

    return found < 0
  })
  return found + offset
}

async function race(
  base: Uint8Array,
  first: (editor: Editor) => void,
  second: (editor: Editor) => void,
) {
  const left = open(base)
  const right = open(base)
  await settle()
  first(left.editor)
  second(right.editor)
  exchange(left, right)
  await settle()
  return [left.editor.state.doc.textContent, right.editor.state.doc.textContent]
}

const threeParagraphs = stored(paragraph('abc'), paragraph('defgh'), paragraph('xyz'))

function typeQQ(editor: Editor, word: string) {
  editor
    .chain()
    .setTextSelection(inside(editor, word, 2))
    .insertContent('QQ')
    .run()
}

// Two people restructuring one block at once keep both copies of it (owner, 2026-10-14): nothing is lost
describe('concurrent restructures of one block', () => {
  it('keeps both copies when both wrap the last block in a different list', async () => {
    const texts = await race(
      threeParagraphs,
      (editor) => editor.chain().setTextSelection(inside(editor, 'xyz')).toggleBulletList().run(),
      (editor) => {
        editor.chain().setTextSelection(inside(editor, 'xyz')).toggleTaskList().run()
        typeQQ(editor, 'xyz')
      },
    )

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/xy(QQ)?z/g)).toEqual(expect.arrayContaining(['xyQQz', 'xyz']))
    expect(texts[0]).toContain('abcdefgh')
  })

  it('keeps both copies when both make the block a heading', async () => {
    const texts = await race(
      threeParagraphs,
      (editor) =>
        editor
          .chain()
          .setTextSelection(inside(editor, 'defgh'))
          .setNode('heading', { level: 2 })
          .run(),
      (editor) => {
        editor
          .chain()
          .setTextSelection(inside(editor, 'defgh'))
          .setNode('heading', { level: 3 })
          .run()
        typeQQ(editor, 'defgh')
      },
    )

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/de(QQ)?fgh/g)).toHaveLength(2)
    expect(texts[0]).toContain('deQQfgh')
  })

  it('keeps both copies when one joins the block up and the other makes it a heading', async () => {
    const texts = await race(
      threeParagraphs,
      (editor) =>
        editor
          .chain()
          .setTextSelection(inside(editor, 'defgh', 0))
          .joinBackward()
          .run(),
      (editor) => {
        editor
          .chain()
          .setTextSelection(inside(editor, 'defgh'))
          .setNode('heading', { level: 2 })
          .run()
        typeQQ(editor, 'defgh')
      },
    )

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/de(QQ)?fgh/g)).toHaveLength(2)
    expect(texts[0]).toContain('deQQfgh')
  })

  it('keeps the second list twice when both delete the paragraph between two lists', async () => {
    const base = stored(bulletList('abc'), paragraph('gap'), bulletList('def'), paragraph('end'))
    function deleteGap(editor: Editor) {
      const from = editor.state.doc.child(0).nodeSize
      editor.commands.deleteRange({ from, to: from + editor.state.doc.child(1).nodeSize })
    }

    const texts = await race(base, deleteGap, deleteGap)

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/abc|def|end/g)).toEqual(['abc', 'def', 'def', 'end'])
  })
})
