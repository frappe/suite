import { type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'

export type Axis = 'row' | 'column'

/** A table node with its grid, found from a position inside it. */
export class TableShape {
  readonly map: TableMap

  constructor(
    readonly node: PMNode,
    /** The position of the table's first row */
    readonly start: number,
  ) {
    this.map = TableMap.get(node)
  }

  static around($pos: ResolvedPos): TableShape | null {
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth)
      if (node.type.spec.tableRole === 'table') return new TableShape(node, $pos.start(depth))
    }
    return null
  }

  static at(doc: PMNode, pos: number): TableShape | null {
    if (pos < 0 || pos > doc.content.size) return null
    return TableShape.around(doc.resolve(pos))
  }

  /** The position of the table node itself */
  get pos() {
    return this.start - 1
  }

  count(axis: Axis) {
    return axis === 'row' ? this.map.height : this.map.width
  }

  cellPos(row: number, column: number) {
    return this.start + this.map.map[row * this.map.width + column]
  }

  /** The row and column of the cell at `pos` (its top-left corner when merged) */
  cellIndex(pos: number) {
    const rect = this.map.findCell(pos - this.start)
    return { row: rect.top, column: rect.left }
  }

  /** The distinct cells of a row or column, in document order */
  lineCells(axis: Axis, index: number): number[] {
    const cells = new Set<number>()
    const other: Axis = axis === 'row' ? 'column' : 'row'
    for (let i = 0; i < this.count(other); i++) {
      cells.add(axis === 'row' ? this.cellPos(index, i) : this.cellPos(i, index))
    }
    return [...cells].sort((a, b) => a - b)
  }

  /** A copy of a line is one wide only when no cell in the line spans across that direction */
  canDuplicate(doc: PMNode, axis: Axis, index: number) {
    const span = axis === 'row' ? 'rowspan' : 'colspan'
    return this.lineCells(axis, index).every((pos) => doc.nodeAt(pos)?.attrs[span] === 1)
  }

  /** How many leading rows hold only header cells */
  get headerRows() {
    let rows = 0
    for (const row of this.node.children) {
      const isHeader =
        row.childCount > 0 &&
        row.children.every((cell) => cell.type.spec.tableRole === 'header_cell')
      if (!isHeader) break
      rows++
    }
    return rows
  }
}
