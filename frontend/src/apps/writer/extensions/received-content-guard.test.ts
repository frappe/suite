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

const waitForUpdates = () => new Promise((resolve) => setTimeout(resolve, 20))

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
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
const heading = (text: string) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})
const bulletList = (text: string) => ({
  type: 'bulletList',
  content: [{ type: 'listItem', content: [paragraph(text)] }],
})
function storedState(...content: object[]) {
  const json = {
    type: 'doc',
    content,
  }
  const ydoc = prosemirrorJSONToYDoc(schema, json, 'default')
  return Y.encodeStateAsUpdate(ydoc)
}

function openViewer(state: Uint8Array) {
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

const blockTypes = (editor: Editor) => editor.getJSON().content!.map((node) => node.type)

describe('received content guard', () => {
  it('opening a document that ends in a heading writes nothing', async () => {
    const viewer = openViewer(storedState(paragraph('body'), heading('End')))
    viewer.editor.commands.setTextSelection(3)
    await waitForUpdates()

    expect(viewer.writes()).toBe(0)
    expect(blockTypes(viewer.editor)).toEqual(['paragraph', 'heading'])
  })

  it('opening a document with two adjacent lists writes nothing', async () => {
    const viewer = openViewer(storedState(bulletList('one'), bulletList('two'), paragraph('end')))
    await waitForUpdates()

    expect(viewer.writes()).toBe(0)
    expect(blockTypes(viewer.editor)).toEqual(['bulletList', 'bulletList', 'paragraph'])
  })

  it("the user's own edit still tidies what it touched", async () => {
    const viewer = openViewer(
      storedState(bulletList('one'), paragraph('gap'), bulletList('two'), paragraph('end')),
    )
    await waitForUpdates()

    const gapStart = viewer.editor.state.doc.child(0).nodeSize
    const gapRange = {
      from: gapStart,
      to: gapStart + viewer.editor.state.doc.child(1).nodeSize,
    }
    viewer.editor.commands.deleteRange(gapRange)

    expect(blockTypes(viewer.editor)).toEqual(['bulletList', 'paragraph'])
    expect(viewer.ydoc.getXmlFragment('default').length).toBe(2)
  })

  it("an untidy spot elsewhere still lets the user's own edit tidy up", async () => {
    const viewer = openViewer(
      storedState(
        bulletList('a'),
        bulletList('b'),
        paragraph('x'),
        bulletList('c'),
        paragraph('gap'),
        bulletList('d'),
        paragraph('end'),
      ),
    )
    await waitForUpdates()

    const { doc } = viewer.editor.state
    let gapStart = 0
    const findGap = (node: ProseMirrorNode, offset: number) => {
      if (node.textContent === 'gap') {
        gapStart = offset
      }
    }
    doc.forEach(findGap)
    const gapRange = {
      from: gapStart,
      to: gapStart + doc.nodeAt(gapStart)!.nodeSize,
    }
    viewer.editor.commands.deleteRange(gapRange)

    expect(blockTypes(viewer.editor)).toEqual([
      'bulletList',
      'bulletList',
      'paragraph',
      'bulletList',
      'paragraph',
    ])
  })

  it('two people editing elsewhere tidy nothing twice', async () => {
    const base = storedState(bulletList('abc'), bulletList('def'), paragraph('end'))
    const viewerA = openViewer(base)
    const viewerB = openViewer(base)
    await waitForUpdates()

    viewerA.editor.commands.insertContentAt(viewerA.editor.state.doc.content.size - 1, '1')
    viewerB.editor.commands.insertContentAt(viewerB.editor.state.doc.content.size - 1, '2')
    const fromB = Y.encodeStateAsUpdate(viewerB.ydoc)
    Y.applyUpdate(viewerA.ydoc, fromB, 'remote')
    const fromA = Y.encodeStateAsUpdate(viewerA.ydoc)
    Y.applyUpdate(viewerB.ydoc, fromA, 'remote')

    for (const { editor } of [viewerA, viewerB]) {
      expect(editor.state.doc.textContent.match(/abc|def/g)).toEqual(['abc', 'def'])
    }
    expect(viewerA.editor.getJSON()).toEqual(viewerB.editor.getJSON())
  })
})
