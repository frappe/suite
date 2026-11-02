import { Editor, getSchema, type AnyExtension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import {
  absolutePositionToRelativePosition,
  placeFragment,
  redo,
  relativePositionToAbsolutePosition,
  undo,
  ySyncPluginKey,
  yUndoPluginKey,
  type UnplaceableReason,
} from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import type { DocumentThread } from '@/apps/drive'

import { encodeAnchor } from '../collab/anchors'
import { writerFault } from '../collab/fault'
import { BODY_FIELD } from '../collab/field'
import { redrawThreads, ThreadHighlights, type ThreadPlaces } from '../collab/highlights'
import { writerEditorExtensions } from '../editor-extensions'
import { writerSchema } from '../schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const REMOTE = 'remote'

interface Tab {
  ydoc: yjs.Doc
  editor: Editor
  freezes: [UnplaceableReason, unknown][]
}

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function element(name: string, ...children: (yjs.XmlElement | yjs.XmlText)[]) {
  const node = new yjs.XmlElement(name)
  node.insert(0, children)
  return node
}

function paragraph(text: string) {
  return element('paragraph', new yjs.XmlText(text))
}

function stored(...blocks: yjs.XmlElement[]) {
  const doc = new yjs.Doc()
  doc.getXmlFragment(BODY_FIELD).insert(0, blocks)
  return yjs.encodeStateAsUpdate(doc)
}

function open(state: Uint8Array, ...more: AnyExtension[]): Tab {
  const ydoc = new yjs.Doc()
  yjs.applyUpdate(ydoc, state, REMOTE)
  const extensions = writerEditorExtensions({
    isCollaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
  })
  const freezes: Tab['freezes'] = []
  const ySyncOptions = {
    onUnplaceable: (reason: UnplaceableReason, transaction: yjs.Transaction | null) =>
      freezes.push([reason, transaction?.origin ?? null]),
  }
  const collaboration = Collaboration.configure({ document: ydoc, field: BODY_FIELD, ySyncOptions })
  const mount = document.createElement('div')
  document.body.append(mount)
  const editor = new Editor({ element: mount, extensions: [...extensions, collaboration, ...more] })
  editors.push(editor)
  return { ydoc, editor, freezes }
}

function storedBody(state: Uint8Array) {
  const doc = new yjs.Doc()
  yjs.applyUpdate(doc, state)
  return doc.getXmlFragment(BODY_FIELD).toString()
}

function body(tab: Tab) {
  return tab.ydoc.getXmlFragment(BODY_FIELD).toString()
}

function type(tab: Tab, text: string, at = 1) {
  tab.editor.view.dispatch(tab.editor.state.tr.insertText(text, at))
}

function cell(name: string) {
  return element(name, paragraph(name))
}

function list(name: string, item: string) {
  return element(name, element(item, paragraph(item)))
}

function cellInBody() {
  return element('tableCell', paragraph('cell text'))
}

describe('content the editor cannot hold', () => {
  it('freezes on open over a table cell straight in the body and leaves the body as stored', () => {
    const tab = open(stored(paragraph('hello'), cellInBody()))
    const before = body(tab)

    type(tab, 'X')

    expect(tab.freezes).toEqual([['open', null]])
    expect(tab.editor.isEditable).toBe(false)
    expect(body(tab)).toBe(before)
  })

  it('freezes on the row that brings a table cell and names its transaction', () => {
    const source = new yjs.Doc()
    yjs.applyUpdate(source, stored(paragraph('hello')))
    const tab = open(yjs.encodeStateAsUpdate(source))
    const vector = yjs.encodeStateVector(source)
    source.getXmlFragment(BODY_FIELD).insert(1, [cellInBody()])

    yjs.applyUpdate(tab.ydoc, yjs.encodeStateAsUpdate(source, vector), REMOTE)
    type(tab, 'X')

    expect(tab.freezes).toEqual([['row', REMOTE]])
    expect(body(tab)).toBe(source.getXmlFragment(BODY_FIELD).toString())
  })

  it('keeps an element of a kind the editor lacks', () => {
    const tab = open(stored(paragraph('hello'), element('resizableMedia', paragraph('old'))))

    type(tab, 'X')

    expect(tab.freezes).toEqual([['open', null]])
    expect(body(tab)).toContain('<resizablemedia><paragraph>old</paragraph></resizablemedia>')
  })

  it('keeps text with a mark the editor lacks', () => {
    const text = new yjs.XmlText()
    text.insert(0, 'marked', { oldMark: {} })
    const tab = open(stored(paragraph('hello'), element('paragraph', text)))

    type(tab, 'X')

    expect(tab.freezes).toEqual([])
    expect(tab.editor.state.doc.textContent).toContain('marked')
    expect(body(tab)).toContain('<oldMark>marked</oldMark>')
  })

  it('freezes over a table cell deep inside a quote', () => {
    const tab = open(stored(paragraph('hello'), element('blockquote', cellInBody())))

    expect(tab.freezes).toEqual([['open', null]])
  })

  it('opens text that two people made bold and code at once without freezing', () => {
    const text = new yjs.XmlText()
    text.insert(0, 'both', { bold: {}, code: {} })
    const tab = open(stored(paragraph('hello'), element('paragraph', text)))

    type(tab, 'X')

    expect([tab.freezes, tab.editor.isEditable]).toEqual([[], true])
    expect(body(tab)).toContain('Xhello')
  })

  it('keeps edits made before a later row froze the tab', () => {
    const source = new yjs.Doc()
    yjs.applyUpdate(source, stored(paragraph('hello')))
    const tab = open(yjs.encodeStateAsUpdate(source))
    type(tab, 'mine ')
    const vector = yjs.encodeStateVector(source)
    source.getXmlFragment(BODY_FIELD).insert(1, [cellInBody()])

    yjs.applyUpdate(tab.ydoc, yjs.encodeStateAsUpdate(source, vector), REMOTE)

    expect(tab.freezes).toHaveLength(1)
    expect(body(tab)).toContain('mine hello')
  })

  it('opens an empty body without freezing and writes the first edit', () => {
    const tab = open(yjs.encodeStateAsUpdate(new yjs.Doc()))

    type(tab, 'first')

    expect([tab.freezes, tab.editor.isEditable]).toEqual([[], true])
    expect(body(tab)).toContain('first')
  })

  it('opens and edits a document of every block kind without freezing', () => {
    const table = element(
      'table',
      element('tableRow', cell('tableHeader'), cell('tableHeader')),
      element('tableRow', cell('tableCell'), cell('tableCell')),
    )
    const heading = element('heading', new yjs.XmlText('title'))
    heading.setAttribute('level', 2)
    const tab = open(
      stored(
        heading,
        paragraph('hello'),
        list('bulletList', 'listItem'),
        list('taskList', 'taskItem'),
        element('blockquote', paragraph('quote')),
        element('codeBlock', new yjs.XmlText('code')),
        table,
        element('horizontalRule'),
      ),
    )

    type(tab, 'X')

    expect([tab.freezes, tab.editor.isEditable]).toEqual([[], true])
    expect(tab.editor.state.doc.textContent).toContain('Xtitle')
    expect(body(tab)).toContain('Xtitle')
  })
})

function exchange(...tabs: Tab[]) {
  for (const target of tabs) {
    for (const source of tabs) {
      const missing = yjs.encodeStateAsUpdate(source.ydoc, yjs.encodeStateVector(target.ydoc))
      yjs.applyUpdate(target.ydoc, missing, REMOTE)
    }
  }
}

function syncState(tab: Tab) {
  return ySyncPluginKey.getState(tab.editor.state)
}

function undoManager(tab: Tab): yjs.UndoManager {
  return yUndoPluginKey.getState(tab.editor.state).undoManager
}

function leftover() {
  return element('bulletList')
}

function textPosition(tab: Tab, text: string) {
  let position = -1
  tab.editor.state.doc.descendants((node, pos) => {
    if (node.text === text) {
      position = pos
    }
  })
  return position
}

function blockTexts(tab: Tab) {
  const texts: string[] = []
  tab.editor.state.doc.descendants((node) => {
    if (node.isTextblock) {
      texts.push(node.textContent)
    }
  })
  return texts
}

// Whether every given Yjs type is still in the document, under the same parent, untouched
function isKept(kept: yjs.XmlElement[], strings: string[]) {
  return kept.every((one, i) => !one._item!.deleted && one.toString() === strings[i])
}

function keep(...kept: yjs.XmlElement[]) {
  const strings = kept.map((one) => one.toString())
  return () => isKept(kept, strings)
}

// The body's element names, `-` for a hidden one
function shape(tab: Tab, parent: yjs.XmlFragment = tab.ydoc.getXmlFragment(BODY_FIELD)) {
  const { hidden } = syncState(tab).binding
  function nameOf(child: yjs.XmlElement | yjs.XmlText) {
    if (hidden.has(child)) {
      return '-'
    }

    return (child as yjs.XmlElement).nodeName
  }

  return parent.toArray().map(nameOf)
}

function paragraphNode(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

describe('leftovers that hold nothing', () => {
  it('opens a body with an empty list left by a merge without freezing, and hides the list', () => {
    const tab = open(stored(paragraph('before'), leftover(), paragraph('after')))

    expect([tab.freezes, tab.editor.isEditable]).toEqual([[], true])
    expect(blockTexts(tab)).toEqual(['before', 'after'])
    expect(shape(tab)).toEqual(['paragraph', '-', 'paragraph'])
  })

  it('leaves a hidden leftover as it is when an edit deletes across it', () => {
    const tab = open(stored(paragraph('before'), leftover(), paragraph('after')))
    const isLeftoverKept = keep(tab.ydoc.getXmlFragment(BODY_FIELD).get(1) as yjs.XmlElement)

    tab.editor.commands.deleteRange({ from: 3, to: 11 })

    expect(blockTexts(tab)).toEqual(['beter'])
    expect(isLeftoverKept()).toBe(true)
    expect(shape(tab)).toEqual(['paragraph', '-'])
  })

  it('keeps the Yjs items of a list next to a hidden list of the same kind', () => {
    const items = element('bulletList', element('listItem', paragraph('item')))
    const tab = open(stored(paragraph('a'), leftover(), items))
    const fragment = tab.ydoc.getXmlFragment(BODY_FIELD)
    const sameKind = fragment.get(2) as yjs.XmlElement
    const item = sameKind.get(0)
    const isLeftoverKept = keep(fragment.get(1) as yjs.XmlElement)

    tab.editor.chain().setTextSelection(10).insertContent('X').splitListItem('listItem').run()

    expect(blockTexts(tab)).toEqual(['a', 'itemX', ''])
    expect([fragment.get(2), sameKind.get(0), sameKind.length]).toEqual([sameKind, item, 2])
    expect(isLeftoverKept()).toBe(true)
  })

  it.each([
    ['at the start', [leftover(), paragraph('one')], 0, ['paragraph', '-', 'paragraph']],
    ['at the end', [paragraph('one'), leftover()], 5, ['paragraph', 'paragraph', '-']],
    [
      'next to a run of them',
      [paragraph('one'), leftover(), leftover(), paragraph('two')],
      5,
      ['paragraph', 'paragraph', '-', '-', 'paragraph'],
    ],
    [
      'after a leftover',
      [leftover(), paragraph('one'), paragraph('two')],
      5,
      ['-', 'paragraph', 'paragraph', 'paragraph'],
    ],
  ])('puts a new block %s next to its visible neighbour', (_, blocks, at, expected) => {
    const tab = open(stored(...(blocks as yjs.XmlElement[])))
    const fragment = tab.ydoc.getXmlFragment(BODY_FIELD)
    const isEveryBlockKept = keep(...(fragment.toArray() as yjs.XmlElement[]))
    let newAt = 0
    if (at !== 0) {
      newAt = expected.indexOf('paragraph') + 1
    }

    tab.editor.commands.insertContentAt(at, paragraphNode('new'))

    expect(shape(tab)).toEqual(expected)
    expect(fragment.toArray().map((child) => child.toString().includes('new'))).toEqual(
      expected.map((_name, i) => i === newAt),
    )
    expect(isEveryBlockKept()).toBe(true)
  })

  it('puts a new block after its visible neighbour inside a list item', () => {
    const tab = open(
      stored(element('bulletList', element('listItem', paragraph('one'), leftover()))),
    )
    const item = (tab.ydoc.getXmlFragment(BODY_FIELD).get(0) as yjs.XmlElement).get(
      0,
    ) as yjs.XmlElement
    const isLeftoverKept = keep(item.get(1) as yjs.XmlElement)

    tab.editor.commands.insertContentAt(7, paragraphNode('new'))

    expect(blockTexts(tab)).toEqual(['one', 'new'])
    expect(shape(tab, item)).toEqual(['paragraph', 'paragraph', '-'])
    expect(item.get(1).toString()).toContain('new')
    expect(isLeftoverKept()).toBe(true)
  })

  it('turns a block after a leftover into a heading and keeps the leftover', () => {
    const tab = open(stored(leftover(), paragraph('one'), paragraph('two')))
    const isLeftoverKept = keep(tab.ydoc.getXmlFragment(BODY_FIELD).get(0) as yjs.XmlElement)

    tab.editor.chain().setTextSelection(2).setNode('heading', { level: 2 }).run()

    expect(shape(tab)).toEqual(['-', 'heading', 'paragraph'])
    expect(isLeftoverKept()).toBe(true)
  })

  it('deletes the visible blocks between leftovers and keeps the leftovers', () => {
    const tab = open(
      stored(paragraph('one'), leftover(), paragraph('two'), leftover(), paragraph('three')),
    )
    const fragment = tab.ydoc.getXmlFragment(BODY_FIELD)
    const isLeftoverKept = keep(
      fragment.get(1) as yjs.XmlElement,
      fragment.get(3) as yjs.XmlElement,
    )

    tab.editor.commands.deleteRange({ from: 2, to: tab.editor.state.doc.content.size - 2 })

    expect(blockTexts(tab)).toEqual(['oe'])
    expect(shape(tab)).toEqual(['paragraph', '-', '-'])
    expect(isLeftoverKept()).toBe(true)
  })

  it('keeps an item a third tab adds to a list the other two emptied', () => {
    const base = stored(
      element(
        'bulletList',
        element('listItem', paragraph('one')),
        element('listItem', paragraph('two')),
      ),
      paragraph('after'),
    )
    const [first, second, third] = [open(base), open(base), open(base)]
    first.editor.commands.deleteRange({ from: 1, to: 8 })
    second.editor.commands.deleteRange({ from: 8, to: 15 })
    addItem(third, 'important')

    exchange(first, second)
    type(first, 'mine ')
    exchange(first, second, third)

    for (const tab of [first, second, third]) {
      expect(blockTexts(tab)).toEqual(['important', 'mine after'])
      expect(tab.freezes).toEqual([])
    }
  })

  it("brings back an item with this tab's undo after another tab emptied its list", () => {
    const base = stored(
      element(
        'bulletList',
        element('listItem', paragraph('one')),
        element('listItem', paragraph('two')),
      ),
      paragraph('after'),
    )
    const [mine, other, third] = [open(base), open(base), open(base)]
    mine.editor.commands.deleteRange({ from: 1, to: 8 })
    other.editor.commands.deleteRange({ from: 8, to: 15 })
    exchange(mine, other, third)
    undoManager(mine).stopCapturing()
    type(mine, 'X')

    expect(shape(mine)).toEqual(['-', 'paragraph'])

    undoManager(mine).undo()
    undoManager(mine).undo()
    exchange(mine, other, third)

    for (const tab of [mine, other, third]) {
      expect(blockTexts(tab)).toEqual(['one', 'after'])
      expect(tab.freezes).toEqual([])
    }
  })
})

function addItem(tab: Tab, text: string) {
  const { schema, doc, tr } = tab.editor.state
  const item = schema.nodes.listItem.create(
    null,
    schema.nodes.paragraph.create(null, schema.text(text)),
  )
  tab.editor.view.dispatch(tr.insert(doc.child(0).nodeSize - 1, item))
}

function withAttributes(node: yjs.XmlElement, attributes: Record<string, unknown>) {
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value as string)
  }

  return node
}

