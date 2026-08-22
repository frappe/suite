import { describe, it, expect, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

import { Schema } from 'prosemirror-model'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { columnResizing, tableNodes } from 'prosemirror-tables'

import { draggedWidth, scaleAwareColumnResizing } from './columnResizing'

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

describe('scaleAwareColumnResizing', () => {
	// the spread carries stock's handlers, and each one of them refuses to resize
	// anything the editor is not editing
	it('leaves none of the stock handlers in place', () => {
		const stock = columnResizing().spec.props!.handleDOMEvents!
		const scaled = scaleAwareColumnResizing().spec.props!.handleDOMEvents!

		Object.keys(stock).forEach((event) => {
			expect(scaled[event as keyof typeof scaled]).not.toBe(stock[event as keyof typeof stock])
		})
	})

	// stock's state.init writes the node view into the same nodeViews object the
	// spread copied a reference to, which is the only reason the table renders
	it('registers the table node view through the shared spec object', () => {
		const plugin = scaleAwareColumnResizing({ cellMinWidth: 25, defaultCellMinWidth: 25 })

		EditorState.create({ schema, plugins: [plugin] })

		expect(typeof plugin.spec.props!.nodeViews!.table).toBe('function')
	})
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

		const buildView = plugin.spec.props!.nodeViews!.table as never as (
			node: ProseMirrorNode,
		) => TableNodeView

		const node = tableNode(widths)
		const nodeView = buildView(node)

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
