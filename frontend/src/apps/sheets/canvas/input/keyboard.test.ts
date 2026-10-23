import { describe, expect, it, vi } from 'vitest'

import { createSelection, type SelRange } from '../selection.js'
import { createKeyboard, type KeyboardHost, type KeyboardOptions } from './keyboard.js'

// A real selection on a 100×26 sheet; moveSel/extendSel/setSelRange drive it
// directly. Hidden rows/columns and data are faked per test.
function setup(over: Partial<KeyboardOptions> = {}, host: KeyboardHost = {}) {
  document.body.innerHTML = ''
  const canvas = document.createElement('canvas')
  const editorEl = document.createElement('textarea')
  document.body.append(canvas, editorEl)
  const sel = createSelection({
    clamp: (r, c) => ({ r: Math.max(0, r), c: Math.max(0, c) }),
    totalRows: () => 100,
    totalCols: () => 26,
  })
  let keyPicking = false
  const picker = {
    target: vi.fn((): HTMLInputElement | null => null),
    isKeyPicking: () => keyPicking,
    keyStart: vi.fn(() => {
      keyPicking = true
    }),
    keyMove: vi.fn(),
    keyCommit: vi.fn(() => {
      keyPicking = false
    }),
    keyCancel: vi.fn(() => {
      keyPicking = false
    }),
  }
  const editor = { open: vi.fn() }
  const opts: KeyboardOptions = {
    canvas,
    editorElement: editorEl,
    picker,
    editor,
    sel,
    host,
    totalRows: () => 100,
    totalCols: () => 26,
    canEdit: () => true,
    rangeEditable: () => true,
    moveSel: (r, c) => sel.moveTo(r, c),
    extendSel: (r, c) => sel.extendTo(r, c),
    setSelRange: (range: SelRange) => sel.set(range),
    jumpEdge: () => ({ r: 9, c: 0 }),
    lastUsedCell: () => ({ r: 4, c: 2 }),
    hasValue: () => true,
    skipHiddenRow: (r) => r,
    skipHiddenCol: (c) => c,
    pageRows: () => 20,
    editValue: () => '=A1+1',
    forgetCells: vi.fn(),
    render: vi.fn(),
    ...over,
  }
  const keys = createKeyboard(opts)
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = canvas) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  return { keys, sel, editor, picker, opts, press, editorEl }
}

describe('moving', () => {
  it('arrows move one cell', () => {
    const h = setup()
    h.press('ArrowDown')
    h.press('ArrowRight')
    expect(h.sel.anchor).toEqual({ r: 1, c: 1 })
  })

  it('arrows step over hidden rows', () => {
    const h = setup({ skipHiddenRow: (r, dr) => (r === 1 ? r + dr : r) })
    h.press('ArrowDown')
    expect(h.sel.anchor.r).toBe(2)
  })

  it('Shift+arrow extends', () => {
    const h = setup()
    h.press('ArrowDown', { shiftKey: true })
    expect(h.sel.range()).toMatchObject({ r0: 0, r1: 1 })
  })

  it('Ctrl+arrow jumps to the data edge', () => {
    const h = setup()
    h.press('ArrowDown', { ctrlKey: true })
    expect(h.sel.anchor).toEqual({ r: 9, c: 0 })
  })

  it('Ctrl+End goes to the last used cell', () => {
    const h = setup()
    h.press('End', { ctrlKey: true })
    expect(h.sel.anchor).toEqual({ r: 4, c: 2 })
  })

  it('PageDown moves a screenful', () => {
    const h = setup()
    h.press('PageDown')
    expect(h.sel.anchor.r).toBe(20)
  })

  it('Tab, Tab, Enter returns to the column the run started in', () => {
    const h = setup()
    h.sel.moveTo(0, 2)
    h.press('Tab')
    h.press('Tab')
    h.sel.extendTo(1, 4) // a range, so Enter navigates instead of editing
    h.press('Enter')
    expect(h.sel.anchor).toEqual({ r: 1, c: 2 })
  })
})

describe('selecting', () => {
  it('Ctrl+A selects the data, then everything', () => {
    const h = setup()
    h.press('a', { ctrlKey: true })
    expect(h.sel.range()).toMatchObject({ r0: 0, c0: 0, r1: 4, c1: 2, mode: 'cell' })
    h.press('a', { ctrlKey: true })
    expect(h.sel.range()).toMatchObject({ r1: 99, c1: 25, mode: 'all' })
  })

  it('Ctrl+A on an empty sheet selects everything at once', () => {
    const h = setup({ lastUsedCell: () => ({ r: 0, c: 0 }), hasValue: () => false })
    h.press('a', { ctrlKey: true })
    expect(h.sel.range().mode).toBe('all')
  })

  it('Shift+Space selects the row, Ctrl+Space the column', () => {
    const onSelect = vi.fn()
    const h = setup({}, { onSelect })
    h.sel.moveTo(2, 1)
    h.press(' ', { code: 'Space', shiftKey: true })
    expect(h.sel.mode).toBe('row')
    expect(onSelect).toHaveBeenLastCalledWith('3:3')
    h.press(' ', { code: 'Space', ctrlKey: true })
    expect(h.sel.mode).toBe('col')
    expect(onSelect).toHaveBeenLastCalledWith('B:B')
    expect(h.editor.open).not.toHaveBeenCalled()
  })
})