describe('leftovers that hold something', () => {
  it.each([
    ['a list numbered from 3', () => withAttributes(element('orderedList'), { start: 3 })],
    [
      'a list with a setting the editor lacks',
      () => withAttributes(element('bulletList'), { kind: 'x' }),
    ],
    ['an empty tab', () => element('tab')],
    [
      'a centred empty paragraph in a list',
      () => element('bulletList', withAttributes(element('paragraph'), { textAlign: 'center' })),
    ],
    [
      'a ticked task',
      () => element('taskList', withAttributes(element('taskItem'), { checked: true })),
    ],
  ])('freezes over %s', (_, leftoverBlock) => {
    const tab = open(stored(paragraph('hello'), leftoverBlock()))

    expect(tab.freezes).toEqual([['open', null]])
  })

  it.each([
    ['an empty image group', () => element('imageGroup')],
    ['an empty table', () => element('table')],
    [
      'an unticked empty task',
      () => element('taskList', withAttributes(element('taskItem'), { checked: false })),
    ],
    [
      'a list holding an empty paragraph',
      () => element('bulletList', element('paragraph', new yjs.XmlText())),
    ],
  ])('hides %s', (_, leftoverBlock) => {
    const tab = open(stored(paragraph('hello'), leftoverBlock()))

    expect([tab.freezes, shape(tab)]).toEqual([[], ['paragraph', '-']])
  })
})

