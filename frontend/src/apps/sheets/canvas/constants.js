export const COL_HEADER_H  = 24
export const ROW_HEADER_W  = 50
export const DEFAULT_COL_W = 100
export const DEFAULT_ROW_H = 24
// Default grid size a fresh/empty sub-sheet shows (Google-Sheets-like). The
// live counts below grow past these when a sheet's data needs it, and reset
// back to them per sub-sheet on switch so a 100k-row source doesn't leave every
// new / pivot / drill-down sheet stuck at 100k empty rows.
export const DEFAULT_TOTAL_ROWS = 1000
export const DEFAULT_TOTAL_COLS = 26

// Live bindings — `let` so the row/column count can grow at runtime via the
// grid's `expandRows` / `expandCols` API. ES modules expose live bindings, so
// importers always see the current value.
export let TOTAL_ROWS = DEFAULT_TOTAL_ROWS
export let TOTAL_COLS = DEFAULT_TOTAL_COLS    // A–Z; more can be added on demand
export function setTotalRows(n) { TOTAL_ROWS = Math.max(1, Math.floor(n)) }
export function setTotalCols(n) { TOTAL_COLS = Math.max(1, Math.floor(n)) }

// Frappe Espresso palette — resolved hex values mirroring the frappe-ui
// semantic tokens (surface-*, outline-*, ink-*). Canvas can't read CSS vars,
// so these are baked in. Keep in sync with --ink-/--outline-/--surface-.
//
// Selection accent is intentionally monochrome (Espresso black + neutral grays)
// rather than blue, to match Frappe Sheets's black-and-grey theme.
export const COLORS = {
  white:        '#FFFFFF',                  // --surface-base
  gridLine:     '#E2E2E2',                  // --outline-gray-2
  headerBg:     '#F8F8F8',                  // --surface-sidebar
  headerText:   '#7C7C7C',                  // --ink-gray-5
  cellText:     '#171717',                  // --ink-gray-9
  selFill:      'rgba(23, 23, 23, 0.06)',   // --ink-gray-9 @ 6% — subtle neutral wash
  selBorder:    '#171717',                  // --ink-gray-9
  selHandle:    '#171717',                  // --ink-gray-9
  activeHeader: '#E2E2E2',                  // --surface-gray-4 (selected header)
  rangeHeader:  '#EDEDED',                  // --surface-gray-3 (range header)
  freezeLine:   '#525252',                  // --ink-gray-7 — 2px line on freeze boundary
  // Formula picker — monochrome Espresso. Distinct from the active selection
  // (solid 2px ink-gray-9) and from marching-ants (animated dashed ink-gray-9)
  // by being a *static dashed* outline in the softer ink-gray-7.
  pickerFill:   'rgba(23, 23, 23, 0.05)',   // --ink-gray-9 @ 5% — subtle wash
  pickerBorder: '#525252',                  // --ink-gray-7 — static dashed outline
  // Data-validation dropdown chips
  chipFill:     '#EDEDED',                  // --surface-gray-3 — neutral pill
  chipCaret:    '#525252',                  // --ink-gray-7 — pill caret
  invalidMark:  '#D93025',                  // red — value fails its validation rule
}
