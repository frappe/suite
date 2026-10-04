import { colLabel } from '../utils/cells.js'

// Convert column letters (e.g. "AB") to 0-based index.
function _colIndex(letters) {
  return letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
}

// Shift a single cell reference token by (dr, dc), respecting $ anchors.
function _shiftRef(cDollar, colStr, rDollar, rowStr, dr, dc) {
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
export function adjustFormula(formula, dr, dc) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) return formula
  if (dr === 0 && dc === 0) return formula
  return formula.replace(
    /(\$?)([A-Za-z]+)(\$?)(\d+)(?!!)/g,
    (_, cDollar, colStr, rDollar, rowStr) =>
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
export function renameSheetInFormula(formula, oldName, newName) {
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
