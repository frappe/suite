// Charts in .xlsx, both ways (ISSUES #73). No JS xlsx library reads or
// writes charts (ExcelJS, SheetJS), so export adds the DrawingML parts to the
// zip ExcelJS wrote and import reads them out of the file's zip.
//
// A chart is xl/charts/chartN.xml (its type, its series as A1 refs, title,
// options), placed by an anchor in xl/drawings/drawingN.xml (top-left cell +
// offset, bottom-right cell + offset), which the sheet's <drawing r:id>
// points at through the .rels files.
//
// Positions here are px from the top-left of A1, not of the canvas overlay
// (the caller adds or takes off the row and column headers).
//
// Mapped: bar (Excel's vertical column chart), line, area, pie, scatter;
// title, header row, series names, stacked, smooth, legend, data labels,
// gridlines. On import Excel's horizontal bars, doughnuts and 3-D charts
// become the nearest of ours. Skipped on import: other types (radar,
// bubble, stock, surface, bar-of-pie), combo charts, series laid out in
// rows or over several sheets, and charts with no category column. Not
// mapped: colours, axis titles, `aggregate` (Excel has none, so such a
// chart goes out as one point per source row).

import { colLabel, parseCellId } from '../utils/cells.js'
import type { ChartSpec, ChartType } from './charts.js'

/** The part of a zip (JSZip) read and written here. */
export interface Zip {
  file(path: string): { async(type: 'string'): Promise<string> } | null
  file(path: string, data: string): unknown
}

/** A sheet's sizes, px, as the view stores them. */
export interface SheetLayout {
  colW?: Record<string, number>
  rowH?: Record<string, number>
  hiddenCols?: number[]
  hiddenRows?: number[]
}

/** A chart and where it sits, px from the top-left of A1. */
export interface PlacedChart {
  spec: ChartSpec
  x: number
  y: number
  width: number
  height: number
}

const NS = {
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
}
const REL = {
  drawing: `${NS.r}/drawing`,
  chart: `${NS.r}/chart`,
}
const CT = {
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
}
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
// English Metric Units per px (914400 per inch, 96 px per inch).
const EMU = 9525
const DEFAULT_COL_W = 100
const DEFAULT_ROW_H = 24

// ── shared ──────────────────────────────────────────────────────────────────

function _esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function _parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml').documentElement
}

// Children by local name, whatever prefix the file uses.
function _kids(el: Element | null | undefined, name: string): Element[] {
  return el ? Array.from(el.children).filter((k) => k.localName === name) : []
}
function _kid(el: Element | null | undefined, ...path: string[]): Element | null {
  let cur: Element | null = el ?? null
  for (const name of path) cur = _kids(cur, name)[0] ?? null
  return cur
}
// A CT_Boolean: present with no val, or val other than 0/false, is on.
function _on(el: Element | null) {
  if (!el) return false
  const v = el.getAttribute('val')
  return v !== '0' && v !== 'false'
}
function _num(el: Element | null) {
  return Number(el?.textContent) || 0
}
// The r:id of an element, whatever prefix the file gave the namespace.
function _rid(el: Element | null) {
  return el ? Array.from(el.attributes).find((a) => a.localName === 'id')?.value : undefined
}

function _resolve(baseDir: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const out = baseDir.split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}
function _dir(path: string) {
  return path.slice(0, path.lastIndexOf('/') + 1)
}
function _relsPath(path: string) {
  const i = path.lastIndexOf('/') + 1
  return `${path.slice(0, i)}_rels/${path.slice(i)}.rels`
}

async function _text(zip: Zip, path: string) {
  return (await zip.file(path)?.async('string')) ?? null
}

// A part's relationships: id → { type, path }.
async function _rels(zip: Zip, path: string) {
  const out = new Map<string, { type: string; path: string }>()
  const xml = await _text(zip, _relsPath(path))
  if (!xml) return out
  for (const rel of _kids(_parse(xml), 'Relationship')) {
    const target = rel.getAttribute('Target')
    if (rel.getAttribute('TargetMode') === 'External' || !target) continue
    out.set(rel.getAttribute('Id') || '', {
      type: rel.getAttribute('Type') || '',
      path: _resolve(_dir(path), target),
    })
  }
  return out
}

