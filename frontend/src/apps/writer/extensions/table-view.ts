import { TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * tiptap's table node view (extension-table src/table/TableView.ts), but a column that loses its
 * width, as when a resize is undone, also loses the old width on screen.
 */
export class WriterTableView extends TableView {
  update(node: PMNode) {
    // tiptap sets `min-width` on a column without a width and leaves the old `width` in place
    for (const column of this.colgroup.children) {
      if (column instanceof HTMLElement) column.style.removeProperty('width')
    }
    return super.update(node)
  }
}
