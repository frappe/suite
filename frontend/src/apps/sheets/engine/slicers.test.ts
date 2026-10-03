import { beforeEach, describe, expect, it } from 'vitest'

import { createSlicerEngine } from './slicers.js'

describe('SlicerEngine', () => {
  let s
  beforeEach(() => {
    s = createSlicerEngine()
  })

  it('adds a slicer for a column and lists it', () => {
    const id = s.add(2, 100, 50, 'S')
    expect(s.list('S')).toEqual([{ id, col: 2, x: 100, y: 50 }])
  })

  it('is one-per-column — a second add on the same column reuses the slicer', () => {
    const a = s.add(2, 0, 0, 'S')
    const b = s.add(2, 9, 9, 'S')
    expect(b).toBe(a)
    expect(s.list('S')).toHaveLength(1)
  })

  it('remove and move', () => {
    const id = s.add(1, 0, 0, 'S')
    s.move(id, 40, 60, 'S')
    expect(s.get(id, 'S')).toMatchObject({ x: 40, y: 60 })
    s.remove(id, 'S')
    expect(s.list('S')).toEqual([])
  })

  it('keeps slicers per sheet', () => {
    s.add(0, 0, 0, 'S1')
    expect(s.list('S2')).toEqual([])
  })

  describe('setCol', () => {
    it('re-points a slicer at another column', () => {
      const id = s.add(1, 0, 0, 'S')
      s.setCol(id, 4, 'S')
      expect(s.get(id, 'S').col).toBe(4)
    })
    it('refuses to move onto a column another slicer already owns', () => {
      const a = s.add(1, 0, 0, 'S')
      s.add(3, 0, 0, 'S')
      s.setCol(a, 3, 'S')
      expect(s.get(a, 'S').col).toBe(1) // unchanged — col 3 is taken
    })
  })

  describe('column shifts', () => {
    it('insertCol shifts slicers at/after the insertion right', () => {
      s.add(3, 0, 0, 'S')
      s.insertCol(2, 'S')
      expect(s.list('S')[0].col).toBe(4)
    })
    it('insertCol before a slicer leaves it', () => {
      s.add(1, 0, 0, 'S')
      s.insertCol(3, 'S')
      expect(s.list('S')[0].col).toBe(1)
    })
    it('deleteCol drops the slicer on that column and shifts the rest left', () => {
      s.add(2, 0, 0, 'S')
      s.add(5, 0, 0, 'S')
      s.deleteCol(2, 'S')
      expect(s.list('S').map((sl) => sl.col)).toEqual([4]) // col-2 slicer gone, col-5 → 4
    })
  })

  describe('lifecycle & snapshot', () => {
    it('rename moves slicers', () => {
      s.add(0, 0, 0, 'S1')
      s.renameSheet('S1', 'S2')
      expect(s.list('S2')).toHaveLength(1)
      expect(s.list('S1')).toEqual([])
    })
    it('duplicate deep-copies', () => {
      s.add(0, 0, 0, 'S1')
      s.duplicateSheet('S1', 'S1 copy')
      s.remove(s.list('S1')[0].id, 'S1')
      expect(s.list('S1 copy')).toHaveLength(1) // copy survives source removal
    })
    it('deleteSheet drops slicers', () => {
      s.add(0, 0, 0, 'S1')
      s.deleteSheet('S1')
      expect(s.list('S1')).toEqual([])
    })
    it('snapshot/restore round-trips', () => {
      s.add(2, 10, 20, 'S')
      const snap = s.snapshot()
      s.remove(s.list('S')[0].id, 'S')
      s.restore(snap)
      expect(s.list('S')).toEqual([{ id: expect.any(Number), col: 2, x: 10, y: 20 }])
    })
    it('restore advances the id counter so new slicers never collide', () => {
      const src = createSlicerEngine()
      const savedId = src.add(0, 0, 0, 'S')
      const snap = src.snapshot()
      const fresh = createSlicerEngine()
      fresh.restore(snap)
      const newId = fresh.add(1, 0, 0, 'S')
      expect(newId).not.toBe(savedId)
      fresh.remove(newId, 'S')
      expect(fresh.list('S')).toHaveLength(1) // the restored slicer survives
    })
  })
})
