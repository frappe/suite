import { Editor, getSchema } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Mark } from '@tiptap/pm/model'
import {
  yUndoPluginKey,
  yXmlFragmentToProseMirrorRootNode,
  type UnplaceableReason,
} from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { BODY_FIELD } from '../collab/field'
import { writerEditorExtensions } from '../editor-extensions'
import { writerSchema } from '../schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

interface Tab {
  ydoc: Y.Doc
  editor: Editor
  freezes: UnplaceableReason[]
}

type Attributes = Record<string, unknown>

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

const MYSTERY = { mystery: { shade: 'teal' } }

function text(...runs: [string, Attributes?][]) {
  const node = new Y.XmlText()
  node.applyDelta(runs.map(([insert, attributes]) => ({ insert, attributes })))
  return node
}

function block(name: string, ...runs: [string, Attributes?][]) {
  const node = new Y.XmlElement(name)
  node.insert(0, [text(...runs)])
  return node
}

function stored(node: Y.XmlElement) {
  const doc = new Y.Doc()
  doc.getXmlFragment(BODY_FIELD).insert(0, [node])
  return Y.encodeStateAsUpdate(doc)
}

function open(state: Uint8Array): Tab {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state, 'remote')
  const extensions = writerEditorExtensions({
    collaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
    comments: ydoc.getMap('comments'),
    ydoc,
    activeComment: ref(null),
    showComments: ref(false),
    showResolved: ref(false),
    edited: ref(false),
    onCommentsPainted: () => {},
  })
  const freezes: UnplaceableReason[] = []
  const ySyncOptions = { onUnplaceable: (reason: UnplaceableReason) => freezes.push(reason) }
  const collaboration = Collaboration.configure({ document: ydoc, field: BODY_FIELD, ySyncOptions })
  const mount = document.createElement('div')
  document.body.append(mount)
  const editor = new Editor({ element: mount, extensions: [...extensions, collaboration] })
  editors.push(editor)
  return { ydoc, editor, freezes }
}

// A block's text runs as Yjs holds them, the first block's by default
function storedRuns(tab: Tab, index = 0) {
  const found = tab.ydoc.getXmlFragment(BODY_FIELD).get(index) as Y.XmlElement
  return (found.get(0) as Y.XmlText).toDelta()
}

// A mark by its name, or kept formatting by its keys
function asShown(mark: Mark): string | Attributes {
  if (mark.type.name === 'keptFormatting') {
    return mark.attrs.attributes
  }

  return mark.type.name
}

// The marks the editor shows on the text holding `word`
function shownMarks(tab: Tab, word: string) {
  const found: (string | Attributes)[] = []
  tab.editor.state.doc.descendants((node) => {
    if (node.isText && node.text!.includes(word)) {
      found.push(...node.marks.map(asShown))
    }
  })
  return found
}

function exchange(left: Tab, right: Tab) {
  const leftState = Y.encodeStateVector(left.ydoc)
  Y.applyUpdate(left.ydoc, Y.encodeStateAsUpdate(right.ydoc, leftState), 'remote')
  Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc), 'remote')
}

function undoManager(tab: Tab): Y.UndoManager {
  return yUndoPluginKey.getState(tab.editor.state).undoManager
}

function typeAtEnd(tab: Tab, typed: string) {
  const end = tab.editor.state.doc.firstChild!.nodeSize - 1
  tab.editor.view.dispatch(tab.editor.state.tr.insertText(typed, end))
}

