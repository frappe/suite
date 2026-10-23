// Diff-and-record helper for cell-edit paths. Extracted from
// SheetEditor/index.vue so the contract is testable in isolation:
// the editor used to bury it as a closure inside a 4000-line file
// where the only way to verify behaviour was to mount the whole
// component.
//
// Usage:
//   const { pushEditOp } = useEditOps({ currentSheet, history, queueOp,
//                                       broadcastBatchChange,
//                                       syncFlags, isDirty, refitRowsFor })
//
// Caller pattern (per edit path — fill, dropdown pick, checkbox):
//   1) read `beforeMap = { id: oldInput, … }` BEFORE the writes
//   2) write `afterMap = { id: newInput, … }` (one command)
//   3) `pushEditOp(sheetName, beforeMap, afterMap, 'Edit cell')`
//
// pushEditOp keeps only the cells whose input changed, refits the rows
// they wrap in (heights ride the op as beforeRowH / afterRowH, so undo
// restores them; same as paste and fill), fires the op through
// history.pushOp + queueOp + broadcastBatchChange, and flips the dirty /
// saved flags. Returns the op (or null when no cells
// actually changed) so callers can chain logic off the diff.

export function useEditOps({
  currentSheet,
  history,
  queueOp,
  broadcastBatchChange,
  syncFlags,
  isDirty,
  refitRowsFor,
}) {
  // `extra` adds fields to the op (sort adds beforeFormats / afterFormats).
  function pushEditOp(sheetName, beforeMap, afterMap, summary = '', extra = {}) {
    if (!beforeMap || !afterMap) return null
    const sn = sheetName || currentSheet.value
    const refs = []
    const before = {},
      after = {}
    for (const [id, a] of Object.entries(afterMap)) {
      const b = beforeMap[id] ?? ''
      if (a !== b) {
        before[id] = b
        after[id] = a
        refs.push(id)
      }
    }
    if (!refs.length) return null
    const op = { opType: 'edit', subSheet: sn, cellRefs: refs, before, after, summary, ...extra }
    const rowH = refitRowsFor?.(sn, after)
    if (rowH) {
      op.beforeRowH = rowH.before
      op.afterRowH = rowH.after
    }
    queueOp?.(op)
    history?.pushOp?.(op)
    broadcastBatchChange?.(
      sn,
      refs.map((id) => ({ id, value: after[id] })),
    )
    syncFlags?.()
    if (isDirty) isDirty.value = true
    return op
  }
  return { pushEditOp }
}
