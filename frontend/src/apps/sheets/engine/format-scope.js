// Decide whether a selection should be formatted at the column, row, or cell
// level. A selection that spans every row of some columns is column-level
// formatting (one entry per column instead of one per cell); every column of
// some rows is row-level. Whole-sheet selections land as columns (which cover
// all cells). Anything else stays per-cell.
//
// This is what keeps "bold the whole column / whole sheet" from writing
// hundreds of thousands of per-cell format records.

export function formatScope(rect, totalRows, totalCols) {
  if (!rect) return { kind: 'cells' }
  const { r0, c0, r1, c1 } = rect
  const fullCols = r0 === 0 && r1 >= totalRows - 1
  const fullRows = c0 === 0 && c1 >= totalCols - 1
  // Prefer columns when both hold (whole sheet) — columns cover every cell.
  if (fullCols) return { kind: 'cols', cols: _range(c0, c1) }
  if (fullRows) return { kind: 'rows', rows: _range(r0, r1) }
  return { kind: 'cells' }
}

function _range(a, b) {
  const out = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}
