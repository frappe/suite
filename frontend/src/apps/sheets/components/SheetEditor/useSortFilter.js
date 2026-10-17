// The sheet's filter: turning it on/off, the chevron + outline overlay
// geometry, the filter panel's open state, and apply / clear / sort.
// Extracted from SheetEditor/index.vue. The panel's form is FilterPanel.vue.
//
// Usage:
//   const { filterPanel, showSortFilter, openFilterPanel, applyFilter, ... } =
//     useSortFilter({ sortFilter, currentSheet, activeCell, renderVersion,
//       gridWrapRef, history, getGrid, readRect, rectBlocked, pushEditOp,
//       repopulateGrid, applyHiddenRows, markDirty })

import { computed, nextTick, reactive, watch } from 'vue'

import { COL_HEADER_H, ROW_HEADER_W } from '../../canvas/constants'
import { parseCellId } from '../../utils/cells.js'
import { overlayRectStyle } from '../../utils/overlay-rect.js'

// The panel renders at FILTER_PANEL_W px outer width (260 content + 24 padding +
// 2 border, content-box). clampFilterLeft keeps its full width inside the grid
// wrap so chevrons on right-edge columns don't push the Apply/Close buttons
// off-screen. Live positioning lives in the filterPanelStyle computed.
const FILTER_PANEL_W = 286
function clampFilterLeft(left, wrapWidth) {
  const GAP = 6
  const maxLeft = wrapWidth - FILTER_PANEL_W - GAP
  return Math.max(GAP, Math.min(left, maxLeft))
}

