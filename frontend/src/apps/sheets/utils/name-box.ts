// The name box left of the formula bar: what it shows for a selection, and
// the cell or range typed into it (Excel and Google both jump there).

import { cellId, colLabel, parseCellId } from './cells.js'

export interface NameBoxRange {
  r0: number
  c0: number
  r1: number
  c1: number
  mode: 'cell' | 'row' | 'col' | 'all'
}

/** `A1`, `A1:B2`, `3:5` or `B:D` for a selection. */
export function nameBoxLabel(sel: NameBoxRange): string {
  const { r0, c0, r1, c1, mode } = sel
  if (mode === 'row') return `${r0 + 1}:${r1 + 1}`
  if (mode === 'col') return `${colLabel(c0)}:${colLabel(c1)}`
  const a = cellId(r0, c0)
  return r0 === r1 && c0 === c1 ? a : `${a}:${cellId(r1, c1)}`
}

const COL = /^[A-Z]{1,3}$/
const ROW = /^\d{1,7}$/

function _col(letters: string): number {
  return parseCellId(letters + '1')?.col ?? -1
}

/**
 * A typed `k40`, `A1:B5`, `$A$1`, `3:5` or `B:D` as a range, or null when
 * it isn't one (or lies outside `rows` × `cols`).
 */
export function parseNameBox(text: string, rows: number, cols: number): NameBoxRange | null {
  const parts = text.trim().toUpperCase().replace(/\$/g, '').split(':')
  if (parts.length > 2 || parts.some((p) => !p)) return null
  const [a = '', b = a] = parts
  let range: NameBoxRange | null = null
  if (parts.length === 2 && ROW.test(a) && ROW.test(b)) {
    const [x, y] = [Number(a) - 1, Number(b) - 1]
    range = { r0: Math.min(x, y), r1: Math.max(x, y), c0: 0, c1: cols - 1, mode: 'row' }
  } else if (parts.length === 2 && COL.test(a) && COL.test(b)) {
    const [x, y] = [_col(a), _col(b)]
    range = { r0: 0, r1: rows - 1, c0: Math.min(x, y), c1: Math.max(x, y), mode: 'col' }
  } else {
    const p = parseCellId(a)
    const q = parseCellId(b)
    if (!p || !q) return null
    range = {
      r0: Math.min(p.row, q.row),
      r1: Math.max(p.row, q.row),
      c0: Math.min(p.col, q.col),
      c1: Math.max(p.col, q.col),
      mode: 'cell',
    }
  }
  const { r0, c0, r1, c1 } = range
  if (r0 < 0 || c0 < 0 || r1 >= rows || c1 >= cols) return null
  return range
}
