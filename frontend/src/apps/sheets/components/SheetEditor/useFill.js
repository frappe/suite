import { planFill } from '../../engine/fill-series.js'
import { detectSeries } from '../../engine/patterns/index.js'
import { numFmtFromEngine } from '../../engine/xlsx-io.js'
import { cellId } from '../../utils/cells.js'

// Fill, extracted from SheetEditor/index.vue: the drag fill handle (series or
// copy, with formats, validation, conditional-format rules and merges
// following the values) and Ctrl+D / Ctrl+R. Each fill is recorded as one
// undo step and one op for the version log.
//
// The editor passes its helpers under their own names; the `_names` are kept
// here so the code reads as it did in index.vue.
export function useFill({
  getGrid,
  currentSheet,
  formats,
  merge,
  validation,
  condFormat,
  history,
  isDirty,
  syncFlags,
  markEdited,
  readInputs: _readInputs,
  writeInputs: _writeInputs,
  captureFormatsRange: _captureFormatsRange,
  captureValidationRange: _captureValidationRange,
  diffRefs: _diffRefs,
  queueOp: _queueOp,
  rectBlocked: _rectBlocked,
  refitRowsFor,
  readEngineFormats,
}) {
  function _fillValidation(src, total, sn) {
    const srcRows = src.r1 - src.r0 + 1,
      srcCols = src.c1 - src.c0 + 1
    for (let r = total.r0; r <= total.r1; r++) {
      for (let c = total.c0; c <= total.c1; c++) {
        if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue
        // True modulo: a drag more than one source-height up or left gives a
        // negative offset, and JS `%` would keep the sign.
        const srcR = src.r0 + ((((r - src.r0) % srcRows) + srcRows) % srcRows)
        const srcC = src.c0 + ((((c - src.c0) % srcCols) + srcCols) % srcCols)
        const rule = validation.get(cellId(srcR, srcC), sn)
        if (rule) validation.set(cellId(r, c), rule, sn)
      }
    }
  }

  // _runFill modes: 'auto' | 'series' | 'copy' (see planFill). Every mode
  // carries the source's formats, validation, conditional-format rules and
  // merges along with the values, as Excel and Google Sheets do. `summary`
  // names the op in the version log (default: "Filled N cells").
  async function _runFill(src, total, mode, summary = '') {
    const sheetName = currentSheet.value
    // `total` includes `src`, so this one read is also the fill's source.
    const fillBefore = await _readInputs(total, sheetName)
    // IronCalc's own formats of the source (a typed `$1.50` is 1.5 with
    // IronCalc's $ format), read before the write changes anything.
    const engineFmts = (await readEngineFormats?.(src, sheetName)) ?? {}
    const beforeFmt = _captureFormatsRange(total, sheetName)
    const beforeVal = _captureValidationRange(total, sheetName)
    const beforeMergeSnap = merge.snapshot?.()
    const cfBefore = condFormat?.getRules?.(sheetName)?.length ?? 0
    const writes = planFill(src, total, (r, c) => fillBefore[cellId(r, c)] ?? '', mode)
    _writeInputs(sheetName, writes)
    _fillFormats(src, total, sheetName, engineFmts)
    _fillValidation(src, total, sheetName)
    condFormat.extendRulesToRange(src, total, sheetName)
    // Merges are a structural format: a merged source tiles its merge into
    // every dragged-over destination.
    _fillMerges(src, total, sheetName)
    const fillAfter = { ...fillBefore, ...writes }
    // Rows with wrapped text refit to what the fill wrote (after the formats,
    // which may carry the wrap); the height change undoes with the fill.
    const rowH = refitRowsFor?.(sheetName, fillAfter)
    const afterFmt = _captureFormatsRange(total, sheetName)
    const afterVal = _captureValidationRange(total, sheetName)
    const afterMergeSnap = merge.snapshot?.()
    const cfAfter = condFormat?.getRules?.(sheetName)?.length ?? 0
    const refs = _diffRefs(fillBefore, fillAfter)
    // Server sync — queue the value diff regardless of how history records it.
    if (refs.length) {
      _queueOp({
        opType: 'fill',
        subSheet: sheetName,
        cellRefs: refs,
        before: fillBefore,
        after: fillAfter,
        summary: summary || _fillSummary(mode, refs.length),
      })
    }
    // History — the previous markEdited() path pushed a full snapshot, but
    // history.undo() can't roll a snapshot back when its preceding entry is
    // an op (no earlier snapshot to restore from), so undoing a fill that
    // came after cell edits silently no-op'd the fill and started peeling
    // off the prior cell edits instead — that's the "1, 2 drag-fill to 7,
    // undo clears A2 first" report. The op-based path mirrors paste's
    // shape, which the history's revertOp already round-trips correctly.
    const mergeChanged = JSON.stringify(beforeMergeSnap) !== JSON.stringify(afterMergeSnap)
    const cfChanged = cfBefore !== cfAfter
    if (refs.length && !cfChanged) {
      history.pushOp({
        opType: 'fill',
        subSheet: sheetName,
        cellRefs: refs,
        before: fillBefore,
        after: fillAfter,
        beforeFormats: beforeFmt,
        afterFormats: afterFmt,
        beforeValidation: beforeVal,
        afterValidation: afterVal,
        ...(rowH && { beforeRowH: rowH.before, afterRowH: rowH.after }),
        // Merge restore rides on the same op shape now — revertOp/applyOp
        // call merge.restore when these are present.
        ...(mergeChanged
          ? {
              beforeMerge: beforeMergeSnap,
              afterMerge: afterMergeSnap,
            }
          : {}),
      })
      syncFlags()
      isDirty.value = true
    } else {
      // Conditional-format rules changed — the op shape doesn't model
      // rule restore yet, so fall back to a snapshot. Same snap-after-op
      // edge case applies but only in this narrow path.
      markEdited()
    }
  }
  function _fillSummary(mode, n) {
    if (mode === 'copy') return `Copied into ${n} cell${n === 1 ? '' : 's'}`
    return `Filled ${n} cell${n === 1 ? '' : 's'}`
  }

  // Replicate every merge whose master AND span lie entirely inside `src` into
  // each tile of the destination range. Without this, dragging the fill handle
  // from a merged source produced unmerged target cells — values copied but
  // the structural merge was lost. merge.merge() already unmerges any
  // overlapping merge on the target, so re-runs are idempotent.
  function _fillMerges(src, total, sn) {
    const srcMerges = []
    for (let r = src.r0; r <= src.r1; r++) {
      for (let c = src.c0; c <= src.c1; c++) {
        const info = merge.getMasterInfo(cellId(r, c), sn)
        if (!info) continue
        if (r + info.rowSpan - 1 > src.r1) continue
        if (c + info.colSpan - 1 > src.c1) continue
        srcMerges.push({
          rOff: r - src.r0,
          cOff: c - src.c0,
          rowSpan: info.rowSpan,
          colSpan: info.colSpan,
        })
      }
    }
    if (!srcMerges.length) return
    const srcRows = src.r1 - src.r0 + 1,
      srcCols = src.c1 - src.c0 + 1
    const goDown = total.r1 > src.r1,
      goUp = total.r0 < src.r0
    const goRight = total.c1 > src.c1,
      goLeft = total.c0 < src.c0

    // Same 2-phase pattern as _fillValues: extend vertically first, then walk
    // every column in the vertically-grown source across the horizontal range.
    // For a diagonal drag, this tiles merges into the full 2D destination
    // instead of just the on-axis strip.
    let workR0 = src.r0,
      workR1 = src.r1
    if (goDown || goUp) {
      const startR = goDown ? src.r1 + 1 : total.r0
      const endR = goDown ? total.r1 : src.r0 - 1
      for (let tileR0 = startR; tileR0 <= endR; tileR0 += srcRows) {
        for (const m of srcMerges) {
          const r0 = tileR0 + m.rOff
          const c0 = src.c0 + m.cOff
          const r1 = r0 + m.rowSpan - 1
          const c1 = c0 + m.colSpan - 1
          if (r1 > endR) continue // drop the partial tile at the far edge
          merge.merge(r0, c0, r1, c1, sn)
        }
      }
      workR0 = Math.min(workR0, total.r0)
      workR1 = Math.max(workR1, total.r1)
    }
    if (goRight || goLeft) {
      // Re-enumerate merges over the vertically-grown source so phase 2 also
      // catches every merge tiled in by phase 1.
      const grownMerges = []
      for (let r = workR0; r <= workR1; r++) {
        for (let c = src.c0; c <= src.c1; c++) {
          const info = merge.getMasterInfo(cellId(r, c), sn)
          if (!info) continue
          if (r + info.rowSpan - 1 > workR1) continue
          if (c + info.colSpan - 1 > src.c1) continue
          grownMerges.push({
            rOff: r - workR0,
            cOff: c - src.c0,
            rowSpan: info.rowSpan,
            colSpan: info.colSpan,
          })
        }
      }
      const startC = goRight ? src.c1 + 1 : total.c0
      const endC = goRight ? total.c1 : src.c0 - 1
      for (let tileC0 = startC; tileC0 <= endC; tileC0 += srcCols) {
        for (const m of grownMerges) {
          const r0 = workR0 + m.rOff
          const c0 = tileC0 + m.cOff
          const r1 = r0 + m.rowSpan - 1
          const c1 = c0 + m.colSpan - 1
          if (c1 > endC) continue
          merge.merge(r0, c0, r1, c1, sn)
        }
      }
    }
  }
  // Each filled cell takes the format of its source cell (the source repeats
  // as a pattern); a cell whose source is unformatted is cleared. A source
  // with no side-store number format lends IronCalc's (`engineFmts`).
  function _fillFormats(src, total, sn, engineFmts = {}) {
    const srcRows = src.r1 - src.r0 + 1,
      srcCols = src.c1 - src.c0 + 1
    for (let r = total.r0; r <= total.r1; r++) {
      for (let c = total.c0; c <= total.c1; c++) {
        if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue
        // True modulo, as in _fillValidation.
        const srcR = src.r0 + ((((r - src.r0) % srcRows) + srcRows) % srcRows)
        const srcC = src.c0 + ((((c - src.c0) % srcCols) + srcCols) % srcCols)
        let fmt = formats.get(cellId(srcR, srcC), sn)
        const engineFmt = numFmtFromEngine(engineFmts[cellId(srcR, srcC)])
        if (engineFmt && !fmt?.numberFormat) fmt = { ...fmt, numberFormat: engineFmt }
        if (fmt && Object.keys(fmt).length) formats.set(cellId(r, c), fmt, sn)
        else formats.clear(cellId(r, c), sn)
      }
    }
  }
  // The series a fill from `src` would continue (null = plain copy).
  async function _previewSeriesKind(src) {
    const sn = currentSheet.value
    const sel = getGrid()?.getSelection()
    const goingDown = sel ? sel.r1 > src.r1 : false
    const goingRight = sel ? sel.c1 > src.c1 : false
    const sampleAlongCol = goingDown || !goingRight
    const inputs = await _readInputs(src, sn)
    const vals = []
    if (sampleAlongCol) {
      for (let r = src.r0; r <= src.r1; r++) vals.push(inputs[cellId(r, src.c0)])
    } else {
      for (let c = src.c0; c <= src.c1; c++) vals.push(inputs[cellId(src.r0, c)])
    }
    const series = detectSeries(vals.map((v) => (v == null ? '' : String(v))))
    return series ? series.kind : null
  }

  // Cmd/Ctrl held inverts the auto-detected mode — Google Sheets behaviour.
  async function _fillFromHandle(src, total, withModifier) {
    const mode = withModifier ? ((await _previewSeriesKind(src)) ? 'copy' : 'series') : 'auto'
    await _runFill(src, total, mode)
  }

  // Ctrl+D / Ctrl+R: copy the selection's first row down (or first column
  // right) across the rest of it. It's a copy-mode fill from that edge, so it
  // carries formats, validation, rules and merges like a drag does.
  async function _fillFromEdge(down) {
    if (!getGrid()) return
    const sel = getGrid().getSelection()
    const { r0, c0, r1, c1 } = sel
    if (down ? r1 <= r0 : c1 <= c0) return
    const dest = down ? { r0: r0 + 1, c0, r1, c1 } : { r0, c0: c0 + 1, r1, c1 }
    if (_rectBlocked(dest, currentSheet.value)) return
    const src = down ? { r0, c0, r1: r0, c1 } : { r0, c0, r1, c1: c0 }
    await _runFill(src, sel, 'copy', down ? 'Fill down' : 'Fill right')
  }
  function fillDown() {
    _fillFromEdge(true).catch((e) => console.error('[sheets] fill down failed', e))
  }
  function fillRight() {
    _fillFromEdge(false).catch((e) => console.error('[sheets] fill right failed', e))
  }

  return { fillFromHandle: _fillFromHandle, fillDown, fillRight }
}
