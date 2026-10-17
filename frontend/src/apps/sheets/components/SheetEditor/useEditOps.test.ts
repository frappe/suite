import { describe, expect, it, vi } from 'vitest'

import { useEditOps } from './useEditOps.js'

function setup() {
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
})
