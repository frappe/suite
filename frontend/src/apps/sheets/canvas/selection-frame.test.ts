// The selection frame sits on the gridlines and the fill handle sits on the
// frame's corner. Cell edges are integers, so a 2px stroke there covers the
// 1px gridline plus one pixel beside it: crisp, with no grey line left next
// to the black one.
import { describe, expect, it, vi } from 'vitest'

import { COL_HEADER_H, COLORS, ROW_HEADER_W } from './constants.js'
import { createSelectionPainter } from './painters/selection-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import { createRenderer } from './renderer.js'
import type { Cell } from './selection.js'
import type { CellBlock, MergeInfo } from './types.js'

type Rect = [number, number, number, number]

function recordingCtx() {
  const ctx = createMockCtx()
  const strokes: { rect: Rect; lineWidth: number }[] = []
  const fills: { rect: Rect; colour: string }[] = []
  ctx.strokeRect = (...rect: Rect) => strokes.push({ rect, lineWidth: ctx.lineWidth })
  ctx.fillRect = (...rect: Rect) => fills.push({ rect, colour: String(ctx.fillStyle) })
  return { ctx, strokes, fills }
}

// B2: x 150 … 250, y 48 … 72 in the mock geometry.
const B2 = { r: 1, c: 1 }
const ONE: CellBlock = { r0: 1, c0: 1, r1: 1, c1: 1 }

function frame(range: CellBlock = ONE, merge: MergeInfo | null = null) {
  const { ctx, strokes, fills } = recordingCtx()
  const sp = createSelectionPainter(ctx, createMockGeo())
  sp.drawSelectionBorder(B2, range, 0, 0, 50, 24, 1000, 1000, () => merge)
  return { strokes, fills }
}

describe('selection frame', () => {
  it('strokes 2px on the cell’s gridlines', () => {
    expect(frame().strokes).toEqual([{ rect: [150, 48, 100, 24], lineWidth: 2 }])
  })

  it('frames a merged active cell on its outer gridlines', () => {
    expect(frame(ONE, { colSpan: 2, rowSpan: 3 }).strokes[0].rect).toEqual([150, 48, 200, 72])
  })

  it('keeps the full 2px on the side that meets a header', () => {
    // A1's frame is centred on the header edges; its outer pixel lies on the
    // header side, so the clip must reach 1px past them.
    const { ctx } = recordingCtx()
    const clips: Rect[] = []
    ctx.rect = (...r: Rect) => void clips.push(r)
    const sp = createSelectionPainter(ctx, createMockGeo())
    const a1 = { r0: 0, c0: 0, r1: 0, c1: 0 }
    sp.drawSelectionBorder(
      { r: 0, c: 0 },
      a1,
      0,
      0,
      ROW_HEADER_W,
      COL_HEADER_H,
      1000,
      1000,
      () => null,
    )
    expect(clips[0].slice(0, 2)).toEqual([ROW_HEADER_W - 1, COL_HEADER_H - 1])
  })

  it('keeps the plain clip for a cell starting on the freeze line', () => {
    // One frozen column (A); B2 is the first scrolled column, x = mainX = 150.
    const { ctx } = recordingCtx()
    const clips: Rect[] = []
    ctx.rect = (...r: Rect) => void clips.push(r)
    const sp = createSelectionPainter(ctx, createMockGeo())
    sp.drawSelectionBorder(B2, ONE, 1, 0, 150, COL_HEADER_H, 1000, 1000, () => null)
    expect(clips[0].slice(0, 2)).toEqual([150, COL_HEADER_H])
  })

  it('keeps the plain clip for a cell scrolled under the frozen pane', () => {
    const { ctx } = recordingCtx()
    const clips: Rect[] = []
    ctx.rect = (...r: Rect) => void clips.push(r)
    const sp = createSelectionPainter(ctx, createMockGeo())
    // B2 starts at x=150; the frozen pane ends at 200, so B2 is half under it.
    sp.drawSelectionBorder(B2, ONE, 0, 0, 200, 24, 1000, 1000, () => null)
    expect(clips[0][0]).toBe(200)
  })

  it('centres a square fill handle on the frame’s corner', () => {
    const { fills } = frame()
    // White ring (8px) then the 6px handle, both centred on (250, 72).
    expect(fills).toEqual([
      { rect: [246, 68, 8, 8], colour: COLORS.white },
      { rect: [247, 69, 6, 6], colour: COLORS.selHandle },
    ])
  })

  it('draws no range outline for a single cell', () => {
    expect(frame().strokes).toHaveLength(1)
  })
})

