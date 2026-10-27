import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import type { ChartSpec } from './charts.js'
import { chartFromXml, chartXml, readCharts, writeCharts } from './xlsx-charts.js'

// A workbook as ExcelJS writes it: Sales holds Region | Units | Price.
async function excelJsFile(sheets = ['Sales', 'Notes']) {
  const wb = new ExcelJS.Workbook()
  for (const name of sheets) {
    const ws = wb.addWorksheet(name)
    ws.addRow(['Region', 'Units', 'Price'])
    ws.addRow(['North', 10, 2])
    ws.addRow(['South', 20, 3])
  }
  return JSZip.loadAsync(await wb.xlsx.writeBuffer())
}

const SPEC: ChartSpec = {
  sourceSheet: 'Sales',
  sourceRange: 'A1:C3',
  chartType: 'bar',
  title: 'Units & price',
  hasHeader: true,
  encoding: { x: 0, y: [1, 2] },
  options: {
    stacked: false,
    smooth: false,
    showLegend: true,
    dataLabels: false,
    gridLines: true,
  },
}

async function roundTrip(spec: ChartSpec, at = { x: 250, y: 60, width: 480, height: 320 }) {
  const zip = await excelJsFile()
  const n = await writeCharts(zip, [{ name: 'Sales', charts: [{ spec, ...at }] }], (s) => s)
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const back = await readCharts(await JSZip.loadAsync(bytes), () => undefined)
  return { n, bytes, back }
}

describe('charts through .xlsx', () => {
  for (const chartType of ['bar', 'line', 'area', 'scatter'] as const)
    it(`round-trips a ${chartType} chart`, async () => {
      const spec = { ...SPEC, chartType }
      const { n, back } = await roundTrip(spec)
      expect(n).toBe(1)
      expect(back.skipped).toBe(0)
      expect(back.charts).toEqual([
        { sheet: 'Sales', spec, x: 250, y: 60, width: 480, height: 320 },
      ])
    })

  it('round-trips a pie chart, which plots its first series only', async () => {
    const spec = {
      ...SPEC,
      chartType: 'pie',
      // Import narrows the range to the columns plotted.
      sourceRange: 'A1:B3',
      encoding: { x: 0, y: [1] },
      options: { ...SPEC.options, dataLabels: true, gridLines: false },
    }
    const { back } = await roundTrip(spec)
    expect(back.charts[0]?.spec).toEqual(spec)
  })

  it('round-trips stacked, smooth, no legend, labels, no gridlines, no header', async () => {
    const spec = {
      ...SPEC,
      chartType: 'line',
      title: '',
      sourceRange: 'A2:C3',
      hasHeader: false,
      options: {
        stacked: true,
        smooth: true,
        showLegend: false,
        dataLabels: true,
        gridLines: false,
      },
    }
    const { back } = await roundTrip(spec)
    expect(back.charts[0]?.spec).toEqual(spec)
  })

  it('keeps the place over sized and hidden columns and rows', async () => {
    const zip = await excelJsFile()
    const layout = { colW: { 0: 200 }, rowH: { 1: 40 }, hiddenCols: [1] }
    const at = { x: 230, y: 70, width: 300, height: 200 }
    await writeCharts(zip, [{ name: 'Sales', charts: [{ spec: SPEC, ...at }], layout }], (s) => s)
    const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string')
    // 230 px: past A (200) and the hidden B, 30 px into C; 70 px: 6 into row 3.
    expect(drawing).toContain(
      '<xdr:from><xdr:col>2</xdr:col><xdr:colOff>285750</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>57150</xdr:rowOff></xdr:from>',
    )
    const back = await readCharts(zip, () => layout)
    expect(back.charts[0]).toMatchObject(at)
  })

  it('writes a file ExcelJS and SheetJS still open, with the parts linked', async () => {
    const { bytes } = await roundTrip(SPEC)
    const zip = await JSZip.loadAsync(bytes)
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toMatch(
      /<drawing r:id="rId\d+"\/><\/worksheet>|<drawing r:id="rId\d+"\/><(tableParts|extLst)/,
    )
    const types = await zip.file('[Content_Types].xml')!.async('string')
    expect(types).toContain('PartName="/xl/charts/chart1.xml"')
    expect(types).toContain('PartName="/xl/drawings/drawing1.xml"')
    // The other sheet has no chart and no drawing.
    expect(await zip.file('xl/worksheets/sheet2.xml')!.async('string')).not.toContain('<drawing')

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes.buffer as ArrayBuffer)
    expect(wb.getWorksheet('Sales')?.getCell('B2').value).toBe(10)
    const { read } = await import('xlsx')
    expect(read(bytes, { type: 'array' }).SheetNames).toEqual(['Sales', 'Notes'])
  })

  it('quotes sheet names in refs and reads them back', async () => {
    const xml = chartXml({ ...SPEC, sourceSheet: "Bob's (2)" }, "Bob's (2)")!
    expect(xml).toContain("<c:f>'Bob''s (2)'!$B$2:$B$3</c:f>")
    expect(chartFromXml(xml)?.sourceSheet).toBe("Bob's (2)")
  })

  it('leaves out a chart with nothing to plot or whose source sheet is gone', async () => {
    expect(chartXml({ ...SPEC, encoding: { x: 0, y: [] } }, 'Sales')).toBeNull()
    expect(chartXml({ ...SPEC, sourceRange: 'A1:C1' }, 'Sales')).toBeNull()
    expect(chartXml({ ...SPEC, sourceRange: '#REF!' }, 'Sales')).toBeNull()
    const zip = await excelJsFile()
    const n = await writeCharts(
      zip,
      [{ name: 'Sales', charts: [{ spec: SPEC, x: 0, y: 0, width: 1, height: 1 }] }],
      () => undefined,
    )
    expect(n).toBe(0)
    expect(zip.file('xl/drawings/drawing1.xml')).toBeNull()
  })
})