describe('positions around hidden leftovers', () => {
  function roundTrips(tab: Tab) {
    const { type: root, binding } = syncState(tab)
    const positions = []
    for (let pos = 0; pos <= tab.editor.state.doc.content.size; pos++) {
      const relative = absolutePositionToRelativePosition(
        pos,
        root,
        binding.mapping,
        binding.hidden,
      )
      positions.push(
        relativePositionToAbsolutePosition(
          tab.ydoc,
          root,
          relative,
          binding.mapping,
          binding.hidden,
        ),
      )
    }

    return positions
  }

  function resolve(tab: Tab, relative: yjs.RelativePosition) {
    const { type: root, binding } = syncState(tab)
    return relativePositionToAbsolutePosition(
      tab.ydoc,
      root,
      relative,
      binding.mapping,
      binding.hidden,
    )
  }

  it('maps every position there and back as it does without the leftovers', () => {
    function nestedList() {
      return element('bulletList', element('listItem', paragraph('cd')))
    }

    const plain = open(stored(paragraph('ab'), nestedList(), paragraph('ef')))
    const withLeftovers = open(
      stored(
        leftover(),
        paragraph('ab'),
        leftover(),
        element('bulletList', element('listItem', paragraph('cd'), leftover())),
        leftover(),
        paragraph('ef'),
        leftover(),
      ),
    )

    expect(withLeftovers.editor.getJSON()).toEqual(plain.editor.getJSON())
    expect(roundTrips(withLeftovers)).toEqual(roundTrips(plain))
  })

  it('places a caret either side of a leftover, holding left or right', () => {
    const tab = open(stored(paragraph('ab'), leftover(), paragraph('cd')))
    const fragment = tab.ydoc.getXmlFragment(BODY_FIELD)
    const [ab, cd] = [0, 2].map(
      (index) => (fragment.get(index) as yjs.XmlElement).get(0) as yjs.XmlText,
    )
    function at(parent: yjs.AbstractType<unknown>, index: number, assoc: number) {
      return resolve(tab, yjs.createRelativePositionFromTypeIndex(parent, index, assoc))
    }

    expect([at(ab, 2, 0), at(ab, 2, -1)]).toEqual([3, 3])
    expect([at(cd, 0, 0), at(cd, 0, -1), at(cd, 2, 0), at(cd, 2, -1)]).toEqual([5, 5, 7, 7])
    expect([
      at(fragment, 1, 0),
      at(fragment, 1, -1),
      at(fragment, 2, 0),
      at(fragment, 2, -1),
    ]).toEqual([4, 4, 4, 4])
  })

  it('places a caret in text that follows a leftover at the start', () => {
    const tab = open(stored(leftover(), paragraph('after')))
    const text = (tab.ydoc.getXmlFragment(BODY_FIELD).get(1) as yjs.XmlElement).get(
      0,
    ) as yjs.XmlText

    const ends = [0, 5].map((index) =>
      resolve(tab, yjs.createRelativePositionFromTypeIndex(text, index)),
    )

    expect(ends).toEqual([1, 6])
  })

  it('gives no place to a position inside a hidden leftover', () => {
    const empty = new yjs.XmlText()
    const quote = element('blockquote', element('paragraph', empty))
    const tab = open(stored(paragraph('ab'), element('bulletList', element('listItem', quote))))

    expect(shape(tab)).toEqual(['paragraph', '-'])
    expect(resolve(tab, yjs.createRelativePositionFromTypeIndex(empty, 0))).toBeNull()
    expect(resolve(tab, yjs.createRelativePositionFromTypeIndex(quote, 0))).toBeNull()
  })
})

