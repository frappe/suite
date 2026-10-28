import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  closeOpeningEditor,
  isOpening,
  OpeningHandover,
  placeOpeningEditor,
  releaseOpeningEditor,
} from './openingEditor'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

let live: Editor | undefined
afterEach(() => {
  live?.destroy()
  closeOpeningEditor()
  document.body.replaceChildren()
})

function place(): HTMLElement {
  return document.body.appendChild(document.createElement('div'))
}

function typeInto(where: HTMLElement, text: string) {
  const view = where.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror')
  view!.editor!.commands.insertContent(text)
}

/** The document's own editor: a shared Y.Doc that may already hold text. */
async function openLive(node: string, existing = '') {
  const ydoc = new Y.Doc()
  if (existing) {
    const seed = new Editor({
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: ydoc })],
    })
    seed.commands.insertContent(existing)
    seed.destroy()
  }
  live = new Editor({
    element: place(),
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: ydoc }),
      OpeningHandover.configure({ node }),
    ],
  })
  await new Promise((resolve) => setTimeout(resolve))
  return { editor: live, ydoc }
}

it('keeps what was typed while the document opened, once, with the caret after it', async () => {
  const first = place()
  placeOpeningEditor('doc-1', first)
  typeInto(first, 'Hello')
  // The page moves the opening editor as the document loads.
  const second = place()
  placeOpeningEditor('doc-1', second)
  typeInto(second, ' world')
  first.remove()

  const { editor, ydoc } = await openLive('doc-1')
  editor.commands.insertContent('!')

  expect(isOpening('doc-1')).toBe(false)
  expect(editor.getText()).toBe('Hello world!')
  expect(ydoc.getXmlFragment('default').toString()).toBe('<paragraph>Hello world!</paragraph>')
})

it('adds what was typed after text the document already holds', async () => {
  const where = place()
  placeOpeningEditor('doc-2', where)
  typeInto(where, 'typed')

  const { editor } = await openLive('doc-2', 'Kept first')

  expect(editor.getJSON().content?.map((block) => block.content?.[0]?.text)).toEqual([
    'Kept first',
    'typed',
  ])
})

it('leaves another document alone', async () => {
  const where = place()
  placeOpeningEditor('doc-3', where)
  typeInto(where, 'for doc-3')

  const { editor } = await openLive('doc-4')

  expect(editor.getText()).toBe('')
  expect(isOpening('doc-3')).toBe(true)
})

it('closes the opening editor once no page shows it', async () => {
  const where = place()
  placeOpeningEditor('doc-5', where)
  where.remove()
  releaseOpeningEditor('doc-5')
  await Promise.resolve()

  expect(isOpening('doc-5')).toBe(false)
})
