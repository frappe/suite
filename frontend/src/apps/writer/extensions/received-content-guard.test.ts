import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import { BulletList, ListItem } from '@tiptap/extension-list'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TrailingNode } from '@tiptap/extensions'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { JoinAdjacentLists } from './join-adjacent-lists'
import { ListJoin } from './list-join'
import { ReceivedContentGuard } from './received-content-guard'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const extensions = [
  Document,
  Paragraph,
  Text,
  Heading,
  BulletList,
  ListItem,
  TrailingNode,
  ListJoin,
  JoinAdjacentLists,
]

const schema = new Editor({ extensions }).schema
const p = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
const h = (text: string) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})
const ul = (text: string) => ({
  type: 'bulletList',
  content: [{ type: 'listItem', content: [p(text)] }],
})
function stored(...content: object[]) {
  const json = {
    type: 'doc',
    content,
  }
  const ydoc = prosemirrorJSONToYDoc(schema, json, 'default')
  return Y.encodeStateAsUpdate(ydoc)
}

function open(state: Uint8Array) {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state, 'server')
  let writes = 0
  const countWrite = (_update: Uint8Array, origin: unknown) => {
    if (origin !== 'server' && origin !== 'remote') {
      writes++
    }
  }
  ydoc.on('update', countWrite)

  const element = document.createElement('div')
  document.body.append(element)
  const collaboration = {
    document: ydoc,
    field: 'default',
  }
  const editorOptions = {
    element,
    extensions: [...extensions, ReceivedContentGuard, Collaboration.configure(collaboration)],
  }
  const editor = new Editor(editorOptions)
  editors.push(editor)
  return {
    ydoc,
    editor,
    writes: () => writes,
  }
}

const blocks = (editor: Editor) => editor.getJSON().content!.map((node) => node.type)

describe('received content guard', () => {
  it('opening a document that ends in a heading writes nothing', async () => {
    const viewer = open(stored(p('body'), h('End')))
    viewer.editor.commands.setTextSelection(3)
    await settle()

    expect(viewer.writes()).toBe(0)
    expect(blocks(viewer.editor)).toEqual(['paragraph', 'heading'])
  })

  it('opening a document with two adjacent lists writes nothing', async () => {
    const viewer = open(stored(ul('one'), ul('two'), p('end')))
    await settle()

    expect(viewer.writes()).toBe(0)
    expect(blocks(viewer.editor)).toEqual(['bulletList', 'bulletList', 'paragraph'])
  })

  it("the user's own edit still tidies what it touched", async () => {
    const viewer = open(stored(ul('one'), p('gap'), ul('two'), p('end')))
    await settle()

    const gap = viewer.editor.state.doc.child(0).nodeSize
    const gapRange = {
      from: gap,
      to: gap + viewer.editor.state.doc.child(1).nodeSize,
    }
    viewer.editor.commands.deleteRange(gapRange)

    expect(blocks(viewer.editor)).toEqual(['bulletList', 'paragraph'])
    expect(viewer.ydoc.getXmlFragment('default').length).toBe(2)
  })

  it("an untidy spot elsewhere still lets the user's own edit tidy up", async () => {
    const viewer = open(stored(ul('a'), ul('b'), p('x'), ul('c'), p('gap'), ul('d'), p('end')))
    await settle()

    const { doc } = viewer.editor.state
    let gap = 0
    const findGap = (node: ProseMirrorNode, offset: number) => {
      if (node.textContent === 'gap') {
        gap = offset
      }
    }
    doc.forEach(findGap)
    const gapRange = {
      from: gap,
      to: gap + doc.nodeAt(gap)!.nodeSize,
    }
    viewer.editor.commands.deleteRange(gapRange)

    expect(blocks(viewer.editor)).toEqual([
      'bulletList',
      'bulletList',
      'paragraph',
      'bulletList',
      'paragraph',
    ])
  })

  it('two people editing elsewhere tidy nothing twice', async () => {
    const base = stored(ul('abc'), ul('def'), p('end'))
    const a = open(base)
    const b = open(base)
    await settle()

    a.editor.commands.insertContentAt(a.editor.state.doc.content.size - 1, '1')
    b.editor.commands.insertContentAt(b.editor.state.doc.content.size - 1, '2')
    const fromB = Y.encodeStateAsUpdate(b.ydoc)
    Y.applyUpdate(a.ydoc, fromB, 'remote')
    const fromA = Y.encodeStateAsUpdate(a.ydoc)
    Y.applyUpdate(b.ydoc, fromA, 'remote')

    for (const { editor } of [a, b]) {
      expect(editor.state.doc.textContent.match(/abc|def/g)).toEqual(['abc', 'def'])
    }
    expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
  })
})
