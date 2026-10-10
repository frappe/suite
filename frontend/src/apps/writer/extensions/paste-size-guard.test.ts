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
const emptyDocLimits: Limits = {
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

function guardedEditor(limits: Limits | null, atLimit = false) {
  const notices: string[] = []
  const guardOptions = {
    limits: () => limits,
    atLimit: () => atLimit,
    onTooLarge: () => notices.push('too large'),
    onNearFull: () => notices.push('nearly full'),
  }
  const guard = PasteSizeGuard.configure(guardOptions)
  const editorOptions = {
    extensions: [Document, Paragraph, Text, guard],
  }
  editor = new Editor(editorOptions)
  return {
    view: editor.view,
    notices,
    text: () => editor!.state.doc.textContent,
  }
}

describe('paste size guard', () => {
  it('a paste over the most one save may hold is refused and the writer is told', () => {
    const { view, notices, text } = guardedEditor(emptyDocLimits)

    paste(view, 'y'.repeat(MiB + 1))

    expect([text().length, notices]).toEqual([0, ['too large']])
  })

  it('a paste well under it goes in without a word', () => {
    const { view, notices, text } = guardedEditor(emptyDocLimits)

    paste(view, 'y'.repeat(MiB / 2))

    expect([text().length, notices]).toEqual([MiB / 2, []])
  })

  it('a paste into a nearly full document goes in with a warning', () => {
    const { view, notices, text } = guardedEditor({
      ...emptyDocLimits,
      state_bytes: 4 * MiB - 1000,
    })

    paste(view, 'y'.repeat(2000))

    expect([text().length, notices]).toEqual([2000, ['nearly full']])
  })

  it('a paste into a full document is not also warned about, as the banner says so', () => {
    const { view, notices } = guardedEditor({ ...emptyDocLimits, state_bytes: 4 * MiB }, true)

    paste(view, 'y'.repeat(10))

    expect(notices).toEqual([])
  })

  it('a tab that has not heard the sizes yet takes the paste', () => {
    const { view, text } = guardedEditor(null)

    paste(view, 'y'.repeat(MiB + 1))

    expect(text().length).toBe(MiB + 1)
  })
})

// A document at its limit, in an editor bound to Yjs, and whether any update it wrote adds content
function editorAtLimit() {
  const ydoc = new Y.Doc()
  const full = { now: false }
  const element = document.createElement('div')
  document.body.append(element)
  const guardOptions = {
    limits: () => emptyDocLimits,
    atLimit: () => full.now,
  }
  const editorOptions = {
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: ydoc }),
      PasteSizeGuard.configure(guardOptions),
    ],
  }
  editor = new Editor(editorOptions)
  editor.commands.setContent('<p>alpha one</p><p>beta two</p><p></p><p>gamma three</p>')
  full.now = true

  const added: number[] = []
  const countStructs = (update: Uint8Array) => {
    const { structs } = Y.decodeUpdate(update)
    added.push(structs.length)
  }
  ydoc.on('update', countStructs)

  const blocks = () => editor!.getJSON().content!.map((block) => block.content?.[0]?.text ?? '')
  return {
    ydoc,
    full,
    added,
    blocks,
    chain: () => editor!.chain(),
  }
}

describe('a document at its size limit', () => {
  it('a tab opened on a full document shows its text', () => {
    const writtenDoc = new Y.Doc()
    const sourceOptions = {
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: writtenDoc })],
    }
    const sourceEditor = new Editor(sourceOptions)
    sourceEditor.commands.setContent('<p>alpha one</p><p>beta two</p>')
    sourceEditor.destroy()

    const ydoc = new Y.Doc()
    const writtenState = Y.encodeStateAsUpdate(writtenDoc)
    Y.applyUpdate(ydoc, writtenState)
    const element = document.createElement('div')
    document.body.append(element)
    const guardOptions = {
      limits: () => emptyDocLimits,
      atLimit: () => true,
    }
    const editorOptions = {
      element,
      extensions: [
        Document,
        Paragraph,
        Text,
        Collaboration.configure({ document: ydoc }),
        PasteSizeGuard.configure(guardOptions),
      ],
    }
    editor = new Editor(editorOptions)

    expect(editor.getText({ blockSeparator: '|' })).toBe('alpha one|beta two')
  })

  it('deleting text inside a paragraph goes in and writes nothing new', () => {
    const { added, blocks, chain } = editorAtLimit()

    chain().setTextSelection({ from: 2, to: 5 }).deleteSelection().run()

    expect([blocks()[0], added.every((structs) => structs === 0)]).toEqual(['aa one', true])
  })

  it('deleting from a paragraph through the end of the next goes in and writes nothing new', () => {
    const { added, blocks, chain } = editorAtLimit()

    chain().setTextSelection({ from: 3, to: 21 }).deleteSelection().run()

    expect([
      blocks().slice(0, 2),
      added.length > 0,
      added.every((structCount) => structCount === 0),
    ]).toEqual([['al', ''], true, true])
  })

  it('removing an empty paragraph goes in', () => {
    const { blocks, chain } = editorAtLimit()

    chain().setTextSelection(22).joinBackward().run()

    expect(blocks()).toEqual(['alpha one', 'beta two', 'gamma three'])
  })

  it('typing, replacing a selection, splitting a paragraph and joining two with text are refused', () => {
    const { added, blocks, chain } = editorAtLimit()

    chain().setTextSelection(3).insertContent('x').run()
    chain().setTextSelection(3).splitBlock().run()
    chain().setTextSelection(12).joinBackward().run()
    chain().setTextSelection({ from: 3, to: 16 }).deleteSelection().run()
    chain().setTextSelection({ from: 2, to: 5 }).insertContent('x').run()

    expect([blocks(), added]).toEqual([['alpha one', 'beta two', '', 'gamma three'], []])
  })

  it('a paste is refused', () => {
    const { blocks } = editorAtLimit()

    paste(editor!.view, 'more')

    expect(blocks()).toEqual(['alpha one', 'beta two', '', 'gamma three'])
  })

  it("another writer's change still shows", () => {
    const { ydoc, blocks } = editorAtLimit()
    const otherDoc = new Y.Doc()
    const fullState = Y.encodeStateAsUpdate(ydoc)
    Y.applyUpdate(otherDoc, fullState)
    const before = Y.encodeStateVector(otherDoc)
    const firstBlock = otherDoc.getXmlFragment('default').get(0) as Y.XmlElement
    ;(firstBlock.get(0) as Y.XmlText).insert(0, 'new ')

    const otherChange = Y.encodeStateAsUpdate(otherDoc, before)
    Y.applyUpdate(ydoc, otherChange, 'remote')

    expect(blocks()[0]).toBe('new alpha one')
  })

  it('typing goes in again once there is room', () => {
    const { full, blocks, chain } = editorAtLimit()

    full.now = false
    chain().setTextSelection(1).insertContent('x').run()

    expect(blocks()[0]).toBe('xalpha one')
  })
})
