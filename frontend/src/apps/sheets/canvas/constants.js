export const COL_HEADER_H  = 24
export const ROW_HEADER_W  = 50
export const DEFAULT_COL_W = 100
export const DEFAULT_ROW_H = 24
// Thickness of the overlay scrollbars (see canvas/scrollbars.js). Shared so DOM
// overlays (filter/pivot outlines) can keep clear of the scrollbar gutter.
export const SCROLLBAR_THICK = 12
// Default grid size a fresh/empty sub-sheet shows (Google-Sheets-like). The
// live counts below grow past these when a sheet's data needs it, and reset
// back to them per sub-sheet on switch so a 100k-row source doesn't leave every
// new / pivot / drill-down sheet stuck at 100k empty rows.
export const DEFAULT_TOTAL_ROWS = 1000
export const DEFAULT_TOTAL_COLS = 26

// Live bindings — `let` so the row/column count can grow at runtime via the
// grid's `expandRows` / `expandCols` API. ES modules expose live bindings, so
// importers always see the current value.
export let TOTAL_ROWS
export let TOTAL_COLS
export function setTotalRows(n) { TOTAL_ROWS = Math.max(1, Math.floor(n)) }
export function setTotalCols(n) { TOTAL_COLS = Math.max(1, Math.floor(n)) }
setTotalRows(DEFAULT_TOTAL_ROWS)
setTotalCols(DEFAULT_TOTAL_COLS)

// Frappe Espresso palette — resolved hex values mirroring the frappe-ui
// semantic tokens (surface-*, outline-*, ink-*). Canvas can't read CSS vars,
// so these are baked in. Keep in sync with --ink-/--outline-/--surface-.
//
// Selection accent is intentionally monochrome (Espresso black + neutral grays)
// rather than blue, to match Frappe Sheets's black-and-grey theme.
// Resolve frappe-ui design tokens (--surface-*, --outline-*, --ink-*).
// Canvas API cannot read CSS variables directly, so we resolve them dynamically
// from document.documentElement via getComputedStyle so canvas rendering stays
// 100% aligned with frappe-ui design tokens in both light and dark modes.
function _token(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return val || fallback
}

export const COLORS = {
  get white()        { return _token('--surface-base', '#FFFFFF') },
  get gridLine()     { return _token('--outline-gray-2', '#E2E2E2') },
  get headerBg()     { return _token('--surface-sidebar', '#F8F8F8') },
  get headerText()   { return _token('--ink-gray-5', '#7C7C7C') },
  get cellText()     { return _token('--ink-gray-9', '#171717') },
  get sparkline()    { return _token('--ink-teal-7', '#0F766E') },
  get selFill()      { return _token('--surface-gray-3', 'rgba(23, 23, 23, 0.06)') },
  get selBorder()    { return _token('--ink-gray-9', '#171717') },
  get selHandle()    { return _token('--ink-gray-9', '#171717') },
  get activeHeader() { return _token('--surface-gray-4', '#E2E2E2') },
  get rangeHeader()  { return _token('--surface-gray-3', '#EDEDED') },
  get freezeLine()   { return _token('--ink-gray-7', '#525252') },
  get pickerFill()   { return _token('--surface-gray-2', 'rgba(23, 23, 23, 0.05)') },
  get pickerBorder() { return _token('--ink-gray-7', '#525252') },
  get chipFill()     { return _token('--surface-gray-3', '#EDEDED') },
  get chipCaret()    { return _token('--ink-gray-7', '#525252') },
  get invalidMark()  { return _token('--ink-red-5', '#D93025') },
}
