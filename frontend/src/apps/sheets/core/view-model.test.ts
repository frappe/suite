import { describe, expect, it } from 'vitest'

import { createViewModel, DEFAULT_TOTAL_ROWS } from './view-model.js'

describe('sizes', () => {
  it('defaults, then stores, never below the minimum', () => {
    const vm = createViewModel()
    expect(vm.colWidth(3)).toBe(100)
    expect(vm.rowHeight(3)).toBe(24)
    vm.setColWidth(3, 10)
    vm.setRowHeight(3, 5)
    expect(vm.colWidth(3)).toBe(30)
    expect(vm.rowHeight(3)).toBe(16)
  })

  it('inserting rows shifts heights at and after the insert point', () => {
    const vm = createViewModel()
    vm.setRowHeight(1, 40)
    vm.setRowHeight(2, 50)
    vm.shiftRows(2, 3)
    expect(vm.rowH).toEqual({ 1: 40, 5: 50 })
  })

  it('deleting columns shifts widths back without overwriting', () => {
    const vm = createViewModel()
    vm.setColWidth(2, 60)
    vm.setColWidth(3, 70)
    vm.shiftCols(2, -1)
    expect(vm.colW).toEqual({ 1: 60, 2: 70 })
  })

  it('a column move sends widths and hides through the map', () => {
    const vm = createViewModel()
    vm.setColWidth(0, 60)
    vm.setHiddenCols([1])
    vm.remapCols((c) => (c === 0 ? 1 : c === 1 ? 0 : c))
    expect(vm.colW).toEqual({ 1: 60 })
    expect([...vm.hiddenCols]).toEqual([0])
  })
})

describe('freeze, size, zoom', () => {
  it('freezing resets scroll', () => {
    const vm = createViewModel()
    vm.scroll.x = 300
    vm.scroll.y = 200
    vm.setFreeze(1, 2)
    expect(vm.freeze).toEqual({ rows: 1, cols: 2 })
    expect(vm.scroll).toEqual({ x: 0, y: 0 })
  })

  it('clamps the sheet size and zoom', () => {
    const vm = createViewModel()
    vm.setTotalRows(0)
    vm.setTotalCols(30.7)
    vm.setZoom(9)
    expect(vm.totalRows).toBe(1)
    expect(vm.totalCols).toBe(30)
    expect(vm.zoom).toBe(2.5)
  })
})

describe('serialize / restore', () => {
  it('round-trips widths, heights, freeze, hides, size and zoom', () => {
    const a = createViewModel()
    a.setColWidth(1, 150)
    a.setRowHeight(4, 60)
    a.setFreeze(2, 1)
    a.setHiddenRows([7, 9])
    a.setHiddenCols([3])
    a.setTotalRows(5000)
    a.setZoom(1.5)
    const b = createViewModel()
    b.restore(JSON.parse(JSON.stringify(a.serialize())))
    expect(b.serialize()).toEqual(a.serialize())
  })

  it('leaves filter hides out of the saved view', () => {
    const vm = createViewModel()
    vm.setHiddenRows([2, 5])
    vm.setFilterHiddenRows([5])
    expect(vm.serialize().hiddenRows).toEqual([2])
  })

  it('never saves the selection', () => {
    const vm = createViewModel()
    vm.sel.anchor = { r: 4, c: 4 }
    expect(JSON.stringify(vm.serialize())).not.toContain('anchor')
  })

  it('a view without a size goes back to the default, and drops old filter tags', () => {
    const vm = createViewModel()
    vm.setTotalRows(100_000)
    vm.setHiddenRows([3])
    vm.setFilterHiddenRows([3])
    vm.restore({ colW: {} })
    expect(vm.totalRows).toBe(DEFAULT_TOTAL_ROWS)
    expect(vm.filterHiddenRows.size).toBe(0)
    expect(vm.hiddenRows.size).toBe(0)
  })
})
