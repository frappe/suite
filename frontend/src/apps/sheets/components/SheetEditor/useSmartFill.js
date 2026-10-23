import { applyPattern, detectPattern } from '../../engine/smart-fill.js'
import { cellId } from '../../utils/cells.js'

// Adapts the pure Smart Fill engine to the SheetEditor's grid + selection.
//
// Trigger contract — `runSmartFill()`:
//   1. Inspect the active selection rectangle.
//   2. If it's a single column, look at the rows where the user already
//      typed values (the "examples") and the contiguous empty rows below.
//   3. Build training pairs from each example: target = the user's value,
//      sources = the values in every other column on that same row.
//   4. Detect a pattern; apply to each empty row's source values.
//   5. Write the inferred values as one edit and record it for undo.
//
// Why per-row sources include "every other column on that row": the engine
// doesn't know which columns are relevant — it walks all of them and picks
// the one(s) that consistently explain the target across examples.
//
// `readInputs(rect, sheetName)` resolves to {cellId: input} for a 0-based
// rect; `writeInputs(sheetName, map)` writes a {cellId: input} map.

// Columns probed on each side of the target for source data.
const PROBE = 8

export function useSmartFill({
  readInputs,
  writeInputs,
  currentSheet,
  getGrid,
  queueOp,
  getHistory,
  getIsDirty,
}) {
  async function runSmartFill() {
    const history = getHistory?.()
    const isDirty = getIsDirty?.()
    const grid = getGrid?.()
    if (!grid) return { ok: false, reason: 'no-grid' }
    const sel = grid.getSelection?.()
    if (!sel) return { ok: false, reason: 'no-selection' }
    const sheetName = currentSheet.value

    // Currently support single-column selections. Multi-column requires
    // a richer "which column am I filling" UI — out of scope for v1.
    if (sel.c0 !== sel.c1) return { ok: false, reason: 'single-column-only' }
    const targetCol = sel.c0

    // One read covers the target column and every probed source column.
    const probeStart = Math.max(0, targetCol - PROBE)
    const probeEnd = targetCol + PROBE
    const inputs = await readInputs(
      { r0: sel.r0, c0: probeStart, r1: sel.r1, c1: probeEnd },
      sheetName,
    )
    const at = (r, c) => inputs[cellId(r, c)] ?? ''

    // Walk the selection top-down to split examples (filled) from
    // target rows (empty).
    const exampleRows = []
    const targetRows = []
    for (let r = sel.r0; r <= sel.r1; r++) {
      if (at(r, targetCol) !== '') exampleRows.push(r)
      else targetRows.push(r)
    }
    if (exampleRows.length < 1) return { ok: false, reason: 'no-examples' }
    if (targetRows.length === 0) return { ok: false, reason: 'no-empty-cells' }

    // Determine the "source" column window: every column near the target
    // with a value on at least one example row. Capped at PROBE each side
    // to keep pattern search cheap.
    const sourceCols = []
    for (let c = probeStart; c <= probeEnd; c++) {
      if (c !== targetCol && exampleRows.some((r) => at(r, c) !== '')) sourceCols.push(c)
    }
    if (!sourceCols.length) return { ok: false, reason: 'no-source-columns' }

    // Build examples for the engine.
    const examples = exampleRows.map((r) => ({
      target: at(r, targetCol),
      sources: sourceCols.map((c) => at(r, c)),
    }))
    const pattern = detectPattern(examples)
    if (!pattern) return { ok: false, reason: 'no-pattern' }

    // Apply. Skip any row whose source values can't produce a value.
    const before = {}
    const after = {}
    for (const r of targetRows) {
      const value = applyPattern(
        pattern,
        sourceCols.map((c) => at(r, c)),
      )
      if (value == null) continue
      const id = cellId(r, targetCol)
      before[id] = ''
      after[id] = String(value)
    }
    const writtenIds = Object.keys(after)
    if (writtenIds.length === 0) return { ok: false, reason: 'no-fills' }
    writeInputs(sheetName, after)

    // Op log + history.
    const op = {
      opType: 'fill', // existing op type — Smart Fill is conceptually a fill
      subSheet: sheetName,
      cellRefs: writtenIds,
      before,
      after,
      summary: `Smart Fill (${pattern.type}, ${writtenIds.length} cells)`,
    }
    queueOp?.(op)
    history?.pushOp?.(op)
    if (isDirty) isDirty.value = true
    return { ok: true, filled: writtenIds.length, pattern }
  }

  return { runSmartFill }
}
