import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
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

  /** A row moves whole, so only cells spanning rows block it; a column is cut from every row */
  canMove(axis: Axis) {
    if (this.count(axis) < 2) return false
    let isBlocked = false
    this.node.descendants((node) => {
      if (isBlocked || !node.type.spec.tableRole?.endsWith('cell')) return !isBlocked
      isBlocked = node.attrs.rowspan > 1 || (axis === 'column' && node.attrs.colspan > 1)
      return false
    })
    return !isBlocked
  }

  /**
   * The table with line `from` moved to index `to`, counted after its removal. The header rows
   * stay the leading rows: cells landing there become header cells, cells leaving them plain ones.
   */
  moved(axis: Axis, from: number, to: number): PMNode {
    const rows = [...this.node.children]
    if (axis === 'column') {
      return this.node.copy(
        Fragment.from(rows.map((row) => row.copy(Fragment.from(reorder(row.children, from, to))))),
      )
    }
    const { tableCell, tableHeader } = this.node.type.schema.nodes
    const headerRows = this.headerRows
    const reordered = reorder(rows, from, to).map((row, index) => {
      const type = index < headerRows ? tableHeader : tableCell
      const cells = row.children.map((cell) =>
        cell.type === type ? cell : type.create(cell.attrs, cell.content, cell.marks),
      )
      return row.copy(Fragment.from(cells))
    })
    return this.node.copy(Fragment.from(reordered))
  }
}

/**
 * Where a dragged line lands: the edge nearest `at`, as an index after the line's removal, or
 * null when that edge is one of the line's own (no move). `edges` are the lines' leading edges
 * followed by the last line's trailing edge.
 */
export function landingIndex(edges: readonly number[], at: number, from: number): number | null {
  let nearest = 0
  edges.forEach((edge, index) => {
    if (Math.abs(edge - at) < Math.abs(edges[nearest] - at)) nearest = index
  })
  if (nearest === from || nearest === from + 1) return null
  return nearest > from ? nearest - 1 : nearest
}

/** The index of the edge a landing index draws its line on */
export function landingEdge(from: number, to: number) {
  return to > from ? to + 1 : to
}

function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}
