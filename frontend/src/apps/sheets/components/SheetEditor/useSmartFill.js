import { applyPattern, detectPattern } from '../../engine/smart-fill.js'
import { colLabel, parseCellId } from '../../utils/cells.js'

// Adapts the pure Smart Fill engine to the SheetEditor's grid + selection.
//
// Trigger contract — `runSmartFill()`:
//   1. Inspect the active selection rectangle.
//   2. If it's a single column, look at the rows where the user already
//      typed values (the "examples") and the contiguous empty rows below.
//   3. Build training pairs from each example: target = the user's value,
//      sources = the values in every other column on that same row.
//   4. Detect a pattern; apply to each empty row's source values.
//   5. Commit the inferred values via the sheet engine + push history.
//
// Why per-row sources include "every other column on that row": the engine
// doesn't know which columns are relevant — it walks all of them and picks
// the one(s) that consistently explain the target across examples.

export function useSmartFill({
  getSheet,
  currentSheet,
  getGrid,
  queueOp,
  captureRange,
  diffRefs,
  getHistory,
  getIsDirty,
  repopulateGrid,
}) {
  function runSmartFill() {
    const history = getHistory?.()
    const isDirty = getIsDirty?.()
    const grid = getGrid?.()
    if (!grid) return { ok: false, reason: 'no-grid' }
    const sel = grid.getSelection?.()
    if (!sel) return { ok: false, reason: 'no-selection' }
    const sheet = getSheet?.()
    if (!sheet) return { ok: false, reason: 'no-sheet' }
    const sheetName = currentSheet.value

    // Currently support single-column selections. Multi-column requires
    // a richer "which column am I filling" UI — out of scope for v1.
    if (sel.c0 !== sel.c1) return { ok: false, reason: 'single-column-only' }
    const targetCol = sel.c0

    // Walk the selection top-down to split examples (filled) from
    // target rows (empty).
    const exampleRows = []
    const targetRows = []
    for (let r = sel.r0; r <= sel.r1; r++) {
      const id = colLabel(targetCol) + (r + 1)
      const val = sheet.getCell(id, sheetName)
      if (val !== '' && val != null) exampleRows.push(r)
      else targetRows.push(r)
    }
    if (exampleRows.length < 1) return { ok: false, reason: 'no-examples' }
    if (targetRows.length === 0) return { ok: false, reason: 'no-empty-cells' }

    // Determine the "source" column window: every non-empty column on the
    // example rows (excluding the target column). Cap at 8 to keep
    // pattern search cheap.
    const sourceCols = _detectSourceCols(sheet, sheetName, exampleRows, targetCol)
    if (!sourceCols.length) return { ok: false, reason: 'no-source-columns' }

    // Build examples for the engine.
    const examples = exampleRows.map((r) => ({
      target: sheet.getCell(colLabel(targetCol) + (r + 1), sheetName),
      sources: sourceCols.map((c) => sheet.getCell(colLabel(c) + (r + 1), sheetName)),
    }))
    const pattern = detectPattern(examples)
    if (!pattern) return { ok: false, reason: 'no-pattern' }

    // Apply. Skip any row whose source values can't produce a value.
    const before = _captureColumn(sheet, sheetName, targetCol, targetRows)
    const after = {}
    const writtenIds = []
    for (const r of targetRows) {
      const sources = sourceCols.map((c) => sheet.getCell(colLabel(c) + (r + 1), sheetName))
      const value = applyPattern(pattern, sources)
      if (value == null) continue
      const id = colLabel(targetCol) + (r + 1)
      sheet.setCell(id, value, sheetName)
      after[id] = value
      writtenIds.push(id)
    }

    if (writtenIds.length === 0) return { ok: false, reason: 'no-fills' }

    // Op log + history + repaint.
    queueOp?.({
      opType: 'fill', // existing op type — Smart Fill is conceptually a fill
      subSheet: sheetName,
      cellRefs: writtenIds,
      before,
      after,
      summary: `Smart Fill (${pattern.type}, ${writtenIds.length} cells)`,
    })
    history?.push?.()
    if (isDirty) isDirty.value = true
    repopulateGrid?.()
    return { ok: true, filled: writtenIds.length, pattern }
  }

  return { runSmartFill }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _detectSourceCols(sheet, sheetName, exampleRows, targetCol) {
  // Probe 8 columns to the left and 8 to the right of the target column,
  // keep the ones with at least one non-empty value in any example row.
  const out = []
  const probeStart = Math.max(0, targetCol - 8)
  const probeEnd = targetCol + 8
  for (let c = probeStart; c <= probeEnd; c++) {
    if (c === targetCol) continue
    const hasData = exampleRows.some((r) => {
      const v = sheet.getCell(colLabel(c) + (r + 1), sheetName)
      return v !== '' && v != null
    })
    if (hasData) out.push(c)
  }
  return out
}

function _captureColumn(sheet, sheetName, col, rows) {
  const out = {}
  for (const r of rows) {
    const id = colLabel(col) + (r + 1)
    out[id] = sheet.getCell(id, sheetName)
  }
  return out
}