export function useSortFilter({
  sortFilter,
  currentSheet,
  activeCell,
  renderVersion,
  gridWrapRef,
  history,
  getGrid,
  readRect,
  rectBlocked,
  pushEditOp,
  repopulateGrid,
  applyHiddenRows,
  markDirty,
}) {
  // Filter panel state. The form itself (mode, operator, checked values) lives
  // in FilterPanel.vue, which is re-created on every open (`seq` is its key).
  //   - allValues: distinct displayed values in the column's data range, read
  //     once per open so the panel doesn't recompute on every keystroke.
  //   - spec: the column's saved filter, which the panel starts from.
  const filterPanel = reactive({
    open: false,
    col: 0,
    allValues: [],
    spec: null,
    seq: 0,
  })

  // `showSortFilter` is the existing template/handler API; with ranged filters
  // it's now derived from "does this sheet have a filter range?".  Writing true
  // creates a filter on the current selection; writing false removes it.
  const showSortFilter = computed({
    get() {
      void renderVersion.value
      return sortFilter.hasFilter(currentSheet.value)
    },
    set(v) {
      if (v) _createFilterOnSelection().catch((e) => console.error('[sheets] filter failed', e))
      else _removeFilter()
    },
  })

  // Re-render the canvas when the filter row is toggled so row-0 cells reserve
  // (or release) right-padding for the chevron buttons.
  watch(showSortFilter, () => {
    getGrid()?.render?.()
  })

  // ── Filter overlay geometry ───────────────────────────────────────────────────

  const filterConfig = computed(() => {
    void renderVersion.value // re-eval when canvas re-renders (e.g. filter apply)
    return sortFilter.getFilterConfig(currentSheet.value)
  })
  const filterRange = computed(() => {
    void renderVersion.value
    return sortFilter.getRange(currentSheet.value)
  })

  // Chevron buttons appear only on the header row of the active filter range —
  // at most one filter per sheet, scoped to its rectangle (Google-Sheets-style).
  const visibleFilterCols = computed(() => {
    void renderVersion.value
    const grid = getGrid()
    if (!grid || !filterRange.value) return []
    const { r0, c0, c1 } = filterRange.value
    const rowRect = grid.getRowRect(r0)
    const rects = grid.getColumnHeaderRects().filter(({ c }) => c >= c0 && c <= c1)
    const BTN = 16
    return rects.map(({ c, x, width }) => ({
      col: c,
      style: {
        left: x + width - BTN - 3 + 'px',
        top: rowRect.y + (rowRect.height - BTN) / 2 + 'px',
        width: BTN + 'px',
        height: BTN + 'px',
      },
    }))
  })

  // Live position for the open filter panel. Recomputed on every canvas render
  // (renderVersion) so the panel tracks its column as the grid scrolls, anchored
  // to the column's chevron just like visibleFilterCols. Returns display:none when
  // the column scrolls out of the visible header range so the panel hides instead
  // of floating over unrelated columns; it reappears when scrolled back into view.
  const filterPanelStyle = computed(() => {
    void renderVersion.value
    const grid = getGrid()
    if (!filterPanel.open || !grid || !filterRange.value)
      return {
        display: 'none',
      }
    const { r0 } = filterRange.value
    const colRect = grid.getColumnHeaderRects().find(({ c }) => c === filterPanel.col)
    const rowRect = grid.getRowRect(r0)
    if (!colRect || !rowRect)
      return {
        display: 'none',
      }
    const BTN = 16
    const wrapW = gridWrapRef.value?.getBoundingClientRect().width ?? Infinity
    return {
      top: rowRect.y + rowRect.height + 2 + 'px',
      left: clampFilterLeft(colRect.x + colRect.width - BTN - 3, wrapW) + 'px',
    }
  })

  // Outline drawn around the active filter's rectangle so its extent is visible
  // (Google-Sheets-style). Mirrors the pivot highlight: bounding box from the
  // range's top-left / bottom-right cell rects, clamped to the header strips so
  // it never paints over the row-number gutter or column-header row when the
  // range is scrolled partly out of view.
  const filterHighlightStyle = computed(() => {
    void renderVersion.value
    const grid = getGrid()
    if (!showSortFilter.value || !grid || !filterRange.value) return null
    const { r0, c0, r1, c1 } = filterRange.value
    const tl = grid.getCellRect?.(r0, c0)
    const br = grid.getCellRect?.(r1, c1)
    if (!tl || !br) return null
    const zoom = grid.getZoom?.() ?? 1
    // `|| Infinity` treats a 0/undefined viewport (before the first layout) as
    // "unclamped" — a 0 would otherwise collapse the overlay to nothing.
    const vp = grid.getViewportSize?.()
    const viewW = vp?.w || Infinity
    const viewH = vp?.h || Infinity
    return overlayRectStyle(tl, br, {
      headerX: ROW_HEADER_W * zoom,
      headerY: COL_HEADER_H * zoom,
      viewW,
      viewH,
    })
  })

  // ── Sort & Filter ─────────────────────────────────────────────────────────────

  // Expand a single anchor cell to the contiguous non-empty data block around it
  // (Google-Sheets Ctrl+A behaviour). If the anchor itself is empty, pivot to
  // the adjacent cell down/right that has data — the empty anchor then becomes
  // the header row/col of the resulting block. Returns null only when nothing
  // adjacent has data either.
  // The contiguous block of non-empty cells around (r, c), as a rect, or null
  // when the anchor and its right/lower neighbours are empty. Reads a window
  // around the anchor in one go and widens it while the block reaches its edge.
  async function detectContiguousBlock(r, c) {
    const sn = currentSheet.value
    for (let rows = 1000, cols = 26; ; rows *= 8, cols *= 8) {
      const win = {
        r0: Math.max(0, r - rows),
        c0: Math.max(0, c - cols),
        r1: r + rows,
        c1: c + cols,
      }
      const { inputs } = await readRect(sn, win)
      const hasVal = (rr, cc) =>
        rr >= win.r0 &&
        cc >= win.c0 &&
        rr <= win.r1 &&
        cc <= win.c1 &&
        (inputs[rr - win.r0]?.[cc - win.c0] ?? '') !== ''
      const block = _blockAround(r, c, hasVal)
      if (!block) return null
      const atEdge =
        (block.r0 === win.r0 && win.r0 > 0) ||
        block.r1 === win.r1 ||
        (block.c0 === win.c0 && win.c0 > 0) ||
        block.c1 === win.c1
      if (!atEdge || rows >= 1_000_000) return block
    }
  }

  function _blockAround(r, c, hasVal) {
    const anchorEmpty = !hasVal(r, c)
    let ar = r,
      ac = c
    if (anchorEmpty) {
      if (hasVal(r + 1, c)) ar = r + 1
      else if (hasVal(r, c + 1)) ac = c + 1
      else return null
    }
    let r0 = ar,
      r1 = ar,
      c0 = ac,
      c1 = ac
    while (r0 > 0 && hasVal(r0 - 1, ac)) r0--
    while (hasVal(r1 + 1, ac)) r1++
    while (c0 > 0 && hasVal(ar, c0 - 1)) c0--
    while (hasVal(ar, c1 + 1)) c1++
    // Walk again from the new top-row left/right edges in case the block widens
    // below; this matches Google Sheets' "smart" expansion well enough for now.
    for (let rr = r0; rr <= r1; rr++) {
      while (c0 > 0 && hasVal(rr, c0 - 1)) c0--
      while (hasVal(rr, c1 + 1)) c1++
    }
    // If the original anchor sits exactly one row above (or one col left of)
    // the detected block, fold it in as the header row/col.
    if (anchorEmpty && r === r0 - 1 && c >= c0 && c <= c1) r0 = r
    if (anchorEmpty && c === c0 - 1 && r >= r0 && r <= r1) c0 = c
    return {
      r0,
      c0,
      r1,
      c1,
    }
  }

  // Create a filter on the user's current selection.  A selection that spans no
  // data rows — a single cell, or a lone header row like A1:E1 — auto-expands to
  // the contiguous data block around its top-left anchor (or refuses if that
  // anchor is empty). Without this, toggling the filter on just the header row
  // would produce a header-only range (r1 === r0): chevrons appear, but the
  // value list scans zero data rows and comes up empty. A genuine multi-row
  // block is taken verbatim.
  async function _createFilterOnSelection() {
    const grid = getGrid()
    if (!grid) return
    const sel = grid.getSelection()
    const noDataRows = sel.r0 === sel.r1
    const range = noDataRows
      ? (await detectContiguousBlock(sel.r0, sel.c0)) || {
          r0: sel.r0,
          c0: sel.c0,
          r1: sel.r0,
          c1: sel.c0,
        }
      : {
          r0: sel.r0,
          c0: sel.c0,
          r1: sel.r1,
          c1: sel.c1,
        }
    sortFilter.setRange(range, currentSheet.value)
    filterPanel.open = false
    applyHiddenRows()
    getGrid()?.render?.()
    history.push()
    markDirty()
  }
  function _removeFilter() {
    sortFilter.clearRange(currentSheet.value)
    filterPanel.open = false
    applyHiddenRows()
    getGrid()?.render?.()
    history.push()
    markDirty()
  }

  async function openFilterPanel(colIdx) {
    const sn = currentSheet.value
    await sortFilter.refresh(sn)
    const cfg = sortFilter.getFilterConfig(sn)
    filterPanel.col = colIdx
    filterPanel.allValues = sortFilter.getColumnValues(colIdx, sn)
    filterPanel.spec = cfg[colIdx] || null
    filterPanel.seq++
    filterPanel.open = true
  }

  // Alt+↓ on a canvas cell opens the filter panel for that cell's column. Forces
  // the filter row visible first (so chevrons exist) and anchors the popover at
  // the column's row-0 cell rather than at a click target.
  async function openQuickFilterForActive() {
    const id = activeCell.value
    const p = parseCellId(id)
    if (!p) return
    if (!sortFilter.hasFilter(currentSheet.value)) await _createFilterOnSelection()
    nextTick(() => {
      const range = sortFilter.getRange(currentSheet.value)
      if (!range || p.col < range.c0 || p.col > range.c1) return
      const grid = getGrid()
      const rects = grid?.getColumnHeaderRects?.() || []
      const colRect = rects.find((r) => r.c === p.col)
      const rowRect = grid?.getRowRect?.(range.r0)
      if (!colRect || !rowRect) return
      // Position is derived live by the filterPanelStyle computed; we only need
      // the column visible here so the panel has a valid anchor on open.
      openFilterPanel(p.col)
    })
  }

  // `spec` comes from FilterPanel.vue; null means every value is checked, which
  // is identical to no filter, so the column's entry is cleared instead.
  function applyFilter(spec) {
    const sn = currentSheet.value
    if (spec) sortFilter.setFilter(filterPanel.col, spec, sn)
    else sortFilter.clearFilter(filterPanel.col, sn)
    filterPanel.open = false
    repopulateGrid()
    applyHiddenRows()
    history.push()
    markDirty()
  }
  function clearFilterCol() {
    sortFilter.clearFilter(filterPanel.col, currentSheet.value)
    filterPanel.open = false
    repopulateGrid()
    applyHiddenRows()
    history.push()
    markDirty()
  }
  async function doSort(colIdx, dir) {
    const sn = currentSheet.value
    // Sorting permutes values across the filter range — refuse if it overlaps
    // protection, matching Google Sheets (a protected range blocks the sort).
    const range = sortFilter.getRange(sn)
    if (range && rectBlocked(range, sn)) return
    filterPanel.open = false
    const sorted = await sortFilter.sort(colIdx, dir, sn)
    if (sorted) pushEditOp(sn, sorted.before, sorted.after, 'Sort')
    applyHiddenRows()
  }

  return {
    filterPanel,
    showSortFilter,
    filterConfig,
    visibleFilterCols,
    filterPanelStyle,
    filterHighlightStyle,
    detectContiguousBlock,
    openFilterPanel,
    openQuickFilterForActive,
    applyFilter,
    clearFilterCol,
    doSort,
  }
}
