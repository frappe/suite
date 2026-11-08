// Where and how the cell painter draws a cell's text: the cell's box, and
// the format, alignment and insets it draws the value with. The in-cell
// editor (index.ts) opens on the same box with the same format, so starting
// or ending an edit doesn't move the text.

import type { Geometry } from '../geometry.js'
import type { CellFormat, CellProvider, CondFormat, MergeInfo } from '../types.js'
import { ICON_INSET } from './cell-decorations.js'
import { autoAlign } from './cell-text-style.js'

/** A cell's box, in logical px. */
export interface CellBox {
  x: number
  y: number
  w: number
  h: number
}

/** How the painter draws a cell's text. */
export interface CellText {
  /** The cell's style with its conditional format over it. */
  fmt: CellFormat
  /** The alignment the text is drawn with: the format's own, else numbers
   *  right and text left. */
  align: string
  /** Whether the cell holds a number; undefined until the engine knows. */
  isNumber: boolean | undefined
  /** Logical px a conditional-format icon takes on the box's left. */
  iconInset: number
  /** Logical px a filter button takes on the box's right. */
  rightInset: number
}

/** The box of the cell at row `r`, column `c`; a merge's spans its cells. */
export function cellBox(
  r: number,
  c: number,
  merge: MergeInfo | null | undefined,
  { cw, rh, colX, rowY }: Pick<Geometry, 'cw' | 'rh' | 'colX' | 'rowY'>,
): CellBox {
  const spanC = merge ? merge.colSpan : 1
  const spanR = merge ? merge.rowSpan : 1
  let w = 0
  let h = 0
  for (let sc = 0; sc < spanC; sc++) w += cw(c + sc)
  for (let sr = 0; sr < spanR; sr++) h += rh(r + sr)
  return { x: colX(c), y: rowY(r), w, h }
}

/** How the painter draws `s`, the text of cell `id`, which has the style
 *  `style` and the conditional format `cond`. */
export function cellText(
  id: string,
  s: string,
  style: CellFormat,
  cond: CondFormat | null | undefined,
  cells: Pick<CellProvider, 'isNumber' | 'getRightInset'>,
): CellText {
  const fmt: CellFormat = cond ? { ...style, ...cond } : style
  const isNumber = cells.isNumber?.(id)
  return {
    fmt,
    align: fmt.align || autoAlign(s, isNumber),
    isNumber,
    iconInset: cond?.icon ? ICON_INSET : 0,
    rightInset: cells.getRightInset?.(id) || 0,
  }
}
