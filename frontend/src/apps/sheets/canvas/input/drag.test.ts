import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDrags, resizeTargets, type DragOptions, type Drags } from './drag.js'

let live: Drags[] = []
afterEach(() => {
  live.forEach((d) => d.destroy())
  live = []
})

function setup(over: Partial<DragOptions> = {}) {
  const opts: DragOptions = {
    canvasRect: () => ({ left: 0, top: 0 }),
    colInsertIndex: () => 7,
    getZoom: () => 2,
    setColWidths: vi.fn(),
    setRowHeights: vi.fn(),
    onColMove: vi.fn(),
    onResizeEnd: vi.fn(),
    render: vi.fn(),
    ...over,
  }
  const drags = createDrags(opts)
  live.push(drags)
  const move = (x: number, y: number) =>
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
  const up = () => document.dispatchEvent(new MouseEvent('mouseup'))
  return { drags, opts, move, up }
}

describe('resizeTargets', () => {
  it('the whole sheet, the selected block, or just the one', () => {
    expect(resizeTargets(2, false, true, 0, 0, 3)).toEqual([0, 1, 2])
    expect(resizeTargets(2, true, false, 1, 3, 26)).toEqual([1, 2, 3])
    expect(resizeTargets(2, false, false, 1, 3, 26)).toEqual([2])
  })
})

describe('resize', () => {
  it('follows the pointer, divided by zoom, and reports the end', () => {
    const h = setup()
    h.drags.startColResize([1, 2], 100, 80)
    expect(h.drags.resizing()).toBe('col')
    h.move(140, 0)
    expect(h.opts.setColWidths).toHaveBeenLastCalledWith([1, 2], 100)
    h.up()
    expect(h.drags.resizing()).toBeNull()
    expect(h.opts.onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('never goes below the minimum row height', () => {
    const h = setup()
    h.drags.startRowResize([0], 100, 24)
    h.move(0, 0)
    expect(h.opts.setRowHeights).toHaveBeenLastCalledWith([0], 16)
  })
})

describe('column move', () => {
  it('a click without moving is not a move', () => {
    const h = setup()
    h.drags.armColMove(1, 1, 0, 0)
    h.move(2, 0)
    expect(h.drags.colDrag()?.moved).toBe(false)
    h.up()
    expect(h.opts.onColMove).not.toHaveBeenCalled()
    expect(h.drags.colDrag()).toBeNull()
  })

  it('past the threshold it tracks the drop column and reports the move', () => {
    const h = setup()
    h.drags.armColMove(1, 2, 0, 0)
    h.move(30, 0)
    expect(h.drags.colDrag()).toMatchObject({ moved: true, insertCol: 7 })
    h.up()
    expect(h.opts.onColMove).toHaveBeenCalledWith(1, 7, 2)
  })
})