describe('formatting the editor cannot show where it sits', () => {
  it('keeps an unknown mark on code text through an edit', () => {
    const tab = open(stored(block('paragraph', ['abc', { code: {}, ...MYSTERY }])))

    typeAtEnd(tab, 'Z')

    expect(tab.freezes).toEqual([])
    const [first] = storedRuns(tab)
    expect(first).toEqual({ insert: 'abc', attributes: { code: {}, ...MYSTERY } })
  })

  it('keeps bold on code text through an edit', () => {
    const tab = open(stored(block('paragraph', ['abc', { code: {}, bold: {} }])))

    typeAtEnd(tab, 'Z')

    expect(tab.freezes).toEqual([])
    const [first] = storedRuns(tab)
    expect(first).toEqual({ insert: 'abc', attributes: { code: {}, bold: {} } })
  })

  it('keeps bold in a code block through an edit', () => {
    const tab = open(stored(block('codeBlock', ['abc', { bold: {} }])))

    typeAtEnd(tab, 'Z')

    expect(tab.freezes).toEqual([])
    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: { bold: {} } }, { insert: 'Z' }])
  })

  it('keeps hidden keys when the text is made into code', () => {
    const tab = open(stored(block('paragraph', ['abc', MYSTERY])))

    tab.editor.chain().setTextSelection({ from: 1, to: 4 }).setMark('code').run()

    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: { code: {}, ...MYSTERY } }])
  })

  // Yjs ends the run with a null marker so the typed character doesn't take its keys
  it('writes only the typed character and the end of the run next to a kept run', () => {
    const tab = open(stored(block('paragraph', ['abc', MYSTERY])))
    const updates: Uint8Array[] = []
    tab.ydoc.on('update', (update: Uint8Array) => updates.push(update))

    typeAtEnd(tab, 'Z')

    const written = updates.flatMap((update) => Y.decodeUpdate(update).structs as Y.Item[])
    const strings = written.filter((item) => item.content instanceof Y.ContentString)
    const formats = written.filter((item) => item.content instanceof Y.ContentFormat)
    expect(strings.map((item) => (item.content as Y.ContentString).str)).toEqual(['Z'])
    expect(formats.map((item) => (item.content as Y.ContentFormat).value)).toEqual([null])
    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: MYSTERY }, { insert: 'Z' }])
  })

  it('writes nothing to a kept run when the block before it is deleted', () => {
    const doc = new Y.Doc()
    const body = doc.getXmlFragment(BODY_FIELD)
    body.insert(0, [block('paragraph', ['x']), block('paragraph', ['abc', MYSTERY])])
    const tab = open(Y.encodeStateAsUpdate(doc))
    const updates: Uint8Array[] = []
    tab.ydoc.on('update', (update: Uint8Array) => updates.push(update))

    tab.editor.view.dispatch(tab.editor.state.tr.delete(0, 3))

    expect(updates.flatMap((update) => Y.decodeUpdate(update).structs)).toEqual([])
    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: MYSTERY }])
  })

  it('drops kept keys when formatting is cleared', () => {
    const tab = open(stored(block('paragraph', ['abc', { bold: {}, ...MYSTERY }])))

    tab.editor.chain().setTextSelection({ from: 1, to: 4 }).unsetAllMarks().run()

    expect(storedRuns(tab)).toEqual([{ insert: 'abc' }])
  })
})

describe('two marks that exclude each other', () => {
  it('shows code over bold, keeping bold', () => {
    const tab = open(stored(block('paragraph', ['abc', { code: {}, bold: {} }])))

    expect(shownMarks(tab, 'abc')).toEqual(['code', { bold: {} }])
  })

  it('shows a link over code, keeping code', () => {
    const link = { href: 'https://x.test' }
    const tab = open(stored(block('paragraph', ['abc', { code: {}, link }])))

    expect(shownMarks(tab, 'abc')).toEqual(['link', { code: {} }])
  })

  it('shows the same mark when built outside the editor, as the server judge does', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, stored(block('paragraph', ['abc', { code: {}, bold: {} }])))

    const root = yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment(BODY_FIELD),
      getSchema(writerSchema()),
    )

    const [shown, kept] = root.firstChild!.firstChild!.marks
    expect([shown.type.name, kept.attrs.attributes]).toEqual(['code', { bold: {} }])
  })
})

