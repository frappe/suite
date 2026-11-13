// Font and ink for a cell's text, shared by the text painter and the
// validation chip so both draw a value the same way.

import { prefersLightInk } from '../../utils/contrast.js'
import { chipFont } from '../chip-geometry.js'
import { COLORS } from '../constants.js'
import type { CellFormat } from '../types.js'

// Ink for a cell's text. A fill — from a conditional-formatting rule or from
// the fill picker — is a literal colour that ignores the theme, so the
// themed ink can vanish on it: in dark mode `--ink-gray-7` is light grey and
// a pale colour-scale fill leaves light on light. Over a fill, read the ink
// off the fill instead. An unfilled cell keeps the themed ink.
export function inkFor(fmt: CellFormat): string {
  if (fmt.color) return fmt.color
  if (fmt.hyperlink) return '#007BE0'
  const light = prefersLightInk(fmt.backgroundColor)
  if (light == null) return COLORS.cellText
  return light ? COLORS.inkOnDark : COLORS.inkOnLight
}

/** How a value with no alignment of its own is drawn: numbers right, text
 *  left, as in Google Sheets. The cell's type decides (`1,000` and `50%`
 *  are numbers), given as `isNumber`; until the engine knows it, guess from
 *  the text. */
export function autoAlign(s: string, isNumber: boolean | undefined): 'left' | 'right' {
  if (isNumber !== undefined) return isNumber ? 'right' : 'left'
  return s !== '' && !isNaN(Number(s)) ? 'right' : 'left'
}

/** The canvas text alignment for a format's `align`; anything unknown is left. */
export function textAlignOf(align: string | undefined): CanvasTextAlign {
  return align === 'center' || align === 'right' ? align : 'left'
}

export function setCellFont(ctx: CanvasRenderingContext2D, fmt: CellFormat): void {
  ctx.font = chipFont(fmt)
  ctx.fillStyle = inkFor(fmt)
  ctx.textAlign = textAlignOf(fmt.align)
}