/** Each worksheet's part path in the zip, by sheet name. */
export async function sheetPaths(zip: Zip) {
  const out = new Map<string, string>()
  const xml = await _text(zip, 'xl/workbook.xml')
  if (!xml) return out
  const rels = await _rels(zip, 'xl/workbook.xml')
  for (const sheet of _kids(_kid(_parse(xml), 'sheets'), 'sheet')) {
    const path = rels.get(_rid(sheet) || '')?.path
    if (path) out.set(sheet.getAttribute('name') || '', path)
  }
  return out
}

// px ↔ (index, offset px) along a sheet's columns or rows. Hidden ones are 0.
function _sizer(
  sizes: Record<string, number> | undefined,
  hidden: number[] | undefined,
  def: number,
) {
  const gone = new Set(hidden || [])
  return (i: number) => (gone.has(i) ? 0 : (sizes?.[i] ?? def))
}
function _toCell(px: number, size: (i: number) => number, max: number) {
  let i = 0
  let left = Math.max(0, px)
  while (i < max - 1 && left >= size(i)) {
    left -= size(i)
    i++
  }
  return { i, off: Math.round(left) }
}
function _fromCell(i: number, off: number, size: (i: number) => number) {
  let px = off
  for (let k = 0; k < i; k++) px += size(k)
  return px
}
const MAX_COLS = 16384
const MAX_ROWS = 1048576

interface Rect {
  r0: number
  c0: number
  r1: number
  c1: number
}

// `A1:C5` (or `$a$1`) as a rect; null for anything else, as the chart
// overlay reads it (useChartIntegration's getMatrix).
function _rect(range: string | undefined): Rect | null {
  const [start = '', end = start] = String(range || '')
    .replace(/\$/g, '')
    .toUpperCase()
    .split(':')
  const a = parseCellId(start)
  const b = parseCellId(end)
  if (!a || !b) return null
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  }
}

// `'Sales (2)'!$B$2:$B$6` → { sheet, rect }; null for anything else (a
// literal, a name, a union).
function _ref(f: string | null | undefined): { sheet: string; rect: Rect } | null {
  const m = String(f || '')
    .trim()
    .match(/^(?:'((?:[^']|'')+)'|([^'!:]+))!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/i)
  if (!m) return null
  const rect = _rect(m[3])
  return rect ? { sheet: m[1] != null ? m[1].replace(/''/g, "'") : m[2]!, rect } : null
}

// ── export ──────────────────────────────────────────────────────────────────

function _quote(sheet: string) {
  return `'${sheet.replace(/'/g, "''")}'`
}
function _a1(sheet: string, c: number, r0: number, r1 = r0) {
  const col = `$${colLabel(c)}$`
  return _esc(`${_quote(sheet)}!${col}${r0 + 1}${r1 !== r0 ? `:${col}${r1 + 1}` : ''}`)
}

const _flag = (name: string, on: boolean) => `<c:${name} val="${on ? 1 : 0}"/>`

/**
 * One chart as xl/charts/chartN.xml, its refs on `sheet` (the source sheet's
 * name in the file). Null when there is nothing to plot: no valid range, no
 * series column, no data row.
 */
