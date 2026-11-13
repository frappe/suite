import { describe, expect, it, vi } from 'vitest'

import { createFormatsEngine } from '../../engine/formats.js'
import { useToolbar } from './useToolbar.js'

// A typed 50% or $1.50 is formatted by IronCalc, not the side store, so
// Clear formatting left it as it was (and a 3 typed there later showed 300%).
describe('clearFormatting', () => {
  function setup(engineFmts: Record<string, string>, scope?: unknown) {
    const formats = createFormatsEngine()
    const history = { pushOp: vi.fn() }
    const clearEngineFormats = vi.fn(async () => {})
    const toolbar = useToolbar({
      currentSheet: { value: 'Sheet1' },
      formats,
      getGrid: () => ({
        getSelection: () => ({ r0: 0, c0: 0, r1: 1, c1: 1 }),
        getActiveCell: () => 'A1',
        render: vi.fn(),
      }),
      history,
      selectionIds: () => ['A1', 'B1', 'A2', 'B2'],
      syncFlags: vi.fn(),
      getScope: scope ? () => scope : undefined,
      readEngineFormats: async () => engineFmts,
      clearEngineFormats,
    })
    return { toolbar, formats, history, clearEngineFormats }
  }

  it("clears IronCalc's format and the side store, and copies no format into it", async () => {
    const t = setup({ A1: '#,##0%', B1: 'yyyy-mm-dd' })
    t.formats.set('A2', { bold: true }, 'Sheet1')
    await t.toolbar.clearFormatting()
    expect(t.clearEngineFormats).toHaveBeenCalledWith(['A1', 'B1'], 'Sheet1')
    for (const id of ['A1', 'B1', 'A2', 'B2'])
      expect(t.formats.getCellFormat(id, 'Sheet1') ?? {}).toEqual({})
  })

  // A whole column clears the column's format, not each cell's: a typed
  // format copied onto a cell would stay, in every tab.
  it('leaves no typed format on a cell of a cleared column', async () => {
    const t = setup(
      { A1: '#,##0%' },
      { rect: { r0: 0, c0: 0, r1: 99, c1: 0 }, totalRows: 100, totalCols: 26 },
    )
    await t.toolbar.clearFormatting()
    expect(t.formats.get('A1', 'Sheet1').numberFormat).toBeFalsy()
  })

  // The plain inputs it writes must go into the action's commit (pushOp), or
  // they would land in the next action's undo step.
  it("clears IronCalc's format before the action is committed", async () => {
    const t = setup({ A1: '#,##0%' })
    let pushed = false
    t.clearEngineFormats.mockImplementation(async () => {
      expect(pushed).toBe(false)
    })
    t.history.pushOp.mockImplementation(() => (pushed = true))
    await t.toolbar.clearFormatting()
    expect(t.clearEngineFormats).toHaveBeenCalledOnce()
    expect(t.clearEngineFormats.mock.invocationCallOrder[0]).toBeLessThan(
      t.history.pushOp.mock.invocationCallOrder[0]!,
    )
  })

  it('touches nothing in IronCalc when it formatted nothing', async () => {
    const t = setup({})
    await t.toolbar.clearFormatting()
    expect(t.clearEngineFormats).not.toHaveBeenCalled()
  })
})
