import { colLabel, parseCellId } from '../../utils/cells.js'
import { toXlsxCell, fromXlsxCell, mergesToXlsx, mergesFromXlsx } from '../../engine/xlsx-io.js'

// ── private helpers ────────────────────────────────────────────────────────────

function _sheetToAoa(sheetName, sheet) {
  const data = sheet.getRawData(sheetName)
  let maxR = 0, maxC = 0
  for (const id of Object.keys(data)) {
    const p = parseCellId(id)
    if (!p) continue
    if (p.row > maxR) maxR = p.row
    if (p.col > maxC) maxC = p.col
  }
  const rows = []
  for (let r = 0; r <= maxR; r++) {
    const row = []
    for (let c = 0; c <= maxC; c++)
      row.push(sheet.getDisplayValue(colLabel(c) + (r + 1), sheetName) ?? '')
    rows.push(row)
  }
  return rows
}

function _esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
          if (s[i] === '"' && s[i + 1] === '"') { cell += '"'; i += 2 }
          else if (s[i] === '"') { i++; break }
          else cell += s[i++]
        }
        row.push(cell)
      } else {
        // Unquoted field — ends at ',' or newline
        const start = i
        while (i < s.length && s[i] !== ',' && s[i] !== '\n') i++
        row.push(s.slice(start, i))
      }
      if (i >= s.length || s[i] === '\n') { i++; break }
      i++ // skip ','
    }
    rows.push(row)
  }
  return rows
}

// ── composable ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {() => object}  opts.getSheet        – returns the sheet engine
 * @param {() => string}  opts.getCurrentTitle – current document title
 * @param {() => object|null} opts.getGrid     – returns the canvas grid or null
 * @param {(op: object) => void} opts.queueOp  – enqueue an operation
 * @param {() => void}    opts.repopulateGrid  – full canvas repaint
 * @param {() => void}    opts.syncFlags       – sync undo/redo button state
 * @param {import('vue').Ref<boolean>} opts.isDirty – dirty flag ref
 */
