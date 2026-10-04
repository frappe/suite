// Formula autocomplete for the in-cell editor: the popup under the editor
// while a formula is being typed.
//
// Three things it can show, decided from the text around the caret:
//   - function and sheet names matching the token being typed (=SU → SUM);
//   - a range suggestion for an empty SUM-style first argument, the run of
//     numbers above or left of the cell ("Tab to fill range");
//   - otherwise, read-only parameter help for the function the caret is in.
//
// Keys: Up/Down move the highlight, Tab (or Enter, except for a range)
// accepts, Escape closes.

import { colLabel } from '../../utils/cells.js'
import {
  AC_FUN_KEYS,
  AC_FUNS,
  describeSignature,
  detectAdjacentRange,
  isNumericText,
  parseAcToken,
  parseSignatureContext,
  shouldSuggestRange,
} from '../../utils/formula-ac.js'
import type { Cell } from '../selection.js'
import { refForRange, type PickRect, type RangePicker } from './range-picker.js'

export type AcItem =
  { kind: 'fn' | 'sheet'; name: string } | { kind: 'range'; name: string; rect: PickRect }

export interface AutocompleteOptions {
  /** Where the popup element is attached (the grid's wrapper). */
  parent: HTMLElement
  /** The in-cell editor; the popup sits under it. */
  input: HTMLTextAreaElement
  picker: Pick<RangePicker, 'showSuggestion' | 'dropSuggestion' | 'acceptSuggestion'>
  /** The cell being edited, for the range suggestion. */
  activeCell(): Cell
  /** A cell's display text, for spotting numeric neighbours. */
  displayAt(r: number, c: number): string | undefined
  sheetNames(): string[]
  crossSheetName(): string | null
  /** The editor's text changed (the host mirrors it in the formula bar). */
  onInput(value: string): void
  render(): void
}

export interface Autocomplete {
  /** Recompute the popup for the editor's text and caret. */
  update(value: string, caret: number): void
  hide(): void
  /** Handle a keydown in the editor; true when the popup used the key. */
  handleKey(e: KeyboardEvent): boolean
  readonly items: readonly AcItem[]
  remove(): void
}

const ACTIVE_BG = 'var(--surface-gray-2, #f3f3f3)'
const MAX_FUNCTIONS = 6
const MAX_SHEETS = 3

