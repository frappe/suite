// The cells a stored version holds differently from the sheet as it is now,
// for the version preview's highlight and its next/previous change. Both are
// docs of one lineage, so a cell is matched by its sheet, row and column ids:
// a row inserted since then moves no other cell into the list.

import type * as Y from 'yjs'

import { cellId } from '../utils/cells'
import { axis, parseCellKey, roots } from './schema'
import { docSheets } from './stores'

/** One cell, by sheet name and A1 address, as the version shows it. */
export interface ChangedCell {
  sheet: string
  cell: string
}

/** Changed cells by sheet name, then A1 address: the canvas's diff overlay. */
export type ChangedCellMap = Record<string, Record<string, boolean>>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The cells whose typed input or format in `version` differs from `current`,
 * in tab, row and column order. A cell only `current` has counts where
 * `version` still has its row and column: the preview shows it empty there.
 */
export function changedCells(version: Y.Doc, current: Y.Doc): ChangedCell[] {
  const then = roots(version)
  const now = roots(current)
  const sheets = docSheets(version)
  const order = new Map(sheets.map((sheet, index) => [sheet.id, index]))
  const keys = new Set([
    ...then.inputs.keys(),
    ...now.inputs.keys(),
    ...then.formats.keys(),
    ...now.formats.keys(),
  ])
  const found: { tab: number; row: number; col: number; cell: ChangedCell }[] = []
  for (const key of keys) {
    const isSame =
      (then.inputs.get(key) ?? '') === (now.inputs.get(key) ?? '') &&
      same(then.formats.get(key) ?? null, now.formats.get(key) ?? null)
    const parsed = isSame ? null : parseCellKey(key)
    const tab = parsed ? order.get(parsed.sheetId) : undefined
    if (!parsed || tab === undefined) continue
    const row = axis(version, parsed.sheetId, 'rows').posOf(parsed.rowId)
    const col = axis(version, parsed.sheetId, 'cols').posOf(parsed.colId)
    if (row < 0 || col < 0) continue
    found.push({ tab, row, col, cell: { sheet: sheets[tab]!.name, cell: cellId(row, col) } })
  }
  found.sort((a, b) => a.tab - b.tab || a.row - b.row || a.col - b.col)
  return found.map(({ cell }) => cell)
}

/** The same cells as the canvas overlay reads them. */
export function changedCellMap(cells: readonly ChangedCell[]) {
  const map: ChangedCellMap = {}
  for (const { sheet, cell } of cells) (map[sheet] ??= {})[cell] = true
  return map
}
