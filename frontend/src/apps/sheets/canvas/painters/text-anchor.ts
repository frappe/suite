// Vertical centring for text on the grid, shared by the cell and header
// painters.
//
// Two things pull text off centre if they are ignored:
// - A gridline is drawn on the *first* pixel row of each cell (grid-painter
//   strokes at `rowY + 0.5`), so a cell of height h shows white from y+1 to
//   y+h. Its centre is y + (h + 1) / 2, not y + h / 2.
// - `textBaseline = 'middle'` centres the font's em box, which for Inter sits
//   above its capitals and digits. Centring the cap height instead puts the
//   ink in the middle: draw on the alphabetic baseline at centre + capHeight/2.

// Inter's cap height as a share of the font size, for contexts that cannot
// measure glyph bounds (tests, very old browsers).
const CAP_HEIGHT_EM = 0.727

/** Centre of the white area of a cell or row header at `y`, `h` tall. */
export function cellMidY(y: number, h: number): number {
  return y + (h + 1) / 2
}

/** Alphabetic baseline that centres the cap height on `midY`. */
export function centredBaseline(midY: number, capHeight: number): number {
  return midY + capHeight / 2
}

/** Reads the cap height of the context's current font, cached per font string. */
export function createCapHeight(ctx: CanvasRenderingContext2D): () => number {
  const cache = new Map<string, number>()
  return () => {
    const font = ctx.font
    let cap = cache.get(font)
    if (cap === undefined) {
      // Glyph bounds are measured from the current baseline, so measure on
      // the alphabetic one: from 'middle' the ascent is only half the caps.
      const baseline = ctx.textBaseline
      ctx.textBaseline = 'alphabetic'
      cap = ctx.measureText('H').actualBoundingBoxAscent
      ctx.textBaseline = baseline
      if (!(cap > 0)) cap = _fontPx(font) * CAP_HEIGHT_EM
      // Until Inter has loaded this measured a fallback font: don't keep it.
      if (_fontsReady()) cache.set(font, cap)
    }
    return cap
  }
}

function _fontsReady(): boolean {
  return typeof document === 'undefined' || document.fonts?.status !== 'loading'
}

function _fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font)
  return m ? Number(m[1]) : 13
}
