import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { describe, expect, it } from 'vitest'

import { orderedTabs, TabsExtension, tabsIn } from './tabs'

const makeEditor = (labels: string[]) => {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, TabsExtension],
    content: '<p>first</p>',
  })
  editor.commands.wrapInTab({ label: labels[0] })
  labels.slice(1).forEach((label) => editor.commands.createTab({ label }))
  return editor
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
