import { describe, expect, it, vi } from 'vitest'

import { createSelection } from '../selection.js'
import { autoFillDownExtent, createFillHandle } from './fill-handle.js'

describe('autoFillDownExtent', () => {
  const has = (cells: string[]) => (r: number, c: number) => cells.includes(`${r},${c}`)
  it('follows the left neighbour column down', () => {
    expect(
      autoFillDownExtent({ r0: 0, c0: 1, r1: 0, c1: 1 }, has(['1,0', '2,0', '3,0']), 100, 26),
    ).toBe(3)
  })
  it('falls back to the right neighbour', () => {
    expect(autoFillDownExtent({ r0: 0, c0: 1, r1: 0, c1: 1 }, has(['1,2', '2,2']), 100, 26)).toBe(2)
  })
  it('returns r1 when neither neighbour has data below', () => {
    expect(autoFillDownExtent({ r0: 0, c0: 1, r1: 0, c1: 1 }, has([]), 100, 26)).toBe(0)
  })
})

function setup(hasValue = (_r: number, _c: number) => false) {
  const sel = createSelection({
    clamp: (r, c) => ({ r, c }),
    totalRows: () => 100,
    totalCols: () => 26,
  })
  const onFill = vi.fn()
  const fill = createFillHandle({
    range: () => sel.range(),
    extendSel: (r, c) => sel.extendTo(r, c),
    hasValue,
    totalRows: () => 100,
    totalCols: () => 26,
    onFill,
  })
  return { sel, fill, onFill }
}

describe('fill drag', () => {
  it('ignores jitter, then extends and reports the fill on release', () => {
    const h = setup()
    h.fill.start(0, 0)
    h.fill.move(2, 2, { r: 5, c: 0 })
    expect(h.sel.range().r1).toBe(0)
    h.fill.move(0, 40, { r: 3, c: 0 })
    h.fill.end(true)
    expect(h.onFill).toHaveBeenCalledWith(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      expect.objectContaining({ r1: 3 }),
      { withModifier: true },
    )
    expect(h.fill.active()).toBe(false)
  })

  it('a click without a drag reports nothing', () => {
    const h = setup()
    h.fill.start(0, 0)
    h.fill.end(false)
    expect(h.onFill).not.toHaveBeenCalled()
  })
})

describe('double-click fill down', () => {
  it('fills alongside the neighbouring column', () => {
    const h = setup((r, c) => c === 0 && r >= 1 && r <= 4)
    h.sel.moveTo(0, 1)
    h.fill.fillDown(false)
    expect(h.onFill).toHaveBeenCalledWith(
      { r0: 0, c0: 1, r1: 0, c1: 1 },
      expect.objectContaining({ r1: 4 }),
      { withModifier: false },
    )
  })

  it('does nothing with no neighbour data', () => {
    const h = setup()
    h.fill.fillDown(false)
    expect(h.onFill).not.toHaveBeenCalled()
  })
})