describe('kept formatting that can show where its text now sits', () => {
  const BOLD = { bold: {} }
  const boldCode = stored(block('codeBlock', ['abc', BOLD]))

  const codeThenParagraph = (() => {
    const doc = new Y.Doc()
    doc
      .getXmlFragment(BODY_FIELD)
      .insert(0, [block('codeBlock', ['abc', BOLD]), block('paragraph', ['de'])])
    return Y.encodeStateAsUpdate(doc)
  })()

  // Moves the code block's text to the end of the paragraph after it, as dragging it does
  function moveOut(tab: Tab) {
    const { state } = tab.editor
    const moved = state.doc.slice(1, 4)
    const tr = state.tr.delete(1, 4)
    tab.editor.view.dispatch(tr.insert(tr.mapping.map(8), moved.content))
  }

  it('shows when its code block becomes a paragraph, here and in a watching tab', () => {
    const [author, watcher] = [open(boldCode), open(boldCode)]

    author.editor.chain().setTextSelection(2).setParagraph().run()
    exchange(author, watcher)

    expect(shownMarks(author, 'abc')).toEqual(['bold'])
    expect(shownMarks(watcher, 'abc')).toEqual(['bold'])
    expect(storedRuns(author)).toEqual([{ insert: 'abc', attributes: BOLD }])
  })

  it('comes off for everyone when the author turns bold off', () => {
    const [author, watcher] = [open(boldCode), open(boldCode)]
    author.editor.chain().setTextSelection(2).setParagraph().run()

    author.editor.chain().setTextSelection({ from: 1, to: 4 }).toggleBold().run()
    exchange(author, watcher)

    expect(storedRuns(author)).toEqual([{ insert: 'abc' }])
    expect([shownMarks(author, 'abc'), shownMarks(watcher, 'abc')]).toEqual([[], []])
  })

  it('keeps the keys that still cannot show', () => {
    const tab = open(stored(block('codeBlock', ['abc', { ...BOLD, ...MYSTERY }])))

    tab.editor.chain().setTextSelection(2).setParagraph().run()

    expect(shownMarks(tab, 'abc')).toEqual(['bold', MYSTERY])
    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: { ...BOLD, ...MYSTERY } }])
  })

  it('shows when moved out of a code block, here and in a watching tab', () => {
    const [author, watcher] = [open(codeThenParagraph), open(codeThenParagraph)]

    moveOut(author)
    exchange(author, watcher)

    expect(shownMarks(author, 'abc')).toEqual(['bold'])
    expect(shownMarks(watcher, 'abc')).toEqual(['bold'])
    expect(storedRuns(author, 1)).toEqual([{ insert: 'de' }, { insert: 'abc', attributes: BOLD }])
  })

  it('hides and shows again through undo and redo of making the paragraph', () => {
    const [author, watcher] = [open(boldCode), open(boldCode)]
    author.editor.chain().setTextSelection(2).setParagraph().run()

    author.editor.commands.undo()

    expect(author.editor.state.doc.firstChild!.type.name).toBe('codeBlock')
    expect(shownMarks(author, 'abc')).toEqual([BOLD])

    author.editor.commands.redo()
    exchange(author, watcher)

    expect(shownMarks(author, 'abc')).toEqual(['bold'])
    expect(shownMarks(watcher, 'abc')).toEqual(['bold'])
    expect(storedRuns(author)).toEqual([{ insert: 'abc', attributes: BOLD }])
  })

  it('hides and shows again through undo and redo of the move', () => {
    const [author, watcher] = [open(codeThenParagraph), open(codeThenParagraph)]
    moveOut(author)

    author.editor.commands.undo()

    expect(shownMarks(author, 'abc')).toEqual([BOLD])
    expect(storedRuns(author)).toEqual([{ insert: 'abc', attributes: BOLD }])

    author.editor.commands.redo()
    exchange(author, watcher)

    expect(shownMarks(author, 'abc')).toEqual(['bold'])
    expect(shownMarks(watcher, 'abc')).toEqual(['bold'])
    expect(undoManager(author).undoStack).toHaveLength(1)
  })

  it('shows bold once code is taken off the text', () => {
    const tab = open(stored(block('paragraph', ['abc', { code: {}, ...BOLD }])))

    tab.editor.chain().setTextSelection({ from: 1, to: 4 }).unsetMark('code').run()

    expect(shownMarks(tab, 'abc')).toEqual(['bold'])
    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: BOLD }])
  })
})

describe('kept formatting from anywhere but Yjs', () => {
  const planted = {
    type: 'text',
    text: 'xy',
    marks: [
      { type: 'keptFormatting', attrs: { attributes: { link: { href: 'https://x.test' } } } },
    ],
  }

  it('is dropped when inserted as content', () => {
    const tab = open(stored(block('paragraph', ['abc'])))

    tab.editor.commands.insertContentAt(4, planted)

    expect(storedRuns(tab)).toEqual([{ insert: 'abcxy' }])
  })

  it('is dropped when set as the content', () => {
    const tab = open(stored(block('paragraph', ['abc'])))

    tab.editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [planted] }],
    })

    expect(storedRuns(tab)).toEqual([{ insert: 'xy' }])
  })

  it('is dropped when set as a mark', () => {
    const tab = open(stored(block('paragraph', ['abc'])))

    tab.editor
      .chain()
      .setTextSelection({ from: 1, to: 4 })
      .setMark('keptFormatting', { attributes: { link: { href: 'https://x.test' } } })
      .run()

    expect(storedRuns(tab)).toEqual([{ insert: 'abc' }])
  })

  it('stays on text moved within the document', () => {
    const tab = open(stored(block('paragraph', ['abc', MYSTERY], ['de'])))
    const { state } = tab.editor
    const moved = state.doc.slice(1, 4)

    tab.editor.view.dispatch(state.tr.delete(1, 4).insert(3, moved.content))

    expect(storedRuns(tab)).toEqual([{ insert: 'de' }, { insert: 'abc', attributes: MYSTERY }])
  })
})

describe('the code mark', () => {
  it('excludes every Writer mark but kept formatting', () => {
    const schema = getSchema(writerSchema())
    const code = schema.marks.code
    const others = Object.values(schema.marks).filter((mark) => mark.name !== 'keptFormatting')

    expect(others.filter((mark) => !code.excludes(mark))).toEqual([])
    expect(code.excludes(schema.marks.keptFormatting)).toBe(false)
  })
})
