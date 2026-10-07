// The in-cell editor: opens the <textarea> over the selected cell, keeps it
// pinned there, and commits or cancels what was typed.
//
// Two modes, as in Excel / Google Sheets:
//   'enter' (typing straight into a cell): arrow keys commit and move;
//   'edit'  (F2, double-click, Enter on a filled cell): arrows move the caret.
// Inside a formula, arrows pick cell references instead (range-picker.ts).
//
// Keys the editor owns: Enter commits (Ctrl/Cmd/Alt+Enter inserts a newline),
// Tab commits, Escape cancels. Where the selection goes after a commit is the
// grid's call (`leave`), since Tab/Enter column memory is shared with the
// grid's own keyboard handling.

import { autoCloseKey } from '../../utils/formula-autoclose.js'
import type { Cell } from '../selection.js'
import type { Autocomplete } from './autocomplete.js'
import { canInsertRef, type RangePicker } from './range-picker.js'

export type EditMode = 'enter' | 'edit'

/** Where the selection should go after the editor commits. */
export type LeaveMove =
  { kind: 'arrow'; dr: number; dc: number } | { kind: 'enter' } | { kind: 'tab'; back: boolean }

/** The cell format fields the overlay copies onto the textarea. */
export interface EditorFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number
  fontFamily?: string
  align?: string
  color?: string
  backgroundColor?: string
  bg?: string
}

/** overlay.js: the textarea and its show/hide/position helpers. */
export interface EditorOverlay {
  el: HTMLTextAreaElement
  position(x: number, y: number, w: number, h: number, fmt: EditorFormat, zoom: number): void
  show(value: string): void
  hide(): void
  getValue(): string
}

/** A cell's rect in logical units (before zoom). */
export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

export interface EditorOptions {
  overlay: EditorOverlay
  picker: Pick<
    RangePicker,
    'isKeyPicking' | 'keyStart' | 'keyMove' | 'keyCommit' | 'keyCancel' | 'clear'
  >
  autocomplete: Pick<Autocomplete, 'update' | 'hide' | 'handleKey'>
  /** The cell being edited (the selection anchor). */
  activeCell(): Cell
  cellRect(r: number, c: number): CellRect
  formatAt(r: number, c: number): EditorFormat
  getZoom(): number
  /** False for read-only viewers: the editor never opens. */
  canEdit(): boolean
  /** False for a protected cell: opening calls onBlockedEdit instead. */
  isCellEditable(r: number, c: number): boolean
  onBlockedEdit(): void
  /** Collapse a range selection to its anchor before editing. */
  collapseSelection(): void
  ensureVisible(r: number, c: number): void
  /** The text changed (the host mirrors it in the formula bar). */
  onInput(value: string): void
  onCommit(value: string): void
  onCancel(): void
  /** Committed with Enter, Tab or an arrow: move the selection. */
  leave(move: LeaveMove): void
  /** Give keyboard focus back to the grid. */
  focusGrid(): void
  render(): void
}

export interface Editor {
  /** Open on the active cell with `value`; no-op when editing isn't allowed. */
  open(value: string, mode?: EditMode): void
  /** Commit and close. Doesn't repaint; no-op when closed. */
  commit(): void
  isOpen(): boolean
  /** The text being edited. */
  value(): string
  /** Re-pin the textarea to its cell after scroll, zoom or layout changes. */
  reposition(): void
}

const ARROWS: { readonly [key: string]: readonly [number, number] } = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

