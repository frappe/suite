import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRangePicker,
  refForRange,
  refReplaceStart,
  sheetPrefix,
  type RangePickerOptions,
} from './range-picker.js'

const colLabel = (c: number) => String.fromCharCode(65 + c) // A..Z is enough here

describe('reference text', () => {
  it('writes one cell or a range', () => {
    expect(refForRange({ r0: 0, c0: 0, r1: 0, c1: 0 }, null, colLabel)).toBe('A1')
    expect(refForRange({ r0: 1, c0: 0, r1: 4, c1: 2 }, null, colLabel)).toBe('A2:C5')
  })

  it('prefixes another sheet, quoting names that need it', () => {
    expect(sheetPrefix('Sheet2')).toBe('Sheet2!')
    expect(sheetPrefix('My Sheet')).toBe("'My Sheet'!")
    expect(sheetPrefix("Bob's")).toBe("'Bob''s'!")
    expect(refForRange({ r0: 0, c0: 1, r1: 0, c1: 1 }, 'Data', colLabel)).toBe('Data!B1')
  })

  it('replaces a partial ref that ends at the caret, sheet prefix included', () => {
    expect(refReplaceStart('=SUM(', 5)).toBe(5)
    expect(refReplaceStart('=SUM(A1:B', 9)).toBe(5)
    expect(refReplaceStart("=SUM('My Sheet'!A1", 18)).toBe(5)
    expect(refReplaceStart('=A1+', 4)).toBe(4)
  })
})

describe('range picker', () => {
  let input: HTMLInputElement
  let editor: HTMLTextAreaElement
  let active: Element | null
  let render: ReturnType<typeof vi.fn>

  function make(over: Partial<RangePickerOptions> = {}) {
    return createRangePicker({
      activeElement: () => active,
      editorElement: editor,
      editingCell: () => ({ r: 0, c: 0 }),
      crossSheetName: () => null,
      colLabel,
      totalRows: () => 100,
      totalCols: () => 26,
      skipHiddenRow: (r) => Math.max(0, Math.min(99, r)),
      skipHiddenCol: (c) => Math.max(0, Math.min(25, c)),
      resolveMaster: (r, c) => ({ r, c }),
      jumpEdge: (r, c, dr, dc) => ({ r: dr > 0 ? 99 : r, c: dc > 0 ? 25 : c }),
      scrollIntoView: () => {},
      render,
      ...over,
    })
  }

  const typed = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value
    el.setSelectionRange(value.length, value.length)
    active = el
  }

  beforeEach(() => {
    input = document.createElement('input')
    editor = document.createElement('textarea')
    document.body.append(input, editor)
    active = null
    render = vi.fn()
  })

  describe('target', () => {
    it('is the formula bar while it holds a formula', () => {
      const p = make()
      typed(input, '=SUM(')
      expect(p.target()).toBe(input)
      typed(input, 'hello')
      expect(p.target()).toBeNull()
    })

    it('is the in-cell editor too, though it is a textarea', () => {
      // Regression: the editor became a <textarea>; a check for <input>
      // alone made in-cell clicks commit the half-typed formula.
      const p = make()
      typed(editor, '=SUM(')
      expect(p.target()).toBe(editor)
    })

    it('ignores any other textarea, e.g. a comment box', () => {
      const p = make()
      const other = document.createElement('textarea')
      typed(other, '=not a formula bar')
      expect(p.target()).toBeNull()
    })
  })

  describe('mouse', () => {
    it('a click writes the cell ref and highlights it', () => {
      const p = make()
      typed(input, '=SUM(')
      p.pickCell(input, 1, 1, false)
      expect(input.value).toBe('=SUM(B2')
      expect(p.rect).toEqual({ r0: 1, c0: 1, r1: 1, c1: 1 })
    })

    it('a second click extends from the first while nothing was typed between', () => {
      const p = make()
      typed(input, '=SUM(')
      p.pickCell(input, 0, 0, false)
      p.endDrag()
      p.pickCell(input, 2, 0, false)
      expect(input.value).toBe('=SUM(A1:A3')
    })

    it('after typing an operator, the next click starts a fresh ref', () => {
      const p = make()
      typed(input, '=SUM(')
      p.pickCell(input, 0, 0, false)
      p.endDrag()
      typed(input, input.value + ',')
      p.pickCell(input, 4, 1, false)
      expect(input.value).toBe('=SUM(A1,B5')
    })

    it('dragging rewrites the ref as a range', () => {
      const p = make()
      typed(input, '=')
      p.pickCell(input, 0, 0, false)
      p.dragTo(3, 2)
      expect(input.value).toBe('=A1:C4')
      expect(p.isDragging()).toBe(true)
      p.endDrag()
      expect(p.isDragging()).toBe(false)
    })

    it('a column header writes a whole-column ref', () => {
      const p = make({ crossSheetName: () => 'Data' })
      typed(input, '=SUM(')
      p.pickColumn(input, 2)
      expect(input.value).toBe('=SUM(Data!C:C')
      expect(p.rect).toEqual({ r0: 0, c0: 2, r1: 99, c1: 2 })
    })
  })

  describe('keyboard', () => {
    it('an arrow starts next to the edited cell, Shift+arrow extends', () => {
      const p = make()
      typed(editor, '=')
      p.keyStart(editor, 1, 0, false) // ↓ from A1
      expect(editor.value).toBe('=A2')
      p.keyMove(1, 0, true, false) // Shift+↓
      expect(editor.value).toBe('=A2:A3')
      expect(p.isKeyPicking(editor)).toBe(true)
    })

    it('Esc puts the input back as it was', () => {
      const p = make()
      typed(editor, '=1+')
      p.keyStart(editor, 0, 1, false)
      expect(editor.value).toBe('=1+B1')
      p.keyCancel()
      expect(editor.value).toBe('=1+')
      expect(p.rect).toBeNull()
    })

    it('Ctrl+arrow jumps to the edge', () => {
      const p = make()
      typed(editor, '=')
      p.keyStart(editor, 1, 0, false)
      p.keyMove(1, 0, false, true)
      expect(editor.value).toBe('=A100')
    })
  })

  describe('suggestions and clearing', () => {
    it('a dropped suggestion clears its highlight; an accepted one stays', () => {
      const p = make()
      p.showSuggestion({ r0: 0, c0: 0, r1: 4, c1: 0 })
      expect(p.dropSuggestion()).toBe(true)
      expect(p.rect).toBeNull()
      expect(p.dropSuggestion()).toBe(false)

      p.showSuggestion({ r0: 0, c0: 0, r1: 4, c1: 0 })
      p.acceptSuggestion({ r0: 0, c0: 0, r1: 4, c1: 0 })
      expect(p.dropSuggestion()).toBe(false)
      expect(p.rect).toEqual({ r0: 0, c0: 0, r1: 4, c1: 0 })
    })

    it('clear forgets everything and repaints once', () => {
      const p = make()
      typed(input, '=')
      p.pickCell(input, 0, 0, false)
      render.mockClear()
      p.clear()
      p.clear()
      expect(p.rect).toBeNull()
      expect(p.isDragging()).toBe(false)
      expect(render).toHaveBeenCalledTimes(1)
    })
  })
})