export function useExportImport({
  getSheet,
  getCurrentTitle,
  getGrid,
  getFormats,
  getMerge,
  queueOp,
  repopulateGrid,
  syncNames,
  switchSheet,
  syncFlags,
  isDirty,
}) {
  function _diffRefs(before, after) {
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
    return [...ids].filter(id => (before?.[id]) !== (after?.[id]))
  }

  // ── exports ──────────────────────────────────────────────────────────────────

  function exportCSV() {
    const sheet = getSheet()
    const rows  = _sheetToAoa(sheet.getCurrentSheet(), sheet)
    const csv   = rows.map(row => row.map(v => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${getCurrentTitle() || 'sheet'}.csv`,
    })
    a.click()
  }

  // Build a SheetJS worksheet from one sub-sheet, preserving value types,
  // formulas (with their computed value), number formats, and merges — the
  // lossy display-string path only round-tripped visible text.
  function _buildWorksheet(sheet, formats, merge, sn) {
    const data = sheet.getRawData(sn)
    const ws = {}
    let maxR = 0, maxC = 0
    for (const [id, raw] of Object.entries(data)) {
      const p = parseCellId(id)
      if (!p) continue
      const isFormula = typeof raw === 'string' && raw.startsWith('=')
      const computed  = isFormula ? sheet.getCellValue(id, sn) : null
      const fmt  = formats?.get(id, sn)?.numberFormat || ''
      const cell = toXlsxCell(raw, computed, fmt)
      if (!cell) continue
      ws[id] = cell
      if (p.row > maxR) maxR = p.row
      if (p.col > maxC) maxC = p.col
    }
    ws['!ref'] = `A1:${colLabel(maxC)}${maxR + 1}`
    const merges = merge ? mergesToXlsx(merge.snapshot()?.[sn]?.masterMap) : []
    if (merges.length) ws['!merges'] = merges
    return ws
  }

  async function exportXLSX() {
    const sheet   = getSheet()
    const formats = getFormats?.()
    const merge   = getMerge?.()
    const { utils, writeFile } = await import('xlsx')
    const wb = utils.book_new()
    const used = new Set()
    for (const sn of sheet.getSheetNames()) {
      const ws = _buildWorksheet(sheet, formats, merge, sn)
      utils.book_append_sheet(wb, ws, _excelSheetName(sn, used))
    }
    writeFile(wb, `${getCurrentTitle() || 'sheet'}.xlsx`)
  }

  // Excel caps sheet names at 31 chars, bans []:*?/\ and duplicates. Coerce to
  // a safe, unique name so book_append_sheet never throws mid-export.
  function _excelSheetName(name, used) {
    let base = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet'
    let out = base, n = 1
    while (used.has(out.toLowerCase())) {
      const suffix = ` (${++n})`
      out = base.slice(0, 31 - suffix.length) + suffix
    }
    used.add(out.toLowerCase())
    return out
  }

  function exportPDF() {
    const sheet = getSheet()
    const sn    = sheet.getCurrentSheet()
    const rows  = _sheetToAoa(sn, sheet)
    if (!rows.length) return
    const thead = `<tr>${rows[0].map(c => `<th>${_esc(c)}</th>`).join('')}</tr>`
    const tbody = rows.slice(1)
      .map(r => `<tr>${r.map(c => `<td>${_esc(c)}</td>`).join('')}</tr>`).join('')
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
    const win = window.open('', '_blank', 'width=800,height=600')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  // ── imports ──────────────────────────────────────────────────────────────────
  //
  // Large imports (50 MB CSV, 100k+ rows) used to freeze the main thread for
  // tens of seconds — Chrome would put up its "Page Unresponsive" dialog.
  // Three changes fix that:
  //   1) Build a plain {cellId: value} map first, then hand it to the engine's
  //      batchSetCells (one dep-graph rebuild + one bulk repaint, no per-cell
  //      formula cascades).
  //   2) Chunk the cell-id construction loop so it yields to the event loop
  //      every CHUNK_ROWS rows — the browser stays responsive even if the
  //      import takes a couple of seconds.
  //   3) Imports are not undoable (matches Sheets / Excel behaviour). The
  //      before/after snapshot of every cell was eating ~2× memory and a
  //      separate iteration pass; dropping it is a clean win.
  const CHUNK_ROWS = 2000

  function _yield() { return new Promise(r => setTimeout(r, 0)) }

  // Build {cellId: value} from a rectangular row array, yielding to the
  // event loop every CHUNK_ROWS rows so the UI stays responsive on big files.
  async function _rowsToCellMap(rows) {
    const out = {}
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      for (let c = 0; c < row.length; c++) {
        const val = row[c]
        if (val !== '' && val != null) out[colLabel(c) + (r + 1)] = String(val)
      }
      if ((r + 1) % CHUNK_ROWS === 0) await _yield()
    }
    return out
  }

  async function importXLSX(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const { read } = await import('xlsx')
      const buf = await file.arrayBuffer()
      // cellFormula keeps `=…`, cellDates yields Date objects, cellNF keeps the
      // number-format code — all three are what makes the import lossless.
      const wb = read(buf, { type: 'array', cellFormula: true, cellDates: true, cellNF: true })
      await _ingestWorkbook(wb)
    } finally {
      e.target.value = ''   // always reset so re-picking the same file re-fires
    }
  }

  // Import every worksheet as a NEW sub-sheet — non-destructive, so the user's
  // current sheets are untouched. Each cell carries its value/formula, number
  // format, and the sheet's merges.
  async function _ingestWorkbook(wb) {
    const sheet    = getSheet()
    const formats  = getFormats?.()
    const merge    = getMerge?.()
    const existing = new Set(sheet.getSheetNames().map(n => n.toLowerCase()))
    let firstAdded = null
    // finally: even if a worksheet throws mid-import, resync the tab bar so the
    // engine and UI never disagree about which sheets exist, and surface what
    // was already ingested.
    try {
      for (const wsName of wb.SheetNames) {
        const ws = wb.Sheets[wsName]
        if (!ws) continue
        const name = _uniqueSheetName(wsName, existing)
        existing.add(name.toLowerCase())
        sheet.addSheet(name)
        if (!firstAdded) firstAdded = name
        await _ingestWorksheet(ws, sheet, formats, merge, name)
      }
    } finally {
      // Always resync the tab bar so engine + UI agree even after a partial
      // import; only dirty the doc when a sheet was actually added (an empty
      // workbook, or a throw before the first add, must not mark it dirty).
      syncNames?.()
      if (firstAdded) {
        switchSheet?.(firstAdded)
        syncFlags()
        isDirty.value = true
      } else {
        repopulateGrid()
      }
    }
  }

  async function _ingestWorksheet(ws, sheet, formats, merge, name) {
    const map = {}
    const fmts = []
    let n = 0
    for (const [id, cell] of Object.entries(ws)) {
      if (id[0] === '!') continue                  // !ref, !merges, !cols meta keys
      if (!parseCellId(id)) continue
      const { value, fmt } = fromXlsxCell(cell)
      if (value !== '' && value != null) map[id] = value
      if (fmt) fmts.push([id, fmt])
      if (++n % CHUNK_ROWS === 0) await _yield()
    }
    sheet.batchSetCells(map, name, { replace: false })
    if (formats) for (const [id, fmt] of fmts) formats.set(id, { numberFormat: fmt }, name)
    if (merge && Array.isArray(ws['!merges'])) {
      for (const { r0, c0, r1, c1 } of mergesFromXlsx(ws['!merges'])) merge.merge(r0, c0, r1, c1, name)
    }
  }

  // Ensure an imported worksheet name doesn't collide with an existing sheet.
  function _uniqueSheetName(name, existing) {
    const base = String(name || 'Sheet').trim() || 'Sheet'
    let out = base, n = 1
    while (existing.has(out.toLowerCase())) out = `${base} (${++n})`
    return out
  }

  function importCSV(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const text = ev.target.result
      const rows = _parseCSV(text)
      await _ingestRows(rows, file.name)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Shared post-parse pipeline: chunked map build → bulk engine write →
  // dirty flag. No undo entry (imports replace the sheet, by design).
  async function _ingestRows(rows, fileName) {
    const sheet     = getSheet()
    const grid      = getGrid()
    const currentSh = sheet.getCurrentSheet()
    const map       = await _rowsToCellMap(rows)
    if (grid) grid.clearAll()
    sheet.batchSetCells(map, currentSh)
    // No history entry: imports aren't undoable (Sheets parity). The old
    // markEdited() path pushed a full-workbook snapshot here — a ~1.9s
    // deepClone on a 2M-cell import, for an op the user can't even undo.
    // Just flag dirty + refresh the toolbar so autosave picks it up.
    syncFlags()
    isDirty.value = true
    return fileName
  }

  return { exportCSV, exportXLSX, exportPDF, importCSV, importXLSX }
}
