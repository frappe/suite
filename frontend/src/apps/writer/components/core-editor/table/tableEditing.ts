import type { ChainedCommands, Editor } from '@tiptap/core'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

import { TableShape, type Axis } from './tableShape'

const INSERT = {
  row: { before: 'addRowBefore', after: 'addRowAfter' },
  column: { before: 'addColumnBefore', after: 'addColumnAfter' },
} as const

/**
 * The table controls' edits to one table, found through the position of one of its cells. Every
 * edit is one ProseMirror transaction, so it syncs through Yjs and undoes in one step.
 */
export class TableEditing {
  constructor(
    private readonly editor: Editor,
    /** The position of a cell in the table */
    private readonly cell: number,
  ) {}

  get shape(): TableShape | null {
    return TableShape.at(this.editor.state.doc, this.cell)
  }

  /** Selects a line without focusing the editor, which would close a menu opening beside it */
  selectLine(axis: Axis, index: number) {
    const { tr } = this.editor.state
    if (selectLine(tr, this.cell, axis, index)) this.editor.view.dispatch(tr)
  }

  /** Inserts a line beside line `index` and puts the caret in it, so typing fills the new line */
  insertLine(axis: Axis, index: number, side: 'before' | 'after') {
    this.run((chain) => {
      const inserted = this.caretIn(chain, axis, index)[INSERT[axis][side]]()
      return this.caretIn(inserted, axis, side === 'before' ? index : index + 1)
    })
  }

  addLineAtEnd(axis: Axis) {
    const shape = this.shape
    if (shape) this.insertLine(axis, shape.count(axis) - 1, 'after')
  }

  duplicateLine(axis: Axis, index: number) {
    this.run((chain) =>
      chain.command(({ tr }) => {
        const shape = TableShape.at(tr.doc, this.cell)
        if (!shape) return false
        if (axis === 'row') {
          const row = shape.node.child(index)
          let pos = shape.start
          for (let i = 0; i <= index; i++) pos += shape.node.child(i).nodeSize
          tr.insert(pos, row.type.create(row.attrs, row.content))
          return true
        }
        for (const pos of shape.lineCells(axis, index).reverse()) {
          const cell = tr.doc.nodeAt(pos)
          if (cell) tr.insert(pos + cell.nodeSize, cell.type.create(cell.attrs, cell.content))
        }
        return true
      }),
    )
  }

  clearLine(axis: Axis, index: number) {
    const shape = this.shape
    if (shape) this.clearCells(shape.lineCells(axis, index))
  }

  /** Empties the selected cells, or the caret's cell */
  clearSelection() {
    const { selection } = this.editor.state
    const cells: number[] = []
    if (selection instanceof CellSelection) selection.forEachCell((_cell, pos) => cells.push(pos))
    else cells.push(this.cell)
    this.clearCells(cells)
  }

  /** Deletes a line and puts the caret in the line that takes its place, in the same row or column */
  deleteLine(axis: Axis, index: number) {
    const shape = this.shape
    if (!shape) return
    if (shape.count(axis) === 1) return this.deleteTable()
    const across = shape.cellIndex(this.cell)[axis === 'row' ? 'column' : 'row']
    this.run((chain) => {
      const selected = chain.command(({ tr }) => selectLine(tr, this.cell, axis, index))
      const deleted = axis === 'row' ? selected.deleteRow() : selected.deleteColumn()
      return deleted.command(({ tr }) => {
        const after = TableShape.at(tr.doc, shape.start)
        if (!after) return false
        const line = Math.min(index, after.count(axis) - 1)
        const pos = axis === 'row' ? after.cellPos(line, across) : after.cellPos(across, line)
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
        return true
      })
    })
  }

  /** Colours a line's cells, or with no line the selected cells; null takes the colour off */
  setBackground(name: string | null, line?: { axis: Axis; index: number }) {
    this.run((chain) => {
      const at = line
        ? chain.command(({ tr }) => selectLine(tr, this.cell, line.axis, line.index))
        : chain
      return at.setCellBackground(name)
    })
  }

  toggleHeaderRow() {
    this.run((chain) => this.caretIn(chain, 'row', 0).toggleHeaderRow())
  }

  /** Moves line `from` to index `to`, counted after its removal, and selects it there */
  moveLine(axis: Axis, from: number, to: number) {
    this.run((chain) =>
      chain.command(({ tr }) => {
        const shape = TableShape.at(tr.doc, this.cell)
        if (!shape || from === to || !shape.canMove(axis)) return false
        tr.replaceWith(shape.pos, shape.pos + shape.node.nodeSize, shape.moved(axis, from, to))
        return selectLine(tr, shape.start, axis, to)
      }),
    )
  }

  /** Focuses the editor with the caret at the end of the cell */
  focusCell() {
    this.run((chain) =>
      chain.command(({ tr }) => {
        const cell = tr.doc.nodeAt(this.cell)
        if (!cell) return false
        tr.setSelection(TextSelection.near(tr.doc.resolve(this.cell + cell.nodeSize - 1), -1))
        return true
      }),
    )
  }

  mergeCells() {
    this.run((chain) => chain.mergeCells())
  }

  splitCell() {
    this.run((chain) => chain.splitCell())
  }

  deleteTable() {
    this.run((chain) => this.caretIn(chain, 'row', 0).deleteTable())
  }

  private clearCells(cells: readonly number[]) {
    this.run((chain) =>
      chain.command(({ tr }) => {
        const paragraph = tr.doc.type.schema.nodes.paragraph
        for (const pos of [...cells].sort((a, b) => b - a)) {
          const cell = tr.doc.nodeAt(pos)
          if (cell) tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, paragraph.create())
        }
        return true
      }),
    )
  }

  /** Puts the caret in the first cell of a line, which table commands act from */
  private caretIn(chain: ChainedCommands, axis: Axis, index: number) {
    return chain.command(({ tr }) => {
      const shape = TableShape.at(tr.doc, this.cell)
      if (!shape) return false
      const pos = axis === 'row' ? shape.cellPos(index, 0) : shape.cellPos(0, index)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
      return true
    })
  }

  private run(build: (chain: ChainedCommands) => ChainedCommands) {
    build(this.editor.chain().focus(undefined, { scrollIntoView: false })).run()
  }
}

function selectLine(tr: Transaction, cell: number, axis: Axis, index: number) {
  const shape = TableShape.at(tr.doc, cell)
  if (!shape) return false
  const last = shape.count(axis === 'row' ? 'column' : 'row') - 1
  const resolve = (row: number, column: number) => tr.doc.resolve(shape.cellPos(row, column))
  tr.setSelection(
    axis === 'row'
      ? CellSelection.rowSelection(resolve(index, 0), resolve(index, last))
      : CellSelection.colSelection(resolve(0, index), resolve(last, index)),
  )
  return true
}
