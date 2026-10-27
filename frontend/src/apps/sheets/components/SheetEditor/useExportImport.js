import { toast } from 'frappe-ui'

import { COL_HEADER_H, ROW_HEADER_W } from '../../canvas/constants.js'
import { DEFAULT_COL_W, DEFAULT_ROW_H, MIN_COL_W, MIN_ROW_H } from '../../core/view-model.js'
import { renameSheetsInFormula } from '../../engine/formula-adjust.js'
import { readCharts, sheetPaths, writeCharts } from '../../engine/xlsx-charts.js'
import { fromXlsxCell, numFmtFromEngine, numFmtToZ, toXlsxCell } from '../../engine/xlsx-io.js'
import {
  cfFromXlsx,
  cfToXlsx,
  colWidthFromXlsx,
  colWidthToXlsx,
  commonFont,
  customHeightRows,
  refToRects,
  rowHeightFromXlsx,
  rowHeightToXlsx,
  styleFromXlsx,
  styleToXlsx,
  themePalette,
} from '../../engine/xlsx-style.js'
import { cellId, parseCellId } from '../../utils/cells.js'
import { dateSerialFromShown, parseNumberFmt } from '../../utils/format-number.js'

// ── private helpers ────────────────────────────────────────────────────────────

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function _parseCSV(text) {
  const rows = []
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let i = 0

  while (i < s.length) {
    const row = []
    while (true) {
      if (s[i] === '"') {
        // Quoted field — may contain commas and newlines
        i++
        let cell = ''
        while (i < s.length) {
          if (s[i] === '"' && s[i + 1] === '"') {
            cell += '"'
            i += 2
          } else if (s[i] === '"') {
            i++
            break
          } else cell += s[i++]
        }
        row.push(cell)
      } else {
        // Unquoted field — ends at ',' or newline
        const start = i
        while (i < s.length && s[i] !== ',' && s[i] !== '\n') i++
        row.push(s.slice(start, i))
      }
      if (i >= s.length || s[i] === '\n') {
        i++
        break
      }
      i++ // skip ','
    }
    rows.push(row)
  }
  return rows
}

// The Excel code of one of our date, time or datetime formats, else null.
function _dateZ(fmt) {
  return ['date', 'time', 'datetime'].includes(parseNumberFmt(fmt).type) ? numFmtToZ(fmt) : null
}

// ExcelJS, loaded on the first export or import (it is ~250 kB gzipped).
async function _excel() {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

// An .xls or .ods file as .xlsx bytes, through SheetJS.
async function _toXlsx(buf) {
  const { read, write } = await import('xlsx')
  // No cellDates: see fromXlsxCell (ISSUES #58).
  const wb = read(buf, { type: 'array', cellFormula: true, cellNF: true })
  return write(wb, { type: 'array', bookType: 'xlsx' })
}

// Each worksheet's hand-set rows (customHeightRows) by sheet name, read from
// the file's XML (ExcelJS drops customHeight); null when it can't be read.
async function _customHeights(zip) {
  try {
    const out = new Map()
    for (const [name, path] of await sheetPaths(zip))
      out.set(name, customHeightRows((await zip.file(path)?.async('string')) ?? ''))
    return out
  } catch {
    return null
  }
}

// The .xlsx as a JSZip, for what ExcelJS neither reads nor writes (charts,
// customHeight); null when it can't be opened.
async function _zip(buf) {
  try {
    const mod = await import('jszip')
    return await (mod.default ?? mod).loadAsync(buf)
  } catch {
    return null
  }
}

// A cell format as an ExcelJS style, its number format included.
function _xStyle(fmt) {
  const style = styleToXlsx(fmt)
  const z = numFmtToZ(fmt?.numberFormat)
  if (z) style.numFmt = z
  return style
}

// An imported format with its number format, or null when it has neither.
function _withNumFmt(fmt, numberFormat) {
  const out = numberFormat ? { ...fmt, numberFormat } : fmt
  return Object.keys(out).length ? out : null
}

// An ExcelJS cell as the SheetJS-shaped cell fromXlsxCell reads. A Date
// (what ExcelJS makes of a number under a date code, in UTC) goes back to
// its day serial.
function _cellIn(cell) {
  let v = cell.value
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('formula' in v || 'sharedFormula' in v || 'result' in v) v = v.result
    else if (v.richText) v = v.richText.map((r) => r.text).join('')
    // A hyperlink keeps its text.
    else if ('text' in v) v = v.text
    else if ('error' in v) v = v.error
  }
  if (v instanceof Date) v = v.getTime() / 86400000 + 25569
  const t = typeof v === 'boolean' ? 'b' : typeof v === 'number' ? 'n' : 's'
  // .formula is a shared formula translated to this cell.
  return { t, v, f: cell.formula, z: cell.numFmt }
}