describe('a thread after a hidden leftover', () => {
  it('highlights the text it was made on, and places its card there', () => {
    const threads: DocumentThread[] = []
    let places: ThreadPlaces = new Map()
    const highlights = ThreadHighlights.configure({
      threads: () => threads,
      onPlaced: (placed) => {
        places = placed
      },
    })
    const tab = open(stored(paragraph('ab'), leftover(), paragraph('cdef')), highlights)
    const text = (tab.ydoc.getXmlFragment(BODY_FIELD).get(2) as yjs.XmlElement).get(
      0,
    ) as yjs.XmlText
    const anchor = encodeAnchor(
      yjs.createRelativePositionFromTypeIndex(text, 1),
      yjs.createRelativePositionFromTypeIndex(text, 3),
      '',
    )
    threads.push({ name: 'c1', anchor, resolved: false } as DocumentThread)
    redrawThreads(tab.editor.view)

    const highlight = tab.editor.view.dom.querySelectorAll('[data-thread="c1"]')
    expect([[...highlight].map((mark) => mark.textContent).join(''), places.get('c1')]).toEqual([
      'de',
      expect.objectContaining({ kind: 'text', from: 6, to: 8 }),
    ])
  })
})

describe('a frozen tab', () => {
  it('drops its undo history and takes no undo or redo', () => {
    const source = new yjs.Doc()
    yjs.applyUpdate(source, stored(paragraph('hello')))
    const tab = open(yjs.encodeStateAsUpdate(source))
    type(tab, 'mine ')
    undoManager(tab).stopCapturing()
    type(tab, 'more ')
    tab.editor.commands.undo()
    const vector = yjs.encodeStateVector(source)
    source.getXmlFragment(BODY_FIELD).insert(1, [cellInBody()])

    yjs.applyUpdate(tab.ydoc, yjs.encodeStateAsUpdate(source, vector), REMOTE)
    const before = body(tab)

    expect([undoManager(tab).undoStack.length, undoManager(tab).redoStack.length]).toEqual([0, 0])
    expect([tab.editor.commands.undo(), tab.editor.commands.redo()]).toEqual([false, false])
    expect([undo(tab.editor.state), redo(tab.editor.state)]).toEqual([false, false])
    expect(body(tab)).toBe(before)
  })

  it('still shows what other tabs write, and takes no edit of its own', () => {
    const source = new yjs.Doc()
    yjs.applyUpdate(source, stored(paragraph('hello'), cellInBody()))
    const tab = open(yjs.encodeStateAsUpdate(source))
    const vector = yjs.encodeStateVector(source)
    source.getXmlFragment(BODY_FIELD).insert(0, [paragraph('later')])

    yjs.applyUpdate(tab.ydoc, yjs.encodeStateAsUpdate(source, vector), REMOTE)
    tab.editor.view.dispatch(tab.editor.state.tr.insertText('X', 1))
    tab.editor.commands.setTextSelection(3)

    expect(tab.editor.state.doc.textContent).toBe('laterhello')
    expect(body(tab)).toBe(source.getXmlFragment(BODY_FIELD).toString())
  })

  it("names an undo that brings back content the editor can't hold", () => {
    const inner = element('bulletList', element('listItem', paragraph('x')))
    const base = stored(element('bulletList', element('listItem', paragraph('a'), inner)))
    const [mine, other] = [open(base), open(base)]
    mine.editor.commands.insertContentAt(2, paragraphNode('new'))
    const otherItem = (other.ydoc.getXmlFragment(BODY_FIELD).get(0) as yjs.XmlElement).get(
      0,
    ) as yjs.XmlElement
    otherItem.delete(0, 1)
    exchange(mine, other)

    expect(blockTexts(mine)).toEqual(['new', 'x'])

    mine.editor.commands.undo()

    expect(mine.freezes.map(([reason]) => reason)).toEqual(['undo'])
    expect(body(mine)).toContain('<paragraph>x</paragraph>')
  })
})

