// Slicers: floating value-filter controls. Extracted from
// SheetEditor/index.vue. One slicer renders as SlicerPanel.vue.
//
// Usage:
//   const { slicerVersion, activeSlicers, insertSlicer, ... } = useSlicers({
//     sortFilter, slicers, currentSheet, activeCell, contextMenu, history,
//     getGrid, detectContiguousBlock, repopulateGrid, applyHiddenRows, markDirty })
//
// A slicer is a floating value-filter control bound to a column of the filter
// range. It reads/writes that column's `inSet` spec in sortFilter; the slicers
// engine only tracks the column + float position. `slicerVersion` is bumped on
// every slicer/filter change so the panels re-derive their checklists (the
// editor bumps it too, after an edit or a filter repaint).

import { computed, ref } from 'vue'

import { colLabel, parseCellId } from '../../utils/cells.js'

export function useSlicers({
  sortFilter,
  slicers,
  currentSheet,
  activeCell,
  contextMenu,
  history,
  getGrid,
  detectContiguousBlock,
  repopulateGrid,
  applyHiddenRows,
  markDirty,
}) {
  const slicerVersion = ref(0)
  let _slicerDrag = null

  // One reactive snapshot per slicer: the column picker's options, the value list
  // with PLAIN boolean checked flags, and whether a filter is active — all derived
  // together on each slicerVersion bump. The template binds to these plain values
  // (not to function calls over the non-reactive sortFilter engine), so the panel
  // can never drift out of sync with the applied filter.
  const activeSlicers = computed(() => {
    void slicerVersion.value
    const sn = currentSheet.value
    const range = sortFilter.getRange(sn)
    const options = range ? _slicerColumnOptions(range, sn) : []
    return slicers.list(sn).map((sl) => {
      const values = sortFilter.getColumnValues(sl.col, sn)
      const spec = sortFilter.getFilterConfig(sn)[sl.col]
      const set = spec?.operator === 'inSet' ? new Set(spec.values) : null // null → unfiltered
      return {
        id: sl.id,
        col: sl.col,
        x: sl.x,
        y: sl.y,
        label: slicerLabel(sl, sn),
        options,
        rows: values.map((v) => ({
          v,
          checked: !set || set.has(v),
        })),
      }
    })
  })

  // Every column of the filter range, as { label: header, value: colIdx } — the
  // raw list the header dropdown is built from.
  function _slicerColumnOptions(range, sn) {
    const opts = []
    for (let c = range.c0; c <= range.c1; c++) {
      const header = sortFilter.getHeader(c, sn)
      opts.push({
        label: header || colLabel(c),
        value: c,
      })
    }
    return opts
  }
  function slicerValues(sl) {
    return sortFilter.getColumnValues(sl.col, currentSheet.value)
  }
  function slicerLabel(sl, sn = currentSheet.value) {
    const range = sortFilter.getRange(sn)
    const header = range ? sortFilter.getHeader(sl.col, sn) : ''
    return header || colLabel(sl.col)
  }
  // The set of values currently kept visible, or null when the column is unfiltered.
  function _slicerCheckedSet(sl) {
    const spec = sortFilter.getFilterConfig(currentSheet.value)[sl.col]
    return spec?.operator === 'inSet' ? new Set(spec.values) : null
  }
  function toggleSlicerValue(sl, v) {
    const all = slicerValues(sl)
    const set = _slicerCheckedSet(sl) || new Set(all)
    if (set.has(v)) set.delete(v)
    else set.add(v)
    _applySlicerFilter(sl, set, all)
  }
  // "Select all" always shows everything — it clears the column's filter outright
  // rather than toggling, so it can never surprise-hide the data.
  function selectAllSlicer(sl) {
    const sn = currentSheet.value
    sortFilter.clearFilter(sl.col, sn)
    repopulateGrid()
    applyHiddenRows()
    history.push()
    markDirty()
  }
  // "Clear" empties the selection (an inSet with no values) so the user can then
  // pick just the values they want — the Google-Sheets filter idiom.
  function clearSlicerValues(sl) {
    const sn = currentSheet.value
    sortFilter.setFilter(
      sl.col,
      {
        operator: 'inSet',
        values: [],
      },
      sn,
    )
    repopulateGrid()
    applyHiddenRows()
    history.push()
    markDirty()
  }
  // Re-point a slicer at a different column of the filter range; the old column's
  // filter is released so it stops hiding rows with no visible control.
  function changeSlicerColumn(sl, value) {
    const sn = currentSheet.value
    const newCol = Number(value)
    if (Number.isNaN(newCol) || newCol === sl.col) return
    // Bail before touching anything if another slicer already owns the target —
    // otherwise we'd clear this column's filter for a move that can't happen.
    if (slicers.list(sn).some((s) => s.col === newCol && s.id !== sl.id)) return
    sortFilter.clearFilter(sl.col, sn)
    slicers.setCol(sl.id, newCol, sn)
    repopulateGrid()
    applyHiddenRows()
    history.push()
    markDirty()
  }
  function _applySlicerFilter(sl, set, all) {
    const sn = currentSheet.value
    // All-checked is identical to no filter — clear the column instead of storing
    // every value (mirrors applyFilter).
    if (set.size === all.length) sortFilter.clearFilter(sl.col, sn)
    else
      sortFilter.setFilter(
        sl.col,
        {
          operator: 'inSet',
          values: [...set],
        },
        sn,
      )
    repopulateGrid()
    applyHiddenRows()
    history.push()
    markDirty()
    slicerVersion.value++
  }
  async function insertSlicer() {
    contextMenu.open = false
    const sn = currentSheet.value
    const p = parseCellId(activeCell.value)
    const col = p ? p.col : 0
    if (slicers.list(sn).some((s) => s.col === col)) return // column already has a slicer
    // A slicer reads distinct values from the filter range — auto-create one over
    // the surrounding data block if the sheet isn't filtered yet.
    if (!sortFilter.getRange(sn)) {
      const block = await detectContiguousBlock(p?.row ?? 0, col)
      if (!block) return // no data to slice
      sortFilter.setRange(block, sn)
    }
    // A slicer filters one column OF the filter range. A column outside it has no
    // values to show and can't appear in the column picker — refuse rather than
    // strand a dead slicer. (Auto-created ranges are centred on col, so they pass.)
    const range = sortFilter.getRange(sn)
    if (!range || col < range.c0 || col > range.c1) return
    slicers.add(col, 96 + slicers.list(sn).length * 28, 96, sn)
    applyHiddenRows() // paints the filter's chevrons/outline (and bumps slicerVersion)
    getGrid()?.render?.()
    history.push()
    markDirty()
  }
  function removeSlicer(sl) {
    const sn = currentSheet.value
    slicers.remove(sl.id, sn)
    // The slicer IS the filter control for its column — clear the filter it
    // applied so removing it doesn't strand hidden rows with no visible control.
    sortFilter.clearFilter(sl.col, sn)
    repopulateGrid()
    applyHiddenRows() // un-hides the rows + bumps slicerVersion
    history.push()
    markDirty()
  }
  function startSlicerDrag(sl, e) {
    _slicerDrag = {
      id: sl.id,
      sx: e.clientX,
      sy: e.clientY,
      ox: sl.x,
      oy: sl.y,
    }
    window.addEventListener('mousemove', _onSlicerDrag)
    window.addEventListener('mouseup', _endSlicerDrag)
  }
  function _onSlicerDrag(e) {
    if (!_slicerDrag) return
    const { id, sx, sy, ox, oy } = _slicerDrag
    slicers.move(
      id,
      Math.max(0, ox + e.clientX - sx),
      Math.max(0, oy + e.clientY - sy),
      currentSheet.value,
    )
    slicerVersion.value++
  }
  function _endSlicerDrag() {
    if (_slicerDrag) {
      history.push()
      markDirty()
    }
    _slicerDrag = null
    window.removeEventListener('mousemove', _onSlicerDrag)
    window.removeEventListener('mouseup', _endSlicerDrag)
  }

  return {
    slicerVersion,
    activeSlicers,
    insertSlicer,
    removeSlicer,
    toggleSlicerValue,
    selectAllSlicer,
    clearSlicerValues,
    changeSlicerColumn,
    startSlicerDrag,
  }
}
