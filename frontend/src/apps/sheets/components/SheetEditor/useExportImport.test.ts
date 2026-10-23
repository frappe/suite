import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

// ISSUES #58 / #59. SheetJS turns a JS Date into a serial (and a serial into
// a Date, with cellDates) in the runner's local time, and an Indian 1899
// is +5:21:10. A UTC-midnight date went out as 05:30:10, and a plain date
// serial came in as the day before at 18:29:50, as text.
describe('xlsx dates in a timezone ahead of UTC', () => {
  const tz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Asia/Kolkata'
  })
  afterAll(() => {
    process.env.TZ = tz
  })

  function editor(
    sheet: { inputs: string[][]; displays: string[][]; numFmts: string[][] },
    tabs = ['Sheet1'],
  ) {
    const writes: Record<string, Record<string, string>> = {}
    const fmts: Record<string, string> = {}
    const opts = {
      cells: {
        readSheet: async () => sheet,
        write: (sn: string, map: Record<string, string>) =>
          (writes[sn] = { ...writes[sn], ...map }),
        addSheet: vi.fn(),
        idle: async () => {},
      },
      sheetNames: () => tabs,
      currentSheet: { value: 'Sheet1' },
      getCurrentTitle: () => 't',
      // A side-store date format on A1 and B1, as the toolbar sets it.
      getFormats: () => ({
        get: (id: string) => (id === 'A1' || id === 'B1' ? { numberFormat: 'date:long' } : {}),
        set: (id: string, f: { numberFormat: string }) => (fmts[id] = f.numberFormat),
      }),
      getMerge: () => null,
      repopulateGrid: vi.fn(),
      syncNames: vi.fn(),
      switchSheet: vi.fn(),
      syncFlags: vi.fn(),
      isDirty: { value: false },
    }
    return { ...useExportImport(opts), writes, fmts }
  }

  it('exports a date as its whole day serial, with no time', async () => {
    const { exportXLSX } = editor({
      inputs: [['2026-01-15', '=DATE(2026,4,1)']],
      displays: [['2026-01-15', '4/1/2026']],
      numFmts: [['yyyy-mm-dd', 'm/d/yyyy']],
    })
    await exportXLSX()
    const ws = written.wb?.Sheets.Sheet1 as Record<string, { t: string; v: unknown; z?: string }>
    expect(ws.A1).toEqual({ t: 'n', v: 46037, z: 'd mmm yyyy' })
    expect(ws.B1).toEqual({ f: 'DATE(2026,4,1)', t: 'n', v: 46113, z: 'd mmm yyyy' })
  })

  it('imports a date serial as that date, not text from the day before', async () => {
    const { utils, write } = await import('xlsx')
    const wb = utils.book_new()
    const ws = {
      '!ref': 'A1:C1',
      A1: { t: 'n', v: 46037, z: 'd mmm yyyy' },
      B1: { t: 'n', v: 46037, z: 'm/d/yyyy' },
      C1: { t: 'n', v: 46037.75, z: 'yyyy-mm-dd hh:mm' },
    }
    utils.book_append_sheet(wb, ws, 'Sales')
    const buf = write(wb, { type: 'array', bookType: 'xlsx' })
    const file = { arrayBuffer: async () => buf }
    const ed = editor({ inputs: [], displays: [], numFmts: [] })
    await ed.importXLSX({ target: { files: [file], value: '' } })
    expect(ed.writes.Sales).toEqual({ A1: '2026-01-15', B1: '2026-01-15', C1: '46037.75' })
    expect(ed.fmts).toEqual({ A1: 'date:long', B1: 'date:mdy', C1: 'datetime:ymd_hm' })
  })
})

// ISSUES #61. Importing next to sheets of the same name adds `Sales (2)`,
// but its formulas still named `Sales` and `Rates`, so the copy silently
// read the sheets that were already there. Excel and Google rename them.
describe('importXLSX into a workbook with the same sheet names', () => {
  it('points imported formulas at the imported sheets', async () => {
    const { utils, write } = await import('xlsx')
    const wb = utils.book_new()
    utils.book_append_sheet(
      wb,
      {
        '!ref': 'A1:B2',
        A1: { t: 'n', v: 1, f: 'VLOOKUP(A2,Rates!A:B,2,FALSE)' },
        B1: { t: 'n', v: 2, f: "'Rates (2)'!A1+Summary!B2" },
        B2: { t: 's', v: 'x', f: '"Rates!"&Rates!A1' },
      },
      'Sales',
    )
    utils.book_append_sheet(wb, { '!ref': 'A1', A1: { t: 'n', v: 3 } }, 'Rates')
    utils.book_append_sheet(wb, { '!ref': 'A1', A1: { t: 'n', v: 4, f: 'sales!A1' } }, 'Rates (2)')
    const buf = write(wb, { type: 'array', bookType: 'xlsx' })
    const writes: Record<string, Record<string, string>> = {}
    const { importXLSX } = useExportImport({
      cells: {
        write: (sn: string, map: Record<string, string>) =>
          (writes[sn] = { ...writes[sn], ...map }),
        addSheet: vi.fn(),
        idle: async () => {},
      },
      sheetNames: () => ['Sales', 'Rates', 'Summary'],
      currentSheet: { value: 'Sales' },
      getCurrentTitle: () => 't',
      getFormats: () => null,
      getMerge: () => null,
      repopulateGrid: vi.fn(),
      syncNames: vi.fn(),
      switchSheet: vi.fn(),
      syncFlags: vi.fn(),
      isDirty: { value: false },
    })
    await importXLSX({ target: { files: [{ arrayBuffer: async () => buf }], value: '' } })
    expect(Object.keys(writes)).toEqual(['Sales (2)', 'Rates (2)', 'Rates (2) (2)'])
    expect(writes['Sales (2)']).toEqual({
      A1: "=VLOOKUP(A2,'Rates (2)'!A:B,2,FALSE)",
      // The file's own `Rates (2)` is now `Rates (2) (2)`; Summary isn't in
      // the file, so it still means the workbook's Summary.
      B1: "='Rates (2) (2)'!A1+Summary!B2",
      // Text in quotes is not a reference.
      B2: `="Rates!"&'Rates (2)'!A1`,
    })
    expect(writes['Rates (2) (2)']).toEqual({ A1: "='Sales (2)'!A1" })
  })
})
