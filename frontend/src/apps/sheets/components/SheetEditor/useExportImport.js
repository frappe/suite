import { fromXlsxCell, mergesFromXlsx, mergesToXlsx, toXlsxCell } from '../../engine/xlsx-io.js'
import { cellId, colLabel, parseCellId } from '../../utils/cells.js'

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

// ── composable ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.cells – the workbook, through IronCalc:
 *   readSheet(sn) → Promise<{ inputs, displays }>, rows from A1 to the last
 *     used cell ([] when the sheet is empty);
 *   write(sn, map) writes a {cellId: input} map; clear(sn) → Promise, empties
 *   the sheet's cells; addSheet(name) adds a sheet; idle() resolves once all
 *   of it applied.
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

  // Build a SheetJS worksheet from one sub-sheet, preserving value types,
  // formulas (with their computed value), number formats, and merges — the
  // lossy display-string path only round-tripped visible text.
  async function _buildWorksheet(formats, merge, sn) {
    const { inputs, displays } = await cells.readSheet(sn)
    const ws = {}
    let maxR = 0,
      maxC = 0
    inputs.forEach((row, r) =>
      row.forEach((raw, c) => {
        if (raw === '') return
        const id = cellId(r, c)
        const computed = raw.startsWith('=') ? displays[r][c] : null
        const fmt = formats?.get(id, sn)?.numberFormat || ''
        const cell = toXlsxCell(raw, computed, fmt)
        if (!cell) return
        ws[id] = cell
        if (r > maxR) maxR = r
        if (c > maxC) maxC = c
      }),
    )
    ws['!ref'] = `A1:${colLabel(maxC)}${maxR + 1}`
    const merges = merge ? mergesToXlsx(merge.snapshot()?.[sn]?.masterMap) : []
    if (merges.length) ws['!merges'] = merges
    return ws
  }

  async function exportXLSX() {
    const formats = getFormats?.()
    const merge = getMerge?.()
    const { utils, writeFile } = await import('xlsx')
    const wb = utils.book_new()
    const used = new Set()
    for (const sn of sheetNames()) {
      const ws = await _buildWorksheet(formats, merge, sn)
      utils.book_append_sheet(wb, ws, _excelSheetName(sn, used))
    }
    writeFile(wb, `${getCurrentTitle() || 'sheet'}.xlsx`)
  }

  // Excel caps sheet names at 31 chars, bans []:*?/\ and duplicates. Coerce to
  // a safe, unique name so book_append_sheet never throws mid-export.
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
      const { read } = await import('xlsx')
      const buf = await file.arrayBuffer()
      // cellFormula keeps `=…`, cellDates yields Date objects, cellNF keeps the
      // number-format code — all three are what makes the import lossless.
      const wb = read(buf, { type: 'array', cellFormula: true, cellDates: true, cellNF: true })
      await _ingestWorkbook(wb)
    } finally {
      e.target.value = '' // always reset so re-picking the same file re-fires
    }
  }

  // Import every worksheet as a NEW sub-sheet — non-destructive, so the user's
  // current sheets are untouched. Each cell carries its value/formula, number
  // format, and the sheet's merges.
  async function _ingestWorkbook(wb) {
    const formats = getFormats?.()
    const merge = getMerge?.()
    const existing = new Set(sheetNames().map((n) => n.toLowerCase()))
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
        cells.addSheet(name)
        if (!firstAdded) firstAdded = name
        await _ingestWorksheet(ws, formats, merge, name)
      }
    } finally {
      // The tab list is the engine's as of its last apply, so wait for the
      // adds. Only dirty the doc when a sheet was actually added (an empty
      // workbook, or a throw before the first add, must not mark it dirty).
      await cells.idle().catch(() => {})
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

  async function _ingestWorksheet(ws, formats, merge, name) {
    const out = _writer(name)
    const fmts = []
    let n = 0
    for (const [id, cell] of Object.entries(ws)) {
      if (id[0] === '!') continue // !ref, !merges, !cols meta keys
      if (!parseCellId(id)) continue
      const { value, fmt } = fromXlsxCell(cell)
      if (value !== '' && value != null) out.add(id, value)
      if (fmt) fmts.push([id, fmt])
      if (++n % CHUNK_ROWS === 0) await _yield()
    }
    out.flush()
    if (formats) for (const [id, fmt] of fmts) formats.set(id, { numberFormat: fmt }, name)
    if (merge && Array.isArray(ws['!merges'])) {
      for (const { r0, c0, r1, c1 } of mergesFromXlsx(ws['!merges']))
        merge.merge(r0, c0, r1, c1, name)
    }
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

  return { exportCSV, exportXLSX, exportPDF, importCSV, importXLSX }
}
