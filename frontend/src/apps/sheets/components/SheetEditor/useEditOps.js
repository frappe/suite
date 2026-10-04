// Diff-and-record helper for cell-edit paths. Extracted from
// SheetEditor/index.vue so the contract is testable in isolation:
// the editor used to bury it as a closure inside a 4000-line file
// where the only way to verify behaviour was to mount the whole
// component.
//
// Usage:
//   const { pushEditOp } = useEditOps({ sheet, history, queueOp,
//                                       broadcastBatchChange,
//                                       syncFlags, isDirty })
//
// Caller pattern (per edit path — formula bar commit, fill, cut,
// dropdown pick):
//   1) capture `beforeMap = { id: oldValue, … }` BEFORE the writes
//   2) run the writes via sheet.setCell
//   3) `pushEditOp(sheetName, beforeMap, 'Edit cell')`
//
// pushEditOp re-reads each id, builds a refs-only diff, fires the
// op through history.pushOp + queueOp + broadcastBatchChange, and
// flips the dirty / saved flags. Returns the op (or null when no
// cells actually changed) so callers can chain logic off the diff.

export function useEditOps({ sheet, history, queueOp, broadcastBatchChange, syncFlags, isDirty }) {
  function pushEditOp(sheetName, beforeMap, summary = '') {
    if (!beforeMap) return null
    const sn = sheetName || sheet.getCurrentSheet()
    const refs = []
    const before = {},
      after = {}
    for (const id of Object.keys(beforeMap)) {
      const a = sheet.getCell(id, sn)
      if (a !== beforeMap[id]) {
        before[id] = beforeMap[id]
        after[id] = a
        refs.push(id)
      }
    }
    if (!refs.length) return null
    const op = { opType: 'edit', subSheet: sn, cellRefs: refs, before, after, summary }
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
