// The editor's IronCalc workbook. IronCalc (core/: worker, client, display
// cache) holds every cell. The grid reads display values and inputs through
// the cell provider; every write is a command sent with client.dispatch.
// Extracted from SheetEditor/index.vue.
//
// Usage:
//   const { startEngine, stopEngine, readRect, writeInputs, … } = useWorkbook({
//     currentSheet, namedRanges, getGrid, syncNames, onVersion, onUsedExtent })
//
// What reacts to the workbook stays with the editor and comes in as
// callbacks: syncNames when its sheet list changes, onVersion after every
// applied edit, onUsedExtent when the open sheet's data extent is read,
// onCrash(reason) if the worker dies (the workbook is lost with it).

import { createCellProvider } from '../../core/cell-provider'
import { createWorkbookClient } from '../../core/client'
import { createDisplayCache } from '../../core/display-cache'
import { MAX_VIEWPORT_CELLS } from '../../core/limits'
import { definedNameFormula } from '../../engine/named-ranges.js'
import { parseSparkline } from '../../engine/sparkline.js'
import { cellId, parseCellId } from '../../utils/cells.js'

export function useWorkbook({
  currentSheet,
  namedRanges,
  getGrid,
  syncNames,
  onVersion,
  onUsedExtent,
  onCrash,
}) {
  // { client, provider, offSheets, offVersion, offCrash } once started (see startEngine).
  let engine = null

  async function startEngine(snapshotBytes = null) {
    stopEngine()
    const cache = createDisplayCache()
    const client = await createWorkbookClient({ echo: cache, snapshotBytes })
    client.onCommandError((f) =>
      console.error('[sheets] IronCalc rejected', f.command.type, f.error),
    )
    const provider = createCellProvider({
      client,
      cache,
      requestRender: () => getGrid()?.render?.(),
    })
    // Tabs follow the workbook: its sheets on load, and any later change.
    const offSheets = client.onSheets(() => syncNames())
    const offVersion = client.onVersion(() => onVersion())
    const offCrash = client.onCrash((reason) => onCrash(reason))
    engine = { client, provider, offSheets, offVersion, offCrash }
    // The saved bytes may predate names being sent to IronCalc: send them all.
    namesInEngine = new Map()
    syncDefinedNames()
    syncNames()
    refreshUsedCells() // size the grid to the loaded data
    getGrid()?.render?.()
  }

  function stopEngine() {
    engine?.offSheets()
    engine?.offVersion()
    engine?.offCrash()
    engine?.provider.dispose()
    engine?.client.terminate()
    engine = null
  }

  // The running workbook client, or null before start and after stop.
  function engineClient() {
    return engine?.client ?? null
  }

  function engineBytes() {
    if (!engine) return Promise.reject(new Error('IronCalc is not running'))
    return engine.client.toBytes()
  }

  let commandSeq = 0

  function command(type, payload) {
    return { id: `ui-${Date.now()}-${commandSeq++}`, actor: 'local', ts: Date.now(), type, payload }
  }

  // One cell's write: setInput, or clearContents when the value is empty.
  function inputCommand(sn, id, value) {
    const p = parseCellId(id)
    if (!p) return null
    const row = p.row + 1
    const col = p.col + 1
    const input = value == null ? '' : String(value)
    return input === ''
      ? command('clearContents', { sheet: sn, range: { r1: row, c1: col, r2: row, c2: col } })
      : command('setInput', { sheet: sn, row, col, input })
  }

  // Writes a {cellId: value} map as one command, so a multi-cell edit or an
  // undo recalculates once.
  function writeInputs(sn, map) {
    if (!engine) return
    const commands = Object.entries(map)
      .map(([id, value]) => inputCommand(sn, id, value))
      .filter(Boolean)
    if (commands.length === 1) engine.client.dispatch(commands[0])
    else if (commands.length > 1) engine.client.dispatch(command('batch', { commands }))
  }

  // Named ranges live in their own store (the dialog edits it, the document
  // saves it); IronCalc evaluates `=Name` from defined names. This sends
  // IronCalc whatever differs from what it was last sent, so calling it after
  // anything that may change the store (dialog, undo, load, sheet rename,
  // row/column ops) is cheap.
  let namesInEngine = new Map() // name → formula
  function syncDefinedNames() {
    if (!engine) return
    const want = new Map(
      namedRanges()
        .list()
        .map((e) => [e.name, definedNameFormula(e)]),
    )
    const commands = []
    for (const name of namesInEngine.keys())
      if (!want.has(name)) commands.push(command('deleteDefinedName', { name }))
    for (const [name, formula] of want)
      if (namesInEngine.get(name) !== formula)
        commands.push(command('setDefinedName', { name, formula }))
    namesInEngine = want
    if (commands.length === 1) engine.client.dispatch(commands[0])
    else if (commands.length > 1) engine.client.dispatch(command('batch', { commands }))
  }

  // The cell's input (a formula, not its result) when its area is on screen,
  // else undefined. Writes use it as the value they replace.
  function inputAt(id, sn = currentSheet.value) {
    const p = parseCellId(id)
    return p && engine ? engine.provider.getInput(sn, p.row + 1, p.col + 1) : undefined
  }

  // The input a cell is painted with, kept through a refresh: lets the grid
  // keep drawing a sparkline while its value is re-read. Not for edits.
  function paintedInput(id, sn = currentSheet.value) {
    const p = parseCellId(id)
    return p && engine ? engine.provider.peekInput(sn, p.row + 1, p.col + 1) : undefined
  }

  // A rect's inputs and display strings (0-based rect), read from the worker in
  // chunks of rows that fit one readViewport. `numFmts: true` also returns
  // IronCalc's own number format per cell (what typing `$1.50` sets), for
  // copy and fill to carry.
  async function readRect(sn, rect, { numFmts: wantFmts = false } = {}) {
    const inputs = []
    const displays = []
    const numFmts = []
    if (!engine) return wantFmts ? { inputs, displays, numFmts } : { inputs, displays }
    const cols = rect.c1 - rect.c0 + 1
    const step = Math.max(1, Math.floor(MAX_VIEWPORT_CELLS / cols))
    for (let r = rect.r0; r <= rect.r1; r += step) {
      const res = await engine.client.readViewport({
        sheet: sn,
        r1: r + 1,
        c1: rect.c0 + 1,
        r2: Math.min(r + step - 1, rect.r1) + 1,
        c2: rect.c1 + 1,
        includeInputs: true,
        includeStyles: wantFmts,
      })
      inputs.push(...(res.inputs ?? []))
      displays.push(...res.values)
      if (wantFmts)
        numFmts.push(...(res.styles ?? []).map((row) => row.map((s) => s.style.num_fmt)))
    }
    // A sparkline shows a chart, not IronCalc's #NAME?, to every reader
    // (charts, copied text, filter lists), as it does in the grid.
    inputs.forEach((row, i) =>
      row.forEach((input, j) => {
        if (parseSparkline(input)) displays[i][j] = ''
      }),
    )
    return wantFmts ? { inputs, displays, numFmts } : { inputs, displays }
  }

  // {cellId: input} for a rect: an edit op's before or after.
  async function readInputs(rect, sn = currentSheet.value) {
    const out = {}
    if (!rect) return out
    const { inputs } = await readRect(sn, rect)
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c0; c <= rect.c1; c++)
        out[cellId(r, c)] = inputs[r - rect.r0]?.[c - rect.c0] ?? ''
    return out
  }

  // Inputs of scattered cells, {cellId: input}, in one round trip.
  async function readIds(ids, sn = currentSheet.value) {
    const out = {}
    const cells = []
    for (const id of ids) {
      const p = parseCellId(id)
      if (p) cells.push({ row: p.row + 1, col: p.col + 1 })
    }
    if (!engine || !cells.length) return out
    const res = await engine.client.readCells({ sheet: sn, cells, what: ['input'] })
    for (const c of res.cells) out[cellId(c.row - 1, c.col - 1)] = c.input ?? ''
    return out
  }

  // One cell's input: from the cache when on screen, else from the worker.
  async function readInput(id, sn = currentSheet.value) {
    const known = inputAt(id, sn)
    if (known !== undefined) return known
    const p = parseCellId(id)
    if (!p) return ''
    return (await readInputs({ r0: p.row, c0: p.col, r1: p.row, c1: p.col }, sn))[id] ?? ''
  }

  // A cell's computed display string. Readers that run during a paint use this,
  // so values and conditional formats come from the same place.
  function displayValue(id, sn = currentSheet.value) {
    const p = parseCellId(id)
    return p && engine ? engine.provider.getDisplay(sn, p.row + 1, p.col + 1) : ''
  }

  // Whether the cell holds a number (it aligns right), or undefined until read.
  function isNumberAt(id, sn = currentSheet.value) {
    const p = parseCellId(id)
    return p && engine ? engine.provider.isNumber(sn, p.row + 1, p.col + 1) : undefined
  }

  // The open sheet's non-empty cells, from the worker: the grid's scroll extent,
  // Ctrl+A's extent and column autofit read them. Refreshed after every edit
  // and on switch; one read at a time, re-run when more changed meanwhile.
  let usedIds = []
  let usedMax = null // { maxRow, maxCol } (0-based), null when the sheet is empty
  let usedReading = false
  let usedStale = false
  function refreshUsedCells() {
    if (!engine) return
    if (usedReading) {
      usedStale = true
      return
    }
    usedReading = true
    const sn = currentSheet.value
    engine.client
      .usedCells({ sheet: sn })
      .then(({ cells }) => {
        if (currentSheet.value !== sn) return // a switch queued its own read
        const ids = []
        let maxRow = -1,
          maxCol = -1
        for (let i = 0; i < cells.length; i += 2) {
          const r = cells[i] - 1,
            c = cells[i + 1] - 1
          ids.push(cellId(r, c))
          if (r > maxRow) maxRow = r
          if (c > maxCol) maxCol = c
        }
        usedIds = ids
        usedMax = ids.length ? { maxRow, maxCol } : null
        if (usedMax) onUsedExtent(usedMax)
      })
      .catch((e) => {
        if (engine) console.error('[sheets] reading used cells failed', e) // see readCells
      })
      .finally(() => {
        usedReading = false
        if (usedStale) {
          usedStale = false
          refreshUsedCells()
        }
      })
  }

  // The open sheet's non-empty cell ids, as of the last read.
  function usedCellIds() {
    return usedIds
  }

  // The open sheet's data extent, or null when it is empty.
  function usedExtent() {
    return usedMax
  }

  // Any sheet's data extent (0-based), read from the worker; null when empty.
  async function sheetExtent(sn) {
    if (!engine) return null
    const { cells } = await engine.client.usedCells({ sheet: sn })
    let maxRow = -1,
      maxCol = -1
    for (let i = 0; i < cells.length; i += 2) {
      if (cells[i] - 1 > maxRow) maxRow = cells[i] - 1
      if (cells[i + 1] - 1 > maxCol) maxCol = cells[i + 1] - 1
    }
    return maxRow < 0 ? null : { maxRow, maxCol }
  }

  // A whole sheet's inputs and displays, A1 to its last used cell.
  async function readWholeSheet(sn, opts = {}) {
    const ext = await sheetExtent(sn)
    if (!ext) return { inputs: [], displays: [], numFmts: [] }
    return readRect(sn, { r0: 0, c0: 0, r1: ext.maxRow, c1: ext.maxCol }, opts)
  }

  // A rect's shown values (charts read these).
  async function readDisplays(sn, rect) {
    return (await readRect(sn, rect)).displays
  }

  // A user-typed source range's shown values, cut to the sheet's data: a range
  // like A1:Z1048576 reads only the rows that hold something.
  async function readSourceRange(sn, rect) {
    const ext = await sheetExtent(sn)
    const r1 = Math.min(rect.r1, ext?.maxRow ?? rect.r0)
    const c1 = Math.min(rect.c1, ext?.maxCol ?? rect.c0)
    return readDisplays(sn, { ...rect, r1: Math.max(r1, rect.r0), c1: Math.max(c1, rect.c0) })
  }

  // Empties a rect's cells (0-based; contents only, formats stay).
  function clearRect(sn, rect) {
    engine?.client.dispatch(
      command('clearContents', {
        sheet: sn,
        range: { r1: rect.r0 + 1, c1: rect.c0 + 1, r2: rect.r1 + 1, c2: rect.c1 + 1 },
      }),
    )
  }

  // Empties a sheet's cells (contents only; formats stay).
  async function clearSheet(sn) {
    const ext = await sheetExtent(sn)
    if (!ext || !engine) return
    engine.client.dispatch(
      command('clearContents', {
        sheet: sn,
        range: { r1: 1, c1: 1, r2: ext.maxRow + 1, c2: ext.maxCol + 1 },
      }),
    )
  }

  return {
    startEngine,
    stopEngine,
    engineClient,
    engineBytes,
    command,
    writeInputs,
    syncDefinedNames,
    inputAt,
    paintedInput,
    readRect,
    readInputs,
    readIds,
    readInput,
    displayValue,
    isNumberAt,
    refreshUsedCells,
    usedCellIds,
    usedExtent,
    sheetExtent,
    readWholeSheet,
    readDisplays,
    readSourceRange,
    clearRect,
    clearSheet,
  }
}
