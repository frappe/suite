import { describe, expect, it, vi } from 'vitest'

import { useExportImport } from './useExportImport.js'

// The workbook SheetJS was asked to write.
const written = vi.hoisted(() => ({ wb: null as null | { Sheets: Record<string, unknown> } }))
vi.mock('xlsx', async (load) => {
  const real = await load<typeof import('xlsx')>()
  return { ...real, writeFile: (wb: typeof written.wb) => (written.wb = wb) }
})

// Typing $1.50, 15% or 1,000 stores the number with IronCalc's format and
// nothing in the side store; =B1*2 shows $3.00. The export kept neither: the
// typed cells went out unformatted and the formula's value as text.
describe('exportXLSX', () => {
  it('carries the format IronCalc gave a typed value, and formula results as numbers', async () => {
    const sheet = {
      inputs: [['1.5', '0.15', '1000', '=A1*2', 'x', '2025-12-09', '=DATE(2025,12,9)']],
      displays: [['$1.50', '15%', '1,000', '$3.00', 'x', '2025-12-09', '12/9/2025']],
      numFmts: [['$#,##0.00', '#,##0%', '#,##0', '$#,##0.00', 'general', 'yyyy-mm-dd', 'm/d/yyyy']],
    }
    const readSheet = vi.fn(async (_sn: string, opts?: { numFmts?: boolean }) =>
      opts?.numFmts ? sheet : { inputs: sheet.inputs, displays: sheet.displays },
    )
    const { exportXLSX } = useExportImport({
      cells: { readSheet },
      sheetNames: () => ['Sheet1'],
      currentSheet: { value: 'Sheet1' },
      getCurrentTitle: () => 't',
      getFormats: () => ({ get: () => ({}) }),
      getMerge: () => null,
      repopulateGrid: vi.fn(),
      syncNames: vi.fn(),
      switchSheet: vi.fn(),
      syncFlags: vi.fn(),
      isDirty: { value: false },
    })
    await exportXLSX()
    const ws = written.wb?.Sheets.Sheet1 as Record<string, { t: string; v: unknown; z?: string }>
    expect(ws.A1).toMatchObject({ t: 'n', v: 1.5, z: '"$"#,##0.00' })
    expect(ws.B1).toMatchObject({ t: 'n', v: 0.15, z: '0%' })
    expect(ws.C1).toMatchObject({ t: 'n', v: 1000, z: '#,##0' })
    expect(ws.D1).toMatchObject({ t: 'n', v: 3, z: '"$"#,##0.00' })
    expect(ws.E1).toMatchObject({ t: 's', v: 'x' })
    expect(ws.E1?.z).toBeUndefined()
    // A typed date is the day serial with its date code, not the text.
    expect(ws.F1).toEqual({ t: 'n', v: 46000, z: 'yyyy-mm-dd' })
    expect(ws.G1).toEqual({ f: 'DATE(2025,12,9)', t: 'n', v: 46000, z: 'm/d/yyyy' })
  })
})
