// The editor's undo/redo. Extracted from SheetEditor/index.vue.
//
// Usage:
//   const { history, undo, redo, structural } = useHistory({
//     currentSheet, engines, getGrid, engineClient, command, writeInputs,
//     syncDefinedNames, addSheet, deleteSheet, getLocalTouches, syncFlags,
//     markDirty, afterStructural, afterNavigate })
//
// Two kinds of step (see engine/history.js): a snapshot step holds IronCalc's
// bytes plus every side engine and the grid's view state; an op step holds a
// diff (cells, formats, validation, merges, row heights) or a row/column op.
// What the editor does after a step lands (repaint, reset the selection)
// comes in as afterStructural and afterNavigate.

import { createHistory } from '../../engine/history.js'

export function useHistory({
  currentSheet,
  // { formats, merge, sortFilter, slicers, comments, validation, protection,
  //   condFormat, pivot, charts, namedRanges }
  engines,
  getGrid,
  engineClient,
  command,
  writeInputs,
  syncDefinedNames,
  addSheet,
  deleteSheet,
  getLocalTouches,
  syncFlags,
  markDirty,
  afterStructural,
  afterNavigate,
}) {
  const {
    formats,
    merge,
    sortFilter,
    slicers,
    comments,
    validation,
    protection,
    condFormat,
    pivot,
    charts,
    namedRanges,
  } = engines

  // Single source of truth for "what does undo restore?". Every engine that
  // owns mutable state (sheet data, formats, merges, filters, comments,
  // validations, conditional formats) plus the canvas-side view state (column
  // widths, freeze, hidden rows/cols, zoom, total rows) is captured. Anything
  // not snapshotted here is invisible to undo — that was the bug behind
  // "filter doesn't undo".
  // Everything undo restores apart from the cells: every engine beside the
  // cell engine, and the grid's view state.
  function sideSnapshot() {
    return {
      formats: formats.snapshot(),
      merge: merge.snapshot(),
      sortFilter: sortFilter.snapshot(),
      slicers: slicers.snapshot(),
      comments: comments.snapshot(),
      validation: validation.snapshot(),
      protection: protection.snapshot(),
      condFormat: condFormat.snapshot(),
      pivot: pivot.snapshot(),
      charts: charts.snapshot(),
      namedRanges: namedRanges.snapshot(),
      view: getGrid()?.viewSnapshot?.() ?? null,
    }
  }
  function restoreSide(snap) {
    const grid = getGrid()
    formats.restore(snap.formats)
    if (snap.merge) merge.restore(snap.merge)
    if (snap.sortFilter) sortFilter.restore(snap.sortFilter)
    if (snap.slicers) slicers.restore(snap.slicers)
    if (snap.comments) comments.restore(snap.comments)
    if (snap.validation) validation.restore(snap.validation)
    if (snap.protection) protection.restore(snap.protection)
    if (snap.condFormat) condFormat.restore(snap.condFormat)
    if (snap.pivot) pivot.restore(snap.pivot)
    if (snap.charts) charts.restore(snap.charts)
    if (snap.namedRanges) {
      namedRanges.restore(snap.namedRanges)
      syncDefinedNames()
    }
    if (snap.view && grid?.viewRestore) grid.viewRestore(snap.view)
  }

  const history = createHistory({
    // A snapshot step holds IronCalc's bytes (cells, sheets and their order),
    // taken in dispatch order, plus every side engine. The bytes promise is
    // shared with the previous step when no command ran in between, so a
    // format-only step serializes nothing.
    snapshot() {
      return { bytes: engineClient() ? engineClient().snapshot() : null, ...sideSnapshot() }
    },
    restore(snap) {
      if (snap.bytes && engineClient()) {
        engineClient()
          .restore(snap.bytes)
          .catch((e) => console.error('[sheets] restoring an undo step failed', e))
      }
      restoreSide(snap)
      // Caller (undo/redo) repopulates the canvas + reapplies hidden rows.
    },
    // Cheap op-based undo/redo. The op shape mirrors what _queueOp already
    // captures for server sync: a {opType, subSheet, before, after} diff over
    // a set of cell IDs. Undo writes `before` back; redo writes `after`.
    // Both go through sheet.setCell so the engine's notify cascade + memo
    // invalidation + collab Y.Doc mirror all stay in sync — same path a
    // human edit takes, just with the saved values.
    //
    // Paste-style ops carry additional optional maps:
    //   - beforeFormats / afterFormats — per-cell format snapshots
    //   - beforeValidation / afterValidation — per-cell validation rules
    // so the full paste effect (values + formats + validation) round-trips
    // through undo/redo without the 320 ms snapshot tax.
    revertOp(op) {
      if (op.opType === 'structural') {
        revertStructural(op)
        return
      }
      // Structural op: undo of "add sheet" is just deleting the (empty) sheet.
      if (op.opType === 'sheet_add') {
        deleteSheet(op.name)
        return
      }
      applyCellMap(op.before, op.subSheet)
      // A cut pasted onto another sheet: put its source cells back.
      if (op.source) applyCellMap(op.source.before, op.source.sheet)
      if (op.beforeFormats) applyFormatMap(op.beforeFormats, op.subSheet)
      if (op.beforeCols) applyAxisFormatMap('col', op.beforeCols, op.subSheet)
      if (op.beforeRows) applyAxisFormatMap('row', op.beforeRows, op.subSheet)
      if (op.beforeValidation) applyValidationMap(op.beforeValidation, op.subSheet)
      if (op.beforeMerge) {
        merge.restore(op.beforeMerge)
        getGrid()?.render?.()
      }
      if (op.beforeRowH) applyRowHeightMap(op.beforeRowH, op.subSheet)
    },
    applyOp(op) {
      if (op.opType === 'structural') {
        redoStructural(op)
        return
      }
      // Structural op: redo of "add sheet" recreates the same empty sheet.
      if (op.opType === 'sheet_add') {
        addSheet(op.name)
        return
      }
      applyCellMap(op.after, op.subSheet)
      if (op.source) applyCellMap(op.source.after, op.source.sheet)
      if (op.afterFormats) applyFormatMap(op.afterFormats, op.subSheet)
      if (op.afterCols) applyAxisFormatMap('col', op.afterCols, op.subSheet)
      if (op.afterRows) applyAxisFormatMap('row', op.afterRows, op.subSheet)
      if (op.afterValidation) applyValidationMap(op.afterValidation, op.subSheet)
      if (op.afterMerge) {
        merge.restore(op.afterMerge)
        getGrid()?.render?.()
      }
      if (op.afterRowH) applyRowHeightMap(op.afterRowH, op.subSheet)
    },
    getLocalTouches: () => getLocalTouches(),
  })

  // Used by op-based undo/redo to write a {cellId: value} diff back, as one
  // command.
  function applyCellMap(map, sheetName) {
    if (!map) return
    writeInputs(sheetName || currentSheet.value, map)
  }

  // Apply a {cellId: format|null} diff. Used by paste/fill undo/redo to
  // revert format changes the user wouldn't get back from the cell-value
  // diff alone. After mutating the store we manually push display strings
  // for each affected cell — number format affects the rendered value, so
  // the canvas needs the new strings for those cells. Validation doesn't
  // affect the display string, so its apply is just the store mutation.
  function applyFormatMap(map, sheetName) {
    if (!map) return
    const sn = sheetName || currentSheet.value
    for (const [id, fmt] of Object.entries(map)) {
      // Replace, not merge: formats.set merges, which kept a bold the step
      // had added after its undo.
      formats.clear(id, sn)
      if (fmt && Object.keys(fmt).length) formats.set(id, fmt, sn)
    }
    getGrid()?.render?.() // the grid applies number formats as it paints
  }

  // Apply a { colIdx|rowIdx: format|null } diff to the column or row format
  // layer (undo/redo of range-level formatting). Exact replacement, so undo
  // restores the captured layer precisely. One render covers the whole axis.
  function applyAxisFormatMap(axis, map, sheetName) {
    if (!map) return
    const sn = sheetName || currentSheet.value
    const replace = axis === 'col' ? formats.replaceCol : formats.replaceRow
    for (const [k, fmt] of Object.entries(map)) replace(+k, fmt || {}, sn)
    getGrid()?.render?.()
  }
  function applyValidationMap(map, sheetName) {
    if (!map) return
    const sn = sheetName || currentSheet.value
    for (const [id, rule] of Object.entries(map)) {
      if (rule) validation.set(id, rule, sn)
      else validation.clear(id, sn)
    }
    // Validation only affects the dropdown-arrow indicator the canvas
    // paints from getValidation each render — next paint picks it up.
    getGrid()?.render?.()
  }

  // Apply a {row: height} diff from a multi-line-edit op. Row heights are
  // canvas view state scoped to the current sheet, so cross-sheet undo skips
  // them rather than resizing the wrong sheet's rows.
  function applyRowHeightMap(map, sheetName) {
    if ((sheetName || currentSheet.value) !== currentSheet.value) return
    for (const [r, h] of Object.entries(map)) getGrid()?.setRowHeight?.(+r, h)
  }

  // Row / column insert, delete, move: IronCalc moves the cells and rewrites
  // formulas pointing at them. Every side engine remaps its own state with
  // the same index map, as does the grid's view metadata (sizes, hidden
  // rows/cols). Insert and move undo with their inverse command; a delete has
  // none (its cells are gone and formulas pointing at them now read #REF!),
  // so its undo restores IronCalc's bytes from just before it.
  //
  // `op.applied` says whether IronCalc holds the change now. Restoring a
  // snapshot step sets it from the op's place in history (the bytes hold the
  // ops before the step, not after), so a replay sends the command only when
  // IronCalc lacks it.
  async function applyStructural(axis, map, forward, inverse = null) {
    const sn = currentSheet.value
    const sideBefore = sideSnapshot()
    // Taken in dispatch order, so it is the workbook just before this command.
    const beforeBytes = inverse ? null : (engineClient()?.snapshot() ?? null)
    const op = {
      opType: 'structural',
      subSheet: sn,
      forward: { type: forward.type, payload: { sheet: sn, ...forward.payload } },
      inverse: inverse && { type: inverse.type, payload: { sheet: sn, ...inverse.payload } },
      beforeBytes,
      sideBefore,
      sideAfter: null,
      applied: true,
    }
    engineClient()?.dispatch(command(op.forward.type, op.forward.payload))
    remapSide(axis, map, sn)
    op.sideAfter = sideSnapshot()
    history.pushOp(op)
    syncFlags()
    markDirty()
    afterStructural(sn)
  }

  function remapSide(axis, map, sn) {
    const all = [
      formats,
      merge,
      comments,
      validation,
      protection,
      condFormat,
      sortFilter,
      namedRanges,
      charts,
      pivot,
    ]
    if (axis === 'row') {
      for (const e of all) e.remapRows(map, sn)
      syncDefinedNames()
      getGrid().remapRowsMeta(map)
    } else {
      // Slicers are column-bound only.
      for (const e of [...all, slicers]) e.remapCols(map, sn)
      syncDefinedNames()
      getGrid().remapColsMeta(map)
    }
  }

  function revertStructural(op) {
    if (op.applied) {
      if (op.inverse) engineClient()?.dispatch(command(op.inverse.type, op.inverse.payload))
      else
        engineClient()
          ?.restore(op.beforeBytes)
          .catch((e) => console.error('[sheets] undo of delete failed', e))
      op.applied = false
    }
    restoreSide(op.sideBefore)
    afterStructural(op.subSheet)
  }

  function redoStructural(op) {
    if (!op.applied) {
      engineClient()?.dispatch(command(op.forward.type, op.forward.payload))
      op.applied = true
    }
    restoreSide(op.sideAfter)
    afterStructural(op.subSheet)
  }

  // A row/column op from the UI: forward command, the index map every side
  // engine remaps with, and the inverse command when there is one.
  function structural(axis, map, forward, inverse) {
    applyStructural(axis, map, forward, inverse).catch((e) =>
      console.error('[sheets] row/column change failed', e),
    )
  }

  function undo() {
    if (!history.undo()) return
    afterNavigate()
  }
  function redo() {
    if (!history.redo()) return
    afterNavigate()
  }

  return { history, undo, redo, structural }
}
