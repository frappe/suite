import { getTextWrap, lineHeightFor, wrapLines } from '../utils/text-wrap.js'
import { chipFont } from './chip-geometry.js'
import { COLORS, FRAME_W, GRID_LINE } from './constants.js'
import type { EditorFormat, EditorOverlay } from './input/editor.js'
import { inkFor } from './painters/cell-text-style.js'
import { cellMidY, centredBaseline, firstLineMid } from './painters/text-anchor.js'
import type { CellFormat } from './types.js'

// The editor's border takes the selection frame's place (FRAME_W centred on
// the gridline, GRID_LINE after the cell edge), so opening the editor doesn't
// move the frame.
// Inter's metrics as shares of the font size, for when no canvas can measure:
// font box (CSS line layout), cap height, and the em box the canvas's 'top'
// and 'bottom' baselines sit on (above / below the alphabetic baseline).
const FALLBACK = { ascent: 0.96875, descent: 0.2421875, cap: 0.727, emAscent: 0.8, emDescent: 0.2 }

// The device pixel row, from the canvas's top, that the canvas draws a
// baseline at logical `y` on. The renderer scales by k = devicePixelRatio ×
// zoom (renderer.ts); the canvas keeps that scale in single precision, maps
// `y` through it in single precision and rounds to the nearest row, a half
// up. The same sum in double precision can land just under a half pixel
// and round to the row above.
function canvasRow(k: number, y: number): number {
  return Math.floor(Math.fround(Math.fround(k) * Math.fround(y)) + 0.5)
}

/** The in-cell editor's <textarea>, added to `parent`. */
export interface Overlay extends EditorOverlay {
  remove(): void
}

interface Box {
  x: number
  y: number
  w: number
  h: number
  fmt: EditorFormat
  zoom: number
}