// Google Sheets' export of a column chart over Sales!A1:B6 (trimmed styling).
const GOOGLE_BAR = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"><a:defRPr b="0"/></a:pPr><a:r><a:rPr b="0"/><a:t>Units vs. Region</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sales!$B$1</c:f></c:strRef></c:tx><c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>Sales!$A$2:$A$6</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Sales!$B$2:$B$6</c:f><c:numCache/></c:numRef></c:val></c:ser><c:axId val="1673930945"/><c:axId val="428561431"/></c:barChart><c:catAx><c:axId val="1673930945"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="428561431"/></c:catAx><c:valAx><c:axId val="428561431"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1673930945"/></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`

describe('charts from other apps', () => {
  it("reads Google Sheets' column chart", () => {
    expect(chartFromXml(GOOGLE_BAR)).toEqual({
      sourceSheet: 'Sales',
      sourceRange: 'A1:B6',
      chartType: 'bar',
      title: 'Units vs. Region',
      hasHeader: true,
      encoding: { x: 0, y: [1] },
      options: {
        stacked: false,
        smooth: false,
        showLegend: true,
        dataLabels: false,
        gridLines: true,
      },
    })
  })

  it('reads horizontal bars and doughnuts as ours, and skips what we cannot draw', () => {
    const bars = GOOGLE_BAR.replace('<c:barDir val="col"/>', '<c:barDir val="bar"/>')
    expect(chartFromXml(bars)?.chartType).toBe('bar')
    const doughnut = GOOGLE_BAR.replace(/barChart>/g, 'doughnutChart>').replace(
      /<c:barDir[^>]*>/,
      '',
    )
    expect(chartFromXml(doughnut)?.chartType).toBe('pie')
    expect(chartFromXml(GOOGLE_BAR.replace(/barChart>/g, 'radarChart>'))).toBeNull()
    // Series in a row, not a column.
    expect(chartFromXml(GOOGLE_BAR.replace('Sales!$B$2:$B$6', 'Sales!$B$2:$F$2'))).toBeNull()
    // A combo: bars and a line.
    const combo = GOOGLE_BAR.replace('</c:barChart>', '</c:barChart><c:lineChart></c:lineChart>')
    expect(chartFromXml(combo)).toBeNull()
  })

  it('reads a oneCellAnchor (what Google writes) and counts skipped charts', async () => {
    const zip = await excelJsFile(['Sales'])
    await writeCharts(
      zip,
      [{ name: 'Sales', charts: [{ spec: SPEC, x: 0, y: 0, width: 10, height: 10 }] }],
      (s) => s,
    )
    zip.file(
      'xl/drawings/drawing1.xml',
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>561975</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>114300</xdr:rowOff></xdr:from><xdr:ext cx="5715000" cy="3533775"/><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`,
    )
    zip.file('xl/charts/chart1.xml', GOOGLE_BAR)
    const back = await readCharts(zip, () => undefined)
    expect(back.charts[0]).toMatchObject({
      sheet: 'Sales',
      x: 259,
      y: 180,
      width: 600,
      height: 371,
    })

    zip.file('xl/charts/chart1.xml', GOOGLE_BAR.replace(/barChart>/g, 'radarChart>'))
    expect(await readCharts(zip, () => undefined)).toEqual({ charts: [], skipped: 1 })
  })
})
