import { beforeEach, describe, expect, it } from 'vitest'

import { createProtectionEngine } from './protection.js'

// Ranges are 0-indexed, inclusive: { r0, c0, r1, c1 }.
const rect = (r0, c0, r1, c1) => ({ r0, c0, r1, c1 })

describe('ProtectionEngine — ranges & queries', () => {
  let p
  beforeEach(() => {
    p = createProtectionEngine()
  })

  it('no protection by default', () => {
    expect(p.isProtected(0, 0)).toBe(false)
    expect(p.isSheetLocked()).toBe(false)
    expect(p.getRanges()).toEqual([])
  })

  it('protects cells inside an added range, inclusive of edges', () => {
    p.addRange(rect(1, 1, 3, 3))
    expect(p.isProtected(1, 1)).toBe(true) // top-left corner
    expect(p.isProtected(3, 3)).toBe(true) // bottom-right corner
    expect(p.isProtected(2, 2)).toBe(true) // interior
    expect(p.isProtected(0, 1)).toBe(false) // one row above
    expect(p.isProtected(1, 0)).toBe(false) // one col left
    expect(p.isProtected(4, 3)).toBe(false) // one row below
    expect(p.isProtected(3, 4)).toBe(false) // one col right
  })

  it('normalises a reversed rect', () => {
    p.addRange(rect(3, 3, 1, 1))
    expect(p.isProtected(2, 2)).toBe(true)
    expect(p.getRanges()[0]).toMatchObject({ r0: 1, c0: 1, r1: 3, c1: 3 })
  })

  it('whole-sheet lock protects every cell', () => {
    p.setSheetLocked(true)
    expect(p.isProtected(0, 0)).toBe(true)
    expect(p.isProtected(999, 999)).toBe(true)
    p.setSheetLocked(false)
    expect(p.isProtected(0, 0)).toBe(false)
  })

  it('removeRange lifts protection', () => {
    const id = p.addRange(rect(0, 0, 0, 0))
    expect(p.isProtected(0, 0)).toBe(true)
    p.removeRange(id)
    expect(p.isProtected(0, 0)).toBe(false)
  })

  it('isAnyProtected detects rect overlap', () => {
    p.addRange(rect(5, 5, 7, 7))
    expect(p.isAnyProtected(rect(0, 0, 5, 5))).toBe(true) // touches corner
    expect(p.isAnyProtected(rect(6, 0, 6, 10))).toBe(true) // crosses through
    expect(p.isAnyProtected(rect(0, 0, 4, 4))).toBe(false) // no overlap
    expect(p.isAnyProtected(rect(8, 8, 9, 9))).toBe(false) // past it
  })

  it('isAnyProtected returns true for a locked sheet regardless of rect', () => {
    p.setSheetLocked(true)
    expect(p.isAnyProtected(rect(100, 100, 100, 100))).toBe(true)
  })

  it('keeps protection per sheet', () => {
    p.addRange(rect(0, 0, 0, 0), '', 'Sheet1')
    expect(p.isProtected(0, 0, 'Sheet1')).toBe(true)
    expect(p.isProtected(0, 0, 'Sheet2')).toBe(false)
  })
})

