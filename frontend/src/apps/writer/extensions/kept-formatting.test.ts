import { Editor, getSchema } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Mark } from '@tiptap/pm/model'
import {
  ySyncPluginKey,
  yUndoPluginKey,
  yXmlFragmentToProseMirrorRootNode,
  type UnplaceableReason,
} from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { BODY_FIELD } from '../collab/field'
import { writerEditorExtensions } from '../editor-extensions'
import { writerSchema } from '../schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

interface Tab {
  ydoc: yjs.Doc
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
  const node = new yjs.XmlText()
  node.applyDelta(runs.map(([insert, attributes]) => ({ insert, attributes })))
  return node
}

function block(name: string, ...runs: [string, Attributes?][]) {
  const node = new yjs.XmlElement(name)
  node.insert(0, [text(...runs)])
  return node
}

function stored(node: yjs.XmlElement) {
  const doc = new yjs.Doc()
  doc.getXmlFragment(BODY_FIELD).insert(0, [node])
  return yjs.encodeStateAsUpdate(doc)
}

function open(state: Uint8Array): Tab {
  const ydoc = new yjs.Doc()
  yjs.applyUpdate(ydoc, state, 'remote')
  const extensions = writerEditorExtensions({
    isCollaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
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
  const found = tab.ydoc.getXmlFragment(BODY_FIELD).get(index) as yjs.XmlElement
  return (found.get(0) as yjs.XmlText).toDelta()
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
  const leftState = yjs.encodeStateVector(left.ydoc)
  yjs.applyUpdate(left.ydoc, yjs.encodeStateAsUpdate(right.ydoc, leftState), 'remote')
  yjs.applyUpdate(right.ydoc, yjs.encodeStateAsUpdate(left.ydoc), 'remote')
}

function undoManager(tab: Tab): yjs.UndoManager {
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

    const written = updates.flatMap((update) => yjs.decodeUpdate(update).structs as yjs.Item[])
    const strings = written.filter((item) => item.content instanceof yjs.ContentString)
    const formats = written.filter((item) => item.content instanceof yjs.ContentFormat)
    expect(strings.map((item) => (item.content as yjs.ContentString).str)).toEqual(['Z'])
    expect(formats.map((item) => (item.content as yjs.ContentFormat).value)).toEqual([null])
    expect(storedRuns(tab)).toEqual([{ insert: 'abc', attributes: MYSTERY }, { insert: 'Z' }])
  })

  it('writes nothing to a kept run when the block before it is deleted', () => {
    const doc = new yjs.Doc()
    const body = doc.getXmlFragment(BODY_FIELD)
    body.insert(0, [block('paragraph', ['x']), block('paragraph', ['abc', MYSTERY])])
    const tab = open(yjs.encodeStateAsUpdate(doc))
    const updates: Uint8Array[] = []
    tab.ydoc.on('update', (update: Uint8Array) => updates.push(update))

    tab.editor.view.dispatch(tab.editor.state.tr.delete(0, 3))

    expect(updates.flatMap((update) => yjs.decodeUpdate(update).structs)).toEqual([])
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
    const doc = new yjs.Doc()
    yjs.applyUpdate(doc, stored(block('paragraph', ['abc', { code: {}, bold: {} }])))

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
    const doc = new yjs.Doc()
    doc
      .getXmlFragment(BODY_FIELD)
      .insert(0, [block('codeBlock', ['abc', BOLD]), block('paragraph', ['de'])])
    return yjs.encodeStateAsUpdate(doc)
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

// A paragraph holding 'a', an inline `name` with `attributes`, then 'b'
function aroundAtom(name: string, attributes: Attributes) {
  const atom = new yjs.XmlElement<Record<string, string | object>>(name)
  for (const [key, value] of Object.entries(attributes)) {
    atom.setAttribute(key, value as string | object)
  }

  const node = new yjs.XmlElement('paragraph')
  node.insert(0, [text(['a']), atom, text(['b'])])
  return stored(node)
}

// The marks the editor shows on every `name` node
function atomMarks(tab: Tab, name: string) {
  const found: (string | Attributes)[] = []
  tab.editor.state.doc.descendants((node) => {
    if (node.type.name === name) {
      found.push(...node.marks.map(asShown))
    }
  })
  return found
}

function reload(tab: Tab) {
  return open(yjs.encodeStateAsUpdate(tab.ydoc))
}

describe('marks on an inline atom', () => {
  const ATOMS: [string, Attributes][] = [
    ['mention', { id: 'ann', label: 'Ann' }],
    ['image', { src: '/files/x.png' }],
  ]

  it.each(ATOMS)(
    'bold over text and an atom shows on the other tab and after a reload (%s)',
    (name, attrs) => {
      const state = aroundAtom(name, attrs)
      const [author, watcher] = [open(state), open(state)]

      author.editor.chain().setTextSelection({ from: 1, to: 4 }).setBold().run()
      exchange(author, watcher)

      const tabs = [author, watcher, reload(author)]
      expect(tabs.map((tab) => atomMarks(tab, name))).toEqual([['bold'], ['bold'], ['bold']])
      expect(tabs.map((tab) => shownMarks(tab, 'b'))).toEqual([['bold'], ['bold'], ['bold']])
      expect(tabs.flatMap((tab) => tab.freezes)).toEqual([])
    },
  )

  it.each(ATOMS)(
    'bold on the atom alone shows on the other tab and after a reload (%s)',
    (name, attrs) => {
      const state = aroundAtom(name, attrs)
      const [author, watcher] = [open(state), open(state)]

      author.editor.chain().setTextSelection({ from: 2, to: 3 }).setBold().run()
      exchange(author, watcher)

      const tabs = [author, watcher, reload(author)]
      expect(tabs.map((tab) => atomMarks(tab, name))).toEqual([['bold'], ['bold'], ['bold']])
      expect(tabs.map((tab) => shownMarks(tab, 'b'))).toEqual([[], [], []])
    },
  )

  it.each(ATOMS)(
    'removing bold from an atom clears it on the other tab and after a reload (%s)',
    (name, attrs) => {
      const state = aroundAtom(name, { ...attrs, bold: {} })
      const [author, watcher] = [open(state), open(state)]
      expect(atomMarks(watcher, name)).toEqual(['bold'])

      author.editor.chain().setTextSelection({ from: 1, to: 4 }).unsetBold().run()
      exchange(author, watcher)

      const tabs = [author, watcher, reload(author)]
      expect(tabs.map((tab) => atomMarks(tab, name))).toEqual([[], [], []])
      expect(tabs.flatMap((tab) => tab.freezes)).toEqual([])
    },
  )

  it('keeps formatting the mention cannot show when bold is set over it', () => {
    const tab = open(aroundAtom('mention', { id: 'ann', ...MYSTERY }))

    tab.editor.chain().setTextSelection({ from: 1, to: 4 }).setBold().run()

    const paragraph = tab.ydoc.getXmlFragment(BODY_FIELD).get(0) as yjs.XmlElement
    const written = (paragraph.get(1) as yjs.XmlElement).getAttributes()
    expect(written).toEqual({ id: 'ann', bold: {}, ...MYSTERY })
    expect(atomMarks(reload(tab), 'mention')).toEqual(['bold', MYSTERY])
  })

  it.each(ATOMS)('bold on the atom shows in a past state (%s)', async (name, attrs) => {
    const tab = open(aroundAtom(name, { ...attrs, bold: {} }))
    const past = yjs.encodeStateAsUpdateV2(tab.ydoc)
    tab.editor.chain().setTextSelection({ from: 1, to: 4 }).unsetBold().run()
    expect(atomMarks(tab, name)).toEqual([])

    const shown = { snapshot: past, prevSnapshot: past }
    tab.editor.view.dispatch(tab.editor.state.tr.setMeta(ySyncPluginKey, shown))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(atomMarks(tab, name)).toEqual(['bold'])
    expect(tab.freezes).toEqual([])
  })

  it('is never an attribute of the atom itself', () => {
    const schema = getSchema(writerSchema())
    const inline = Object.values(schema.nodes).filter((type) => type.isInline && !type.isText)
    const clashes = inline.flatMap((type) =>
      Object.keys(type.attrs)
        .filter((key) => key in schema.marks)
        .map((key) => `${type.name}.${key}`),
    )

    expect(inline.map((type) => type.name)).toEqual(expect.arrayContaining(['mention', 'image']))
    expect(clashes).toEqual([])
  })
})