describe('range outline', () => {
  // B2:C4 with B2 active: the range spans x 150 … 350, y 48 … 120.
  const RANGE: CellBlock = { r0: 1, c0: 1, r1: 3, c1: 2 }

  function paint(sel: Cell, range: CellBlock) {
    const { ctx, strokes, fills } = recordingCtx()
    const sp = createSelectionPainter(ctx, createMockGeo())
    sp.drawRangeOutline(range, sel, () => null)
    sp.drawSelectionBorder(sel, range, 0, 0, 50, 24, 1000, 1000, () => null)
    return { strokes, fills }
  }

  it('outlines the whole range 1px on its gridline pixels, under the active frame', () => {
    // Gridline pixels are x 150 and 350, y 48 and 120: a 1px line centred on
    // each pixel's middle.
    expect(paint(B2, RANGE).strokes).toEqual([
      { rect: [150.5, 48.5, 200, 72], lineWidth: 1 },
      { rect: [150, 48, 100, 24], lineWidth: 2 },
    ])
  })

  it('draws no outline when the range is just the (merged) active cell', () => {
    const { ctx, strokes } = recordingCtx()
    const sp = createSelectionPainter(ctx, createMockGeo())
    sp.drawRangeOutline({ r0: 1, c0: 1, r1: 2, c1: 2 }, B2, () => ({ colSpan: 2, rowSpan: 2 }))
    expect(strokes).toEqual([])
  })

  it('draws the outline in every pane the range crosses, like the tint', () => {
    // One frozen row: a range from B1 (frozen) to B5 (scrolling) is outlined
    // in both panes, each clipped to its own pane.
    const ctx = createMockCtx()
    let outlines = 0
    ctx.strokeRect = () => {
      if (ctx.lineWidth === 1) outlines++
    }
    const geo = createMockGeo()
    geo.frozenH = vi.fn(() => 24)
    createRenderer(ctx as never, geo as never).render({
      cssW: 600,
      cssH: 300,
      getValue: () => '',
      cells: {},
      sel: { r: 4, c: 1 },
      selEnd: { r: 0, c: 1 },
      selMode: 'cell',
      editing: false,
      freeze: { rows: 1, cols: 0 },
      getDiffFor: null,
      marchAnts: null,
      marchPhase: 0,
      pickerRect: null,
      colDrag: null,
      zoom: 1,
    })
    expect(outlines).toBe(2)
  })

  it('centres the handle on the 1px outline when the active cell is elsewhere', () => {
    // The outline's corner pixel is (350, 120), centre (350.5, 120.5): a 7px
    // square on whole pixels, x 347 … 354.
    expect(paint(B2, RANGE).fills.at(-1)!.rect).toEqual([347, 117, 7, 7])
  })

  it('centres the handle on the 2px frame when the active cell is in that corner', () => {
    expect(paint({ r: 3, c: 2 }, RANGE).fills.at(-1)!.rect).toEqual([347, 117, 6, 6])
  })

  it('picks the line per axis', () => {
    // B2:C2 with B2 active: the frame reaches the bottom edge, not the right.
    const row: CellBlock = { r0: 1, c0: 1, r1: 1, c1: 2 }
    expect(paint(B2, row).fills.at(-1)!.rect).toEqual([347, 69, 7, 6])
  })
})

describe('copy outline and formula range border', () => {
  it('draws the marching ants on the gridlines, 2px', () => {
    const { ctx, strokes } = recordingCtx()
    createSelectionPainter(ctx, createMockGeo()).drawMarchingAnts(ONE, 0)
    expect(strokes).toEqual([{ rect: [150, 48, 100, 24], lineWidth: 2 }])
  })

  it('draws the picker border on the gridlines, 2px', () => {
    const { ctx, strokes } = recordingCtx()
    createSelectionPainter(ctx, createMockGeo()).drawPickerBorder(ONE)
    expect(strokes).toEqual([{ rect: [150, 48, 100, 24], lineWidth: 2 }])
  })
})

describe('selection fill', () => {
  const area = (fills: { rect: Rect }[]) => fills.reduce((a, f) => a + f.rect[2] * f.rect[3], 0)
  const overlaps = ([x, y, w, h]: Rect, [ax, ay, aw, ah]: Rect) =>
    x < ax + aw && ax < x + w && y < ay + ah && ay < y + h

  function fill(range: CellBlock, sel: Cell | null = B2, merge: MergeInfo | null = null) {
    const { ctx, fills } = recordingCtx()
    createSelectionPainter(ctx, createMockGeo()).drawSelFill(range, sel, () => merge)
    return fills
  }

  it('leaves a single active cell white', () => {
    expect(fill(ONE)).toEqual([])
  })

  it('tints a range except the active cell', () => {
    // B2:D4 is 300 × 72; the active B2 (100 × 24) stays white.
    const fills = fill({ r0: 1, c0: 1, r1: 3, c1: 3 }, { r: 2, c: 2 })
    expect(area(fills)).toBe(300 * 72 - 100 * 24)
    for (const f of fills) {
      expect(f.colour).toBe(COLORS.selFill)
      expect(overlaps(f.rect, [250, 72, 100, 24])).toBe(false)
    }
  })

  it('tints the whole range when there is no active cell to leave out', () => {
    const fills = fill({ r0: 1, c0: 1, r1: 3, c1: 3 }, null)
    expect(fills).toEqual([{ rect: [150, 48, 300, 72], colour: COLORS.selFill }])
  })

  it('tints a selected row evenly, active cell included (no frame there)', () => {
    const ctx = createMockCtx()
    const fills: Rect[] = []
    ctx.fillRect = (...rect: Rect) => {
      if (ctx.fillStyle === COLORS.selFill) fills.push(rect)
    }
    createRenderer(ctx as never, createMockGeo() as never).render({
      cssW: 600,
      cssH: 300,
      getValue: () => '',
      cells: {},
      sel: { r: 1, c: 2 },
      selEnd: { r: 1, c: 2 },
      selMode: 'row',
      editing: false,
      freeze: { rows: 0, cols: 0 },
      getDiffFor: null,
      marchAnts: null,
      marchPhase: 0,
      pickerRect: null,
      colDrag: null,
      zoom: 1,
    })
    expect(fills).toHaveLength(1)
    expect(fills[0][1]).toBe(48)
    expect(fills[0][3]).toBe(24)
  })

  it('leaves a merged active cell white as a whole', () => {
    const fills = fill({ r0: 1, c0: 1, r1: 3, c1: 3 }, B2, { colSpan: 2, rowSpan: 2 })
    expect(area(fills)).toBe(300 * 72 - 200 * 48)
    for (const f of fills) expect(overlaps(f.rect, [150, 48, 200, 48])).toBe(false)
  })
})
