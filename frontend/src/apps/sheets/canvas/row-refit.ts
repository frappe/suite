// Which rows change height when they refit to their wrapped or multi-line
// text, as in Google Sheets: a row sized by hand keeps its height, a row with
// tall text fits it, and a row an earlier fit made taller shrinks back once
// its tall text is gone. A plain row that never had a height stays default.
// autofit.ts measures; this decides; the grid applies the result.

import type { RowHeightChange } from './types.js'

export interface RowSizes {
  readonly rowH: Readonly<{ [row: number]: number }>
  readonly manualRows: ReadonlySet<number>
  rowHeight(r: number): number
}

/**
 * The height change for `rows`, given their measurement (a row missing from
 * `measured` has nothing left in it), or null when no row changes.
 */
export function planRowRefit(
  rows: Iterable<number>,
  measured: ReadonlyMap<number, { height: number; tall: boolean }>,
  view: RowSizes,
  defaultHeight: number,
): RowHeightChange | null {
  const before: { [row: number]: number } = {}
  const after: { [row: number]: number } = {}
  let changed = false
  for (const r of rows) {
    if (view.manualRows.has(r)) continue
    const m = measured.get(r)
    if (!(r in view.rowH) && !m?.tall) continue
    const height = m?.height ?? defaultHeight
    if (height === view.rowHeight(r)) continue
    before[r] = view.rowHeight(r)
    after[r] = height
    changed = true
  }
  return changed ? { before, after } : null
}