export function createOverlay(parent: HTMLElement): Overlay {
  // A textarea (not an input) so Cmd/Ctrl/Alt+Enter can insert real newlines
  // inside a cell, like Google Sheets. wrap=off keeps lines breaking only at
  // explicit \n, matching the old single-line horizontal-scroll behavior;
  // a wrap-mode cell turns soft wrapping on, as the canvas wraps it.
  const el = document.createElement('textarea')
  el.rows = 1
  el.wrap = 'off'
  el.spellcheck = false
  el.autocomplete = 'off'
  // Font longhands, no `font` shorthand: the shorthand resets the font
  // settings that the textarea, like the canvas beside it, inherits from the
  // grid's wrapper. _layout pins Inter's optical size to the unzoomed font
  // size, the size the canvas draws before it scales, so the editor draws
  // the same glyphs at the same widths.
  el.style.cssText = [
    'position:absolute',
    'display:none',
    'box-sizing:border-box',
    `border:${FRAME_W}px solid ${COLORS.selBorder}`,
    'background:var(--surface-base, #FFFFFF)',
    'padding:0 4px',
    'font-size:13px',
    'font-family:InterVar,Inter,ui-sans-serif,system-ui,sans-serif',
    'font-feature-settings:inherit',
    'font-optical-sizing:inherit',
    'letter-spacing:0',
    'word-spacing:0',
    `color:${COLORS.cellText}`,
    'outline:none',
    'box-shadow:none',
    'resize:none',
    'overflow:hidden',
    '-webkit-appearance:none',
    'appearance:none',
    'z-index:10',
  ].join(';')
  parent.appendChild(el)

  let baseH = 0 // cell height; autosize never shrinks below it
  let borderW = FRAME_W
  // The border width the browser draws: it snaps a border to whole device
  // pixels (1.5px is 1px on a 1x screen), and the text starts after it.
  let usedBorder = FRAME_W
  let measureCtx: OffscreenCanvasRenderingContext2D | null | undefined
  let box: Box | null = null
  // Lines of the text the editor opened with. The canvas lays a cell's text
  // block out by its line count; the editor keeps that first-line position
  // while typing and grows downward.
  let openLines = 1
  // Layout-measured baselines (_layoutBaseline), per font and line height.
  const baselines = new Map<string, number | null>()
  let probe: HTMLDivElement | null = null
  let mark: HTMLSpanElement | null = null

  function position(
    x: number,
    y: number,
    w: number,
    h: number,
    fmt: EditorFormat = {},
    zoom = 1,
  ): void {
    box = { x, y, w, h, fmt, zoom }
    _layout(box)
  }

  // The text has to stay where the canvas drew it (cell-painter.ts): same
  // font, 4px in from the cell's text edges, and the first line's baseline
  // where the canvas put it for this alignment and line count. The border
  // sits on the selection frame, so its outer edge starts a quarter of a
  // (zoomed) pixel before the cell edge.
  function _layout({ x, y, w, h, fmt, zoom }: Box): void {
    borderW = FRAME_W * zoom
    const outer = GRID_LINE * zoom - borderW / 2
    el.style.left = x + outer + 'px'
    el.style.top = y + outer + 'px'
    el.style.width = w + borderW + 'px'
    el.style.height = h + borderW + 'px'
    el.style.borderWidth = borderW + 'px'
    usedBorder = parseFloat(getComputedStyle(el).borderTopWidth) || borderW
    // The content box starts `inner` after x and y, and ends `innerRight`
    // before x + w.
    const inner = outer + usedBorder
    const innerRight = -outer - borderW + usedBorder
    // The canvas draws from x + 4 (plus a conditional-format icon) to
    // x + w - 4 (minus a filter button).
    el.style.paddingLeft = (4 + (fmt.insetLeft || 0)) * zoom - inner + 'px'
    el.style.paddingRight = (4 + (fmt.insetRight || 0)) * zoom - innerRight + 'px'
    el.style.fontWeight = fmt.bold ? 'bold' : 'normal'
    el.style.fontStyle = fmt.italic ? 'italic' : 'normal'
    // Same size the canvas draws (chipFont clamps it to 8…72 before zoom).
    const size0 = Math.max(8, Math.min(72, fmt.fontSize || 13))
    const size = size0 * zoom
    el.style.fontSize = size + 'px'
    el.style.fontFamily = fmt.fontFamily || 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
    // A variable font with an optical-size axis (Inter) picks its design from
    // the font size. The canvas draws the unzoomed size and scales it, so pin
    // the editor to that size's design; at zoom 125% the 25px design is
    // narrower than the scaled 20px one.
    el.style.setProperty('font-variation-settings', `"opsz" ${size0}`)
    el.style.textAlign = fmt.align === 'center' || fmt.align === 'right' ? fmt.align : 'left'
    const deco = [fmt.underline && 'underline', fmt.strikethrough && 'line-through']
      .filter(Boolean)
      .join(' ')
    el.style.textDecoration = deco || 'none'
    // The painter's ink: over a fill, it reads the ink off the fill.
    const ink: CellFormat = {}
    if (fmt.color) ink.color = fmt.color
    const fill = fmt.backgroundColor || fmt.bg
    if (fill) ink.backgroundColor = fill
    el.style.color = inkFor(ink)
    el.style.backgroundColor = fmt.backgroundColor || fmt.bg || COLORS.white
    el.style.borderColor = COLORS.selBorder
    const wrap = getTextWrap(fmt) === 'wrap'
    el.wrap = wrap ? 'soft' : 'off'
    // The canvas's line pitch (text-wrap.ts), so a second line lands where
    // the canvas draws it.
    let lineH = lineHeightFor(fmt) * zoom
    // A textarea top-aligns its first line, and CSS centres the font's
    // ascent + descent in the line box; pad the top so the first baseline
    // lands where the canvas drew it. The canvas measures its font unzoomed
    // and scales; CSS lays out the zoomed font.
    const drawn = _metrics(_font(size0), size0)
    const css = _metrics(_font(size), size)
    const multi = wrap || openLines > 1
    const baseline0 = _canvasBaseline(h / zoom, fmt, multi, drawn)
    let baseline = baseline0 * zoom
    // Where CSS puts the baseline in a line box: measured when the page has
    // layout (the browser rounds its font metrics and snaps the line, so the
    // canvas's metrics can be half a pixel off); from the metrics otherwise.
    const baselineInLine = (lh: number) =>
      _layoutBaseline(lh) ?? (lh - css.ascent - css.descent) / 2 + css.ascent
    // On screen, the canvas draws text on the device pixel nearest to its
    // baseline, while CSS rounds a fractional baseline its own way (at zoom
    // 125%, or with the grid between device pixels on a 1.5x screen, they
    // land a device pixel apart). Put the editor's baseline on the canvas's
    // pixel, a quarter pixel down so any rounding keeps it.
    if (_layoutBaseline(lineH) !== null) {
      const dpr = globalThis.devicePixelRatio || 1
      const top = parent.getBoundingClientRect().top
      const row = Math.round(top * dpr) + canvasRow(dpr * zoom, y / zoom + baseline0)
      baseline = (row + 0.25) / dpr - top - y
    }
    let padTop = baseline - inner - baselineInLine(lineH)
    // Padding can't go negative: a font too big for its row draws its
    // baseline higher than a full line box allows. One line has no pitch to
    // keep, so shrink the line box instead (its baseline rises by half).
    if (padTop < 0 && !multi) {
      lineH += 2 * padTop
      padTop = baseline - inner - baselineInLine(lineH)
    }
    el.style.lineHeight = lineH + 'px'
    el.style.paddingTop = Math.max(0, padTop) + 'px'
    baseH = h + borderW
  }

  // The baseline's offset from the top of a `lineH` line box in the
  // editor's current font, as the browser lays it out: a hidden line in the
  // same parent (so it inherits the same font settings) with a zero-size box
  // sitting on the baseline. Null without layout (jsdom).
  function _layoutBaseline(lineH: number): number | null {
    const st = el.style
    const key = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily} ${st.getPropertyValue('font-variation-settings')}/${lineH}@${globalThis.devicePixelRatio || 1}`
    const known = baselines.get(key)
    if (known !== undefined) return known
    if (!probe) {
      probe = document.createElement('div')
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        'visibility:hidden',
        'pointer-events:none',
        'white-space:pre',
        'margin:0',
        'padding:0',
        'border:0',
        'font-feature-settings:inherit',
        'font-optical-sizing:inherit',
      ].join(';')
      mark = document.createElement('span')
      mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
      probe.append('H', mark)
      parent.appendChild(probe)
    }
    const ps = probe.style
    ps.fontStyle = st.fontStyle
    ps.fontWeight = st.fontWeight
    ps.fontSize = st.fontSize
    ps.fontFamily = st.fontFamily
    ps.setProperty('font-variation-settings', st.getPropertyValue('font-variation-settings'))
    ps.lineHeight = lineH + 'px'
    const result =
      probe.offsetHeight > 0
        ? mark!.getBoundingClientRect().top - probe.getBoundingClientRect().top
        : null
    // Until the web font loads this measures a fallback font: don't keep it.
    if (document.fonts?.status !== 'loading') baselines.set(key, result)
    return result
  }

  // The canvas font string (chip-geometry.ts chipFont) at `px`.
  function _font(px: number): string {
    const st = el.style
    return `${st.fontStyle} ${st.fontWeight} ${px}px ${st.fontFamily}`
  }

  // Where the canvas puts the first line's alphabetic baseline, below the
  // cell's top edge, in unzoomed pixels: wrapped or multi-line text lays
  // out a block of `openLines` lines, and one line centres its capitals on
  // the white area below the gridline (text-anchor.ts).
  function _canvasBaseline(
    h: number,
    fmt: EditorFormat,
    multi: boolean,
    m: ReturnType<typeof _metrics>,
  ): number {
    if (multi) {
      const mid = firstLineMid(0, h, fmt.valign, openLines, lineHeightFor(fmt))
      return centredBaseline(mid, m.cap)
    }
    // One top or bottom line sits on the canvas's 'top' or 'bottom'
    // baseline, 4px in from the edge (cell-painter.ts _computeTextAnchor).
    if (fmt.valign === 'top') return 4 + m.emAscent
    if (fmt.valign === 'bottom') return h - 4 - m.emDescent
    return centredBaseline(cellMidY(0, h), m.cap)
  }

  // The canvas the overlay measures text on. OffscreenCanvas: every current
  // browser has one; jsdom (tests) doesn't, and gets null without logging a
  // missing canvas.
  function _measure(): OffscreenCanvasRenderingContext2D | null {
    if (measureCtx === undefined)
      measureCtx =
        typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
    return measureCtx
  }

  // Metrics of `font` (whose size is `size` px), measured on a canvas, as
  // the painter and CSS see them (canvas font-box metrics are the ones CSS
  // lays lines out with).
  function _metrics(font: string, size: number) {
    const measure = _measure()
    const fb = {
      ascent: size * FALLBACK.ascent,
      descent: size * FALLBACK.descent,
      cap: size * FALLBACK.cap,
      emAscent: size * FALLBACK.emAscent,
      emDescent: size * FALLBACK.emDescent,
    }
    if (!measure) return fb
    measure.font = font
    measure.textBaseline = 'top'
    const top = measure.measureText('H').alphabeticBaseline
    measure.textBaseline = 'bottom'
    const bottom = measure.measureText('H').alphabeticBaseline
    measure.textBaseline = 'alphabetic'
    const t = measure.measureText('H')
    return {
      ascent: t.fontBoundingBoxAscent,
      descent: t.fontBoundingBoxDescent,
      cap: t.actualBoundingBoxAscent,
      // alphabeticBaseline: how far the alphabetic baseline sits above the
      // current one (so below 'top' it is negative).
      emAscent: Number.isFinite(top) ? -top : fb.emAscent,
      emDescent: Number.isFinite(bottom) ? bottom : fb.emDescent,
    }
  }

  // Lines the painter draws `el.value` in (cell-painter.ts _drawWrappedText):
  // its hard lines, which a wrap-mode cell also wraps to the width between
  // its text edges, measured in the font the canvas draws. Without a canvas
  // to measure on, the hard lines.
  function _countLines(): number {
    const ctx = _measure()
    if (!box || !ctx || getTextWrap(box.fmt) !== 'wrap') return el.value.split('\n').length
    const { w, zoom, fmt } = box
    ctx.font = chipFont(fmt)
    const maxW = w / zoom - (fmt.insetLeft || 0) - (fmt.insetRight || 0) - 8
    return wrapLines(el.value, maxW, (t) => ctx.measureText(t).width).length
  }

  // Grow the editor downward to fit newline-separated lines.
  function autosize(): void {
    el.style.height = baseH + 'px'
    if (el.scrollHeight > el.clientHeight) el.style.height = el.scrollHeight + 2 * usedBorder + 'px'
  }
  el.addEventListener('input', autosize)

  function show(value: string): void {
    el.style.display = 'block'
    el.value = value
    openLines = _countLines()
    if (box && openLines > 1) _layout(box)
    autosize()
    el.focus()
    el.setSelectionRange(value.length, value.length)
  }

  function hide(): void {
    el.style.display = 'none'
    el.value = ''
    openLines = 1
  }

  function getValue(): string {
    return el.value
  }

  function remove(): void {
    el.remove()
    probe?.remove()
  }

  return { el, position, show, hide, getValue, remove }
}
