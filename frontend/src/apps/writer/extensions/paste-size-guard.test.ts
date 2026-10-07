import type { Limits } from '@suite/collab-client'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { PasteSizeGuard } from './paste-size-guard'

const MiB = 2 ** 20
const empty: Limits = {
  fragment: 256 * 1024,
  edit_max: MiB,
  state_max: 4 * MiB,
  state_bytes: 0,
  tail_bound: 0,
}

let editor: Editor | undefined
// jsdom has no ClipboardEvent, which ProseMirror makes when it is given none
const paste = (view: Editor['view'], text: string) =>
  view.pasteText(text, new Event('paste') as ClipboardEvent)
afterEach(() => editor?.destroy())

function guarded(limits: Limits | null) {
  const said: string[] = []
  editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      PasteSizeGuard.configure({
        limits: () => limits,
        tooLarge: () => said.push('too large'),
        nearFull: () => said.push('nearly full'),
      }),
    ],
  })
  return { view: editor.view, said, text: () => editor!.state.doc.textContent }
}

describe('paste size guard', () => {
  it('a paste over the most one save may hold is refused and the writer is told', () => {
    const { view, said, text } = guarded(empty)

    paste(view, 'y'.repeat(MiB + 1))

    expect([text().length, said]).toEqual([0, ['too large']])
  })

  it('a paste well under it goes in without a word', () => {
    const { view, said, text } = guarded(empty)

    paste(view, 'y'.repeat(MiB / 2))

    expect([text().length, said]).toEqual([MiB / 2, []])
  })

  it('a paste into a nearly full document goes in with a warning', () => {
    const { view, said, text } = guarded({ ...empty, state_bytes: 4 * MiB - 1000 })

    paste(view, 'y'.repeat(2000))

    expect([text().length, said]).toEqual([2000, ['nearly full']])
  })

  it('a tab that has not heard the sizes yet takes the paste', () => {
    const { view, text } = guarded(null)

    paste(view, 'y'.repeat(MiB + 1))

    expect(text().length).toBe(MiB + 1)
  })
})

// A document at its limit, in an editor bound to Yjs, and whether any update it wrote adds content
function atLimit() {
  const ydoc = new Y.Doc()
  const full = { now: false }
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: ydoc }),
      PasteSizeGuard.configure({ limits: () => empty, atLimit: () => full.now }),
    ],
  })
  editor.commands.setContent('<p>alpha one</p><p>beta two</p><p></p><p>gamma three</p>')
  full.now = true
  const added: number[] = []
  ydoc.on('update', (update: Uint8Array) => added.push(Y.decodeUpdate(update).structs.length))
  const blocks = () => editor!.getJSON().content!.map((block) => block.content?.[0]?.text ?? '')
  return { ydoc, full, added, blocks, chain: () => editor!.chain() }
}

describe('a document at its size limit', () => {
  it('a tab opened on a full document shows its text', () => {
    const written = new Y.Doc()
    const source = new Editor({
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: written })],
    })
    source.commands.setContent('<p>alpha one</p><p>beta two</p>')
    source.destroy()
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(written))
    const element = document.createElement('div')
    document.body.append(element)
    editor = new Editor({
      element,
      extensions: [
        Document,
        Paragraph,
        Text,
        Collaboration.configure({ document: ydoc }),
        PasteSizeGuard.configure({ limits: () => empty, atLimit: () => true }),
      ],
    })

    expect(editor.getText({ blockSeparator: '|' })).toBe('alpha one|beta two')
  })

  it('deleting text inside a paragraph goes in and writes nothing new', () => {
    const { added, blocks, chain } = atLimit()

    chain().setTextSelection({ from: 2, to: 5 }).deleteSelection().run()

    expect([blocks()[0], added.every((structs) => structs === 0)]).toEqual(['aa one', true])
  })

  it('deleting from a paragraph through the end of the next goes in and writes nothing new', () => {
    const { added, blocks, chain } = atLimit()

    chain().setTextSelection({ from: 3, to: 21 }).deleteSelection().run()

    expect([blocks().slice(0, 2), added.length > 0, added.every((n) => n === 0)]).toEqual([
      ['al', ''],
      true,
      true,
    ])
  })

  it('removing an empty paragraph goes in', () => {
    const { blocks, chain } = atLimit()

    chain().setTextSelection(22).joinBackward().run()

    expect(blocks()).toEqual(['alpha one', 'beta two', 'gamma three'])
  })

  it('typing, replacing a selection, splitting a paragraph and joining two with text are refused', () => {
    const { added, blocks, chain } = atLimit()

    chain().setTextSelection(3).insertContent('x').run()
    chain().setTextSelection(3).splitBlock().run()
    chain().setTextSelection(12).joinBackward().run()
    chain().setTextSelection({ from: 3, to: 16 }).deleteSelection().run()
    chain().setTextSelection({ from: 2, to: 5 }).insertContent('x').run()

    expect([blocks(), added]).toEqual([['alpha one', 'beta two', '', 'gamma three'], []])
  })

  it('a paste is refused', () => {
    const { blocks } = atLimit()

    paste(editor!.view, 'more')

    expect(blocks()).toEqual(['alpha one', 'beta two', '', 'gamma three'])
  })

  it("another writer's change still shows", () => {
    const { ydoc, blocks } = atLimit()
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc))
    const before = Y.encodeStateVector(other)
    const first = other.getXmlFragment('default').get(0) as Y.XmlElement
    ;(first.get(0) as Y.XmlText).insert(0, 'new ')

    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(other, before), 'remote')

    expect(blocks()[0]).toBe('new alpha one')
  })

  it('typing goes in again once there is room', () => {
    const { full, blocks, chain } = atLimit()

    full.now = false
    chain().setTextSelection(1).insertContent('x').run()

    expect(blocks()[0]).toBe('xalpha one')
  })
})
