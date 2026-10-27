import ExcelJS from 'exceljs'
import { toast } from 'frappe-ui'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createChartEngine } from '../../engine/charts.js'
import { createCondFormatEngine } from '../../engine/cond-format.js'
import { createFormatsEngine } from '../../engine/formats.js'
import { createMergeEngine } from '../../engine/merge.js'
import { createValidationEngine } from '../../engine/validation.js'
import { useExportImport } from './useExportImport.js'

vi.mock('frappe-ui', () => ({ toast: { info: vi.fn() } }))

type Sheet = { inputs: string[][]; displays: string[][]; numFmts: string[][] }
type XCell = { t: string; v: unknown; z?: string; f?: string }

// The cells of the file buildXLSX wrote, as SheetJS reads them back.
async function written(build: () => Promise<ArrayBuffer>, sheet = 'Sheet1') {
  const { read } = await import('xlsx')
  const wb = read(await build(), { type: 'array', cellFormula: true, cellNF: true })
  return wb.Sheets[sheet] as unknown as Record<string, XCell>
}

function file(buf: ArrayBuffer | Uint8Array, name = 'book.xlsx') {
  return { target: { files: [{ name, arrayBuffer: async () => buf }], value: '' } }
}

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
    const { buildXLSX } = useExportImport({
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
    const ws = await written(buildXLSX)
    expect(ws.A1).toMatchObject({ t: 'n', v: 1.5, z: '"$"#,##0.00' })
    expect(ws.B1).toMatchObject({ t: 'n', v: 0.15, z: '0%' })
    expect(ws.C1).toMatchObject({ t: 'n', v: 1000, z: '#,##0' })
    expect(ws.D1).toMatchObject({ f: 'A1*2', t: 'n', v: 3, z: '"$"#,##0.00' })
    expect(ws.E1).toMatchObject({ t: 's', v: 'x' })
    expect(ws.E1?.z).toBe('General')
    // A typed date is the day serial with its date code, not the text.
    expect(ws.F1).toMatchObject({ t: 'n', v: 46000, z: 'yyyy-mm-dd' })
    expect(ws.F1?.f).toBeUndefined()
    expect(ws.G1).toMatchObject({ f: 'DATE(2025,12,9)', t: 'n', v: 46000, z: 'm/d/yyyy' })
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

  function editor(sheet: Sheet, tabs = ['Sheet1']) {
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
    const { buildXLSX } = editor({
      inputs: [['2026-01-15', '=DATE(2026,4,1)']],
      displays: [['2026-01-15', '4/1/2026']],
      numFmts: [['yyyy-mm-dd', 'm/d/yyyy']],
    })
    const ws = await written(buildXLSX)
    expect(ws.A1).toMatchObject({ t: 'n', v: 46037, z: 'd mmm yyyy' })
    expect(ws.B1).toMatchObject({ f: 'DATE(2026,4,1)', t: 'n', v: 46113, z: 'd mmm yyyy' })
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
    const ed = editor({ inputs: [], displays: [], numFmts: [] })
    await ed.importXLSX(file(buf))
    expect(ed.writes.Sales).toEqual({ A1: '2026-01-15', B1: '2026-01-15', C1: '46037.75' })
    expect(ed.fmts).toEqual({ A1: 'date:long', B1: 'date:mdy', C1: 'datetime:ymd_hm' })
  })

  it('round-trips a date and a formula giving a date', async () => {
    const out = editor({
      inputs: [['2026-01-15', '=A1+1']],
      displays: [['2026-01-15', '2026-01-16']],
      numFmts: [['yyyy-mm-dd', 'yyyy-mm-dd']],
    })
    const back = editor({ inputs: [], displays: [], numFmts: [] }, [])
    await back.importXLSX(file(await out.buildXLSX()))
    expect(back.writes.Sheet1).toEqual({ A1: '2026-01-15', B1: '=A1+1' })
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
    await importXLSX(file(buf))
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

// ISSUES #56 / #57. The SheetJS community build wrote no styles, and the side
// stores (formats, view, conditional formats) were never passed to it, so a
// round trip through Excel or Google lost all of it, and import lost merges.
describe('xlsx round trip of styling, sizes, freeze, merges and conditional formats', () => {
  // A workbook with real side stores; the cells come from `sheets`.
  function editor(sheets: Record<string, Sheet>, views: Record<string, unknown> = {}) {
    const writes: Record<string, Record<string, string>> = {}
    const formats = createFormatsEngine()
    const merge = createMergeEngine()
    const condFormat = createCondFormatEngine()
    const state = { views }
    const opts = {
      cells: {
        readSheet: async (sn: string) => sheets[sn] ?? { inputs: [], displays: [], numFmts: [] },
        write: (sn: string, map: Record<string, string>) =>
          (writes[sn] = { ...writes[sn], ...map }),
        addSheet: vi.fn(),
        idle: async () => {},
      },
      sheetNames: () => Object.keys(sheets),
      currentSheet: { value: Object.keys(sheets)[0] ?? 'Sheet1' },
      getCurrentTitle: () => 't',
      getFormats: () => formats,
      getMerge: () => merge,
      getCondFormat: () => condFormat,
      getViews: () => state.views,
      setViews: (v: Record<string, unknown>) => (state.views = v),
      repopulateGrid: vi.fn(),
      syncNames: vi.fn(),
      switchSheet: vi.fn(),
      syncFlags: vi.fn(),
      isDirty: { value: false },
    }
    return { ...useExportImport(opts), writes, formats, merge, condFormat, state }
  }

  const sales: Sheet = {
    inputs: [
      ['Region', 'Revenue', 'Title', ''],
      ['North', '30000', '', ''],
      ['Total', '=SUM(B2:B2)', '', ''],
    ],
    displays: [
      ['Region', 'Revenue', 'Title', ''],
      ['North', '30000', '', ''],
      ['Total', '30000', '', ''],
    ],
    numFmts: [[], [], []],
  }
  const header = { bold: true, backgroundColor: '#cfe2f3' }
  const total = { bold: true, italic: true, color: '#ff0000' }
  const title = {
    fontSize: 21,
    underline: true,
    strikethrough: true,
    align: 'center',
    valign: 'top',
    textWrap: 'wrap',
    borderBottom: { style: 'medium', color: '#000000' },
  }

  async function roundTrip() {
    const out = editor(
      { Sales: sales },
      {
        Sales: {
          colW: { 0: 200, 2: 64 },
          rowH: { 0: 40 },
          freezeRows: 1,
          freezeCols: 1,
          hiddenRows: [5],
          hiddenCols: [6],
        },
      },
    )
    out.formats.set('A1', header, 'Sales')
    out.formats.set('B1', header, 'Sales')
    out.formats.set('A3', total, 'Sales')
    out.formats.set('B3', { ...total, numberFormat: 'currency:INR:2' }, 'Sales')
    out.formats.set('C1', title, 'Sales')
    out.formats.set('E7', { backgroundColor: '#ffff00' }, 'Sales') // a filled, empty cell
    out.formats.setCol(3, { italic: true }, 'Sales')
    out.merge.merge(0, 2, 0, 3, 'Sales')
    out.condFormat.addRule(
      {
        range: { r0: 1, c0: 1, r1: 2, c1: 1 },
        condition: { type: 'gt', value: '30000' },
        format: { backgroundColor: '#b7e1cd' },
      },
      'Sales',
    )
    out.condFormat.addRule(
      { range: { r0: 1, c0: 1, r1: 2, c1: 1 }, kind: 'data-bar', bar: { color: '#638ec6' } },
      'Sales',
    )
    const buf = await out.buildXLSX()
    const back = editor({})
    await back.importXLSX(file(buf))
    return { buf, back }
  }

  it('keeps bold, italic, colour, fill, font size, alignment, wrap and borders', async () => {
    const { back } = await roundTrip()
    const f = (id: string) => back.formats.get(id, 'Sales')
    expect(f('A1')).toEqual(header)
    expect(f('B1')).toEqual(header)
    expect(f('A3')).toEqual(total)
    expect(f('B3')).toEqual({ ...total, numberFormat: 'currency:INR:2' })
    expect(f('C1')).toEqual(title)
    expect(f('E7')).toEqual({ backgroundColor: '#ffff00' })
    expect(f('A2')).toEqual({})
    // The column layer comes back as the column's format.
    expect(f('D40')).toEqual({ italic: true })
    expect(back.writes.Sales).toMatchObject({ A1: 'Region', B2: '30000', B3: '=SUM(B2:B2)' })
  })

  it('keeps column widths, row heights, hidden rows and columns and the freeze', async () => {
    const { back } = await roundTrip()
    expect(back.state.views.Sales).toEqual({
      colW: { 0: 200, 2: 64 },
      rowH: { 0: 40 },
      freezeRows: 1,
      freezeCols: 1,
      hiddenRows: [5],
      hiddenCols: [6],
      manualRows: [0],
    })
  })

  it('keeps merges and conditional formats', async () => {
    const { back } = await roundTrip()
    // ExcelJS gives a merged cell its top-left cell's value: not ours to copy.
    expect(back.writes.Sales?.D1).toBeUndefined()
    expect(back.merge.snapshot().Sales?.masterMap).toEqual({
      C1: { r: 0, c: 2, rowSpan: 1, colSpan: 2 },
    })
    expect(back.condFormat.getRules('Sales').map(({ id: _, ...r }) => r)).toEqual([
      {
        range: { r0: 1, c0: 1, r1: 2, c1: 1 },
        condition: { type: 'gt', value: '30000' },
        format: { backgroundColor: '#b7e1cd' },
      },
      { range: { r0: 1, c0: 1, r1: 2, c1: 1 }, kind: 'data-bar', bar: { color: '#638ec6' } },
    ])
  })

  it('gives unsized columns a width that fits a currency, not 8.43', async () => {
    const { buf } = await roundTrip()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as ArrayBuffer)
    const ws = wb.getWorksheet('Sales')!
    expect(ws.properties.defaultColWidth).toBe(13.57)
    expect(ws.getColumn(1).width).toBe(27.86)
  })

  it("imports Google's export: Arial 10 everywhere reads as no font", async () => {
    // What Google Sheets writes: every cell Arial (size only on the
    // default font), theme 1 (black) text, a frozen header row.
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sales', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] })
    const arial = { name: 'Arial', color: { theme: 1 } }
    ws.getCell('A1').value = 'Region'
    ws.getCell('A1').font = { ...arial, bold: true }
    ws.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFCFE2F3' },
      bgColor: { argb: 'FFCFE2F3' },
    }
    ws.getCell('A2').value = 'North'
    ws.getCell('A2').font = arial
    ws.getCell('A3').value = 'South'
    ws.getCell('A3').font = arial
    ws.getCell('A4').value = 'Title'
    ws.getCell('A4').font = { ...arial, size: 16 }
    ws.getColumn(1).width = 21.88
    const back = editor({})
    await back.importXLSX(file(await wb.xlsx.writeBuffer()))
    expect(back.formats.get('A1', 'Sales')).toEqual({ bold: true, backgroundColor: '#cfe2f3' })
    expect(back.formats.get('A2', 'Sales')).toEqual({})
    expect(back.formats.get('A4', 'Sales')).toEqual({ fontSize: 21 })
    expect(back.state.views.Sales).toMatchObject({ colW: { 0: 158 }, freezeRows: 1, freezeCols: 0 })
  })

  // The file picker takes .xls and .ods too, which only SheetJS reads; with
  // ExcelJS alone they failed without a word.
  for (const [ext, bookType] of [
    ['xls', 'biff8'],
    ['ods', 'ods'],
  ] as const) {
    it(`imports a .${ext} file`, async () => {
      const { utils, write } = await import('xlsx')
      const wb = utils.book_new()
      const ws = {
        '!ref': 'A1:B2',
        A1: { t: 's', v: 'Region' },
        B1: { t: 'n', v: 0.25, z: '0.00%' },
        A2: { t: 's', v: 'North' },
        B2: { t: 'n', v: 46037, z: 'd mmm yyyy' },
      }
      utils.book_append_sheet(wb, ws, 'Sales')
      const buf = write(wb, { type: 'array', bookType })
      const back = editor({})
      await back.importXLSX(file(buf, `report.${ext}`))
      expect(back.writes.Sales).toMatchObject({ A1: 'Region', B1: '0.25', A2: 'North' })
      // SheetJS's own .ods writer leaves the number formats out, so only the
      // .xls has them to bring in.
      if (ext === 'xls') {
        expect(back.writes.Sales?.B2).toBe('2026-01-15')
        expect(back.formats.get('B1', 'Sales')).toEqual({ numberFormat: 'percentage' })
        expect(back.formats.get('B2', 'Sales')).toEqual({ numberFormat: 'date:long' })
      }
    })
  }

  it("keeps hand-set row heights, lets Excel's auto-fitted ones refit, and no 5 px columns", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sales')
    ws.getCell('A1').value = 'Title'
    ws.getRow(1).height = 30 // set by hand
    ws.getCell('A2').value = 'Big text'
    ws.getRow(2).height = 21 // Excel's own fit to a larger font
    ws.getCell('A4').value = 'x' // ExcelJS drops a row with no cells
    ws.getRow(4).height = 0.5 // hidden by squashing
    ws.getRow(4).hidden = true
    ws.getColumn(2).width = 1 // a 12 px spacer
    ws.getColumn(4).width = 0 // hidden column, as Excel writes it
    ws.getColumn(4).hidden = true
    // ExcelJS marks every height it writes as set by hand; take it off row 2.
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer())
    const path = 'xl/worksheets/sheet1.xml'
    const xml = await zip.file(path)!.async('string')
    zip.file(path, xml.replace(/(<row r="2"[^>]*?) customHeight="1"/, '$1'))
    const back = editor({})
    await back.importXLSX(file(await zip.generateAsync({ type: 'arraybuffer' })))
    expect(back.state.views.Sales).toMatchObject({
      colW: { 1: 30 },
      rowH: { 0: 40, 1: 28 },
      manualRows: [0],
      hiddenRows: [3],
      hiddenCols: [3],
    })
  })
})

