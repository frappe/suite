import { describe, expect, it, vi } from 'vitest'

import { createHistory } from './history.js'

// Guards the undo baseline set up at doc load: init() seeds an EMPTY snapshot
// before the doc loads, then reset() must re-baseline to the loaded state so a
// later snapshot-based undo (e.g. insert column) lands on the loaded data and
// never on the empty pre-load snapshot (which blanked the whole sheet).
describe('history — load baseline', () => {
  it('init seeds the first snapshot and is idempotent', () => {
    const snapshot = vi.fn(() => 1)
    const h = createHistory({ snapshot, restore: () => {} })
    h.init()
    h.init()
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('reset re-baselines: undo after reset restores the reset snapshot, not the pre-reset one', () => {
    const snaps = ['empty', 'loaded', 'afterEdit']
    let idx = 0
    const restore = vi.fn()
    const h = createHistory({ snapshot: () => snaps[idx++], restore })
    h.init() // seed 'empty' (pre-load)
    h.reset() // re-baseline to 'loaded'
    h.push() // 'afterEdit' — a snapshot mutation (e.g. insert column)
    expect(h.undo()).toBe(true)
    expect(restore).toHaveBeenLastCalledWith('loaded', { touches: null })
    // No further undo past the re-baselined start.
    expect(h.canUndo()).toBe(false)
  })
})

// Snapshots hold the engine's whole state, so after one is restored an op
// that records whether the engine holds it (structural ops) must be resent
// when replayed if it came after the snapshot, and not if it came before.
describe('history — ops after a restored snapshot', () => {
  it('marks ops before the snapshot applied and ops after it not', () => {
    const replayed: string[] = []
    const h = createHistory({
      snapshot: () => 'snap',
      restore: () => {},
      applyOp: (op: { name: string; applied: boolean }) => {
        replayed.push(`${op.name}:${op.applied}`)
        op.applied = true
      },
      revertOp: () => {},
    })
    h.init()
    const before = { name: 'before', applied: true }
    h.pushOp(before)
    h.push() // a snapshot step that already holds `before`
    const after = { name: 'after', applied: true }
    h.pushOp(after)
    h.push() // the step being undone
    h.undo() // rebuilds `after` on top of the middle snapshot
    expect(before.applied).toBe(true)
    expect(replayed).toEqual(['after:false']) // resent, since the restore dropped it
    expect(after.applied).toBe(true)
  })

  it('leaves ops without an applied flag alone', () => {
    const h = createHistory({ snapshot: () => 'snap', restore: () => {} })
    h.init()
    const edit = { before: {}, after: {} }
    h.pushOp(edit)
    h.push()
    h.undo()
    expect('applied' in edit).toBe(false)
  })
})
