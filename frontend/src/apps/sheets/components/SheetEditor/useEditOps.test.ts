import { describe, expect, it, vi } from 'vitest'

import { useEditOps } from './useEditOps.js'

function setup(refitRowsFor?: (sn: string, writes: Record<string, string>) => unknown) {
  const history = { pushOp: vi.fn() }
  const queueOp = vi.fn()
  const isDirty = { value: false }
  const { pushEditOp } = useEditOps({
    currentSheet: { value: 'Sheet1' },
    history,
    queueOp,
    broadcastBatchChange: vi.fn(),
    syncFlags: vi.fn(),
    isDirty,
    refitRowsFor,
  })
  return { pushEditOp, history, queueOp, isDirty }
}

describe('pushEditOp', () => {
  it('records only the cells whose input changed', () => {
    const h = setup()
    const op = h.pushEditOp('Sheet2', { A1: '1', A2: '2' }, { A1: '1', A2: '3' }, 'Fill down')
    expect(op).toEqual({
      opType: 'edit',
      subSheet: 'Sheet2',
      cellRefs: ['A2'],
      before: { A2: '2' },
      after: { A2: '3' },
      summary: 'Fill down',
    })
    expect(h.history.pushOp).toHaveBeenCalledWith(op)
    expect(h.queueOp).toHaveBeenCalledWith(op)
    expect(h.isDirty.value).toBe(true)
  })

  it('treats a cell missing from before as empty', () => {
    const op = setup().pushEditOp('Sheet1', {}, { B1: 'x' })
    expect(op?.before).toEqual({ B1: '' })
  })

  it('records nothing when no input changed', () => {
    const h = setup()
    expect(h.pushEditOp('Sheet1', { A1: 'x' }, { A1: 'x' })).toBeNull()
    expect(h.history.pushOp).not.toHaveBeenCalled()
  })

  // ISSUES #33: find & replace, sort, split text, dropdown pick, checkbox
  // and link-title writes all go through here, and left a wrapped row at
  // its old height. Like paste and fill, the refit rides the op so undo
  // puts the old height back.
  it('refits the written rows and puts the heights on the op', () => {
    const refit = vi.fn(() => ({ before: { 2: 21 }, after: { 2: 63 } }))
    const h = setup(refit)
    const op = h.pushEditOp('Sheet1', { A3: 'a', B3: 'b' }, { A3: 'a long line', B3: 'b' })
    expect(refit).toHaveBeenCalledWith('Sheet1', { A3: 'a long line' })
    expect(op).toMatchObject({ beforeRowH: { 2: 21 }, afterRowH: { 2: 63 } })
    expect(h.history.pushOp).toHaveBeenCalledWith(op)
  })

  it('leaves the op without heights when no row changed', () => {
    const op = setup(() => null).pushEditOp('Sheet1', {}, { A1: 'x' })
    expect(op).not.toHaveProperty('beforeRowH')
  })

  it('does not refit when nothing changed', () => {
    const refit = vi.fn()
    setup(refit).pushEditOp('Sheet1', { A1: 'x' }, { A1: 'x' })
    expect(refit).not.toHaveBeenCalled()
  })
})

describe('pushEditOp extra fields', () => {
  it('puts them on the op (sort adds its format maps)', () => {
    const op = setup().pushEditOp('Sheet1', { A1: 'a' }, { A1: 'b' }, 'Sort', {
      beforeFormats: { A1: null },
      afterFormats: { A1: { bold: true } },
    })
    expect(op).toMatchObject({ beforeFormats: { A1: null }, afterFormats: { A1: { bold: true } } })
  })
})
