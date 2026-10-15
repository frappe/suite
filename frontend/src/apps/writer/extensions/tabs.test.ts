import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { listTabs, orderedTabs, TabsExtension, tabsIn } from './tabs'

const waitForUpdates = () => new Promise((resolve) => setTimeout(resolve, 20))

const editors: Editor[] = []
afterEach(async () => {
  await waitForUpdates()
  editors.splice(0).forEach((editor) => editor.destroy())
})

const tabHTML = (label: string, index: number) =>
  `<div data-tab-id="tab-${label}" data-tab-label="${label}" data-tab-order="${index}"><p>${label}</p></div>`

function makeEditor(labels: string[]) {
  const editorOptions = {
    extensions: [Document, Paragraph, Text, TabsExtension],
    content: labels.map(tabHTML).join(''),
  }
  return new Editor(editorOptions)
}

const labelsOf = (editor: Editor) =>
  orderedTabs(editor.state.doc).map(({ node }) => node.attrs.label)

const idsOf = (editor: Editor) => tabsIn(editor.state.doc).map(({ node }) => node.attrs.id)

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
    expect(orderedTabs(editor.state.doc).map(({ node }) => node.attrs.order)).toEqual([0, 1, 2, 3])
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
      editor.schema.nodes.tab.create(first.node.attrs, editor.schema.nodes.paragraph.create()),
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

function openPeer(ydoc = new Y.Doc()) {
  const element = document.createElement('div')
  document.body.append(element)
  const collaboration = {
    document: ydoc,
    field: 'default',
  }
  const editorOptions = {
    element,
    extensions: [Document, Paragraph, Text, TabsExtension, Collaboration.configure(collaboration)],
  }
  const editor = new Editor(editorOptions)
  editors.push(editor)
  return { ydoc, editor }
}

const syncDocs = (first: Y.Doc, second: Y.Doc) => {
  const missingInFirst = Y.encodeStateAsUpdate(second, Y.encodeStateVector(first))
  Y.applyUpdate(first, missingInFirst, 'remote')
  const missingInSecond = Y.encodeStateAsUpdate(first, Y.encodeStateVector(second))
  Y.applyUpdate(second, missingInSecond, 'remote')
}

const textOf = (editor: Editor) =>
  editor.state.doc.textBetween(0, editor.state.doc.content.size, '|')

const untabbedPeer = () => {
  const author = openPeer()
  author.editor.commands.setContent('<p>Hello</p>')
  return author
}

describe('the first tab', () => {
  it('adding a tab keeps what someone else is typing', async () => {
    const peerA = untabbedPeer()
    const peerB = openPeer()
    syncDocs(peerA.ydoc, peerB.ydoc)
    await waitForUpdates()

    peerA.editor.commands.createTab({ label: 'Second' })
    peerB.editor.commands.insertContentAt(6, ' world')
    syncDocs(peerA.ydoc, peerB.ydoc)
    await waitForUpdates()

    expect(textOf(peerA.editor)).toBe('Hello world|')
    expect(textOf(peerB.editor)).toBe('Hello world|')
    expect(peerA.editor.state.doc.firstChild!.type.name).toBe('paragraph')
  })

  it('shows an untabbed document as one tab whose label other editors see', async () => {
    const peerA = untabbedPeer()
    const peerB = openPeer()
    syncDocs(peerA.ydoc, peerB.ydoc)
    await waitForUpdates()
    expect(listTabs(peerA.editor)).toEqual([{ id: 'main', label: 'Untitled' }])

    peerA.editor.commands.renameTab('main', 'Notes', false)
    syncDocs(peerA.ydoc, peerB.ydoc)

    expect(listTabs(peerB.editor)).toEqual([{ id: 'main', label: 'Notes' }])
    expect(tabsIn(peerB.editor.state.doc)).toHaveLength(0)
  })

  it('hides its content while another tab is open', async () => {
    const { editor } = untabbedPeer()
    editor.commands.createTab({ id: 'second', label: 'Second' })
    editor.commands.changeTab('second', false)

    expect(editor.view.dom.querySelector('p')!.style.display).toBe('none')
    editor.commands.changeTab('main', false)
    expect(editor.view.dom.querySelector('p')!.style.display).toBe('')
  })

  it('getHTML writes it as a tab of its own next to other tabs', () => {
    const { editor } = untabbedPeer()
    editor.commands.renameTab('main', 'Notes', false)
    editor.commands.createTab({ id: 'second', label: 'Second' })

    const html = editor.getHTML()
    expect(html).toMatch(
      /^<div data-tab-id="first-tab" data-tab-label="Notes"><p>Hello<\/p><\/div>/,
    )
    expect(html).toContain('data-tab-id="second"')

    const reloaded = makeEditor([])
    reloaded.commands.setContent(html)
    expect(listTabs(reloaded).map((tab) => tab.label)).toEqual(['Notes', 'Second'])
    expect(reloaded.commands.deleteTab(listTabs(reloaded)[0].id)).toBe(true)
    expect(listTabs(reloaded).map((tab) => tab.label)).toEqual(['Second'])
  })

  it('stays first when other tabs are reordered', () => {
    const { editor } = untabbedPeer()
    editor.commands.createTab({ id: 'b', label: 'b' })
    editor.commands.createTab({ id: 'c', label: 'c' })

    expect(editor.commands.reorderTab('c', 1)).toBe(true)
    expect(listTabs(editor).map((tab) => tab.id)).toEqual(['main', 'c', 'b'])
    expect(editor.commands.reorderTab('b', 0)).toBe(false)
  })

  it('opens the first saved tab once a tabbed document loads', async () => {
    const saved = makeEditor(['a', 'b'])
    const stored = new Y.Doc()
    const author = openPeer(stored)
    author.editor.commands.setContent(saved.getHTML())
    const viewer = openPeer()
    await waitForUpdates()
    expect(viewer.editor.storage.tab.activeTabId).toBe('main')

    syncDocs(stored, viewer.ydoc)
    await waitForUpdates()

    expect(viewer.editor.storage.tab.activeTabId).toBe('tab-a')
  })
})
