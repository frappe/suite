export const COL_HEADER_H = 28
export const ROW_HEADER_W = 50
// Gridlines are 1px lines on the pixel after the integer cell edge, so their
// centre is the edge + 0.5. The selection frame is centred there.
export const GRID_LINE = 0.5
// The active cell's frame width; the in-cell editor's border matches it.
export const FRAME_W = 1.5
// Thickness of the overlay scrollbars (scrollbars.ts). Shared so DOM overlays
// (filter/pivot outlines) can keep clear of the scrollbar gutter.
export const SCROLLBAR_THICK = 12
// Opacity of the selection tint (COLORS.selFill) over the cells.
export const SEL_ALPHA = 0.06

// Default cell size and sheet size. The live sheet size is per grid, in the
// ViewModel; a fresh, pivot or drill-down sheet starts at these.
export {
  DEFAULT_COL_W,
  DEFAULT_ROW_H,
  DEFAULT_TOTAL_ROWS,
  DEFAULT_TOTAL_COLS,
} from '../core/view-model.js'

// Frappe Espresso palette, read from the frappe-ui design tokens (--surface-*,
// --outline-*, --ink-*). The canvas API can't use CSS variables, so each
// colour reads its token from <html> with getComputedStyle at paint time and
// follows the theme. The hex values are fallbacks for when no frappe-ui
// stylesheet is loaded (tests).
//
// Selection accent is intentionally monochrome (Espresso black + neutral grays)
// rather than blue, to match Frappe Sheets's black-and-grey theme.
function _token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return val || fallback
}

export const COLORS = {
  get white() {
    return _token('--surface-base', '#FFFFFF')
  },
  get gridLine() {
    return _token('--outline-gray-2', '#E2E2E2')
  },
  get headerBg() {
    return _token('--surface-sidebar', '#F8F8F8')
  },
  get headerText() {
    return _token('--ink-gray-5', '#7C7C7C')
  },
  get cellText() {
    return _token('--ink-gray-9', '#171717')
  },
  // Ink for text sitting on a cell fill. A fill stores a literal colour and
  // ignores the theme, so these must not flip with it either — they read the
  // raw palette scale, which is fixed in both themes. They are the two values
  // --ink-gray-9 itself resolves to, so a filled cell keeps the ink it already
  // had in each theme. utils/contrast.js decides which one a fill gets.
  get inkOnLight() {
    return _token('--gray-950', '#171717')
  },
  get inkOnDark() {
    return _token('--gray-50', '#FAFAFA')
  },
  get sparkline() {
    return _token('--ink-teal-7', '#0F766E')
  },
  // Tint of a multi-cell range: the ink colour at SEL_ALPHA, painted over
  // the cells so they show through. Ink flips with the theme, so the wash
  // darkens in light mode and lightens in dark mode.
  get selFill() {
    return _token('--ink-gray-9', '#171717')
  },
  get selBorder() {
    return _token('--ink-gray-9', '#171717')
  },
  get selHandle() {
    return _token('--ink-gray-9', '#171717')
  },
  get activeHeader() {
    return _token('--surface-gray-4', '#E2E2E2')
  },
  // An active filter's range outline (Google-Sheets-style green).
  get filterOutline() {
    return _token('--ink-green-3', '#15803D')
  },
  // Separators between selected headers: one step past the tint on the same
  // surface scale, so they show on it in both themes. gridLine is the tint's
  // own grey in light mode, and --outline-gray-3 is in dark mode.
  get activeHeaderLine() {
    return _token('--surface-gray-5', '#C7C7C7')
  },
  get freezeLine() {
    return _token('--ink-gray-7', '#525252')
  },
  get pickerFill() {
    return _token('--surface-gray-2', 'rgba(23, 23, 23, 0.05)')
  },
  get pickerBorder() {
    return _token('--ink-gray-7', '#525252')
  },
  get chipFill() {
    return _token('--surface-gray-3', '#EDEDED')
  },
  get chipCaret() {
    return _token('--ink-gray-7', '#525252')
  },
  get invalidMark() {
    return _token('--ink-red-5', '#D93025')
  },
}
