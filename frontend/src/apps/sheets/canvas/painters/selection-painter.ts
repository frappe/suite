import { cellId } from '../../utils/cells.js'
import { COL_HEADER_H, COLORS, FRAME_W, GRID_LINE, ROW_HEADER_W, SEL_ALPHA } from '../constants.js'
import type { Geometry } from '../geometry.js'
import type { Cell } from '../selection.js'
import type { CellBlock, CellProvider } from '../types.js'

// Every selection line is centred on the gridline (GRID_LINE: edge + 0.5),
// so it reaches past it equally on both sides. FRAME_W is the active cell's
// frame, and the copy / formula range borders.
// A range larger than the active cell also gets a thinner outline: 1px,
// exactly on the gridline pixels, so it covers them and stays crisp.
const OUTLINE_W = 1
// Fill handle: a square centred on the gridlines' crossing at the selection's
// bottom-right corner, with a 1px ring in the cell colour so it reads against
// it. 7px centred on a half pixel lands on whole pixels at DPR 1 and 2.
const HANDLE = 7
const HANDLE_RING = 1

export interface SelectionPainter {
  drawSelFill(range: CellBlock, sel: Cell | null, getMergeInfo: CellProvider['getMergeInfo']): void
  drawRangeOutline(
    range: CellBlock,
    sel: Cell | null,
    getMergeInfo: CellProvider['getMergeInfo'],
  ): void
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
  drawFilterOutline(rect: CellBlock): void
}

export function createSelectionPainter(
  ctx: CanvasRenderingContext2D,
  { cw, rh, colX, rowY }: Pick<Geometry, 'cw' | 'rh' | 'colX' | 'rowY'>,
): SelectionPainter {
  // The whole range, active cell included, gets a see-through tint painted
  // over the cells. A selection that is just the (merged) active cell `sel`
  // gets none: its frame says enough. With no `sel` the range is always
  // tinted (row, column and whole-sheet selections).
  function drawSelFill(
    { r0, c0, r1, c1 }: CellBlock,
    sel: Cell | null,
    getMergeInfo: CellProvider['getMergeInfo'],
  ): void {
    const x = colX(c0),
      y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    if (sel) {
      const { w: aw, h: ah } = _activeSize(sel, getMergeInfo)
      if (w <= aw && h <= ah) return
    }
    ctx.save()
    ctx.globalAlpha = SEL_ALPHA
    ctx.fillStyle = COLORS.selFill
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  // Drawn per pane with the tint (the renderer clips each pane), so a range
  // that crosses a freeze line is outlined in both panes and never over one.
  // Like the tint, a selection that is just the active cell `sel` gets none;
  // with no `sel` (row, column, whole sheet) the range is always outlined.
  function drawRangeOutline(
    range: CellBlock,
    sel: Cell | null,
    getMergeInfo: CellProvider['getMergeInfo'],
  ): void {
    const x = colX(range.c0),
      y = rowY(range.r0)
    const w = colX(range.c1) + cw(range.c1) - x
    const h = rowY(range.r1) + rh(range.r1) - y
    if (sel) {
      const { w: aw, h: ah } = _activeSize(sel, getMergeInfo)
      if (w <= aw && h <= ah) return
    }
    ctx.save()
    ctx.strokeStyle = COLORS.selBorder
    ctx.lineWidth = OUTLINE_W
    ctx.strokeRect(x + GRID_LINE, y + GRID_LINE, w, h)
    ctx.restore()
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
    // A cell starting on a header edge would lose the part of its frame past the
    // edge (FRAME_W / 2 - GRID_LINE) to the clip, so that part may overlap the
    // header. Not at a freeze line:
    // the separator drawn after this covers the frame there anyway.
    let clipX = sel.c < fc ? ROW_HEADER_W : mainX
    let clipY = sel.r < fr ? COL_HEADER_H : mainY
    if (x === ROW_HEADER_W && clipX === ROW_HEADER_W) clipX -= FRAME_W / 2 - GRID_LINE
    if (y === COL_HEADER_H && clipY === COL_HEADER_H) clipY -= FRAME_W / 2 - GRID_LINE
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipX, clipY, Math.max(0, cssW - clipX), Math.max(0, cssH - clipY))
    ctx.clip()
    // The visible selection's far corner: for a single merged cell, range is
    // just the master cell coords, so extend r1/c1 to the merge's far corner.
    const sr1 = Math.max(range.r1, sel.r + spanR - 1),
      sc1 = Math.max(range.c1, sel.c + spanC - 1)
    const right = colX(sc1) + cw(sc1),
      bottom = rowY(sr1) + rh(sr1)
    ctx.strokeStyle = COLORS.selBorder
    ctx.lineWidth = FRAME_W
    ctx.strokeRect(x + GRID_LINE, y + GRID_LINE, mergedW, mergedH)
    ctx.lineWidth = 1
    _drawFillHandle(right, bottom)
    ctx.restore()
  }

  // `hx`, `hy`: the selection's right and bottom cell edges.
  function _drawFillHandle(hx: number, hy: number): void {
    const x = hx + GRID_LINE - HANDLE / 2,
      y = hy + GRID_LINE - HANDLE / 2
    ctx.fillStyle = COLORS.white
    ctx.fillRect(
      x - HANDLE_RING,
      y - HANDLE_RING,
      HANDLE + 2 * HANDLE_RING,
      HANDLE + 2 * HANDLE_RING,
    )
    ctx.fillStyle = COLORS.selHandle
    ctx.fillRect(x, y, HANDLE, HANDLE)
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
    ctx.strokeRect(x + GRID_LINE, y + GRID_LINE, w, h)
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
    ctx.strokeRect(x + GRID_LINE, y + GRID_LINE, w, h)
    ctx.restore()
  }

  // An active filter's range: 1px on its gridline pixels, like the range
  // outline. The renderer draws it before the selection, which covers it.
  function drawFilterOutline({ r0, c0, r1, c1 }: CellBlock): void {
    const x = colX(c0),
      y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    ctx.save()
    ctx.strokeStyle = COLORS.filterOutline
    ctx.lineWidth = OUTLINE_W
    ctx.strokeRect(x + GRID_LINE, y + GRID_LINE, w, h)
    ctx.restore()
  }

  return {
    drawSelFill,
    drawRangeOutline,
    drawSelectionBorder,
    drawMarchingAnts,
    drawPickerFill,
    drawPickerBorder,
    drawFilterOutline,
  }
}
