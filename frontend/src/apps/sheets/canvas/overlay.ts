import { COLORS } from './constants.js'
import type { EditorFormat, EditorOverlay } from './input/editor.js'

// Selection frame width (painters/selection-painter.ts): the editor's border
// takes its place, so opening the editor doesn't move the frame.
const FRAME_W = 2
// Inter's metrics as shares of the font size, for when no canvas can measure.
const FALLBACK = { ascent: 0.96875, descent: 0.2421875, cap: 0.727 }

/** The in-cell editor's <textarea>, added to `parent`. */
export interface Overlay extends EditorOverlay {
  remove(): void
}

export function createOverlay(parent: HTMLElement): Overlay {
  // A textarea (not an input) so Cmd/Ctrl/Alt+Enter can insert real newlines
  // inside a cell, like Google Sheets. wrap=off keeps lines breaking only at
  // explicit \n, matching the old single-line horizontal-scroll behavior.
  const el = document.createElement('textarea')
  el.rows = 1
  el.wrap = 'off'
  el.spellcheck = false
  el.autocomplete = 'off'
  el.style.cssText = [
    'position:absolute',
    'display:none',
    'box-sizing:border-box',
    `border:2px solid ${COLORS.selBorder}`,
    'background:var(--surface-base, #FFFFFF)',
    'padding:0 4px',
    'font:13px InterVar,Inter,ui-sans-serif,system-ui,sans-serif',
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
  let measure: OffscreenCanvasRenderingContext2D | null | undefined

  function position(
    x: number,
    y: number,
    w: number,
    h: number,
    fmt: EditorFormat = {},
    zoom = 1,
  ): void {
    // The text has to stay where the canvas drew it (cell-painter.ts): 4px
    // in from the left, capitals centred on the white area below the
    // gridline. The border sits on the selection frame, one (zoomed) pixel
    // outside the cell box.
    borderW = FRAME_W * zoom
    const out = borderW / 2
    el.style.left = x - out + 'px'
    el.style.top = y - out + 'px'
    el.style.width = w + borderW + 'px'
    el.style.height = h + borderW + 'px'
    el.style.borderWidth = borderW + 'px'
    el.style.paddingLeft = el.style.paddingRight = 4 * zoom - out + 'px'
    el.style.fontWeight = fmt.bold ? 'bold' : 'normal'
    el.style.fontStyle = fmt.italic ? 'italic' : 'normal'
    // Same size the canvas draws (chipFont clamps it to 8…72 before zoom).
    const size = Math.max(8, Math.min(72, fmt.fontSize || 13)) * zoom
    el.style.fontSize = size + 'px'
    el.style.fontFamily = fmt.fontFamily || 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
    el.style.textAlign = fmt.align || 'left'
    const deco = [fmt.underline && 'underline', fmt.strikethrough && 'line-through']
      .filter(Boolean)
      .join(' ')
    el.style.textDecoration = deco || 'none'
    el.style.color = fmt.color || COLORS.cellText
    el.style.backgroundColor = fmt.backgroundColor || fmt.bg || COLORS.white
    el.style.borderColor = COLORS.selBorder
    // A textarea top-aligns its first line, and CSS centres the font's
    // ascent + descent in the line box; pad the top so the capitals' middle
    // lands on the canvas's centre line, y + (h + zoom) / 2.
    const lineH = Math.round(size * 1.3)
    const m = _metrics(size)
    const baselineInLine = (lineH - m.ascent - m.descent) / 2 + m.ascent
    const contentTop = out // border top (y - out + borderW) relative to y
    const capCentre = (h + zoom) / 2
    el.style.lineHeight = lineH + 'px'
    el.style.paddingTop = Math.max(0, capCentre + m.cap / 2 - baselineInLine - contentTop) + 'px'
    baseH = h + borderW
  }

  // Line metrics of the editor's font at this zoom, measured on a canvas
  // (canvas font-box metrics are the ones CSS lays lines out with).
  function _metrics(size: number) {
    // OffscreenCanvas: every current browser has one; jsdom (tests) doesn't,
    // and falls back to Inter's ratios without logging a missing canvas.
    if (measure === undefined)
      measure =
        typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
    if (!measure) {
      return {
        ascent: size * FALLBACK.ascent,
        descent: size * FALLBACK.descent,
        cap: size * FALLBACK.cap,
      }
    }
    const st = el.style
    measure.font = `${st.fontStyle} ${st.fontWeight} ${size}px ${st.fontFamily}`
    measure.textBaseline = 'alphabetic'
    const t = measure.measureText('H')
    return {
      ascent: t.fontBoundingBoxAscent,
      descent: t.fontBoundingBoxDescent,
      cap: t.actualBoundingBoxAscent,
    }
  }

  // Grow the editor downward to fit newline-separated lines.
  function autosize(): void {
    el.style.height = baseH + 'px'
    if (el.scrollHeight > el.clientHeight) el.style.height = el.scrollHeight + 2 * borderW + 'px'
  }
  el.addEventListener('input', autosize)

  function show(value: string): void {
    el.style.display = 'block'
    el.value = value
    autosize()
    el.focus()
    el.setSelectionRange(value.length, value.length)
  }

  function hide(): void {
    el.style.display = 'none'
    el.value = ''
  }

  function getValue(): string {
    return el.value
  }

  function remove(): void {
    el.remove()
  }

  return { el, position, show, hide, getValue, remove }
}
