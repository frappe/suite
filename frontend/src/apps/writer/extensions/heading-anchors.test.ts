import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Heading from '@tiptap/extension-heading'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { HeadingAnchors } from './heading-anchors'
import { ReceivedContentGuard } from './received-content-guard'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

function open(state: Uint8Array) {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state, 'server')
  let writes = 0
  ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== 'server' && origin !== 'remote') writes++
  })
  let anchors: { id: string; textContent: string }[] = []
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Heading,
      Collaboration.configure({ document: ydoc, field: 'default' }),
      HeadingAnchors.configure({ onUpdate: (items) => (anchors = items as never) }),
      ReceivedContentGuard,
    ],
  })
  editors.push(editor)
  return { ydoc, editor, writes: () => writes, anchors: () => anchors }
}

function legacyDoc(...headings: string[]) {
  const ydoc = new Y.Doc()
  const blocks = headings.flatMap((text) => {
    const heading = new Y.XmlElement('heading')
    heading.setAttribute('level', 2 as never)
    heading.insert(0, [new Y.XmlText(text)])
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText('body')])
    return [heading, paragraph]
  })
  ydoc.getXmlFragment('default').insert(0, blocks)
  return Y.encodeStateAsUpdate(ydoc)
}

const headingIds = (editor: Editor) => {
  const ids: (string | null)[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') ids.push(node.attrs['data-toc-id'])
  })
  return ids
}

describe('heading anchors', () => {
  it('opening a document whose headings lack ids writes nothing', async () => {
    const viewer = open(legacyDoc('Intro', 'Intro', 'Usage'))
    await settle()

    expect(viewer.writes()).toBe(0)
    expect(headingIds(viewer.editor)).toEqual([null, null, null])
  })

  it('gives those headings working table-of-contents links', async () => {
    const viewer = open(legacyDoc('Intro', 'Intro', 'Usage'))
    await settle()

    const anchors = viewer.anchors()
    expect(anchors.map((anchor) => anchor.textContent)).toEqual(['Intro', 'Intro', 'Usage'])
    expect(new Set(anchors.map((anchor) => anchor.id)).size).toBe(3)
    for (const anchor of anchors) {
      const target = viewer.editor.view.dom.querySelector(`[data-toc-id="${anchor.id}"]`)
      expect(target?.textContent).toBe(anchor.textContent)
    }
  })

  it('editing gives the headings ids', async () => {
    const viewer = open(legacyDoc('Intro', 'Usage'))
    await settle()

    viewer.editor.commands.insertContentAt(viewer.editor.state.doc.content.size, '<h2>New</h2>')
    const ids = headingIds(viewer.editor)
    expect(ids).toEqual([expect.any(String), expect.any(String), expect.any(String)])
    expect(new Set(ids).size).toBe(3)
    expect(viewer.anchors().map((anchor) => anchor.id)).toEqual(ids)
  })
})