// ── composable ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.cells – the workbook, through IronCalc:
 *   readSheet(sn, { numFmts }) → Promise<{ inputs, displays, numFmts? }>, rows
 *     from A1 to the last used cell ([] when the sheet is empty);
 *   write(sn, map) writes a {cellId: input} map; clear(sn) → Promise, empties
 *   the sheet's cells; addSheet(name) adds a sheet; extent(sn) → Promise of
 *   its used extent, null when empty; idle() resolves once all of it applied.
 * @param {() => string[]} opts.sheetNames – the tab list
 * @param {() => string}  opts.getCurrentTitle – current document title
 * @param {() => void}    opts.repopulateGrid  – full canvas repaint
 * @param {() => void}    opts.syncFlags       – sync undo/redo button state
 * @param {import('vue').Ref<boolean>} opts.isDirty – dirty flag ref
 */
export function useExportImport({
  cells,
  sheetNames,
  currentSheet,
  getCurrentTitle,
  getFormats,
  getMerge,
  getCondFormat,
  getCharts,
  getSheetStores,
  getViews,
  setViews,
  renameSheet,
  repopulateGrid,
  syncNames,
  switchSheet,
  syncFlags,
  isDirty,
}) {
  // ── exports ──────────────────────────────────────────────────────────────────

  function _download(blob, ext) {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${getCurrentTitle() || 'sheet'}.${ext}`,
    })
    a.click()
  }

  async function exportCSV() {
    const { displays } = await cells.readSheet(currentSheet.value)
    const csv = displays
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? '')
            return s.includes(',') || s.includes('"') || s.includes('\n')
              ? `"${s.replace(/"/g, '""')}"`
              : s
          })
          .join(','),
      )
      .join('\n')
    _download(new Blob([csv], { type: 'text/csv' }), 'csv')
  }

  // Fill an ExcelJS worksheet from one sub-sheet: value types, formulas (with
  // their computed value), number formats, cell/column/row formats, sizes,
  // hides, merges and conditional formats. The freeze is set on creation.
  async function _buildWorksheet(ws, sn, { formats, merge, condFormat, view }) {
    // numFmts: IronCalc's own format of a typed $1.50 or 15%, used where
    // the side store has none.
    const { inputs, displays, numFmts } = await cells.readSheet(sn, { numFmts: true })
    // Column and row formats first: ExcelJS copies them onto the cells made
    // after, and each cell below then gets its whole resolved format.
    const layers = formats?.snapshot?.()?.[sn]
    for (const [c, fmt] of Object.entries(layers?.cols || {}))
      ws.getColumn(Number(c) + 1).style = _xStyle(fmt)
    for (const [r, fmt] of Object.entries(layers?.rows || {}))
      ws.getRow(Number(r) + 1).style = _xStyle(fmt)

    inputs.forEach((row, r) =>
      row.forEach((raw, c) => {
        if (raw === '') return
        const id = cellId(r, c)
        const computed = raw.startsWith('=') ? displays[r][c] : null
        const own = formats?.get(id, sn)
        const ours = own?.numberFormat
        const engineCode = numFmts?.[r]?.[c]
        // A date IronCalc formatted (a typed 2025-12-09, =TODAY()) goes out
        // as its day serial with IronCalc's code, which is Excel's grammar,
        // or with ours when the toolbar gave it a date format.
        const oursZ = ours ? _dateZ(ours) : null
        const serial = ours && !oursZ ? NaN : dateSerialFromShown(displays[r][c], engineCode)
        const cell = !isNaN(serial)
          ? {
              ...(raw.startsWith('=') && { f: raw.slice(1) }),
              t: 'n',
              v: serial,
              z: oursZ || engineCode,
            }
          : toXlsxCell(raw, computed, ours || numFmtFromEngine(engineCode) || '')
        if (!cell) return
        const x = ws.getCell(r + 1, c + 1)
        x.value = cell.f ? { formula: cell.f, result: cell.v } : cell.v
        x.style = { ...styleToXlsx(own), ...(cell.z && { numFmt: cell.z }) }
      }),
    )
    // Cells with a format and no value: a fill, a border.
    for (const id of Object.keys(layers?.cells || {})) {
      const p = parseCellId(id)
      if (!p || inputs[p.row]?.[p.col]) continue
      const style = _xStyle(formats.get(id, sn))
      if (Object.keys(style).length) ws.getCell(p.row + 1, p.col + 1).style = style
    }

    for (const m of Object.values(merge?.snapshot()?.[sn]?.masterMap || {}))
      ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rowSpan, m.c + m.colSpan)
    for (const rule of condFormat?.getRules(sn) || []) {
      const cf = cfToXlsx(rule)
      if (cf) ws.addConditionalFormatting(cf)
    }

    // ExcelJS gives a column it writes 9 characters unless told, and drops
    // a row with no cells and no height, hidden or not: so every column and
    // row written gets its size, ours or the default.
    const colW = view?.colW || {}
    const rowH = view?.rowH || {}
    for (const c of view?.hiddenCols || []) ws.getColumn(c + 1).hidden = true
    for (const r of view?.hiddenRows || []) ws.getRow(r + 1).hidden = true
    ws.columns?.forEach((col, c) => (col.width = colWidthToXlsx(colW[c] ?? DEFAULT_COL_W)))
    for (const [c, px] of Object.entries(colW))
      ws.getColumn(Number(c) + 1).width = colWidthToXlsx(px)
    for (const r of view?.hiddenRows || []) ws.getRow(r + 1).height = rowHeightToXlsx(DEFAULT_ROW_H)
    for (const [r, px] of Object.entries(rowH))
      ws.getRow(Number(r) + 1).height = rowHeightToXlsx(px)
  }

  // The workbook as .xlsx bytes.
  async function buildXLSX() {
    const formats = getFormats?.()
    const merge = getMerge?.()
    const condFormat = getCondFormat?.()
    const views = getViews?.() || {}
    const ExcelJS = await _excel()
    const wb = new ExcelJS.Workbook()
    const used = new Set()
    // Our name → its name in the file.
    const fileNames = new Map()
    for (const sn of sheetNames()) {
      const view = views[sn]
      const rows = view?.freezeRows || 0
      const cols = view?.freezeCols || 0
      fileNames.set(sn, _excelSheetName(sn, used))
      const ws = wb.addWorksheet(fileNames.get(sn), {
        // Our default sizes, so an unsized column fits what fits here
        // (Excel's 8.43 showed ######## in every amount and date).
        properties: {
          defaultColWidth: colWidthToXlsx(DEFAULT_COL_W),
          defaultRowHeight: rowHeightToXlsx(DEFAULT_ROW_H),
        },
        views:
          rows || cols
            ? [{ state: 'frozen', xSplit: cols, ySplit: rows, topLeftCell: cellId(rows, cols) }]
            : [],
      })
      await _buildWorksheet(ws, sn, { formats, merge, condFormat, view })
    }
    const buf = await wb.xlsx.writeBuffer()
    return (await _withCharts(buf, fileNames, views)) ?? buf
  }

  // The file with each sheet's charts added (ExcelJS writes none), or null
  // when there are none.
  async function _withCharts(buf, fileNames, views) {
    const all = getCharts?.()?.list() || []
    if (!all.length) return null
    const zip = await _zip(buf)
    if (!zip) return null
    // Overlay px → px from A1's top-left.
    const sheets = [...fileNames].map(([sn, name]) => ({
      name,
      layout: views[sn],
      charts: all
        .filter((c) => c.position?.sheet === sn)
        .map((c) => ({
          spec: c,
          x: c.position.x - ROW_HEADER_W,
          y: c.position.y - COL_HEADER_H,
          width: c.position.width,
          height: c.position.height,
        })),
    }))
    const n = await writeCharts(zip, sheets, (sn) => fileNames.get(sn))
    return n ? zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }) : null
  }

  async function exportXLSX() {
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    _download(new Blob([await buildXLSX()], { type }), 'xlsx')
  }

  // Excel caps sheet names at 31 chars, bans []:*?/\ and duplicates. Coerce to
  // a safe, unique name so addWorksheet never throws mid-export.
  function _excelSheetName(name, used) {
    let base =
      String(name || 'Sheet')
        .replace(/[[\]:*?/\\]/g, ' ')
        .slice(0, 31)
        .trim() || 'Sheet'
    let out = base,
      n = 1
    while (used.has(out.toLowerCase())) {
      const suffix = ` (${++n})`
      out = base.slice(0, 31 - suffix.length) + suffix
    }
    used.add(out.toLowerCase())
    return out
  }

  async function exportPDF() {
    const sn = currentSheet.value
    // Open the window before the read: a popup opened after an await is no
    // longer tied to the click, and browsers block it.
    const win = window.open('', '_blank', 'width=800,height=600')
    if (!win) return
    const { displays: rows } = await cells.readSheet(sn)
    if (!rows.length) {
      win.close()
      return
    }
    const thead = `<tr>${rows[0].map((c) => `<th>${_esc(c)}</th>`).join('')}</tr>`
    const tbody = rows
      .slice(1)
      .map((r) => `<tr>${r.map((c) => `<td>${_esc(c)}</td>`).join('')}</tr>`)
      .join('')
    const title = getCurrentTitle()
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${_esc(title)}</title>
    <style>
      body{font:11px/1.4 Arial,sans-serif;margin:20px}
      h2{font-size:14px;margin:0 0 12px}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}
      th{background:#f2f2f2;font-weight:600}
      @page{margin:1.5cm}
    </style></head>
    <body><h2>${_esc(title)} — ${_esc(sn)}</h2>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table></body></html>`
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  // ── imports ──────────────────────────────────────────────────────────────────
  //
  // Large imports (50 MB CSV, 100k+ rows) must not freeze the page:
  //   1) Cells go to the worker as batch commands of WRITE_CHUNK cells, each
  //      one recalculation, so no single message or apply is huge.
  //   2) Building the cell map yields to the event loop every CHUNK_ROWS rows.
  //   3) Imports are not undoable (matches Sheets / Excel behaviour).
  const CHUNK_ROWS = 2000
  const WRITE_CHUNK = 50_000

  function _yield() {
    return new Promise((r) => setTimeout(r, 0))
  }

  // Collects {cellId: input} and hands it to cells.write every WRITE_CHUNK
  // cells.
  function _writer(sn) {
    let map = {}
    let n = 0
    return {
      add(id, value) {
        map[id] = value
        if (++n % WRITE_CHUNK === 0) this.flush()
      },
      flush() {
        if (Object.keys(map).length) cells.write(sn, map)
        map = {}
      },
    }
  }

  async function importXLSX(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const ExcelJS = await _excel()
      let buf = await file.arrayBuffer()
      // The picker takes .xls and .ods too, which only SheetJS reads: they
      // come in through the .xlsx it writes of them (values, formulas,
      // number formats and merges; no styles).
      if (!/\.xls[xm]$/i.test(file.name || 'book.xlsx')) buf = await _toXlsx(buf)
      const wb = new ExcelJS.Workbook()
      // A number under a date code comes in as a UTC Date, which _cellIn
      // turns back into its day serial: no local-time shift (ISSUES #58).
      await wb.xlsx.load(buf)
      await _ingestWorkbook(wb, await _zip(buf))
    } finally {
      e.target.value = '' // always reset so re-picking the same file re-fires
    }
  }

  // Import every worksheet as a NEW sub-sheet — non-destructive, so the user's
  // current sheets are untouched. Each cell carries its value/formula, number
  // format and style, and each sheet its sizes, hides, freeze, merges and
  // conditional formats, and the charts on it. A new file's one blank sheet
  // becomes the first imported sheet instead of staying in front of them.
  // zip: the file's zip (JSZip), for what ExcelJS doesn't read; may be null.
  async function _ingestWorkbook(wb, zip) {
    const stores = {
      formats: getFormats?.(),
      merge: getMerge?.(),
      condFormat: getCondFormat?.(),
      // ExcelJS keeps the file's theme only as its XML.
      theme: themePalette(wb._themes?.theme1),
    }
    const heights = zip && (await _customHeights(zip))
    let blank = wb.worksheets.length ? await _blankSheet() : null
    const existing = new Set(
      sheetNames()
        .filter((n) => n !== blank)
        .map((n) => n.toLowerCase()),
    )
    // Every tab's name first: a formula may name a sheet later in the file,
    // and must follow it when it gets a new name (`Sales` → `Sales (2)`).
    const renames = {}
    for (const ws of wb.worksheets) {
      renames[ws.name] = _uniqueSheetName(ws.name, existing)
      // The blank `Sheet1` taking the file's `sheet1` keeps its spelling:
      // no rename by case alone.
      if (ws === wb.worksheets[0] && blank?.toLowerCase() === renames[ws.name].toLowerCase())
        renames[ws.name] = blank
      existing.add(renames[ws.name].toLowerCase())
    }
    const views = {}
    let firstAdded = null
    // finally: even if a worksheet throws mid-import, resync the tab bar so the
    // engine and UI never disagree about which sheets exist, and surface what
    // was already ingested.
    try {
      for (const ws of wb.worksheets) {
        const name = renames[ws.name]
        // The blank sheet takes the first one's name (a no-op when it has it).
        if (!blank || !renameSheet(blank, name)) cells.addSheet(name)
        blank = null
        if (!firstAdded) firstAdded = name
        views[name] = await _ingestWorksheet(ws, stores, name, renames, heights?.get(ws.name))
      }
      if (zip) await _ingestCharts(zip, renames, views)
    } finally {
      // The tab list is the engine's as of its last apply, so wait for the
      // adds. Only dirty the doc when a sheet was actually added (an empty
      // workbook, or a throw before the first add, must not mark it dirty).
      await cells.idle().catch(() => {})
      syncNames?.()
      // Before the switch, which applies the first new sheet's view.
      if (setViews && Object.keys(views).length) setViews({ ...getViews?.(), ...views })
      if (firstAdded) {
        switchSheet?.(firstAdded)
        syncFlags()
        isDirty.value = true
      } else {
        repopulateGrid()
      }
    }
  }

  // The workbook's only sheet when nothing is on it (no cells, formats,
  // merges, rules, charts, notes, validation, protection, slicers): a new
  // file's Sheet1. Else null.
  async function _blankSheet() {
    const names = sheetNames()
    if (!renameSheet || !cells.extent || names.length !== 1) return null
    const sn = names[0]
    const layers = getFormats?.()?.snapshot?.()?.[sn] || {}
    const used =
      ['cells', 'cols', 'rows'].some((k) => Object.keys(layers[k] || {}).length) ||
      Object.keys(getMerge?.()?.snapshot()?.[sn]?.masterMap || {}).length ||
      getCondFormat?.()?.getRules(sn)?.length ||
      getCharts?.()
        ?.list()
        .some((c) => c.position?.sheet === sn || c.sourceSheet === sn) ||
      (getSheetStores?.() || []).some((s) => Object.keys(s.snapshot()?.[sn] || {}).length)
    if (used) return null
    return (await cells.extent(sn)) ? null : sn
  }

  // Adds the file's charts on the sheets they came in as, and says how many
  // it left out (types and layouts we can't draw: xlsx-charts.ts, or data
  // on a sheet that isn't in the file).
  async function _ingestCharts(zip, renames, views) {
    const charts = getCharts?.()
    if (!charts) return
    // A sheet named in a ref matches its tab whatever the case.
    const named = new Map(Object.entries(renames).map(([k, v]) => [k.toLowerCase(), v]))
    const as = (sheet) => named.get(String(sheet).toLowerCase())
    const read = await readCharts(zip, (sheet) => views[as(sheet)])
    let skipped = read.skipped
    for (const { sheet, spec, x, y, width, height } of read.charts) {
      if (!as(sheet) || !as(spec.sourceSheet)) {
        skipped++
        continue
      }
      charts.add({
        ...spec,
        sourceSheet: as(spec.sourceSheet),
        position: {
          sheet: as(sheet),
          x: x + ROW_HEADER_W,
          y: y + COL_HEADER_H,
          width,
          height,
        },
      })
    }
    if (skipped)
      toast.info(
        `${skipped} chart${skipped === 1 ? ' was' : 's were'} not imported: only bar, line, area, pie and scatter charts over columns of the file's own sheets come in.`,
      )
  }

  // Ingests one worksheet and returns its view (sizes, hides, freeze).
  // custom: its hand-set rows, or undefined when unknown (all count as set).
  async function _ingestWorksheet(
    ws,
    { formats, merge, condFormat, theme },
    name,
    renames,
    custom,
  ) {
    const view = {
      colW: {},
      rowH: {},
      freezeRows: 0,
      freezeCols: 0,
      hiddenRows: [],
      hiddenCols: [],
      manualRows: [],
    }
    // includeEmpty: a filled cell with no value still carries a format.
    const all = []
    ws.eachRow({ includeEmpty: true }, (row) => {
      const r = row.number - 1
      // A default height reads as none (we write it on hidden rows), and a
      // hidden row squashed to nothing keeps ours.
      const h = row.height && rowHeightFromXlsx(row.height)
      if (h && h !== DEFAULT_ROW_H && !(row.hidden && h < MIN_ROW_H)) {
        view.rowH[r] = Math.max(MIN_ROW_H, h)
        // Set by hand: kept from auto-fitting. One Excel fitted to its text
        // refits here as well.
        if (!custom || custom.has(r)) view.manualRows.push(r)
      }
      if (row.hidden) view.hiddenRows.push(r)
      // A merged cell reads as its top-left cell (value, formula, style), so
      // only the top-left one is the merge's own.
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.isMerged || cell.master === cell) all.push(cell)
      })
    })
    // The font most cells use reads as no font (Google writes Arial 10).
    const opts = { theme, font: commonFont(all.map((c) => c.style)) }

    const out = _writer(name)
    const fmts = []
    let n = 0
    for (const cell of all) {
      const id = cellId(cell.row - 1, cell.col - 1)
      const { value, fmt } = fromXlsxCell(_cellIn(cell))
      if (value !== '' && value != null) out.add(id, renameSheetsInFormula(value, renames))
      const f = _withNumFmt(styleFromXlsx(cell.style, opts), fmt)
      if (f) fmts.push([id, f])
      if (++n % CHUNK_ROWS === 0) await _yield()
    }
    out.flush()

    // Column and row formats before the cells' own, which win over them.
    ;(ws.columns || []).forEach((col, c) => {
      // isCustomWidth: ExcelJS reads a <col> with no width as 9 characters.
      // A hidden column squashed to nothing keeps ours; a visible one is no
      // narrower than one can be dragged to.
      const w = col.isCustomWidth && colWidthFromXlsx(col.width)
      if (w && w !== DEFAULT_COL_W && !(col.hidden && w < MIN_COL_W))
        view.colW[c] = Math.max(MIN_COL_W, w)
      if (col.hidden) view.hiddenCols.push(c)
      const f = _withNumFmt(
        styleFromXlsx(col.style, opts),
        fromXlsxCell({ z: col.style?.numFmt }).fmt,
      )
      if (f) formats?.setCol(c, f, name)
    })
    if (formats) {
      ws.eachRow({ includeEmpty: true }, (row) => {
        const f = _withNumFmt(
          styleFromXlsx(row.style, opts),
          fromXlsxCell({ z: row.style?.numFmt }).fmt,
        )
        if (f) formats.setRow(row.number - 1, f, name)
      })
      for (const [id, f] of fmts) formats.set(id, f, name)
    }

    const frozen = (ws.views || []).find((v) => v.state === 'frozen')
    if (frozen) {
      view.freezeRows = frozen.ySplit || 0
      view.freezeCols = frozen.xSplit || 0
    }
    // ExcelJS keeps merges only privately, keyed by their top-left cell.
    if (merge)
      for (const m of Object.values(ws._merges || {}))
        for (const { r0, c0, r1, c1 } of refToRects(m.range)) merge.merge(r0, c0, r1, c1, name)
    if (condFormat)
      for (const cf of ws.conditionalFormattings || [])
        for (const rule of cfFromXlsx(cf, { theme })) condFormat.addRule(rule, name)
    return view
  }

  // Ensure an imported worksheet name doesn't collide with an existing sheet.
  function _uniqueSheetName(name, existing) {
    const base = String(name || 'Sheet').trim() || 'Sheet'
    let out = base,
      n = 1
    while (existing.has(out.toLowerCase())) out = `${base} (${++n})`
    return out
  }

  function importCSV(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const rows = _parseCSV(ev.target.result)
      await _ingestRows(rows)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // A CSV replaces the open sheet's cells. No undo entry (Sheets parity).
  async function _ingestRows(rows) {
    const sn = currentSheet.value
    await cells.clear(sn) // dispatches before the writes below, so it can't erase them
    const out = _writer(sn)
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      for (let c = 0; c < row.length; c++) {
        const val = row[c]
        if (val !== '' && val != null) out.add(cellId(r, c), String(val))
      }
      if ((r + 1) % CHUNK_ROWS === 0) await _yield()
    }
    out.flush()
    syncFlags()
    isDirty.value = true
  }

  return { exportCSV, exportXLSX, buildXLSX, exportPDF, importCSV, importXLSX }
}
