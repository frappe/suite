import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { tableNodes } from '@tiptap/pm/tables'
import { DecorationSet, type EditorView } from '@tiptap/pm/view'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

import { draggedWidth, scaleAwareColumnResizing } from './columnResizing'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const dragging = (scale: number) => ({ startX: 100, startWidth: 200, scale })

describe('draggedWidth', () => {
  it('divides the mouse offset by the rendered scale', () => {
    expect(draggedWidth(dragging(1), 150, 25)).toBe(250)
    expect(draggedWidth(dragging(0.5), 150, 25)).toBe(300)
    expect(draggedWidth(dragging(2), 150, 25)).toBe(225)
    // a fractional width cannot survive the parseInt read of colwidth
    expect(draggedWidth(dragging(0.55), 150, 25)).toBe(291)
  })

  it('never returns less than the minimum width', () => {
    expect(draggedWidth(dragging(1), -1000, 25)).toBe(25)
  })

  // an unrendered editor measures 0, and dividing by it would send the column to Infinity
  it('falls back to unscaled when the scale is unmeasurable', () => {
    expect(draggedWidth(dragging(0), 150, 25)).toBe(250)
  })
})

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph+', cellAttributes: {} }),
  },
})

type TableNodeView = {
  dom: HTMLTableElement
  contentDOM: HTMLElement
  update: (node: ProseMirrorNode) => boolean
}

describe('the table node view', () => {
  const cell = (width: number) =>
    schema.nodes.table_cell.create({ colwidth: [width] }, schema.nodes.paragraph.create())

  const tableNode = (widths: number[]) =>
    schema.nodes.table.create(null, schema.nodes.table_row.create(null, widths.map(cell)))

  const buildNodeView = (widths: number[]) => {
    const plugin = scaleAwareColumnResizing({ cellMinWidth: 25, defaultCellMinWidth: 25 })
    EditorState.create({ schema, plugins: [plugin] })

    const buildView = plugin.spec.props?.nodeViews?.table
    if (!buildView) throw new Error('Expected a table node view constructor')
    const node = tableNode(widths)
    const built = buildView(node, fromPartial<EditorView>({}), () => 0, [], DecorationSet.empty)
    const { dom, contentDOM, update } = built
    if (!(dom instanceof HTMLTableElement) || !(contentDOM instanceof HTMLElement) || !update)
      throw new Error('Expected an updatable table with a content body')
    const nodeView: TableNodeView = {
      dom,
      contentDOM,
      update: (next) => update.call(built, next, [], DecorationSet.empty),
    }

    // the cells the editor would fill the tbody with
    nodeView.contentDOM.innerHTML = `<tr>${widths
      .map((width) => `<td colwidth="${width}"><p>a</p></td>`)
      .join('')}</tr>`

    return { node, nodeView }
  }

  const colWidths = (dom: HTMLTableElement) =>
    Array.from(dom.querySelectorAll('col')).map((col) => col.style.width)

  it('draws the widths the document states', () => {
    const { node, nodeView } = buildNodeView([100, 300])

    nodeView.update(node)

    expect(nodeView.dom.style.width).toBe('400px')
    expect(colWidths(nodeView.dom)).toEqual(['100px', '300px'])
  })

  it('keeps the frame resize preview through a redraw', () => {
    const { node, nodeView } = buildNodeView([100, 300])
    nodeView.dom.setAttribute('data-frame-resizing', '')

    nodeView.update(node)

    expect(nodeView.dom.style.width).toBe('100%')
    expect(colWidths(nodeView.dom)).toEqual(['25%', '75%'])
  })
})
