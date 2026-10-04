import { COLORS } from './constants.js'
import type { EditorFormat, EditorOverlay } from './input/editor.js'

/** The in-cell editor's <textarea>, added to `parent`. */
export interface Overlay extends EditorOverlay {
  remove(): void
}

export function createOverlay(parent: HTMLElement): Overlay {
  // A textarea (not an input) so Cmd/Ctrl/Alt+Enter can insert real newlines
  // inside a cell, like Google Sheets. wrap=off keeps lines breaking only at
  // explicit \n, matching the old single-line horizontal-scroll behavior.
  const el = document.createElement('textarea')
  el.rows         = 1
  el.wrap         = 'off'
  el.spellcheck   = false
  el.autocomplete = 'off'
  el.style.cssText = [
    'position:absolute',
    'display:none',
    'box-sizing:border-box',
    `border:2px solid ${COLORS.selBorder}`,
    'background:var(--surface-base, #FFFFFF)',
    'padding:0 4px',
    'font:13px InterVar,Inter,ui-sans-serif,system-ui,sans-serif',
    'letter-spacing:0.02em',
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

  let baseH = 0   // cell height; autosize never shrinks below it

  function position(x: number, y: number, w: number, h: number, fmt: EditorFormat = {}, zoom = 1): void {
    el.style.left           = x + 'px'
    el.style.top            = y + 'px'
    el.style.width          = w + 'px'
    el.style.height         = h + 'px'
    el.style.fontWeight     = fmt.bold      ? 'bold'      : 'normal'
    el.style.fontStyle      = fmt.italic    ? 'italic'    : 'normal'
    el.style.fontSize       = ((fmt.fontSize || 13) * zoom) + 'px'
    el.style.fontFamily     = fmt.fontFamily || 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
    el.style.textAlign      = fmt.align     || 'left'
    const deco = [fmt.underline && 'underline', fmt.strikethrough && 'line-through'].filter(Boolean).join(' ')
    el.style.textDecoration = deco || 'none'
    el.style.color          = fmt.color     || COLORS.cellText
    el.style.backgroundColor = fmt.backgroundColor || fmt.bg || COLORS.white
    el.style.borderColor     = COLORS.selBorder
    // Textareas top-align text; pad so a single line sits centered like the
    // old <input> did. 4px = the 2px borders (box-sizing:border-box).
    const lineH = Math.round(((fmt.fontSize || 13) * zoom) * 1.3)
    el.style.lineHeight = lineH + 'px'
    el.style.paddingTop = Math.max(0, (h - 4 - lineH) / 2) + 'px'
    baseH = h
  }

  // Grow the editor downward to fit newline-separated lines.
  function autosize(): void {
    el.style.height = baseH + 'px'
    if (el.scrollHeight > el.clientHeight) el.style.height = (el.scrollHeight + 4) + 'px'
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

  function getValue(): string { return el.value }

  function remove(): void { el.remove() }

  return { el, position, show, hide, getValue, remove }
}