describe('ProtectionEngine — row/col shifts', () => {
  let p
  beforeEach(() => {
    p = createProtectionEngine()
  })

  it('insertRow at/above a range shifts it down', () => {
    p.addRange(rect(6, 0, 8, 0))
    p.insertRow(5)
    expect(p.getRanges()[0]).toMatchObject({ r0: 7, r1: 9 })
  })

  it('insertRow inside a range grows it (straddle)', () => {
    p.addRange(rect(3, 0, 8, 0))
    p.insertRow(5)
    expect(p.getRanges()[0]).toMatchObject({ r0: 3, r1: 9 })
  })

  it('insertRow below a range leaves it', () => {
    p.addRange(rect(3, 0, 4, 0))
    p.insertRow(5)
    expect(p.getRanges()[0]).toMatchObject({ r0: 3, r1: 4 })
  })

  it('deleteRow below a range shifts it up', () => {
    p.addRange(rect(6, 0, 8, 0))
    p.deleteRow(5)
    expect(p.getRanges()[0]).toMatchObject({ r0: 5, r1: 7 })
  })

  it('deleteRow inside a range shrinks it', () => {
    p.addRange(rect(3, 0, 8, 0))
    p.deleteRow(5)
    expect(p.getRanges()[0]).toMatchObject({ r0: 3, r1: 7 })
  })

  it('deleteRow above a range leaves it', () => {
    p.addRange(rect(6, 0, 8, 0))
    p.deleteRow(9)
    expect(p.getRanges()[0]).toMatchObject({ r0: 6, r1: 8 })
  })

  it('deleting the only row of a single-row range drops it', () => {
    p.addRange(rect(5, 0, 5, 3))
    p.deleteRow(5)
    expect(p.getRanges()).toEqual([])
  })

  it('col shifts mirror row shifts', () => {
    p.addRange(rect(0, 3, 0, 8))
    p.insertCol(5)
    expect(p.getRanges()[0]).toMatchObject({ c0: 3, c1: 9 }) // grew
    p.deleteCol(5)
    expect(p.getRanges()[0]).toMatchObject({ c0: 3, c1: 8 }) // shrank back
  })

  it('deleting the only col of a single-col range drops it', () => {
    p.addRange(rect(0, 5, 3, 5))
    p.deleteCol(5)
    expect(p.getRanges()).toEqual([])
  })
})

describe('ProtectionEngine — sheet lifecycle & snapshot', () => {
  let p
  beforeEach(() => {
    p = createProtectionEngine()
  })

  it('rename moves protection to the new name', () => {
    p.addRange(rect(0, 0, 1, 1), '', 'A')
    p.setSheetLocked(true, 'A')
    p.renameSheet('A', 'B')
    expect(p.isProtected(0, 0, 'B')).toBe(true)
    expect(p.isSheetLocked('B')).toBe(true)
    expect(p.getRanges('A')).toEqual([])
  })

  it('duplicate deep-copies protection', () => {
    p.addRange(rect(0, 0, 1, 1), '', 'A')
    p.duplicateSheet('A', 'A copy')
    p.insertRow(0, 'A') // mutate source only
    expect(p.getRanges('A copy')[0]).toMatchObject({ r0: 0, r1: 1 })
  })

  it('deleteSheet clears protection', () => {
    p.addRange(rect(0, 0, 1, 1), '', 'A')
    p.deleteSheet('A')
    expect(p.getRanges('A')).toEqual([])
  })

  it('restore advances the id counter past restored ids (no post-reload collision)', () => {
    // A saved doc's range ids can exceed a freshly re-initialised module
    // counter (the reload case). Restore a snapshot whose id is far above any
    // the counter has reached, then add a range: its id must clear the restored
    // one, or removeRange would later drop both. HIGH is picked well above the
    // handful of addRange calls in this file so the assertion is real, not
    // trivially satisfied by an already-advanced counter.
    const HIGH = 1_000_000
    const p2 = createProtectionEngine()
    p2.restore({ Sheet1: { locked: false, ranges: [{ id: HIGH, r0: 0, c0: 0, r1: 0, c1: 0 }] } })
    const newId = p2.addRange(rect(5, 5, 5, 5))
    expect(newId).toBeGreaterThan(HIGH) // fails if restore didn't advance the counter
    p2.removeRange(newId)
    expect(p2.isProtected(0, 0)).toBe(true) // restored range survives its own removal
    expect(p2.isProtected(5, 5)).toBe(false)
  })

  it('snapshot/restore round-trips and is independent of later edits', () => {
    p.addRange(rect(2, 2, 4, 4))
    p.setSheetLocked(true, 'Locked')
    const snap = p.snapshot()
    p.addRange(rect(0, 0, 0, 0)) // mutate after snapshot
    p.restore(snap)
    expect(p.isProtected(3, 3)).toBe(true)
    expect(p.isProtected(0, 0)).toBe(false) // the post-snapshot add is gone
    expect(p.isSheetLocked('Locked')).toBe(true)
  })
})
