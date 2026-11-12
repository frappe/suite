// Font size +/− and a picked size, as the { cols, rows, cells } mutation triple
// the editor's scoped format op runs. `next(size)` gives a cell's new size from
// its current one.
//
// A whole column or row writes its layer entry (so cells added later get the
// size too) AND every cell in it that has its own size, as Google Sheets does.
// The layer write alone left those cells, and the toolbar, at the old size.

import type { FormatsEngine } from './formats.js'

const DEFAULT_SIZE = 13

export function fontSizeOps(formats: FormatsEngine, next: (size: number) => number) {
  const sizeOf = (fmt: Record<string, unknown>) => Number(fmt.fontSize) || DEFAULT_SIZE
  // Read before any write: a cell's size can come from the layer being changed.
  const setCells = (ids: readonly string[], sn: string) => {
    const sizes = ids.map((id) => next(sizeOf(formats.get(id, sn))))
    ids.forEach((id, i) => formats.set(id, { fontSize: sizes[i] }, sn))
  }
  return {
    cols: (cols: readonly number[], sn: string) => {
      setCells(formats.overridesInCols(cols, 'fontSize', sn), sn)
      for (const c of cols) formats.setCol(c, { fontSize: next(sizeOf(formats.getCol(c, sn))) }, sn)
    },
    rows: (rows: readonly number[], sn: string) => {
      setCells(formats.overridesInRows(rows, 'fontSize', sn), sn)
      for (const r of rows) formats.setRow(r, { fontSize: next(sizeOf(formats.getRow(r, sn))) }, sn)
    },
    cells: setCells,
  }
}