export function createEditor(o: EditorOptions): Editor {
  const el = o.overlay.el
  let open = false
  let mode: EditMode = 'enter'

  function reposition(): void {
    if (!open) return
    const { r, c } = o.activeCell()
    const z = o.getZoom()
    const rect = o.cellRect(r, c)
    o.overlay.position(rect.x * z, rect.y * z, rect.w * z, rect.h * z, o.formatAt(r, c), z)
  }

  function openEditor(value: string, m: EditMode = 'enter'): void {
    // The single choke point for every way into editing (typing, F2,
    // Enter, double-click), so viewers and protected cells are blocked here.
    if (!o.canEdit()) return
    const { r, c } = o.activeCell()
    if (!o.isCellEditable(r, c)) {
      o.onBlockedEdit()
      return
    }
    mode = m
    o.collapseSelection()
    // Typing or F2 doesn't move the selection, which may be scrolled off
    // screen; bring it back or the editor opens out of view.
    o.ensureVisible(r, c)
    open = true
    reposition()
    o.overlay.show(value)
    o.onInput(value)
    o.render()
  }

  function commit(): void {
    if (!open) return
    o.autocomplete.hide()
    open = false
    const value = o.overlay.getValue()
    o.overlay.hide()
    o.picker.clear()
    o.onCommit(value)
  }

  function commitAndLeave(move: LeaveMove): void {
    commit()
    o.leave(move)
    o.focusGrid()
  }

  // Replace the text and caret as if typed, so listeners (autocomplete, the
  // formula bar, autosize) see the change.
  function setText(value: string, caret: number): void {
    el.value = value
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (o.autocomplete.handleKey(e)) return
    // Auto-close parens inside a formula, before the picker or navigation
    // see the key, so `(` never leaks into them.
    const closed = autoCloseKey(e.key, el.value, el.selectionStart, el.selectionEnd)
    if (closed) {
      e.preventDefault()
      if (o.picker.isKeyPicking()) o.picker.keyCommit()
      setText(closed.value, closed.caret)
      return
    }
    // A printable key (e.g. '+' after picking C1) ends the current pick, so
    // the next arrow starts a new reference instead of replacing this one.
    if (o.picker.isKeyPicking() && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      o.picker.keyCommit()
    }

    const arrow = ARROWS[e.key]
    if (mode === 'enter' && arrow) {
      const [dr, dc] = arrow
      e.preventDefault()
      if (o.picker.isKeyPicking()) {
        o.picker.keyMove(dr, dc, e.shiftKey, e.ctrlKey || e.metaKey)
        return
      }
      // In a formula, arrows pick where a ref can go (after `=`, `(`, `,`,
      // an operator); keyStart decides whether to replace a partial ref or
      // insert a new one. After `)` etc. they commit and move, like Sheets.
      if (canInsertRef(el.value, el.selectionStart ?? el.value.length)) {
        o.picker.keyStart(el, dr, dc, e.shiftKey)
        return
      }
      commitAndLeave({ kind: 'arrow', dr, dc })
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (o.picker.isKeyPicking()) o.picker.keyCommit()
      // Ctrl/Cmd/Alt+Enter: a newline inside the cell, not a commit.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        const { selectionStart: s0, selectionEnd: s1, value } = el
        setText(value.slice(0, s0) + '\n' + value.slice(s1), s0 + 1)
        return
      }
      commitAndLeave({ kind: 'enter' })
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (o.picker.isKeyPicking()) o.picker.keyCommit()
      commitAndLeave({ kind: 'tab', back: e.shiftKey })
    } else if (e.key === 'Escape') {
      o.autocomplete.hide()
      // Escape while picking cancels the pick and keeps editing.
      if (o.picker.isKeyPicking()) {
        o.picker.keyCancel()
        return
      }
      open = false
      o.overlay.hide()
      o.picker.clear()
      o.render()
      o.focusGrid()
      o.onCancel()
    }
  }

  el.addEventListener('input', () => {
    const value = o.overlay.getValue()
    o.onInput(value)
    o.autocomplete.update(value, el.selectionStart)
  })

  el.addEventListener('keydown', onKeyDown)

  // Losing focus commits. Unlike commit(), this repaints and leaves the
  // picker state alone (unchanged from before the split).
  el.addEventListener('blur', () => {
    if (!open) return
    o.autocomplete.hide()
    open = false
    const value = o.overlay.getValue()
    o.overlay.hide()
    o.render()
    o.onCommit(value)
  })

  return {
    open: openEditor,
    commit,
    isOpen: () => open,
    value: () => o.overlay.getValue(),
    reposition,
  }
}