export function createAutocomplete(o: AutocompleteOptions): Autocomplete {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute',
    'display:none',
    'z-index:50',
    'background:var(--surface-elevation-2, var(--surface-base, #ffffff))',
    'border:1px solid var(--outline-gray-2, #e2e2e2)',
    'border-radius:6px',
    'box-shadow:0 4px 14px rgba(0,0,0,.25)',
    'min-width:200px',
    'max-height:208px',
    'overflow-y:auto',
    'padding:4px 0',
    'font:13px Inter,system-ui,sans-serif',
  ].join(';')
  o.parent.appendChild(el)

  let items: AcItem[] = []
  let idx = 0

  // Drop a passive range-suggestion highlight (never touches a real pick).
  function clearSuggestion(): void {
    if (o.picker.dropSuggestion()) o.render()
  }

  function placeUnderEditor(): { ox: number; oy: number } {
    const ox = parseFloat(o.input.style.left) || 0
    const oy = parseFloat(o.input.style.top) || 0
    const oh = parseFloat(o.input.style.height) || 24
    el.style.left = ox + 'px'
    el.style.top = oy + oh + 2 + 'px'
    el.style.display = 'block'
    return { ox, oy }
  }

  function rangeSuggestion(value: string, caret: number): AcItem | null {
    if (!shouldSuggestRange(value, caret)) return null
    const at = o.activeCell()
    const rect = detectAdjacentRange(at.r, at.c, (r, c) => isNumericText(o.displayAt(r, c)))
    if (!rect) return null
    return { kind: 'range', name: refForRange(rect, o.crossSheetName(), colLabel), rect }
  }

  function update(value: string, caret: number): void {
    clearSuggestion()
    const token = parseAcToken(value, caret)
    if (!token) {
      // No name being typed. In an empty SUM-style first argument, offer
      // the adjacent numbers as a range (selectable); otherwise show
      // passive parameter help (not selectable).
      const sug = rangeSuggestion(value, caret)
      if (sug && sug.kind === 'range') {
        items = [sug]
        idx = 0
        o.picker.showSuggestion(sug.rect)
        renderList()
        o.render()
        return
      }
      showSignature(value, caret)
      return
    }
    const up = token.tok.toUpperCase()
    const fns = AC_FUN_KEYS.filter((n) => n.startsWith(up)).slice(0, MAX_FUNCTIONS)
    const sheets = o
      .sheetNames()
      .filter((n) => n.toUpperCase().startsWith(up) && !fns.includes(n.toUpperCase()))
      .slice(0, MAX_SHEETS)
    items = [
      ...fns.map((name): AcItem => ({ name, kind: 'fn' })),
      ...sheets.map((name): AcItem => ({ name, kind: 'sheet' })),
    ]
    if (!items.length) {
      hide()
      return
    }
    idx = 0
    renderList()
  }

  function renderList(): void {
    el.innerHTML = ''
    items.forEach((item, i) => {
      const row = document.createElement('div')
      row.style.cssText = `display:flex;align-items:baseline;gap:10px;padding:6px 12px;cursor:pointer;white-space:nowrap;border-radius:4px;${i === idx ? `background:${ACTIVE_BG};` : ''}`
      const right =
        item.kind === 'sheet'
          ? `<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-cyan-6, #0891b2);background:var(--surface-cyan-1, #ecfeff);border-radius:3px;padding:1px 5px;">sheet</span>`
          : item.kind === 'range'
            ? `<span style="font-size:11px;color:var(--ink-gray-5, #7c7c7c);">Tab to fill range</span>`
            : `<span style="font-size:11px;color:var(--ink-gray-5, #7c7c7c);">${AC_FUNS[item.name] ?? ''}</span>`
      row.innerHTML = `<span style="font-weight:600;min-width:80px;color:var(--ink-gray-9, #171717);">${item.name}</span>${right}`
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        accept(item)
      })
      row.addEventListener('mouseover', () => {
        idx = i
        highlight()
      })
      el.appendChild(row)
    })
    const { oy } = placeUnderEditor()
    // Flip upward if the list clips the viewport bottom.
    if (el.getBoundingClientRect().bottom > window.innerHeight - 8) {
      el.style.top = Math.max(0, oy - el.offsetHeight - 2) + 'px'
    }
  }

  function highlight(): void {
    Array.from(el.children).forEach((row, i) => {
      ;(row as HTMLElement).style.background = i === idx ? ACTIVE_BG : ''
    })
  }

  function hide(): void {
    items = []
    idx = 0
    // A live range suggestion owns the picker highlight: drop it and
    // repaint. An accepted suggestion is no longer a suggestion, so its
    // inserted reference stays lit.
    clearSuggestion()
    el.style.display = 'none'
  }

  // FN(a, b, c) with the argument the caret is on in bold. `items` stays
  // empty so Up/Down/Enter/Tab are not captured.
  function showSignature(value: string, caret: number): void {
    const ctx = parseSignatureContext(value, caret)
    const desc = ctx && describeSignature(ctx.fn, ctx.argIndex)
    if (!ctx || !desc) {
      hide()
      return
    }
    items = []
    idx = 0
    const params = desc.params
      .map((p, i) =>
        i === desc.active ? `<b style="color:var(--ink-gray-9, #171717);">${p}</b>` : p,
      )
      .join(', ')
    el.innerHTML =
      `<div style="padding:6px 12px;white-space:nowrap;color:var(--ink-gray-5, #7c7c7c);">` +
      `<span style="font-weight:600;color:var(--ink-gray-9, #171717);">${ctx.fn}</span>(${params})</div>`
    placeUnderEditor()
  }

  function setValue(value: string, caret: number): void {
    o.input.value = value
    o.input.setSelectionRange(caret, caret)
    o.onInput(value)
  }

  function accept(item: AcItem): void {
    const input = o.input
    const caret = input.selectionStart ?? input.value.length
    if (item.kind === 'range') {
      // Splice the reference in at the caret, just after the '('.
      setValue(
        input.value.slice(0, caret) + item.name + input.value.slice(caret),
        caret + item.name.length,
      )
      // The accepted suggestion becomes a real pick (range-picker.ts).
      o.picker.acceptSuggestion(item.rect)
      hide()
      input.focus()
      o.render()
      return
    }
    const token = parseAcToken(input.value, caret)
    if (!token) {
      hide()
      input.focus()
      return
    }
    // A function gets '()' with the caret between; a sheet gets '!'.
    // Either way the caret lands one character past the name.
    const suffix = item.kind === 'sheet' ? '!' : '()'
    const next =
      input.value.slice(0, token.tokStart) + item.name + suffix + input.value.slice(caret)
    const pos = token.tokStart + item.name.length + 1
    setValue(next, pos)
    input.focus()
    // The caret now sits inside '(': offer a range or parameter help.
    update(next, pos)
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (!items.length) return false
    const cur = items[idx]
    // A range suggestion accepts on Tab only, so Enter still commits the
    // formula and an unwanted guess never hijacks it.
    const acceptKey = cur?.kind === 'range' ? e.key === 'Tab' : e.key === 'Tab' || e.key === 'Enter'
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      idx = Math.min(idx + 1, items.length - 1)
      highlight()
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      idx = Math.max(idx - 1, 0)
      highlight()
      return true
    }
    if (acceptKey && cur) {
      e.preventDefault()
      accept(cur)
      return true
    }
    if (e.key === 'Escape') {
      hide()
      return true
    }
    return false
  }

  return {
    update,
    hide,
    handleKey,
    get items() {
      return items
    },
    remove: () => el.remove(),
  }
}
