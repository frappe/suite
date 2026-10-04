// Geometry, colour + font helpers for data-validation dropdown chips.
// Shared by the cell painter (which draws the pill) and the grid hit-test
// (which needs to know where the caret is) so the clickable caret zone
// always lines up with what's painted. Keep the two in sync by routing all
// chip measurement through here.

import type { CellFormat, ValidationRule } from './types.js'

export const CHIP = {
  padX:     4,   // gap from the cell's edge to the pill
  innerPad: 8,   // text padding inside the pill
  caretW:   16,  // room reserved on the pill's right for the caret + its click zone
  maxH:     22,  // the pill never grows taller than this
  minH:     13,  // below this the row is too short for a pill — fall back to a plain arrow
}

// Soft pastel chip backgrounds, à la Sheets. Used as the *auto* colour when an
// option has no colour of its own. Dark cell text stays readable on all of them.
const CHIP_PALETTE = [
  '#FCE8E6', '#FEF7E0', '#E6F4EA', '#E8F0FE',
  '#F3E8FD', '#FEEFE3', '#E4F7FB', '#FDE7F3',
]

// The auto colour for the i-th option in a list, cycling the palette. Slotting
// by position (not by hashing the text) means adjacent options never collide on
// the same colour, which is what made the old hash feel "random".
export function chipPaletteColor(i: number): string {
  return CHIP_PALETTE[((i % CHIP_PALETTE.length) + CHIP_PALETTE.length) % CHIP_PALETTE.length] ?? '#E8F0FE'
}

// Canvas font string for a cell format. Mirrors the cell painter exactly so
// text measured here for hit-testing matches what gets drawn.
export function chipFont(fmt: CellFormat = {}): string {
  const weight = fmt.bold   ? 'bold'   : 'normal'
  const style  = fmt.italic ? 'italic' : 'normal'
  const px     = Math.max(8, Math.min(72, fmt.fontSize || 13))
  const family = fmt.fontFamily || 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
  return `${style} ${weight} ${px}px ${family}`
}

// Background colour for an option value. Resolution order:
//   1. the rule's per-option custom colour (rule.colors[value]), if set;
//   2. otherwise the auto palette slot for the option's position in the list.
// `rule` is optional: without it (or for a value not among the options) we fall
// back to hashing the text so callers with no rule context still get a colour.
export function chipColor(value: unknown, rule?: Pick<ValidationRule, 'colors' | 'options'> | null): string {
  const s = String(value)
  const custom = rule?.colors?.[s]
  if (custom) return custom
  const i = rule?.options ? rule.options.indexOf(s) : -1
  if (i >= 0) return chipPaletteColor(i)
  let h = 0
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0
  return chipPaletteColor(h)
}

// Pill placement for `text` in a cell of width `cellW`: its x-offset from the
// cell's left edge and its width, honouring the cell's horizontal alignment.
// Caller need not pre-set ctx.font. Returns { offsetX, chipW }.
export function chipMetrics(ctx: CanvasRenderingContext2D, text: string, fmt: CellFormat | null | undefined, cellW: number): { offsetX: number; chipW: number } {
  ctx.save()
  ctx.font = chipFont(fmt ?? {})
  const tw = ctx.measureText(text).width
  ctx.restore()
  const chipW = Math.min(cellW - CHIP.padX * 2, CHIP.innerPad + tw + CHIP.caretW)
  const align = fmt?.align || 'left'
  const offsetX = align === 'right'  ? cellW - CHIP.padX - chipW
                : align === 'center' ? (cellW - chipW) / 2
                :                      CHIP.padX
  return { offsetX, chipW }
}
