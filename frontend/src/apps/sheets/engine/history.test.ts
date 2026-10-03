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
