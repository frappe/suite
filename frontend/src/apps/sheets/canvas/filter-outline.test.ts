// An active filter outlines its range in green (Google-Sheets-style). It is
// drawn on the canvas, under the selection, so the selection outline and the
// active frame always show over it where they meet (ISSUES #106).
import { describe, expect, it, vi } from 'vitest'

import { COL_HEADER_H, COLORS, ROW_HEADER_W } from './constants.js'
import { createGrid } from './index.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import { createRenderer } from './renderer.js'
import type { CellBlock } from './types.js'

type Rect = [number, number, number, number]

function render(filterRect: CellBlock | null) {
  const ctx = createMockCtx()
  const strokes: { rect: Rect; colour: string; lineWidth: number }[] = []
  // Leave out the repaint on the header edges' 1px strips (tested below).
  let strip = false
  ctx.rect = (_x: number, _y: number, w: number, h: number) => void (strip = w === 1 || h === 1)
  ctx.strokeRect = (...rect: Rect) => {
    if (!strip) strokes.push({ rect, colour: String(ctx.strokeStyle), lineWidth: ctx.lineWidth })
  }
  createRenderer(ctx as never, createMockGeo() as never).render({
    cssW: 600,
    cssH: 300,
    getValue: () => '',
    cells: {},
    // B2:C4 selected, B2 active.
    sel: { r: 1, c: 1 },
    selEnd: { r: 3, c: 2 },
    selMode: 'cell',
    editing: false,
    freeze: { rows: 0, cols: 0 },
    getDiffFor: null,
    marchAnts: null,
    marchPhase: 0,
    pickerRect: null,
    filterRect,
    colDrag: null,
    zoom: 1,
  })
  return strokes
}

describe('filter outline', () => {
  // B2:E6: x 150 … 550, y 48 … 168 in the mock geometry.
  const FILTER: CellBlock = { r0: 1, c0: 1, r1: 5, c1: 4 }

  it('outlines the filter range 1px in green on its gridline pixels', () => {
    expect(render(FILTER)[0]).toEqual({
      rect: [150.5, 48.5, 400, 120],
      colour: COLORS.filterOutline,
      lineWidth: 1,
    })
  })

  it('draws it before the selection, so the selection lies on top', () => {
    const colours = render(FILTER).map((s) => s.colour)
    expect(colours.indexOf(COLORS.filterOutline)).toBe(0)
    expect(colours.slice(1).every((c) => c === COLORS.selBorder)).toBe(true)
  })

  it('draws nothing green without a filter', () => {
    expect(render(null).some((s) => s.colour === COLORS.filterOutline)).toBe(false)
  })
})

// The row and column headers' borders are painted after the cells, onto the
// first gridline of column A and row 1. A filter or range that starts there
// gets its outline painted again on those 1px strips, after the headers.
describe('outlines on the sheet’s top and left edge', () => {
  type Op = { kind: 'path' | 'rect' | 'clip'; colour?: string; lineWidth?: number; rect?: Rect }

  function ops(filterRect: CellBlock | null, selEnd = { r: 2, c: 1 }) {
    const ctx = createMockCtx()
    const out: Op[] = []
    ctx.stroke = () => void out.push({ kind: 'path', colour: String(ctx.strokeStyle) })
    ctx.strokeRect = (...rect: Rect) =>
      void out.push({
        kind: 'rect',
        colour: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
        rect,
      })
    ctx.rect = (...rect: Rect) => void out.push({ kind: 'clip', rect })
    createRenderer(ctx as never, createMockGeo() as never).render({
      cssW: 600,
      cssH: 300,
      getValue: () => '',
      cells: {},
      // A1:B3 selected, A1 active.
      sel: { r: 0, c: 0 },
      selEnd,
      selMode: 'cell',
      editing: false,
      freeze: { rows: 0, cols: 0 },
      getDiffFor: null,
      marchAnts: null,
      marchPhase: 0,
      pickerRect: null,
      filterRect,
      colDrag: null,
      zoom: 1,
    })
    return out
  }

  // What is painted after the last header border (a grey path stroke).
  function afterHeaders(list: Op[]) {
    const last = list
      .map((o) => o.kind === 'path' && o.colour === COLORS.gridLine)
      .lastIndexOf(true)
    return list.slice(last + 1)
  }

  it('repaints a filter and a range starting at A1 over the header borders', () => {
    const late = afterHeaders(ops({ r0: 0, c0: 0, r1: 2, c1: 1 }))
    const strips = late.filter((o) => o.kind === 'clip').map((o) => o.rect)
    expect(strips).toContainEqual([ROW_HEADER_W, COL_HEADER_H, 1, 300 - COL_HEADER_H])
    expect(strips).toContainEqual([ROW_HEADER_W, COL_HEADER_H, 600 - ROW_HEADER_W, 1])
    const colours = late.filter((o) => o.kind === 'rect').map((o) => o.colour)
    expect(colours).toContain(COLORS.filterOutline)
    // The filter goes under the range outline, which goes under the frame.
    expect(colours.indexOf(COLORS.filterOutline)).toBeLessThan(colours.indexOf(COLORS.selBorder))
    expect(late.filter((o) => o.kind === 'rect').at(-1)!.lineWidth).toBe(1.5)
  })
})

// The editor sets the filter range again after every paint (each paint bumps
// its render counter). An unchanged range must not ask for another frame, or
// the grid repaints forever.
describe('setting the filter range', () => {
  function grid() {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx() as never)
    document.body.appendChild(canvas)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    const g = createGrid(canvas, {
      cells: { getStyle: () => ({}) },
      host: { canEdit: () => true },
    } as never)
    g.resize(800, 600)
    frames.splice(0).forEach((cb) => cb(0))
    return { g, frames }
  }

  it('asks for a frame only when the range changes', () => {
    const { g, frames } = grid()
    g.setFilterRange({ r0: 0, c0: 0, r1: 2, c1: 1 })
    expect(frames).toHaveLength(1)
    frames.splice(0).forEach((cb) => cb(0))

    g.setFilterRange({ r0: 0, c0: 0, r1: 2, c1: 1 })
    expect(frames).toHaveLength(0)
    g.setFilterRange(null)
    expect(frames).toHaveLength(1)
    frames.splice(0).forEach((cb) => cb(0))
    g.setFilterRange(null)
    expect(frames).toHaveLength(0)
  })
})
