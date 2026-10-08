import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useSheetTabs } from './useSheetTabs.js'

// A stand-in for IronCalc: records the commands and applies the tab ones to
// its own list, the way the workbook would.
function setup(initial = ['Sheet1']) {
  const list = [...initial]
  const sent: Array<[string, Record<string, unknown>]> = []
  const run = (type: string, payload: Record<string, unknown>) => sent.push([type, payload])
  const currentSheet = ref(initial[0])
  const activeCell = ref('C3')
  const showInput = vi.fn()
  const tabs = useSheetTabs({
    names: () => [...list],
    run,
    currentSheet,
    formats: null,
    getGrid: () => null,
    activeCell,
    showInput,
    refreshActiveFormat: () => {},
  })
  return { tabs, list, sent, currentSheet, activeCell, showInput }
}

describe('sheet tabs', () => {
  it('adds a sheet with the next free name and opens it', () => {
    const { tabs, sent, currentSheet, activeCell, showInput } = setup(['Sheet1', 'Sheet2'])
    tabs.renameSheet('Sheet2', 'Data')
    sent.length = 0
    expect(tabs.addSheet()).toBe('Sheet3')
    expect(sent).toEqual([['addSheet', { name: 'Sheet3' }]])
    expect(tabs.sheetNames.value).toEqual(['Sheet1', 'Data', 'Sheet3'])
    expect(currentSheet.value).toBe('Sheet3')
    expect(activeCell.value).toBe('A1')
    expect(showInput).toHaveBeenCalledWith('A1')
  })

  it('skips a name that is taken', () => {
    const { tabs } = setup(['Sheet1', 'Sheet2', 'Sheet4'])
    expect(tabs.addSheet()).toBe('Sheet5')
  })

  it('renames the open sheet, and refuses a name in use', () => {
    const { tabs, sent, currentSheet } = setup(['Sheet1', 'Sheet2'])
    expect(tabs.renameSheet('Sheet1', 'Sheet2')).toBe(false)
    expect(tabs.renameSheet('Sheet1', '  Totals ')).toBe(true)
    expect(sent).toEqual([['renameSheet', { sheet: 'Sheet1', name: 'Totals' }]])
    expect(currentSheet.value).toBe('Totals')
  })

  it('duplicates next to the source under a free name', () => {
    const { tabs, sent } = setup(['A', 'A copy', 'B'])
    expect(tabs.duplicateSheet('A')).toBe('A copy 2')
    expect(sent).toEqual([['duplicateSheet', { sheet: 'A', name: 'A copy 2' }]])
    expect(tabs.sheetNames.value).toEqual(['A', 'A copy 2', 'A copy', 'B'])
  })

  it('deletes a sheet and opens the first when it was open, but never the last one', () => {
    const { tabs, sent, currentSheet } = setup(['A', 'B'])
    tabs.switchSheet('B')
    expect(tabs.deleteSheet('B')).toBe(true)
    expect(sent).toEqual([['deleteSheet', { sheet: 'B' }]])
    expect(currentSheet.value).toBe('A')
    expect(tabs.deleteSheet('A')).toBe(false)
  })

  it('reorders with one move per tab out of place', () => {
    const { tabs, sent } = setup(['A', 'B', 'C'])
    tabs.reorderSheets(['C', 'A', 'B'])
    expect(sent).toEqual([['moveSheet', { sheet: 'C', index: 0 }]])
    expect(tabs.sheetNames.value).toEqual(['C', 'A', 'B'])
  })

  it("takes IronCalc's list, and leaves a tab that no longer exists", () => {
    const { tabs, list, currentSheet } = setup(['A', 'B'])
    tabs.switchSheet('B')
    list.splice(1, 1, 'Renamed')
    tabs.syncNames()
    expect(tabs.sheetNames.value).toEqual(['A', 'Renamed'])
    expect(currentSheet.value).toBe('A')
  })
})
