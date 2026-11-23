import { TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view'

/** The width a column without its own keeps before the table scrolls sideways. */
export const DEFAULT_COLUMN_WIDTH = 120

/**
 * tiptap's table node view (extension-table src/table/TableView.ts), but a column that loses its
 * width, as when a resize is undone, also loses the old width on screen, and a table too wide for
 * its wrapper fades the side that has more to scroll to.
 */
export class WriterTableView extends TableView {
  private readonly sizes = new ResizeObserver(() => this.showFades())
  // tiptap and a resize in progress measure columns by the drag limit, which would squeeze them
  private readonly widths = new MutationObserver(() => this.keepDefaultWidths())
  private readonly onScroll = () => this.showFades()

  constructor(
    node: PMNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes?: Record<string, unknown>,
  ) {
    super(node, cellMinWidth, view, HTMLAttributes)
    this.keepDefaultWidths()
    this.dom.addEventListener('scroll', this.onScroll, { passive: true })
    this.sizes.observe(this.dom)
    this.sizes.observe(this.table)
    this.widths.observe(this.table, { attributes: true, attributeFilter: ['style'] })
  }

  update(node: PMNode) {
    // tiptap sets `min-width` on a column without a width and leaves the old `width` in place
    for (const column of this.colgroup.children) {
      if (column instanceof HTMLElement) column.style.removeProperty('width')
    }
    const isSameType = super.update(node)
    this.keepDefaultWidths()
    return isSameType
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.target === this.dom || super.ignoreMutation(mutation)
  }

  destroy() {
    this.sizes.disconnect()
    this.widths.disconnect()
    this.dom.removeEventListener('scroll', this.onScroll)
  }

  private keepDefaultWidths() {
    if (this.table.style.width) return
    let total = 0
    for (const column of this.colgroup.children) {
      total +=
        (column instanceof HTMLElement && parseFloat(column.style.width)) || DEFAULT_COLUMN_WIDTH
    }
    if (this.table.style.minWidth !== `${total}px`) this.table.style.minWidth = `${total}px`
  }

  private showFades() {
    const { scrollLeft, scrollWidth, clientWidth } = this.dom
    this.dom.classList.toggle('has-more-before', scrollLeft > 1)
    this.dom.classList.toggle('has-more-after', scrollWidth - scrollLeft - clientWidth > 1)
  }
}
