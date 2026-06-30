import { ref } from 'vue'
import { formatScope } from '../../engine/format-scope.js'

// getGrid is a getter fn () => grid so the toolbar always has the live reference.
// markDirty (optional) is called after every mutation so the SheetEditor can
// trigger autosave — without it, format changes never persist.
// getScope (optional) returns { rect, totalRows, totalCols } so full-column /
// full-row selections format at the column/row level instead of per-cell.
export function useToolbar({ sheet, formats, getGrid, history, selectionIds, getScope, syncFlags, markDirty }) {
  const activeFormat = ref({})

  // Last-action ledger — what F4 replays. Captured by every toolbar mutator
  // *after* it runs so the record always reflects what was actually applied.
  let lastAction = null

  function refreshActiveFormat() {
    activeFormat.value = formats.get(
      getGrid()?.getActiveCell() ?? 'A1',
      sheet.getCurrentSheet(),
    )
  }

  function _captureCells(ids, sn) {
    const out = {}
    for (const id of ids) out[id] = formats.getCellFormat(id, sn) || null
    return out
  }
  function _captureCols(cols, sn) {
    const out = {}
    for (const c of cols) out[c] = formats.getCol(c, sn) || null
    return out
  }
  function _captureRows(rows, sn) {
    const out = {}
    for (const r of rows) out[r] = formats.getRow(r, sn) || null
    return out
  }

  function _scope() {
    const s = getScope?.()
    return s ? formatScope(s.rect, s.totalRows, s.totalCols) : { kind: 'cells' }
  }

  // Run a format mutation and record it as an op DIFF — never a full-workbook
  // snapshot (that deep-clone was ~2s on a 2M-cell sheet, ×50 in the undo
  // stack: the 10s toolbar INP). The op carries before/after for just the
  // touched layer; applyOp/revertOp restore it. Full-column / full-row
  // selections format the column/row LAYER (one entry each) instead of writing
  // per-cell records — that's what stops "bold the whole sheet" from inflating
  // the payload to 100MB+ and freezing on apply.
  //
  // `ops` supplies the three mutation variants: { cols, rows, cells }.
  // Post-mutate ordering is preserved (push AFTER mutating) so one undo reverts
  // one action — reversing it was the old format+type double-undo bug.
  function _formatOp(kind, args, ops) {
    const sn = sheet.getCurrentSheet()
    const scope = _scope()
    const op = { opType: 'format', subSheet: sn }
    if (scope.kind === 'cols') {
      op.beforeCols = _captureCols(scope.cols, sn)
      ops.cols(scope.cols, sn)
      op.afterCols = _captureCols(scope.cols, sn)
    } else if (scope.kind === 'rows') {
      op.beforeRows = _captureRows(scope.rows, sn)
      ops.rows(scope.rows, sn)
      op.afterRows = _captureRows(scope.rows, sn)
    } else {
      const ids = selectionIds()
      op.beforeFormats = _captureCells(ids, sn)
      ops.cells(ids, sn)
      op.afterFormats = _captureCells(ids, sn)
    }
    history.pushOp(op)
    getGrid()?.render()
    refreshActiveFormat()
    syncFlags()
    markDirty?.()
    lastAction = { kind, args }
  }

  function toggleFmt(key) {
    _formatOp('toggleFmt', [key], {
      cols:  (cols, sn) => formats.toggleColumns(cols, key, sn),
      rows:  (rows, sn) => formats.toggleRows(rows, key, sn),
      cells: (ids, sn)  => formats.toggleRange(ids, key, sn),
    })
  }

  function setAlign(align) {
    _formatOp('setAlign', [align], _patchOps({ align }))
  }

  function setValign(valign) {
    _formatOp('setValign', [valign], _patchOps({ valign }))
  }

  function setColor(key, value) {
    _formatOp('setColor', [key, value], _patchOps({ [key]: value }))
  }

  function clearFormatting() {
    _formatOp('clearFormatting', [], {
      cols:  (cols, sn) => formats.clearColumns(cols, sn),
      rows:  (rows, sn) => formats.clearRows(rows, sn),
      cells: (ids, sn)  => { for (const id of ids) formats.clear(id, sn) },
    })
  }

  // Shared mutation triple for "apply this format patch" handlers.
  function _patchOps(patch) {
    return {
      cols:  (cols, sn) => formats.applyToColumns(cols, patch, sn),
      rows:  (rows, sn) => formats.applyToRows(rows, patch, sn),
      cells: (ids, sn)  => formats.applyToRange(ids, patch, sn),
    }
  }

  function getLastAction() { return lastAction }
  function recordAction(kind, args) { lastAction = { kind, args } }

  return {
    activeFormat, refreshActiveFormat,
    toggleFmt, setAlign, setValign, setColor, clearFormatting,
    getLastAction, recordAction,
  }
}
