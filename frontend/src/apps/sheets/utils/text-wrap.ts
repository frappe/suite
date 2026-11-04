// Cell text-wrap modes. Replaces the legacy boolean `wrapText` with a
// three-way enum that matches Sheets / Excel semantics:
//
//   'overflow' — long text spills into adjacent empty cells (default)
//   'clip'     — hard truncate at the cell border
//   'wrap'     — word-wrap inside the cell, row auto-grows
//
// Backwards compat: when only the old `wrapText: boolean` is set,
// `true` → 'wrap', `false`/missing → 'overflow'. New writes always
// use `textWrap`; old cells keep working until they're re-saved.

export type WrapMode = 'overflow' | 'clip' | 'wrap'

/** The format fields wrapping reads. */
interface WrapFormat {
  textWrap?: string | undefined
  wrapText?: boolean | undefined
  fontSize?: number | undefined
}

export const WRAP_MODES: readonly WrapMode[] = ['overflow', 'clip', 'wrap']

function _isWrapMode(v: unknown): v is WrapMode {
  return (WRAP_MODES as readonly unknown[]).includes(v)
}

/** The cell's wrap mode; the legacy `wrapText: true` reads as 'wrap'. */
export function getTextWrap(fmt: WrapFormat | null | undefined): WrapMode {
  if (!fmt) return 'overflow'
  if (_isWrapMode(fmt.textWrap)) return fmt.textWrap
  if (fmt.wrapText === true) return 'wrap'
  return 'overflow'
}

export function isWrapText(fmt: WrapFormat | null | undefined): boolean {
  return getTextWrap(fmt) === 'wrap'
}

// Logical line height (px) for a cell's font. The row auto-grow, the manual
// row auto-fit, and the wrapped-text painter all share this so a grown row
// fits exactly what's drawn — at any font size. The 1.25 factor keeps the
// default 13px font at the historical 16px line pitch.
export function lineHeightFor(fmt: WrapFormat | null | undefined): number {
  return Math.round((fmt?.fontSize || 13) * 1.25)
}

// Split a value into the visual lines it renders as: hard newlines always
// break, then each paragraph soft-wraps to fit `maxW`. `measure(text)` returns
// the pixel width of `text` in the cell's font — the caller sets that font on
// its measuring context first. A blank paragraph keeps one empty line so
// `\n\n` renders a gap. Single source of truth for both the painter (what it
// draws) and the row sizer (how tall it must be).
export function wrapLines(val: unknown, maxW: number, measure: (text: string) => number): string[] {
  return String(val)
    .split('\n')
    .flatMap((par) => _wrapParagraph(par, maxW, measure))
}

function _wrapParagraph(par: string, maxW: number, measure: (text: string) => number): string[] {
  const tokens = par.split(/(\s+)/)
  const lines: string[] = []
  let line = ''
  for (const tok of tokens) {
    if (!tok) continue
    if (measure(line + tok) <= maxW) {
      line += tok
      continue
    }
    if (/^\s+$/.test(tok)) {
      if (line.trim()) lines.push(line.trimEnd())
      line = ''
      continue
    }
    // A word that doesn't fit starts the next line whole; only a word wider
    // than the cell on its own is split by letters.
    if (line.trim()) {
      lines.push(line.trimEnd())
      line = ''
      if (measure(tok) <= maxW) {
        line = tok
        continue
      }
    }
    for (const ch of tok) {
      if (line && measure(line + ch) > maxW) {
        lines.push(line.trimEnd())
        line = ch
      } else {
        line += ch
      }
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.length ? lines : ['']
}
