import { colLabel } from '../utils/cells.js'

// Convert column letters (e.g. "AB") to 0-based index.
function _colIndex(letters: string): number {
  return letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
}

// Shift a single cell reference token by (dr, dc), respecting $ anchors.
function _shiftRef(
  cDollar: string,
  colStr: string,
  rDollar: string,
  rowStr: string,
  dr: number,
  dc: number,
): string {
  const col = _colIndex(colStr)
  const row = parseInt(rowStr, 10) - 1
  const newCol = cDollar ? col : col + dc
  const newRow = rDollar ? row : row + dr
  if (newCol < 0 || newRow < 0) return `${cDollar}${colStr}${rDollar}${rowStr}`
  return `${cDollar}${colLabel(newCol)}${rDollar}${newRow + 1}`
}

// Adjust all relative cell references in a formula by (dr, dc) rows/cols.
// Absolute refs (prefixed with $) are left unchanged.
// The (?!!) negative lookahead skips sequences like SHEET2! (sheet-name identifiers).
// Anything that isn't a formula string comes back unchanged.
export function adjustFormula<T>(formula: T, dr: number, dc: number): T | string {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) return formula
  if (dr === 0 && dc === 0) return formula
  return formula.replace(
    /(\$?)([A-Za-z]+)(\$?)(\d+)(?!!)/g,
    (_: string, cDollar: string, colStr: string, rDollar: string, rowStr: string) =>
      _shiftRef(cDollar, colStr.toUpperCase(), rDollar, rowStr, dr, dc),
  )
}

// Replace every `oldSheetName!` prefix in a formula with `newSheetName!`.
// Sheet names can contain spaces, so the pattern must be flexible:
//   * Sheet names appear immediately before a `!`.
//   * Surrounded by quotes if they contain spaces (Excel uses single quotes,
//     we accept them too): `'My Sheet'!A1` ↔ `My Sheet!A1`.
//
// Preserves the quoting style of each occurrence so the formula reads the
// same after the rename.
export function renameSheetInFormula<T>(
  formula: T,
  oldName: string | null | undefined,
  newName: string | null | undefined,
): T | string {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) return formula
  if (!oldName || !newName || oldName === newName) return formula

  // Escape regex metachars in the old name.
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Two variants:
  //   1.  'Old Name'!     →  quoted form (any chars between the quotes)
  //   2.  Old Name!       →  unquoted; only valid when name has no quote chars
  // We match both and choose the appropriate replacement style for the new name.
  const needsQuotes = /[\s'!]/.test(newName)
  const replacement = needsQuotes ? `'${newName.replace(/'/g, "''")}'!` : `${newName}!`

  return (
    formula
      // Quoted form first so we don't double-replace.
      .replace(new RegExp(`'${esc}'!`, 'g'), replacement)
      .replace(new RegExp(`(?<![A-Za-z0-9_'])${esc}!`, 'g'), replacement)
  )
}

// Rename several sheets at once ({ old: new }, names matched without regard
// to case, as Excel does). One pass, so `Rates` → `Rates (2)` and
// `Rates (2)` → `Rates (2) (2)` can't apply twice. Text in double quotes is
// left alone. An xlsx import uses it when a tab gets a new name (#61).
export function renameSheetsInFormula<T>(formula: T, renames: Record<string, string>): T | string {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula
  const to = new Map(
    Object.entries(renames)
      .filter(([from, name]) => from !== name)
      .map(([from, name]) => [from.toLowerCase(), name]),
  )
  if (!to.size) return formula
  const bare = [...to.keys()].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const ref = new RegExp(`'((?:[^']|'')+)'!|(?<![A-Za-z0-9_.'])(${bare})!`, 'gi')
  const rename = (match: string, quoted?: string, plain?: string) => {
    const name = to.get((quoted?.replace(/''/g, "'") ?? plain ?? '').toLowerCase())
    if (name == null) return match
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`
  }
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) => (i % 2 ? part : part.replace(ref, rename)))
    .join('')
}
