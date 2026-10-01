import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { TabsExtension, listTabs, orderedTabs, tabsIn } from './tabs'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const editors: Editor[] = []
afterEach(async () => {
  await settle()
  editors.splice(0).forEach((editor) => editor.destroy())
})

const tabHTML = (label: string, index: number) =>
  `<div data-tab-id="tab-${label}" data-tab-label="${label}" data-tab-order="${index}"><p>${label}</p></div>`

const makeEditor = (labels: string[]) =>
  new Editor({
    extensions: [Document, Paragraph, Text, TabsExtension],
    content: labels.map(tabHTML).join(''),
  })

const labelsOf = (editor: Editor) =>
  orderedTabs(editor.state.doc).map(({ node }) => node.attrs.label)

const idsOf = (editor: Editor) =>
  tabsIn(editor.state.doc).map(({ node }) => node.attrs.id)

describe('tab reordering', () => {
  it('reorders without moving nodes', () => {
    const editor = makeEditor(['a', 'b', 'c'])
    const idsBefore = idsOf(editor)

    expect(editor.commands.reorderTab(idsBefore[2], 0)).toBe(true)
    expect(labelsOf(editor)).toEqual(['c', 'a', 'b'])
    expect(idsOf(editor)).toEqual(idsBefore)
  })

  it('keeps every tab exactly once across repeated moves', () => {
    const editor = makeEditor(['a', 'b', 'c', 'd'])
    const ids = idsOf(editor)

    editor.commands.reorderTab(ids[0], 3)
    editor.commands.reorderTab(ids[2], 1)
    editor.commands.reorderTab(ids[3], 0)

    expect(idsOf(editor).sort()).toEqual([...ids].sort())
    expect(labelsOf(editor).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(
      orderedTabs(editor.state.doc).map(({ node }) => node.attrs.order),
    ).toEqual([0, 1, 2, 3])
  })

  it('rejects out-of-range and no-op moves', () => {
    const editor = makeEditor(['a', 'b'])
    const ids = idsOf(editor)

    expect(editor.commands.reorderTab(ids[0], 0)).toBe(false)
    expect(editor.commands.reorderTab(ids[0], 2)).toBe(false)
    expect(editor.commands.reorderTab('missing', 1)).toBe(false)
  })

  it('falls back to document order when order is unset', () => {
    const editor = makeEditor(['a', 'b', 'c'])
    const { tr } = editor.state
    tabsIn(editor.state.doc).forEach(({ node, pos }) =>
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, order: null }),
    )
    editor.view.dispatch(tr)

    expect(labelsOf(editor)).toEqual(['a', 'b', 'c'])
  })
})

describe('tab id integrity', () => {
  it('refuses a transaction that duplicates a tab id', () => {
    const editor = makeEditor(['a', 'b'])
    const [first] = tabsIn(editor.state.doc)
    const { tr } = editor.state

    tr.insert(
      editor.state.doc.content.size,
      editor.schema.nodes.tab.create(
        first.node.attrs,
        editor.schema.nodes.paragraph.create(),
      ),
    )
    editor.view.dispatch(tr)

    expect(tabsIn(editor.state.doc)).toHaveLength(2)
  })
})

describe('ordered serialisation', () => {
  it('getHTML serialises tabs in display order', () => {
    const editor = makeEditor(['a', 'b'])
    const ids = idsOf(editor)
    editor.commands.reorderTab(ids[1], 0)

    const html = editor.getHTML()
    expect(html.indexOf(ids[1])).toBeLessThan(html.indexOf(ids[0]))
    expect(html).toContain('data-tab-order="0"')
  })

  it('getHTML keeps a document without tabs intact', () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, TabsExtension],
      content: '<p>plain</p>',
    })
    expect(editor.getHTML()).toBe('<p>plain</p>')
  })
})

function open(ydoc = new Y.Doc()) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      TabsExtension,
      Collaboration.configure({ document: ydoc, field: 'default' }),
    ],
  })
  editors.push(editor)
  return { ydoc, editor }
}

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'remote')
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote')
}

const textOf = (editor: Editor) =>
  editor.state.doc.textBetween(0, editor.state.doc.content.size, '|')

const untabbed = () => {
  const author = open()
  author.editor.commands.setContent('<p>Hello</p>')
  return author
}

describe('the first tab', () => {
  it('adding a tab keeps what someone else is typing', async () => {
    const a = untabbed()
    const b = open()
    sync(a.ydoc, b.ydoc)
    await settle()

    a.editor.commands.createTab({ label: 'Second' })
    b.editor.commands.insertContentAt(6, ' world')
    sync(a.ydoc, b.ydoc)
    await settle()

    expect(textOf(a.editor)).toBe('Hello world|')
    expect(textOf(b.editor)).toBe('Hello world|')
    expect(a.editor.state.doc.firstChild!.type.name).toBe('paragraph')
  })

  it('shows an untabbed document as one tab whose label other editors see', async () => {
    const a = untabbed()
    const b = open()
    sync(a.ydoc, b.ydoc)
    await settle()
    expect(listTabs(a.editor)).toEqual([{ id: 'main', label: 'Untitled' }])

    a.editor.commands.renameTab('main', 'Notes', false)
    sync(a.ydoc, b.ydoc)

    expect(listTabs(b.editor)).toEqual([{ id: 'main', label: 'Notes' }])
    expect(tabsIn(b.editor.state.doc)).toHaveLength(0)
  })

  it('hides its content while another tab is open', async () => {
    const { editor } = untabbed()
    editor.commands.createTab({ id: 'second', label: 'Second' })
    editor.commands.changeTab('second', false)

    expect(editor.view.dom.querySelector('p')!.style.display).toBe('none')
    editor.commands.changeTab('main', false)
    expect(editor.view.dom.querySelector('p')!.style.display).toBe('')
  })

  it('getHTML writes it as a tab of its own next to other tabs', () => {
    const { editor } = untabbed()
    editor.commands.renameTab('main', 'Notes', false)
    editor.commands.createTab({ id: 'second', label: 'Second' })

    const html = editor.getHTML()
    expect(html).toMatch(/^<div data-tab-id="main" data-tab-label="Notes"><p>Hello<\/p><\/div>/)
    expect(html).toContain('data-tab-id="second"')
  })

  it('stays first when other tabs are reordered', () => {
    const { editor } = untabbed()
    editor.commands.createTab({ id: 'b', label: 'b' })
    editor.commands.createTab({ id: 'c', label: 'c' })

    expect(editor.commands.reorderTab('c', 1)).toBe(true)
    expect(listTabs(editor).map((tab) => tab.id)).toEqual(['main', 'c', 'b'])
    expect(editor.commands.reorderTab('b', 0)).toBe(false)
  })

  it('opens the first saved tab once a tabbed document loads', async () => {
    const saved = makeEditor(['a', 'b'])
    const stored = new Y.Doc()
    const author = open(stored)
    author.editor.commands.setContent(saved.getHTML())
    const viewer = open()
    await settle()
    expect(viewer.editor.storage.tab.activeTabId).toBe('main')

    sync(stored, viewer.ydoc)
    await settle()

    expect(viewer.editor.storage.tab.activeTabId).toBe('tab-a')
  })
})
