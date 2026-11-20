/**
 * What Sheets reads from Drive's records: a comment's anchor and a time stamp.
 *
 * Anchors are Sheets' own: Drive stores the string and never reads it.
 */

import { ironcalcSheetName } from '../utils/legacy-sheet'

/** One cell on one worksheet of the workbook. */
export interface CellAnchor {
  sheet: string
  cell: string
}

/** A thread about the workbook as a whole, not one cell. */
export const WORKBOOK_ANCHOR = 'sheets:workbook'
const CELL_PREFIX = 'sheets:cell:'
const CELL = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/
/** Drive stores an anchor of at most 255 characters. */
const MAX_ANCHOR = 255

export function cellAnchor(anchor: CellAnchor): string {
  const value = `${CELL_PREFIX}${anchor.cell}!${anchor.sheet}`
  return value.length <= MAX_ANCHOR ? value : WORKBOOK_ANCHOR
}

export function readAnchor(value: unknown): CellAnchor | null {
  if (typeof value === 'string' && value.startsWith('[')) return readMigratedAnchor(value)
  if (typeof value !== 'string' || !value.startsWith(CELL_PREFIX)) return null
  const rest = value.slice(CELL_PREFIX.length)
  const split = rest.indexOf('!')
  if (split < 0) return null
  const cell = rest.slice(0, split)
  const sheet = rest.slice(split + 1)
  return CELL.test(cell) && sheet ? { sheet, cell } : null
}

// The Drive migration moved develop-editor comments into Drive threads with
// `["<sheet>","<cell>"]` as the anchor (suite/drive/patches/build/content_mapping.py
// `sheet_anchor`). Read it as the same cell.
function readMigratedAnchor(value: string): CellAnchor | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null
  const [sheet, cell] = parsed
  // The upgrade renamed the sheets IronCalc refuses; follow the same rule.
  return typeof sheet === 'string' && sheet && typeof cell === 'string' && CELL.test(cell)
    ? { sheet: ironcalcSheetName(sheet), cell }
    : null
}

/** A Drive time (`YYYY-MM-DD HH:MM:SS`, site time) as a short local label. */
export function stampLabel(stamp: string | null): string {
  if (!stamp) return ''
  const when = new Date(stamp.replace(' ', 'T'))
  if (Number.isNaN(when.getTime())) return stamp
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
