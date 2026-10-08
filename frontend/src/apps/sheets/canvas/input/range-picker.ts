// Formula reference picking: while a formula (`=…`) is being typed, clicking,
// dragging or arrowing over cells writes their reference (A1, A1:B5, A:A,
// Sheet2!A1) into the formula instead of moving the selection.
//
// Works for the formula bar (an <input>) and the in-cell editor (a
// <textarea>). Three ways in, one highlight (`rect`) the renderer draws:
//   mouse:    pickColumn / pickRow / pickCell, then dragTo, endDrag
//   keyboard: keyStart, keyMove, keyCancel (Esc), keyCommit
//   autocomplete: showSuggestion / dropSuggestion / acceptSuggestion, a
//     passive highlight for the "Tab to fill range" suggestion
//
// Rows and columns are 0-based.

import type { Cell } from '../selection.js'

export interface PickRect {
  r0: number
  c0: number
  r1: number
  c1: number
}

export type PickInput = HTMLInputElement | HTMLTextAreaElement

export interface RangePickerOptions {
  /** document.activeElement; injectable for tests. */
  activeElement(): Element | null
  /** The in-cell editor's <textarea>; the only textarea that may pick. */
  editorElement: HTMLTextAreaElement
  /** The cell being edited: keyboard picks start next to it. */
  editingCell(): Cell
  /** The sheet being viewed when it differs from the formula's home sheet. */
  crossSheetName(): string | null
  colLabel(c: number): string
  totalRows(): number
  totalCols(): number
  /** Step past hidden rows/columns (dr/dc are ±1) and clamp to the sheet. */
  skipHiddenRow(r: number, dr: number): number
  skipHiddenCol(c: number, dc: number): number
  /** A merged cell's master for any cell inside the merge. */
  resolveMaster(r: number, c: number): Cell
  /** Ctrl/Cmd+Arrow target from (r, c). */
  jumpEdge(r: number, c: number, dr: number, dc: number): Cell
  scrollIntoView(r: number, c: number): void
  render(): void
}

// ── Reference text (pure) ─────────────────────────────────────────────────────

// A reference ending at the caret, with an optional sheet prefix: a cell or
// range (A1, A1:B, B2:E5), a column range (A:A) or a row range (3:3). Bare
// letters are not one: `SUM` or `AVER` is a function name being typed.
const REF_BEFORE_CARET =
  /(?:'(?:[^']|'')*'!|[A-Za-z_][A-Za-z0-9_]*!)?(?:[A-Z]+\d+(?::[A-Z]*\d*)?|[A-Z]+:[A-Z]*\d*|\d+:\d*)$/i

/**
 * Where a picked reference should start replacing: just before any partial
 * reference that ends at the caret, including a sheet prefix, so a second
 * pick replaces `Sheet1!B2:E` whole instead of producing `Sheet1!Sheet1!…`.
 */
export function refReplaceStart(value: string, caret: number): number {
  const m = value.slice(0, caret).match(REF_BEFORE_CARET)
  return m ? caret - m[0].length : caret
}

/**
 * Whether a reference may go at the caret: the text before it (ignoring a
 * partial ref the pick would replace, and spaces) ends in `=`, `(`, `,` or an
 * operator. After `)`, a number or a closed string a click or arrow commits
 * the formula instead, as in Google Sheets.
 */