describe('building a document from Yjs', () => {
  it('writes nothing to Yjs, even over two texts this client made side by side', () => {
    const doc = new yjs.Doc()
    doc
      .getXmlFragment(BODY_FIELD)
      .insert(0, [element('paragraph', new yjs.XmlText('a'), new yjs.XmlText('b'))])
    const before = yjs.encodeStateAsUpdate(doc)

    const { node, hidden, lost } = placeFragment(
      doc.getXmlFragment(BODY_FIELD),
      getSchema(writerSchema()),
    )

    expect([node.textContent, hidden.size, lost]).toEqual(['ab', 0, []])
    expect(yjs.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('names what it hid and what it lost, by the same rule as the editor', () => {
    const doc = new yjs.Doc()
    const [empty, misplaced] = [leftover(), cellInBody()]
    doc.getXmlFragment(BODY_FIELD).insert(0, [paragraph('a'), empty, misplaced])

    const { node, hidden, lost } = placeFragment(
      doc.getXmlFragment(BODY_FIELD),
      getSchema(writerSchema()),
    )

    expect([node.textContent, [...hidden], lost]).toEqual(['a', [empty], [misplaced]])
  })

  it('keeps a text this tab makes beside another apart from it, as the live editor', () => {
    const tab = open(stored(paragraph('hello')))
    const block = tab.ydoc.getXmlFragment(BODY_FIELD).get(0) as yjs.XmlElement

    block.insert(1, [new yjs.XmlText(' there')])

    expect([block.length, block.toString()]).toEqual([2, '<paragraph>hello there</paragraph>'])
    expect(tab.editor.state.doc.textContent).toBe('hello there')
  })
})

// Two tabs typing into one empty block at once each make a text in it, and every tab keeps both
describe('two texts side by side in one block', () => {
  const base = stored(element('paragraph'))

  function typeAtOnce() {
    const tabs = [open(base), open(base)]
    type(tabs[0], 'a')
    type(tabs[1], 'b')
    return tabs
  }

  function texts(tab: Tab) {
    return (tab.ydoc.getXmlFragment(BODY_FIELD).get(0) as yjs.XmlElement).length
  }

  function ownClocks(...tabs: Tab[]) {
    return tabs.map((tab) => yjs.getState(tab.ydoc.store, tab.ydoc.clientID))
  }

  it('keeps them apart once the tabs sync, writes nothing for it, and later typing at once is not doubled', () => {
    const [mine, other] = typeAtOnce()
    const clocks = ownClocks(mine, other)
    exchange(mine, other)
    exchange(mine, other)

    expect([texts(mine), texts(other), ownClocks(mine, other)]).toEqual([2, 2, clocks])

    type(mine, 'X', 3)
    type(other, 'Y')
    exchange(mine, other)
    exchange(mine, other)

    const [typed] = blockTexts(mine)
    expect(blockTexts(mine)).toEqual(blockTexts(other))
    expect([...typed].sort()).toEqual(['X', 'Y', 'a', 'b'])
  })

  it('leaves them apart in tabs that cannot edit, and writes nothing', () => {
    const [mine, other] = typeAtOnce()
    mine.editor.setEditable(false)
    other.editor.setEditable(false)
    const clocks = ownClocks(mine, other)

    exchange(mine, other)
    exchange(mine, other)

    expect([texts(mine), texts(other), ownClocks(mine, other)]).toEqual([2, 2, clocks])
    expect(blockTexts(mine)).toEqual(blockTexts(other))
  })

  it('leaves them apart in frozen tabs, and writes nothing', () => {
    const [mine, other] = typeAtOnce()
    const source = new yjs.Doc()
    yjs.applyUpdate(source, base)
    source.getXmlFragment(BODY_FIELD).insert(1, [cellInBody()])
    for (const tab of [mine, other]) {
      yjs.applyUpdate(tab.ydoc, yjs.encodeStateAsUpdate(source), REMOTE)
    }

    const clocks = ownClocks(mine, other)

    exchange(mine, other)
    exchange(mine, other)

    expect([mine.freezes, other.freezes].flat().map(([reason]) => reason)).toEqual(['row', 'row'])
    expect([texts(mine), texts(other), ownClocks(mine, other)]).toEqual([2, 2, clocks])
  })
})

describe('typing next to many hidden leftovers', () => {
  function typingTime(tab: Tab) {
    const middle = Math.floor(tab.editor.state.doc.content.size / 2)
    const position = tab.editor.state.doc.resolve(middle)
    const at = position.start()
    const times = []
    for (let i = 0; i < 15; i++) {
      const started = performance.now()
      tab.editor.view.dispatch(tab.editor.state.tr.insertText('x', at))
      times.push(performance.now() - started)
    }

    times.sort((left, right) => left - right)
    return times[7]
  }

  // Another tab types into the middle paragraph; this one renders each keystroke from Yjs
  function remoteTypingTime(state: Uint8Array) {
    const tab = open(state)
    const source = new yjs.Doc()
    yjs.applyUpdate(source, state)
    const shown = source
      .getXmlFragment(BODY_FIELD)
      .toArray()
      .filter((block) => (block as yjs.XmlElement).nodeName === 'paragraph')
    const text = (shown[1000] as yjs.XmlElement).get(0) as yjs.XmlText
    const times = []
    for (let i = 0; i < 15; i++) {
      const before = yjs.encodeStateVector(source)
      text.insert(0, 'x')
      const keystroke = yjs.encodeStateAsUpdate(source, before)
      const started = performance.now()
      yjs.applyUpdate(tab.ydoc, keystroke, REMOTE)
      times.push(performance.now() - started)
    }

    times.sort((left, right) => left - right)
    return { time: times[7], text: tab.editor.state.doc.textContent, freezes: tab.freezes }
  }

  function paragraphs() {
    return Array.from({ length: 2000 }, (_, i) => paragraph(`paragraph ${i}`))
  }

  function withLeftovers() {
    const blocks = []
    for (const [i, block] of paragraphs().entries()) {
      blocks.push(block)
      if (i % 2) {
        blocks.push(leftover())
      }
    }

    return blocks
  }

  it('takes at most twice as long per keystroke as the same body without them', () => {
    const plain = open(stored(...paragraphs()))
    const hidden = open(stored(...withLeftovers()))
    typingTime(plain)
    typingTime(hidden)

    expect(typingTime(hidden)).toBeLessThanOrEqual(2 * typingTime(plain))
  })

  it('takes at most twice as long per keystroke from another tab', () => {
    const [plain, hidden] = [stored(...paragraphs()), stored(...withLeftovers())]
    remoteTypingTime(plain)
    remoteTypingTime(hidden)
    const [plainTyping, hiddenTyping] = [remoteTypingTime(plain), remoteTypingTime(hidden)]

    const typed = 'x'.repeat(15)

    expect(hiddenTyping.text).toContain(`${typed}paragraph 1000`)
    expect(hiddenTyping.freezes).toEqual([])
    expect(hiddenTyping.time).toBeLessThanOrEqual(2 * plainTyping.time)
  })
})

function markedText(text: string, marks: Record<string, object>) {
  const node = new yjs.XmlText()
  node.insert(0, text, marks)
  return node
}

function tableWithEmptyRow() {
  return element(
    'table',
    element('tableRow', element('tableCell', paragraph('x'))),
    element('tableRow'),
  )
}

const judgedBodies = [
  {
    name: 'an element of a kind the editor lacks',
    blocks: () => [paragraph('a'), element('resizableMedia', paragraph('old'))],
    isLost: true,
  },
  {
    name: 'a table cell straight in the body',
    blocks: () => [paragraph('a'), cellInBody()],
    isLost: true,
  },
  {
    name: 'a table cell inside a quote',
    blocks: () => [paragraph('a'), element('blockquote', cellInBody())],
    isLost: true,
  },
  {
    name: 'text with a mark the editor lacks',
    blocks: () => [element('paragraph', markedText('old', { oldMark: {} }))],
    isLost: false,
  },
  {
    name: 'bold text in a code block',
    blocks: () => [element('codeBlock', markedText('both', { bold: {} }))],
    isLost: false,
  },
  {
    name: 'an empty list between paragraphs',
    blocks: () => [paragraph('a'), leftover(), paragraph('b')],
    isLost: false,
  },
  {
    name: 'an empty table between paragraphs',
    blocks: () => [paragraph('a'), element('table'), paragraph('b')],
    isLost: false,
  },
  { name: 'an empty list alone', blocks: () => [leftover()], isLost: false },
  { name: 'an empty table alone', blocks: () => [element('table')], isLost: false },
  {
    name: 'a quote holding only an empty list',
    blocks: () => [element('blockquote', leftover())],
    isLost: false,
  },
  {
    name: 'a table row with no cells',
    blocks: () => [paragraph('a'), tableWithEmptyRow()],
    isLost: false,
  },
  {
    name: 'a tab holding a paragraph',
    blocks: () => [element('tab', paragraph('x'))],
    isLost: false,
  },
  {
    name: 'a table of only a row with no cells',
    blocks: () => [paragraph('a'), element('table', element('tableRow'))],
    isLost: false,
  },
]

describe('the judge and the editor', () => {
  it.each(judgedBodies)('agree on $name', ({ blocks, isLost }) => {
    const state = stored(...blocks())
    const judged = new yjs.Doc()
    yjs.applyUpdate(judged, state)

    const tab = open(state)

    const agreement = { isFrozen: tab.freezes.length > 0, isFaulted: writerFault(judged) !== null }
    expect(agreement).toEqual({ isFrozen: isLost, isFaulted: isLost })
  })
})

// ReceivedContentGuard is what keeps fixTables from padding the row on open or after an edit elsewhere
describe('a table row with no cells', () => {
  it.each([
    { name: 'beside a row with cells', table: tableWithEmptyRow, texts: ['a', 'x'] },
    { name: 'as the only row', table: () => element('table', element('tableRow')), texts: ['a'] },
  ])(
    'opens $name without freezing or writing, and an edit beside it writes only that edit',
    ({ table, texts }) => {
      const state = stored(paragraph('a'), table())
      const asStored = storedBody(state)
      const tab = open(state)

      expect([tab.freezes, blockTexts(tab), body(tab)]).toEqual([[], texts, asStored])

      type(tab, 'Z')

      const edited = asStored.replace('<paragraph>a<', '<paragraph>Za<')
      expect([tab.freezes, body(tab)]).toEqual([[], edited])
    },
  )

  it('writes an edit typed in a cell of its table and the default spans of that cell only', () => {
    const state = stored(paragraph('a'), tableWithEmptyRow())
    const asStored = storedBody(state)
    const tab = open(state)

    type(tab, 'Y', textPosition(tab, 'x'))

    const edited = asStored.replace(
      '<tablecell><paragraph>x<',
      '<tablecell colspan="1" rowspan="1"><paragraph>Yx<',
    )
    expect([tab.freezes, body(tab)]).toEqual([[], edited])
  })
})