export function chartXml(spec: ChartSpec, sheet: string): string | null {
  const rect = _rect(spec.sourceRange)
  if (!rect) return null
  const type: ChartType = (['line', 'pie', 'area', 'scatter'] as const).includes(
    spec.chartType as never,
  )
    ? (spec.chartType as ChartType)
    : 'bar'
  const header = spec.hasHeader !== false
  const d0 = rect.r0 + (header ? 1 : 0)
  const width = rect.c1 - rect.c0 + 1
  const x = spec.encoding?.x ?? 0
  const ys = (spec.encoding?.y ?? []).filter((y) => y >= 0 && y < width && y !== x)
  if (d0 > rect.r1 || x < 0 || x >= width || !ys.length) return null
  const o = spec.options || {}
  const series = type === 'pie' ? ys.slice(0, 1) : ys
  const labels = type === 'pie' ? o.dataLabels !== false : !!o.dataLabels

  const sers = series
    .map((y, i) => {
      const col = rect.c0 + y
      const tx = header
        ? `<c:tx><c:strRef><c:f>${_a1(sheet, col, rect.r0)}</c:f></c:strRef></c:tx>`
        : ''
      const cat = `<c:strRef><c:f>${_a1(sheet, rect.c0 + x, d0, rect.r1)}</c:f></c:strRef>`
      const val = `<c:numRef><c:f>${_a1(sheet, col, d0, rect.r1)}</c:f></c:numRef>`
      const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`
      if (type === 'scatter')
        // Points only: no line between them.
        return `<c:ser>${head}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:xVal>${cat.replace(/strRef/g, 'numRef')}</c:xVal><c:yVal>${val}</c:yVal>${_flag('smooth', false)}</c:ser>`
      const smooth = type === 'line' ? _flag('smooth', !!o.smooth) : ''
      const bar = type === 'bar' ? _flag('invertIfNegative', false) : ''
      return `<c:ser>${head}${bar}<c:cat>${cat}</c:cat><c:val>${val}</c:val>${smooth}</c:ser>`
    })
    .join('')
  const dLbls = labels
    ? `<c:dLbls>${_flag('showLegendKey', false)}${_flag('showVal', type !== 'pie')}${_flag('showCatName', type === 'pie')}${_flag('showSerName', false)}${_flag('showPercent', false)}${_flag('showBubbleSize', false)}</c:dLbls>`
    : ''
  const grouping = `<c:grouping val="${o.stacked ? 'stacked' : type === 'bar' ? 'clustered' : 'standard'}"/>`
  const axIds = '<c:axId val="1"/><c:axId val="2"/>'
  const vary = _flag('varyColors', type === 'pie')
  const group = {
    bar: `<c:barChart><c:barDir val="col"/>${grouping}${vary}${sers}${dLbls}<c:gapWidth val="150"/>${o.stacked ? '<c:overlap val="100"/>' : ''}${axIds}</c:barChart>`,
    line: `<c:lineChart>${grouping}${vary}${sers}${dLbls}${_flag('marker', true)}${axIds}</c:lineChart>`,
    area: `<c:areaChart>${grouping}${vary}${sers}${dLbls}${axIds}</c:areaChart>`,
    pie: `<c:pieChart>${vary}${sers}${dLbls}<c:firstSliceAng val="0"/></c:pieChart>`,
    scatter: `<c:scatterChart><c:scatterStyle val="lineMarker"/>${vary}${sers}${dLbls}${axIds}</c:scatterChart>`,
  }[type]

  const axis = (tag: string, id: number, cross: number, pos: string, grid: boolean) =>
    `<c:${tag}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>${_flag('delete', false)}<c:axPos val="${pos}"/>${grid ? '<c:majorGridlines/>' : ''}<c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:${tag}>`
  const grid = o.gridLines !== false
  const axes =
    type === 'pie'
      ? ''
      : axis(type === 'scatter' ? 'valAx' : 'catAx', 1, 2, 'b', false) +
        axis('valAx', 2, 1, 'l', grid)

  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${_esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx>${_flag('overlay', false)}</c:title>${_flag('autoTitleDeleted', false)}`
    : // Else Excel titles a one-series chart with the series name.
      _flag('autoTitleDeleted', true)
  const legend =
    o.showLegend !== false
      ? `<c:legend><c:legendPos val="b"/>${_flag('overlay', false)}</c:legend>`
      : ''
  return (
    XML_HEAD +
    `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">${_flag('roundedCorners', false)}` +
    `<c:chart>${title}<c:plotArea><c:layout/>${group}${axes}</c:plotArea>${legend}${_flag('plotVisOnly', true)}<c:dispBlanksAs val="gap"/></c:chart>` +
    `</c:chartSpace>`
  )
}

function _anchor(p: PlacedChart, layout: SheetLayout | undefined, rId: string, n: number) {
  const col = _sizer(layout?.colW, layout?.hiddenCols, DEFAULT_COL_W)
  const row = _sizer(layout?.rowH, layout?.hiddenRows, DEFAULT_ROW_H)
  const point = (x: number, y: number) => {
    const c = _toCell(x, col, MAX_COLS)
    const r = _toCell(y, row, MAX_ROWS)
    return `<xdr:col>${c.i}</xdr:col><xdr:colOff>${c.off * EMU}</xdr:colOff><xdr:row>${r.i}</xdr:row><xdr:rowOff>${r.off * EMU}</xdr:rowOff>`
  }
  return (
    `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${point(p.x, p.y)}</xdr:from><xdr:to>${point(p.x + p.width, p.y + p.height)}</xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n + 1}" name="Chart ${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${rId}"/></a:graphicData></a:graphic>` +
    `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  )
}

function _relsXml(rels: { id: string; type: string; target: string }[]) {
  return (
    XML_HEAD +
    `<Relationships xmlns="${NS.rels}">${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')}</Relationships>`
  )
}

// The free part name `${prefix}N.xml` with N from `from` up.
function _free(zip: Zip, prefix: string, from: number) {
  let n = from
  while (zip.file(`${prefix}${n}.xml`)) n++
  return n
}

// Worksheet children that come after <drawing> (CT_Worksheet's sequence).
const AFTER_DRAWING =
  /<(?:legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/

/**
 * Adds each sheet's charts to the zip of a workbook ExcelJS wrote. `sheets`
 * names each worksheet as it is in the file; `fileName` maps a chart's
 * sourceSheet to its name in the file (undefined: not exported, the chart
 * is left out). Returns how many charts were written.
 */
export async function writeCharts(
  zip: Zip,
  sheets: { name: string; charts: PlacedChart[]; layout?: SheetLayout }[],
  fileName: (sheet: string) => string | undefined,
) {
  const paths = await sheetPaths(zip)
  const parts: { path: string; type: string }[] = []
  let chartN = _free(zip, 'xl/charts/chart', 1)
  let drawingN = _free(zip, 'xl/drawings/drawing', 1)
  let written = 0
  for (const { name, charts, layout } of sheets) {
    const sheetPath = paths.get(name)
    const sheetXml = sheetPath && (await _text(zip, sheetPath))
    // A sheet with a drawing of its own (ExcelJS's images) is left as is.
    if (!sheetPath || !sheetXml || /<drawing\b/.test(sheetXml)) continue
    const anchors: string[] = []
    const drawingRels: { id: string; type: string; target: string }[] = []
    for (const p of charts) {
      const source = fileName(p.spec.sourceSheet || '')
      const xml = source != null ? chartXml(p.spec, source) : null
      if (!xml) continue
      const chartPath = `xl/charts/chart${chartN}.xml`
      zip.file(chartPath, xml)
      parts.push({ path: chartPath, type: CT.chart })
      const id = `rId${drawingRels.length + 1}`
      drawingRels.push({ id, type: REL.chart, target: `../charts/chart${chartN}.xml` })
      anchors.push(_anchor(p, layout, id, anchors.length + 1))
      chartN = _free(zip, 'xl/charts/chart', chartN + 1)
      written++
    }
    if (!anchors.length) continue

    const drawingPath = `xl/drawings/drawing${drawingN}.xml`
    zip.file(
      drawingPath,
      XML_HEAD +
        `<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">${anchors.join('')}</xdr:wsDr>`,
    )
    zip.file(_relsPath(drawingPath), _relsXml(drawingRels))
    parts.push({ path: drawingPath, type: CT.drawing })

    // The sheet's own rels, with one more for the drawing.
    const relsPath = _relsPath(sheetPath)
    const relsXml = await _text(zip, relsPath)
    const ids = new Set(relsXml ? [...relsXml.matchAll(/\bId="([^"]*)"/g)].map((m) => m[1]) : [])
    let k = ids.size + 1
    while (ids.has(`rId${k}`)) k++
    const rel = `<Relationship Id="rId${k}" Type="${REL.drawing}" Target="${_relative(sheetPath, drawingPath)}"/>`
    zip.file(
      relsPath,
      relsXml
        ? relsXml.replace(/<\/Relationships>\s*$/, `${rel}</Relationships>`)
        : _relsXml([]).replace('</Relationships>', `${rel}</Relationships>`),
    )
    let out = sheetXml
    if (!/<worksheet\b[^>]*\bxmlns:r=/.test(out))
      out = out.replace(/<worksheet\b/, `<worksheet xmlns:r="${NS.r}"`)
    const at = out.search(AFTER_DRAWING)
    zip.file(sheetPath, `${out.slice(0, at)}<drawing r:id="rId${k}"/>${out.slice(at)}`)
    drawingN = _free(zip, 'xl/drawings/drawing', drawingN + 1)
  }

  if (parts.length) {
    const types = (await _text(zip, '[Content_Types].xml')) || ''
    const add = parts
      .map((p) => `<Override PartName="/${p.path}" ContentType="${p.type}"/>`)
      .join('')
    zip.file('[Content_Types].xml', types.replace(/<\/Types>\s*$/, `${add}</Types>`))
  }
  return written
}

// `xl/drawings/drawing1.xml` from `xl/worksheets/sheet1.xml`: ../drawings/drawing1.xml
function _relative(from: string, to: string) {
  const a = _dir(from).split('/').filter(Boolean)
  const b = to.split('/')
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

// ── import ──────────────────────────────────────────────────────────────────

const TYPES: Record<string, ChartType> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'pie',
  scatterChart: 'scatter',
}

function _f(el: Element | null) {
  for (const kind of ['strRef', 'numRef', 'multiLvlStrRef'])
    if (_kid(el, kind)) return _kid(el, kind, 'f')?.textContent ?? null
  return null
}

function _richText(el: Element | null) {
  const rich = _kid(el, 'tx', 'rich')
  if (rich) return Array.from(rich.getElementsByTagNameNS(NS.a, 't'), (t) => t.textContent).join('')
  // A title read from a cell: its cached text.
  const cache = _kid(el, 'tx', 'strRef', 'strCache')
  return _kids(cache, 'pt')
    .map((pt) => _kid(pt, 'v')?.textContent ?? '')
    .join('')
}

function _labelsOn(dLbls: Element | null) {
  return ['showVal', 'showCatName', 'showPercent'].some((k) => _on(_kid(dLbls, k)))
}

/**
 * A chart from xl/charts/chartN.xml, or null when we can't draw it. Its
 * sourceSheet is the source sheet's name in the file.
 */
export function chartFromXml(xml: string): ChartSpec | null {
  const chart = _kid(_parse(xml), 'chart')
  const plot = _kid(chart, 'plotArea')
  const groups = Array.from(plot?.children || []).filter((k) => k.localName.endsWith('Chart'))
  // One chart per plot area: a combo (bars + line) is not one of ours.
  if (groups.length !== 1) return null
  const group = groups[0]!
  const chartType = TYPES[group.localName]
  if (!chartType) return null

  const sers = _kids(group, 'ser').map((ser) => ({
    name: _ref(_f(_kid(ser, 'tx'))),
    cat: _ref(_f(_kid(ser, 'cat') ?? _kid(ser, 'xVal'))),
    val: _ref(_f(_kid(ser, 'val') ?? _kid(ser, 'yVal'))),
    smooth: _on(_kid(ser, 'smooth')),
    labels: _labelsOn(_kid(ser, 'dLbls')),
  }))
  const first = sers[0]
  if (!first?.val || !first.cat) return null
  const { sheet } = first.val
  const { r0, r1 } = first.val.rect
  const column = (ref: { sheet: string; rect: Rect } | null, rows = true) =>
    !!ref &&
    ref.sheet === sheet &&
    ref.rect.c0 === ref.rect.c1 &&
    (!rows || (ref.rect.r0 === r0 && ref.rect.r1 === r1))
  // Every series one column of the same rows, on one sheet, with the same
  // categories: what a range + column indices can say.
  if (!sers.every((s) => column(s.val) && column(s.cat) && s.cat!.rect.c0 === first.cat!.rect.c0))
    return null

  // The header row: every series is named by the cell above its values.
  const hasHeader =
    r0 > 0 &&
    sers.every(
      (s) =>
        column(s.name, false) && s.name!.rect.r0 === r0 - 1 && s.name!.rect.c0 === s.val!.rect.c0,
    )
  const xCol = first.cat.rect.c0
  const yCols = sers.map((s) => s.val!.rect.c0)
  const c0 = Math.min(xCol, ...yCols)
  const c1 = Math.max(xCol, ...yCols)
  const top = hasHeader ? r0 - 1 : r0
  const sourceRange = `${colLabel(c0)}${top + 1}:${colLabel(c1)}${r1 + 1}`

  const grouping = _kid(group, 'grouping')?.getAttribute('val')
  const legend = _kid(chart, 'legend')
  const valAx = _kids(plot, 'valAx')
  const title = _kid(chart, 'title')
  return {
    sourceSheet: sheet,
    sourceRange,
    chartType,
    title: title ? _richText(title) : '',
    hasHeader,
    encoding: { x: xCol - c0, y: yCols.map((c) => c - c0) },
    options: {
      stacked: grouping === 'stacked' || grouping === 'percentStacked',
      smooth: chartType === 'line' && sers.some((s) => s.smooth),
      showLegend: !!legend && !_on(_kid(legend, 'delete')),
      dataLabels: _labelsOn(_kid(group, 'dLbls')) || sers.some((s) => s.labels),
      gridLines: valAx.some((ax) => !!_kid(ax, 'majorGridlines')),
    },
  }
}

// Where an anchor puts its chart, px from A1's top-left.
function _place(anchor: Element, layout: SheetLayout | undefined) {
  const col = _sizer(layout?.colW, layout?.hiddenCols, DEFAULT_COL_W)
  const row = _sizer(layout?.rowH, layout?.hiddenRows, DEFAULT_ROW_H)
  const point = (el: Element | null) => ({
    x: _fromCell(_num(_kid(el, 'col')), _num(_kid(el, 'colOff')) / EMU, col),
    y: _fromCell(_num(_kid(el, 'row')), _num(_kid(el, 'rowOff')) / EMU, row),
  })
  const ext = _kid(anchor, 'ext')
  const size = ext && {
    width: Number(ext.getAttribute('cx')) / EMU,
    height: Number(ext.getAttribute('cy')) / EMU,
  }
  if (anchor.localName === 'absoluteAnchor') {
    const pos = _kid(anchor, 'pos')
    return {
      x: Number(pos?.getAttribute('x')) / EMU || 0,
      y: Number(pos?.getAttribute('y')) / EMU || 0,
      ...size,
    }
  }
  const from = point(_kid(anchor, 'from'))
  if (anchor.localName === 'oneCellAnchor') return { ...from, ...size }
  const to = point(_kid(anchor, 'to'))
  return { ...from, width: to.x - from.x, height: to.y - from.y }
}

/**
 * Every chart in the file, by the sheet it sits on (its name in the file),
 * and how many were left out because we can't draw them. `layoutOf` gives a
 * sheet's sizes, to turn cell anchors into px.
 */
export async function readCharts(zip: Zip, layoutOf: (sheet: string) => SheetLayout | undefined) {
  const charts: (PlacedChart & { sheet: string })[] = []
  let skipped = 0
  for (const [sheet, sheetPath] of await sheetPaths(zip)) {
    const sheetRels = await _rels(zip, sheetPath)
    for (const { type, path } of sheetRels.values()) {
      if (type !== REL.drawing) continue
      const xml = await _text(zip, path)
      if (!xml) continue
      const drawingRels = await _rels(zip, path)
      const anchors = Array.from(_parse(xml).children).filter((k) => k.localName.endsWith('Anchor'))
      for (const anchor of anchors) {
        const ref = _kid(anchor, 'graphicFrame', 'graphic', 'graphicData', 'chart')
        const chartPath = ref && drawingRels.get(_rid(ref) || '')?.path
        if (!chartPath) continue // a picture, a shape
        const chartXmlText = await _text(zip, chartPath)
        const spec = chartXmlText ? chartFromXml(chartXmlText) : null
        if (!spec) {
          skipped++
          continue
        }
        const p = _place(anchor, layoutOf(sheet))
        charts.push({
          sheet,
          spec,
          x: Math.round(p.x),
          y: Math.round(p.y),
          width: Math.round(p.width || 480),
          height: Math.round(p.height || 320),
        })
      }
    }
  }
  return { charts, skipped }
}