// ISSUES #73 / #69. Charts went neither out nor in, and an import into a new
// file kept its empty Sheet1 in front of the imported tabs.
describe('xlsx charts, and importing into a new file', () => {
  const sales: Sheet = {
    inputs: [
      ['Region', 'Units'],
      ['North', '10'],
      ['South', '20'],
    ],
    displays: [
      ['Region', 'Units'],
      ['North', '10'],
      ['South', '20'],
    ],
    numFmts: [],
  }

  function editor(sheets: Record<string, Sheet>, views: Record<string, unknown> = {}) {
    const writes: Record<string, Record<string, string>> = {}
    const charts = createChartEngine()
    const formats = createFormatsEngine()
    const validation = createValidationEngine()
    const tabs = Object.keys(sheets)
    const state = { views }
    const opts = {
      cells: {
        readSheet: async (sn: string) => sheets[sn] ?? { inputs: [], displays: [], numFmts: [] },
        write: (sn: string, map: Record<string, string>) =>
          (writes[sn] = { ...writes[sn], ...map }),
        addSheet: vi.fn((name: string) => tabs.push(name)),
        extent: async (sn: string) => (sheets[sn]?.inputs.length ? { maxRow: 0, maxCol: 0 } : null),
        idle: async () => {},
      },
      sheetNames: () => tabs,
      currentSheet: { value: tabs[0] ?? 'Sheet1' },
      getCurrentTitle: () => 't',
      getFormats: () => formats,
      getMerge: () => null,
      getCharts: () => charts,
      getSheetStores: () => [validation],
      getViews: () => state.views,
      setViews: (v: Record<string, unknown>) => (state.views = v),
      renameSheet: vi.fn((from: string, to: string) => {
        tabs[tabs.indexOf(from)] = to
        return true
      }),
      repopulateGrid: vi.fn(),
      syncNames: vi.fn(),
      switchSheet: vi.fn(),
      syncFlags: vi.fn(),
      isDirty: { value: false },
    }
    return { ...useExportImport(opts), opts, tabs, writes, charts, state }
  }

  const chart = {
    sourceSheet: 'Sales',
    sourceRange: 'A1:B3',
    chartType: 'line',
    title: 'Units',
    hasHeader: true,
    encoding: { x: 0, y: [1] },
    options: { stacked: false, smooth: true, showLegend: true, dataLabels: false, gridLines: true },
    // Overlay px: 50 px of row numbers and 24 of column letters, then 250
    // and 48 px into the sheet, over a 150 px column A.
    position: { sheet: 'Sales', x: 300, y: 72, width: 480, height: 320 },
  }

  it('exports charts and imports them onto the imported sheets', async () => {
    const out = editor({ Sales: sales }, { Sales: { colW: { 0: 150 } } })
    out.charts.add(chart)
    const buf = await out.buildXLSX()
    const back = editor({ Sales: sales })
    await back.importXLSX(file(buf))
    expect(back.tabs).toEqual(['Sales', 'Sales (2)'])
    expect(back.charts.list()).toEqual([
      {
        ...chart,
        id: expect.any(String),
        sourceSheet: 'Sales (2)',
        position: { ...chart.position, sheet: 'Sales (2)' },
      },
    ])
  })

  it('says how many charts it could not bring in', async () => {
    const out = editor({ Sales: sales })
    out.charts.add(chart)
    const zip = await JSZip.loadAsync(await out.buildXLSX())
    const xml = await zip.file('xl/charts/chart1.xml')!.async('string')
    zip.file('xl/charts/chart1.xml', xml.replace(/lineChart>/g, 'radarChart>'))
    const back = editor({ Sales: sales })
    await back.importXLSX(file(await zip.generateAsync({ type: 'arraybuffer' })))
    expect(back.charts.list()).toEqual([])
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('1 chart'))
  })

  it("replaces a new file's empty Sheet1 instead of keeping it first", async () => {
    const out = editor({ Sales: sales, Rates: sales })
    const buf = await out.buildXLSX()
    const back = editor({ Sheet1: { inputs: [], displays: [], numFmts: [] } })
    await back.importXLSX(file(buf))
    expect(back.opts.renameSheet).toHaveBeenCalledWith('Sheet1', 'Sales')
    expect(back.tabs).toEqual(['Sales', 'Rates'])
    expect(Object.keys(back.writes)).toEqual(['Sales', 'Rates'])
  })

  it('keeps a Sheet1 that has anything on it', async () => {
    const buf = await editor({ Sales: sales }).buildXLSX()
    const typed = editor({ Sheet1: sales })
    await typed.importXLSX(file(buf))
    expect(typed.tabs).toEqual(['Sheet1', 'Sales'])
    const filled = editor({ Sheet1: { inputs: [], displays: [], numFmts: [] } })
    filled.opts.getFormats().set('B2', { bg: '#ff0000' }, 'Sheet1')
    await filled.importXLSX(file(buf))
    expect(filled.tabs).toEqual(['Sheet1', 'Sales'])
    expect(filled.opts.renameSheet).not.toHaveBeenCalled()
    // A dropdown on empty cells would move onto the imported sheet.
    const listed = editor({ Sheet1: { inputs: [], displays: [], numFmts: [] } })
    listed.opts.getSheetStores()[0]!.set('B2', { type: 'list', values: ['a', 'b'] }, 'Sheet1')
    await listed.importXLSX(file(buf))
    expect(listed.tabs).toEqual(['Sheet1', 'Sales'])
  })

  it('keeps the blank sheet as it is spelled when the file differs only in case', async () => {
    const buf = await editor({ sheet1: sales }).buildXLSX()
    const back = editor({ Sheet1: { inputs: [], displays: [], numFmts: [] } })
    await back.importXLSX(file(buf))
    expect(back.tabs).toEqual(['Sheet1'])
    expect(Object.keys(back.writes)).toEqual(['Sheet1'])
  })

  it('reads a chart whose refs spell the sheet in another case', async () => {
    const out = editor({ Sales: sales })
    out.charts.add(chart)
    const zip = await JSZip.loadAsync(await out.buildXLSX())
    const xml = await zip.file('xl/charts/chart1.xml')!.async('string')
    zip.file('xl/charts/chart1.xml', xml.replace(/'Sales'!/g, 'SALES!'))
    const back = editor({ Rates: sales })
    await back.importXLSX(file(await zip.generateAsync({ type: 'arraybuffer' })))
    expect(back.charts.list()[0]).toMatchObject({ sourceSheet: 'Sales' })
  })
})
