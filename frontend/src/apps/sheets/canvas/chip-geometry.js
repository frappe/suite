// Geometry, colour + font helpers for data-validation dropdown chips.
// Shared by the cell painter (which draws the pill) and the grid hit-test
// (which needs to know where the caret is) so the clickable caret zone
// always lines up with what's painted. Keep the two in sync by routing all
// chip measurement through here.

export const CHIP = {
  padX:     4,   // gap from the cell's edge to the pill
  innerPad: 8,   // text padding inside the pill
  caretW:   16,  // room reserved on the pill's right for the caret + its click zone
  maxH:     22,  // the pill never grows taller than this
  minH:     13,  // below this the row is too short for a pill — fall back to a plain arrow
}

// Soft pastel chip backgrounds, à la Sheets. A value's colour is derived from
// the value itself, so the same option is always the same colour without any
// per-option config in the rule. Dark cell text stays readable on all of them.
const CHIP_PALETTE = [
  '#FCE8E6', '#FEF7E0', '#E6F4EA', '#E8F0FE',
  '#F3E8FD', '#FEEFE3', '#E4F7FB', '#FDE7F3',
]

// Canvas font string for a cell format. Mirrors the cell painter exactly so
// text measured here for hit-testing matches what gets drawn.
export function chipFont(fmt = {}) {
  const weight = fmt.bold   ? 'bold'   : 'normal'
  const style  = fmt.italic ? 'italic' : 'normal'
  const px     = Math.max(8, Math.min(72, fmt.fontSize || 13))
  const family = fmt.fontFamily || 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
  return `${style} ${weight} ${px}px ${family}`
}

// Stable pastel background for a known option value.
export function chipColor(value) {
  const s = String(value)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CHIP_PALETTE[h % CHIP_PALETTE.length]
}

// Pill placement for `text` in a cell of width `cellW`: its x-offset from the
// cell's left edge and its width, honouring the cell's horizontal alignment.
// Caller need not pre-set ctx.font. Returns { offsetX, chipW }.
export function chipMetrics(ctx, text, fmt, cellW) {
  ctx.save()
  ctx.font = chipFont(fmt)
  const tw = ctx.measureText(text).width
  ctx.restore()
  const chipW = Math.min(cellW - CHIP.padX * 2, CHIP.innerPad + tw + CHIP.caretW)
  const align = fmt.align || 'left'
  const offsetX = align === 'right'  ? cellW - CHIP.padX - chipW
                : align === 'center' ? (cellW - chipW) / 2
                :                      CHIP.padX
  return { offsetX, chipW }
}
