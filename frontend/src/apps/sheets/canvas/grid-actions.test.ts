import { describe, expect, it, vi } from 'vitest'

import { createViewModel } from '../core/view-model.js'
import { createGridActions } from './grid-actions.js'
import { createSelection } from './selection.js'
import type { CellProvider, GridHost } from './types.js'

function setup({
  values = {} as { [id: string]: string },
  cells = {} as CellProvider,
  host = {} as GridHost,
  hiddenRows = [] as number[],
} = {}) {
  const vm = createViewModel()
  vm.setHiddenRows(hiddenRows)
  const sel = createSelection({
    clamp: (r, c) => ({ r: Math.max(0, r), c: Math.max(0, c) }),
    totalRows: () => vm.totalRows,
    totalCols: () => vm.totalCols,
    state: vm.sel,
  })
  const vp = { ensureVisible: vi.fn() }
  const render = vi.fn()
  const act = createGridActions({
    vm,
    sel,
    cells,
    host,
    render,
    geo: { rh: (r) => (vm.hiddenRows.has(r) ? 0 : 24), cw: () => 100 },
    vp,
    getValue: (id) => values[id],
    cellIds: () => Object.keys(values),
  })
  return { vm, sel, act, vp, render }
}

describe('selection moves', () => {
  it('moveSel collapses, scrolls, notifies listeners, repaints and tells the host', () => {
    const onSelect = vi.fn()
    const h = setup({ host: { onSelect } })
    const listener = vi.fn()
    h.act.onMove(listener)
    h.act.moveSel(3, 2)
    expect(h.vm.sel.anchor).toEqual({ r: 3, c: 2 })
    expect(h.vp.ensureVisible).toHaveBeenCalledWith(3, 2)
    expect(listener).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('C4')
  })

  it('extending a whole-column selection scrolls along row 0', () => {
    const h = setup()
    h.sel.mode = 'col'
    h.act.extendSel(99, 4)
    expect(h.vp.ensureVisible).toHaveBeenLastCalledWith(0, 4)
  })

  it('setSelRange ignores an incomplete range', () => {
    const h = setup()
    h.act.setSelRange({ r0: 1 })
    expect(h.render).not.toHaveBeenCalled()
  })
})

describe('lookups', () => {
  it('editValue prefers the input over the display', () => {
    const h = setup({ values: { A1: '4' }, cells: { getEditValue: () => '=2+2' } })
    expect(h.act.editValue(0, 0)).toBe('=2+2')
    expect(setup({ values: { A1: '4' } }).act.editValue(0, 0)).toBe('4')
  })

  it('skips hidden rows', () => {
    const h = setup({ hiddenRows: [1, 2] })
    expect(h.act.skipHiddenRow(1, 1)).toBe(3)
    expect(h.act.skipHiddenRow(2, -1)).toBe(0)
  })

  it('resolves a merged cell to its master', () => {
    const h = setup({ cells: { getMasterId: (id) => (id === 'B2' ? 'A1' : null) } })
    expect(h.act.resolveMaster(1, 1)).toEqual({ r: 0, c: 0 })
    expect(h.act.resolveMaster(5, 5)).toEqual({ r: 5, c: 5 })
  })

  it('names the picked sheet only during a cross-sheet edit', () => {
    expect(
      setup({
        host: { getCurrentSheet: () => 'S2', getEditingHomeSheet: () => 'S1' },
      }).act.crossSheetName(),
    ).toBe('S2')
    expect(
      setup({
        host: { getCurrentSheet: () => 'S1', getEditingHomeSheet: () => 'S1' },
      }).act.crossSheetName(),
    ).toBeNull()
  })

  it('finds the last used cell and data edges', () => {
    const h = setup({ values: { A1: 'x', A2: 'x', A3: 'x', C7: 'y' } })
    expect(h.act.lastUsedCell()).toEqual({ r: 6, c: 2 })
    expect(h.act.jumpEdge(0, 0, 1, 0)).toEqual({ r: 2, c: 0 })
  })

  it('a protected cell makes the block uneditable', () => {
    const h = setup({ cells: { isCellEditable: (r, c) => !(r === 1 && c === 1) } })
    expect(h.act.rangeEditable(0, 0, 2, 2)).toBe(false)
    expect(h.act.rangeEditable(0, 0, 0, 2)).toBe(true)
  })
})
