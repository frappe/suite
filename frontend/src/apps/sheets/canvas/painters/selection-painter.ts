import { cellId } from '../../utils/cells.js'
import { COL_HEADER_H, COLORS, ROW_HEADER_W } from '../constants.js'
import type { Geometry } from '../geometry.js'
import type { Cell } from '../selection.js'
import type { CellBlock, CellProvider } from '../types.js'

// The selection frame is drawn on the cell's gridlines: a 2px stroke centred
// on the integer cell edge covers the 1px gridline plus one pixel beside it,
// so it is crisp at DPR 1 and 2 and no grey line shows next to it.
const FRAME_W = 2
// Fill handle: a square centred on the frame's bottom-right corner, with a
// 1px ring in the cell colour so it reads against the frame.
const HANDLE = 6
const HANDLE_RING = 1

export interface SelectionPainter {
  drawSelFill(range: CellBlock, sel: Cell | null, getMergeInfo: CellProvider['getMergeInfo']): void
  drawSelectionBorder(
    sel: Cell,
    range: CellBlock,
    fc: number,
    fr: number,
    mainX: number,
    mainY: number,
    cssW: number,
    cssH: number,
    getMergeInfo: CellProvider['getMergeInfo'],
  ): void
  drawMarchingAnts(rect: CellBlock, phase: number): void
  drawPickerFill(rect: CellBlock): void
  drawPickerBorder(rect: CellBlock): void
}

export function createSelectionPainter(
  ctx: CanvasRenderingContext2D,
  { cw, rh, colX, rowY }: Pick<Geometry, 'cw' | 'rh' | 'colX' | 'rowY'>,
): SelectionPainter {
  // The range gets a light tint; the active cell `sel` inside it stays white,
  // so a single selected cell has no fill at all. With no `sel` (or one
  // outside the range, which the renderer never passes) the whole range is
  // tinted.
  function drawSelFill(
    { r0, c0, r1, c1 }: CellBlock,
    sel: Cell | null,
    getMergeInfo: CellProvider['getMergeInfo'],
  ): void {
    const x = colX(c0),
      y = rowY(r0)
    const right = colX(c1) + cw(c1)
    const bottom = rowY(r1) + rh(r1)
    ctx.fillStyle = COLORS.selFill
    if (!sel || sel.r < r0 || sel.r > r1 || sel.c < c0 || sel.c > c1) {
      ctx.fillRect(x, y, right - x, bottom - y)
      return
    }
    const { w: aw, h: ah } = _activeSize(sel, getMergeInfo)
    const ax = colX(sel.c),
      ay = rowY(sel.r)
    // Up to four bands around the active cell: above, below, left, right.
    _fillBand(x, y, right - x, ay - y)
    _fillBand(x, ay + ah, right - x, bottom - ay - ah)
    _fillBand(x, ay, ax - x, ah)
    _fillBand(ax + aw, ay, right - ax - aw, ah)
  }

  function _fillBand(x: number, y: number, w: number, h: number): void {
    if (w > 0 && h > 0) ctx.fillRect(x, y, w, h)
  }

  function _activeSize(sel: Cell, getMergeInfo: CellProvider['getMergeInfo']) {
    const merge = getMergeInfo ? getMergeInfo(cellId(sel.r, sel.c)) : null
    const spanC = merge ? merge.colSpan : 1
    const spanR = merge ? merge.rowSpan : 1
    let w = 0,
      h = 0
    for (let i = 0; i < spanC; i++) w += cw(sel.c + i)
    for (let i = 0; i < spanR; i++) h += rh(sel.r + i)
    return { w, h, spanC, spanR }
  }

  function drawSelectionBorder(
    sel: Cell,
    range: CellBlock,
    fc: number,
    fr: number,
    mainX: number,
    mainY: number,
    cssW: number,
    cssH: number,
    getMergeInfo: CellProvider['getMergeInfo'],
  ): void {
    const { w: mergedW, h: mergedH, spanC, spanR } = _activeSize(sel, getMergeInfo)

    const x = colX(sel.c),
      y = rowY(sel.r)
    // A cell starting on a header edge would lose the outer half of its frame
    // to the clip, so that half may overlap the header. Not at a freeze line:
    // the separator drawn after this covers the frame there anyway.
    let clipX = sel.c < fc ? ROW_HEADER_W : mainX
    let clipY = sel.r < fr ? COL_HEADER_H : mainY
    if (x === ROW_HEADER_W && clipX === ROW_HEADER_W) clipX -= FRAME_W / 2
    if (y === COL_HEADER_H && clipY === COL_HEADER_H) clipY -= FRAME_W / 2
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipX, clipY, Math.max(0, cssW - clipX), Math.max(0, cssH - clipY))
    ctx.clip()
    ctx.strokeStyle = COLORS.selBorder
    ctx.lineWidth = FRAME_W
    ctx.strokeRect(x, y, mergedW, mergedH)
    ctx.lineWidth = 1
    // Fill handle anchors at the bottom-right of the *visible* selection.
    // For a single merged cell, range is just the master cell coords, so
    // we extend r1/c1 to the merge's far corner — otherwise the dot sits
    // in the middle of the merged block instead of at its bottom-right.
    const handleRange = {
      r0: range.r0,
      c0: range.c0,
      r1: Math.max(range.r1, sel.r + spanR - 1),
      c1: Math.max(range.c1, sel.c + spanC - 1),
    }
    _drawFillHandle(handleRange)
    ctx.restore()
  }

  function _drawFillHandle({ r1, c1 }: CellBlock): void {
    const hx = colX(c1) + cw(c1)
    const hy = rowY(r1) + rh(r1)
    const ring = HANDLE / 2 + HANDLE_RING
    ctx.fillStyle = COLORS.white
    ctx.fillRect(hx - ring, hy - ring, ring * 2, ring * 2)
    ctx.fillStyle = COLORS.selHandle
    ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
  }

  // Copy outline and formula range border sit where the selection frame does.
  function drawMarchingAnts({ r0, c0, r1, c1 }: CellBlock, phase: number): void {
    const x = colX(c0),
      y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    ctx.save()
    ctx.lineWidth = FRAME_W
    ctx.strokeStyle = COLORS.selBorder
    ctx.setLineDash([4, 4])
    ctx.lineDashOffset = -phase
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }

  // The formula range highlight comes in two passes, like the selection: the
  // fill is a solid theme grey, so it goes under the cells or it hides the
  // values it frames (ISSUES #83); the dashed border goes on top.
  function drawPickerFill({ r0, c0, r1, c1 }: CellBlock): void {
    const x = colX(c0),
      y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    ctx.fillStyle = COLORS.pickerFill
    ctx.fillRect(x, y, w, h)
  }

  function drawPickerBorder({ r0, c0, r1, c1 }: CellBlock): void {
    const x = colX(c0),
      y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    ctx.save()
    ctx.strokeStyle = COLORS.pickerBorder
    ctx.lineWidth = FRAME_W
    ctx.setLineDash([6, 4])
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }

  return { drawSelFill, drawSelectionBorder, drawMarchingAnts, drawPickerFill, drawPickerBorder }
}