describe('editing', () => {
  it('a printable key starts typing into the cell', () => {
    const h = setup()
    h.press('7')
    expect(h.editor.open).toHaveBeenCalledWith('7')
  })

  it('plain Space types a space', () => {
    const h = setup()
    h.press(' ', { code: 'Space' })
    expect(h.editor.open).toHaveBeenCalledWith(' ')
  })

  it('Enter and F2 edit the formula', () => {
    const h = setup()
    h.press('Enter')
    h.press('F2')
    expect(h.editor.open).toHaveBeenCalledTimes(2)
    expect(h.editor.open).toHaveBeenCalledWith('=A1+1', 'edit')
  })

  it('Enter only moves for a viewer', () => {
    const h = setup({ canEdit: () => false })
    h.press('Enter')
    expect(h.editor.open).not.toHaveBeenCalled()
    expect(h.sel.anchor.r).toBe(1)
  })
})

describe('clearing', () => {
  it('Delete on one cell commits an empty value', () => {
    const onCommit = vi.fn()
    const h = setup({}, { onCommit })
    h.press('Delete')
    expect(onCommit).toHaveBeenCalledWith('A1', '')
  })

  it('Delete on a range batch-clears and forgets the cells', () => {
    const onBatchCommit = vi.fn()
    const h = setup({}, { onBatchCommit })
    h.sel.extendTo(1, 1)
    h.press('Backspace')
    expect(onBatchCommit).toHaveBeenCalledWith([
      { id: 'A1', value: '' },
      { id: 'B1', value: '' },
      { id: 'A2', value: '' },
      { id: 'B2', value: '' },
    ])
    expect(h.opts.forgetCells).toHaveBeenCalledWith(['A1', 'B1', 'A2', 'B2'])
  })

  it('a protected range is reported, not cleared', () => {
    const onCommit = vi.fn()
    const onBlockedEdit = vi.fn()
    const h = setup({ rangeEditable: () => false }, { onCommit, onBlockedEdit })
    h.press('Delete')
    expect(onBlockedEdit).toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('viewers cannot clear', () => {
    const onCommit = vi.fn()
    const h = setup({ canEdit: () => false }, { onCommit })
    h.press('Delete')
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('afterEdit', () => {
  it('moves by the way the editor was left', () => {
    const h = setup()
    h.keys.afterEdit({ kind: 'tab', back: false })
    h.keys.afterEdit({ kind: 'tab', back: false })
    expect(h.sel.anchor).toEqual({ r: 0, c: 2 })
    h.keys.afterEdit({ kind: 'enter' })
    expect(h.sel.anchor).toEqual({ r: 1, c: 0 })
    h.keys.afterEdit({ kind: 'arrow', dr: 0, dc: 1 })
    expect(h.sel.anchor).toEqual({ r: 1, c: 1 })
  })

  it('a click ends the Tab run', () => {
    const h = setup()
    h.keys.afterEdit({ kind: 'tab', back: false })
    h.keys.resetTabAnchor()
    h.keys.afterEdit({ kind: 'enter' })
    expect(h.sel.anchor).toEqual({ r: 1, c: 1 })
  })
})

describe('formula bar picking', () => {
  it('an arrow in a `=` formula bar starts a pick, the next moves it', () => {
    const h = setup()
    const bar = document.createElement('input')
    document.body.appendChild(bar)
    h.picker.target.mockReturnValue(bar)
    h.press('ArrowDown', {}, bar)
    expect(h.picker.keyStart).toHaveBeenCalledWith(bar, 1, 0, false)
    h.press('ArrowRight', { shiftKey: true }, bar)
    expect(h.picker.keyMove).toHaveBeenCalledWith(0, 1, true, false)
    h.press('+', {}, bar)
    expect(h.picker.keyCommit).toHaveBeenCalled()
  })

  it('ignores the in-cell editor, which picks for itself', () => {
    const h = setup()
    h.picker.target.mockReturnValue(document.createElement('input'))
    h.press('ArrowDown', {}, h.editorEl)
    expect(h.picker.keyStart).not.toHaveBeenCalled()
  })

  it('leaves Home and End to the caret', () => {
    const h = setup()
    const bar = document.createElement('input')
    document.body.appendChild(bar)
    h.picker.target.mockReturnValue(bar)
    h.press('Home', {}, bar)
    expect(h.picker.keyStart).not.toHaveBeenCalled()
    h.keys.destroy()
  })
})