export function canInsertRef(value: string, caret: number): boolean {
  if (!value.startsWith('=')) return false
  const before = value.slice(0, refReplaceStart(value, caret)).trimEnd()
  return /[=(,;+\-*/^&<>{]$/.test(before)
}

/** `Sheet2!` for a plain name, `'My Sheet'!` (quotes doubled) otherwise. */
export function sheetPrefix(name: string | null): string {
  if (!name) return ''
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `${name}!`
  return `'${name.replace(/'/g, "''")}'!`
}

export function refForRange(
  r: PickRect,
  sheet: string | null,
  colLabel: (c: number) => string,
): string {
  const a = colLabel(r.c0) + (r.r0 + 1)
  const range = r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:${colLabel(r.c1)}${r.r1 + 1}`
  return sheetPrefix(sheet) + range
}

/** Replace value[replaceStart, caret) with `refText` and tell listeners. */
export function writeRef(input: PickInput, refText: string, replaceStart: number): void {
  const caret = input.selectionStart ?? input.value.length
  input.value = input.value.slice(0, replaceStart) + refText + input.value.slice(caret)
  const pos = replaceStart + refText.length
  input.setSelectionRange(pos, pos)
  // Vue v-model on the formula bar and the editor's own input handler.
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const span = (a: Cell, b: Cell): PickRect => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
})

// ── State machine ─────────────────────────────────────────────────────────────

interface Drag {
  anchor: Cell
  target: PickInput
}

// Keyboard picking ("PICKING"): the reference being edited occupies
// value[insertStart, insertEnd). savedValue/savedCaret let Esc undo it.
interface KeyPick {
  target: PickInput
  anchor: Cell
  head: Cell
  insertStart: number
  insertEnd: number
  savedValue: string
  savedCaret: number
}

export interface RangePicker {
  /** The highlighted range, or null. */
  readonly rect: PickRect | null
  /** The focused formula input a click should write into, or null. */
  target(): PickInput | null
  /** Forget every pick and highlight, and repaint if anything changed. */
  clear(): void
  /** Drop the highlight without repainting (the caller repaints). */
  dismissHighlight(): void

  pickColumn(input: PickInput, c: number): void
  pickRow(input: PickInput, r: number): void
  /** A click on a cell (already resolved to its merge master). */
  pickCell(input: PickInput, r: number, c: number, extend: boolean): void
  isDragging(): boolean
  dragTo(r: number, c: number): void
  /** Mouse released: end the drag and give focus back to the input. */
  endDrag(): void

  isKeyPicking(target?: PickInput): boolean
  keyStart(target: PickInput, dr: number, dc: number, extend: boolean): void
  keyMove(dr: number, dc: number, extend: boolean, toEdge: boolean): void
  keyCancel(): void
  keyCommit(): void

  showSuggestion(rect: PickRect): void
  /** True if a suggestion was showing (the caller repaints). */
  dropSuggestion(): boolean
  acceptSuggestion(rect: PickRect): void
}

export function createRangePicker(o: RangePickerOptions): RangePicker {
  let rect: PickRect | null = null
  let drag: Drag | null = null
  let key: KeyPick | null = null
  // Origin for Shift+click. Outlives `drag` (mouseup clears that), so a
  // later Shift+click extends from the first-clicked cell.
  let mouseAnchor: Cell | null = null
  // `rect` is a passive autocomplete suggestion, not a real pick.
  let suggesting = false

  const ref = (r: PickRect) => refForRange(r, o.crossSheetName(), o.colLabel)
  const caretOf = (input: PickInput) => input.selectionStart ?? input.value.length

  function target(): PickInput | null {
    const el = o.activeElement()
    const ok = el instanceof HTMLInputElement || el === o.editorElement
    if (!ok) return null
    const input = el as PickInput
    // A pick in progress owns the input even mid-reference.
    if (key?.target === input) return input
    return canInsertRef(input.value, caretOf(input)) ? input : null
  }

  function clear(): void {
    if (!rect && !drag && !key) return
    rect = null
    drag = null
    key = null
    mouseAnchor = null
    suggesting = false
    o.render()
  }

  // ── Mouse ───────────────────────────────────────────────────────────────

  function pickWhole(input: PickInput, text: string, anchor: Cell, r: PickRect): void {
    writeRef(input, text, refReplaceStart(input.value, caretOf(input)))
    drag = { anchor, target: input }
    rect = r
    o.render()
  }

  function pickColumn(input: PickInput, c: number): void {
    const L = o.colLabel(c)
    pickWhole(
      input,
      `${sheetPrefix(o.crossSheetName())}${L}:${L}`,
      { r: 0, c },
      { r0: 0, c0: c, r1: o.totalRows() - 1, c1: c },
    )
  }

  function pickRow(input: PickInput, r: number): void {
    pickWhole(
      input,
      `${sheetPrefix(o.crossSheetName())}${r + 1}:${r + 1}`,
      { r, c: 0 },
      { r0: r, c0: 0, r1: r, c1: o.totalCols() - 1 },
    )
  }

  // Google Sheets style: a plain click writes a one-cell ref, replacing a
  // ref picked just before it (A1 → A3). Only Shift+click extends (A1:A3).
  function pickCell(input: PickInput, r: number, c: number, extend: boolean): void {
    const start = refReplaceStart(input.value, caretOf(input))
    const anchor = extend && mouseAnchor ? mouseAnchor : { r, c }
    const next = span(anchor, { r, c })
    writeRef(input, ref(next), start)
    drag = { anchor, target: input }
    rect = next
    mouseAnchor = anchor
    key = null // a mouse pick supersedes a keyboard pick
    o.render()
  }

  function dragTo(r: number, c: number): void {
    if (!drag) return
    const next = span(drag.anchor, { r, c })
    writeRef(drag.target, ref(next), refReplaceStart(drag.target.value, caretOf(drag.target)))
    rect = next
    o.render()
  }

  function endDrag(): void {
    if (!drag) return
    const t = drag.target
    drag = null
    t.focus()
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  // Rewrite the reference span from anchor + head and highlight it.
  function keyRender(): void {
    if (!key) return
    const next = span(key.anchor, key.head)
    const text = ref(next)
    const v = key.target.value
    key.target.value = v.slice(0, key.insertStart) + text + v.slice(key.insertEnd)
    key.insertEnd = key.insertStart + text.length
    key.target.setSelectionRange(key.insertEnd, key.insertEnd)
    key.target.dispatchEvent(new Event('input', { bubbles: true }))
    rect = next
    o.scrollIntoView(key.head.r, key.head.c)
    o.render()
  }

  function clampTo(r: number, c: number): Cell {
    return {
      r: Math.max(0, Math.min(o.totalRows() - 1, r)),
      c: Math.max(0, Math.min(o.totalCols() - 1, c)),
    }
  }

  // EDITING → PICKING. A fresh pick starts one step from the edited cell in
  // the arrow's direction. If a mouse drag is still in progress on this
  // input, take over its anchor so Shift+arrow extends what was dragged.
  function keyStart(t: PickInput, dr: number, dc: number, extend: boolean): void {
    const savedCaret = caretOf(t)
    const savedValue = t.value
    let anchor: Cell, head: Cell, insertStart: number
    const insertEnd = savedCaret
    if (drag && drag.target === t && rect) {
      insertStart = Math.max(0, insertEnd - ref(rect).length)
      anchor = drag.anchor
      // The current head is the rect corner opposite the anchor.
      head = {
        r: (anchor.r === rect.r0 ? rect.r1 : rect.r0) + dr,
        c: (anchor.c === rect.c0 ? rect.c1 : rect.c0) + dc,
      }
    } else {
      insertStart = refReplaceStart(t.value, savedCaret)
      const at = o.editingCell()
      head = { r: at.r + dr, c: at.c + dc }
      anchor = head
    }
    head = clampTo(head.r, head.c)
    if (dr !== 0) head = { r: o.skipHiddenRow(head.r, dr), c: head.c }
    if (dc !== 0) head = { r: head.r, c: o.skipHiddenCol(head.c, dc) }
    head = o.resolveMaster(head.r, head.c)
    if (!extend) anchor = head // plain arrow collapses, Shift+arrow extends
    key = { target: t, anchor, head, insertStart, insertEnd, savedValue, savedCaret }
    keyRender()
  }

  function keyMove(dr: number, dc: number, extend: boolean, toEdge: boolean): void {
    if (!key) return
    let next: Cell
    if (toEdge) {
      next = o.jumpEdge(key.head.r, key.head.c, dr, dc)
    } else {
      let r = key.head.r + dr,
        c = key.head.c + dc
      if (dr !== 0) r = o.skipHiddenRow(r, dr)
      if (dc !== 0) c = o.skipHiddenCol(c, dc)
      next = clampTo(r, c)
    }
    next = o.resolveMaster(next.r, next.c)
    if (!extend) key.anchor = next
    key.head = next
    keyRender()
  }

  // Esc while picking: put the input back as it was before the pick.
  function keyCancel(): void {
    if (!key) return
    const { target: t, savedValue, savedCaret } = key
    t.value = savedValue
    t.setSelectionRange(savedCaret, savedCaret)
    t.dispatchEvent(new Event('input', { bubbles: true }))
    key = null
    rect = null
    o.render()
  }

  // Leave PICKING but keep the inserted reference (the user typed on). The
  // highlight stays until the selection moves or the edit ends.
  function keyCommit(): void {
    key = null
  }

  return {
    get rect() {
      return rect
    },
    target,
    clear,
    dismissHighlight() {
      rect = null
    },
    pickColumn,
    pickRow,
    pickCell,
    isDragging: () => drag !== null,
    dragTo,
    endDrag,
    isKeyPicking: (t) => key !== null && (t === undefined || key.target === t),
    keyStart,
    keyMove,
    keyCancel,
    keyCommit,
    showSuggestion(r) {
      rect = r
      suggesting = true
    },
    dropSuggestion() {
      if (!suggesting) return false
      suggesting = false
      rect = null
      return true
    },
    // The accepted suggestion becomes a real pick: cleared on commit or
    // cancel, extendable by the next click. Not a drag, or the next mouse
    // move would rewrite the reference.
    acceptSuggestion(r) {
      rect = { ...r }
      mouseAnchor = { r: r.r0, c: r.c0 }
      suggesting = false
    },
  }
}
