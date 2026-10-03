import {
  COL_HEADER_H,
  DEFAULT_COL_W,
  DEFAULT_ROW_H,
  ROW_HEADER_W,
  TOTAL_COLS,
  TOTAL_ROWS,
} from './constants.js'

export function createGeometry(
  colW,
  rowH,
  scroll,
  freeze = { rows: 0, cols: 0 },
  hiddenRows = null,
  hiddenCols = null,
  getZoom = () => 1,
  filterHiddenRows = null,
) {
  const cw = (c) => (hiddenCols && hiddenCols.has(c) ? 0 : (colW[c] ?? DEFAULT_COL_W))
  const rh = (r) => (hiddenRows && hiddenRows.has(r) ? 0 : (rowH[r] ?? DEFAULT_ROW_H))
  // Distinguishes filter-hidden rows (transient, many small gaps) from
  // manually-hidden rows so the grid painter can draw the bold "there's
  // something hidden here" boundary only for the manual variety.
  const isFilterHidden = (r) => !!(filterHiddenRows && filterHiddenRows.has(r))
  // Convert page coordinates into the renderer's *logical* coordinate system.
  // Renderer scales ctx by zoom; mouse coords come in physical CSS pixels.
  const _logical = (ex, ey, canvasRect) => {
    const z = getZoom() || 1
    return { x: (ex - canvasRect.left) / z, y: (ey - canvasRect.top) / z }
  }

  function frozenW() {
    let w = 0
    for (let i = 0; i < (freeze.cols || 0); i++) w += cw(i)
    return w
  }

  function frozenH() {
    let h = 0
    for (let i = 0; i < (freeze.rows || 0); i++) h += rh(i)
    return h
  }

  function colX(c) {
    const fc = freeze.cols || 0
    if (c < fc) {
      let x = ROW_HEADER_W
      for (let i = 0; i < c; i++) x += cw(i)
      return x
    }
    let x = ROW_HEADER_W + frozenW()
    for (let i = fc; i < c; i++) x += cw(i)
    return x - scroll.x
  }

  function rowY(r) {
    const fr = freeze.rows || 0
    if (r < fr) {
      let y = COL_HEADER_H
      for (let i = 0; i < r; i++) y += rh(i)
      return y
    }
    let y = COL_HEADER_H + frozenH()
    for (let i = fr; i < r; i++) y += rh(i)
    return y - scroll.y
  }

  function firstVisCol() {
    const fc = freeze.cols || 0
    let c = fc,
      x = 0
    while (c < TOTAL_COLS - 1 && x + cw(c) <= scroll.x) {
      x += cw(c)
      c++
    }
    return c
  }

  function firstVisRow() {
    const fr = freeze.rows || 0
    let r = fr,
      y = 0
    while (r < TOTAL_ROWS - 1 && y + rh(r) <= scroll.y) {
      y += rh(r)
      r++
    }
    return r
  }

  function lastVisCol(c0, cssW) {
    let c = c0
    while (c < TOTAL_COLS - 1 && colX(c) < cssW) c++
    return c
  }

  function lastVisRow(r0, cssH) {
    let r = r0
    while (r < TOTAL_ROWS - 1 && rowY(r) < cssH) r++
    return r
  }

  function hitTest(ex, ey, canvasRect) {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (x < ROW_HEADER_W || y < COL_HEADER_H) return null

    const fc = freeze.cols || 0
    const fr = freeze.rows || 0

    // Determine column (check frozen cols first)
    let c = 0,
      found = false
    let cx = ROW_HEADER_W
    for (let i = 0; i < fc; i++) {
      if (x < cx + cw(i)) {
        c = i
        found = true
        break
      }
      cx += cw(i)
    }
    if (!found) {
      cx = ROW_HEADER_W + frozenW() - scroll.x
      c = fc
      while (c < TOTAL_COLS - 1 && cx + cw(c) <= x) {
        cx += cw(c)
        c++
      }
    }

    // Determine row (check frozen rows first)
    let r = 0
    found = false
    let ry = COL_HEADER_H
    for (let i = 0; i < fr; i++) {
      if (y < ry + rh(i)) {
        r = i
        found = true
        break
      }
      ry += rh(i)
    }
    if (!found) {
      ry = COL_HEADER_H + frozenH() - scroll.y
      r = fr
      while (r < TOTAL_ROWS - 1 && ry + rh(r) <= y) {
        ry += rh(r)
        r++
      }
    }

    return { r, c }
  }

  function clamp(r, c) {
    return {
      r: Math.max(0, Math.min(r, TOTAL_ROWS - 1)),
      c: Math.max(0, Math.min(c, TOTAL_COLS - 1)),
    }
  }

  function hitTestCorner(ex, ey, canvasRect) {
    const { x, y } = _logical(ex, ey, canvasRect)
    return x < ROW_HEADER_W && y < COL_HEADER_H
  }

  // mainX/Y: left/top edge of the scrollable region (= ROW_HEADER_W+frozenW,
  // COL_HEADER_H+frozenH). Scrollable cells whose visible position is left/
  // above these are occluded by the frozen pane and must not be hittable.
  function _mainX() {
    return ROW_HEADER_W + frozenW()
  }
  function _mainY() {
    return COL_HEADER_H + frozenH()
  }

  function hitTestColResize(ex, ey, canvasRect) {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (y >= COL_HEADER_H) return null
    const fc = freeze.cols || 0
    const mainX = _mainX()
    for (let c = 0; c < TOTAL_COLS; c++) {
      const right = colX(c) + cw(c)
      // Frozen cols only matter inside [ROW_HEADER_W, mainX]; scrollable cols
      // only matter when their right edge is visible past mainX. Otherwise
      // they're either off-canvas or hidden under the frozen pane.
      if (c < fc) {
        if (right > mainX) continue
      } else {
        if (right <= mainX) continue
      }
      if (Math.abs(x - right) <= 4) return c
    }
    return null
  }

  function hitTestColHeader(ex, ey, canvasRect) {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (y >= COL_HEADER_H || x < ROW_HEADER_W) return null
    const fc = freeze.cols || 0
    const mainX = _mainX()
    // Inside the frozen strip: walk frozen cols only.
    if (x < mainX) {
      let cx = ROW_HEADER_W
      for (let i = 0; i < fc; i++) {
        if (x < cx + cw(i)) return i
        cx += cw(i)
      }
      return null
    }
    // Outside the frozen strip: walk scrollable cols starting at mainX.
    let cx = mainX - scroll.x
    let c = fc
    while (c < TOTAL_COLS - 1 && cx + cw(c) <= x) {
      cx += cw(c)
      c++
    }
    return c
  }

  // Insertion boundary for a column drag: the index a dropped column would sit
  // *before* (0..TOTAL_COLS), decided by which side of the hovered column's
  // midpoint the cursor sits on. Ignores the y coordinate so it tracks anywhere.
  function colInsertIndex(ex, canvasRect) {
    const { x } = _logical(ex, 0, canvasRect)
    const fc = freeze.cols || 0
    const mainX = _mainX()
    let c, cx
    if (x < mainX) {
      cx = ROW_HEADER_W
      c = 0
      while (c < fc && x >= cx + cw(c)) {
        cx += cw(c)
        c++
      }
      if (c >= fc) {
        c = fc
        cx = mainX - scroll.x
      }
    } else {
      cx = mainX - scroll.x
      c = fc
      while (c < TOTAL_COLS - 1 && cx + cw(c) <= x) {
        cx += cw(c)
        c++
      }
    }
    return x < cx + cw(c) / 2 ? c : c + 1
  }

  function hitTestRowHeader(ex, ey, canvasRect) {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (x >= ROW_HEADER_W || y < COL_HEADER_H) return null
    const fr = freeze.rows || 0
    const mainY = _mainY()
    if (y < mainY) {
      let ry = COL_HEADER_H
      for (let i = 0; i < fr; i++) {
        if (y < ry + rh(i)) return i
        ry += rh(i)
      }
      return null
    }
    let ry = mainY - scroll.y
    let r = fr
    while (r < TOTAL_ROWS - 1 && ry + rh(r) <= y) {
      ry += rh(r)
      r++
    }
    return r
  }

  function setColWidth(c, w) {
    colW[c] = Math.max(30, w)
  }

  function hitTestRowResize(ex, ey, canvasRect) {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (x >= ROW_HEADER_W) return null
    const fr = freeze.rows || 0
    const mainY = _mainY()
    for (let r = 0; r < TOTAL_ROWS; r++) {
      const yTop = rowY(r)
      if (yTop > y + 10) break
      const bottom = yTop + rh(r)
      if (r < fr) {
        if (bottom > mainY) continue
      } else {
        if (bottom <= mainY) continue
      }
      if (Math.abs(y - bottom) <= 4) return r
    }
    return null
  }

  function setRowHeight(r, h) {
    rowH[r] = Math.max(16, h)
  }

  return {
    cw,
    rh,
    colX,
    rowY,
    frozenW,
    frozenH,
    isFilterHidden,
    firstVisCol,
    firstVisRow,
    lastVisCol,
    lastVisRow,
    hitTest,
    clamp,
    hitTestColResize,
    hitTestColHeader,
    hitTestRowHeader,
    hitTestCorner,
    colInsertIndex,
    setColWidth,
    hitTestRowResize,
    setRowHeight,
  }
}
