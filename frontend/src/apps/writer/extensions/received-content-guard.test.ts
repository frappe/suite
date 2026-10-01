import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Heading from '@tiptap/extension-heading'
import { BulletList, ListItem } from '@tiptap/extension-list'
import { TrailingNode } from '@tiptap/extensions'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { ListJoin } from './list-join'
import { ReceivedContentGuard } from './received-content-guard'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const extensions = [Document, Paragraph, Text, Heading, BulletList, ListItem, TrailingNode, ListJoin]

const schema = new Editor({ extensions }).schema
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const h = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const ul = (text: string) => ({ type: 'bulletList', content: [{ type: 'listItem', content: [p(text)] }] })
const stored = (...content: object[]) =>
  Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, { type: 'doc', content }, 'default'))

function open(state: Uint8Array) {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state, 'server')
  let writes = 0
  ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== 'server' && origin !== 'remote') writes++
  })
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [
      ...extensions,
      ReceivedContentGuard,
      Collaboration.configure({ document: ydoc, field: 'default' }),
    ],
  })
  editors.push(editor)
  return { ydoc, editor, writes: () => writes }
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

  it("the user's own edit still normalizes the document", async () => {
    const viewer = open(stored(ul('one'), ul('two'), h('End')))
    await settle()

    viewer.editor.commands.insertContentAt(3, 'Z')

    expect(viewer.writes()).toBeGreaterThan(0)
    expect(blocks(viewer.editor)).toEqual(['bulletList', 'heading', 'paragraph'])
    expect(viewer.ydoc.getXmlFragment('default').length).toBe(3)
  })
})
