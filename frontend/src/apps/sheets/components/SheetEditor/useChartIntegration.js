import { computed, ref, watch } from 'vue'

import { COL_HEADER_H, DEFAULT_COL_W, DEFAULT_ROW_H, ROW_HEADER_W } from '../../canvas/constants'
import { DEFAULT_CHART_SIZE } from '../../engine/charts.js'
import { parseCellId } from '../../utils/cells.js'

/**
 * Wires the chart engine to the SheetEditor surface. Mirrors the
 * `usePivotIntegration` pattern: a reactive version counter bumped on
 * every chart mutation (via `chart.setOnChange`) drives reactivity,
 * and a small action API (`openInsert`, `onChartConfirm`, `onChartDelete`,
 * `onChartMove`, `onChartResize`, `onChartRefresh`) is returned for
 * index.vue to wire into the toolbar / overlay / dialog.
 *
 * @param {{
 *   chart:          object,                       // createChartEngine()
 *   readRange:      (sheetName: string, rect: object) => Promise<string[][]>,
 *   currentSheet:   import('vue').Ref<string>,
 *   contextMenu:    { open: boolean },
 *   history:        { push: () => void },
 *   isDirty:        import('vue').Ref<boolean>,
 *   getGrid:        () => object,
 * }} opts
 */
export function useChartIntegration({
  chart,
  readRange,
  currentSheet,
  contextMenu,
  history,
  isDirty,
  getGrid,
}) {
  const chartDialogOpen = ref(false)
  const chartInitialRange = ref('')
  const chartEditId = ref('')
  const chartEditConfig = ref(null)
  const chartVersion = ref(0)
  // Bumped when the source data should be re-pulled: on refresh AND on any
  // sheet cell change (index.vue's onCellChanged/onCellsChanged) — but NOT on
  // move/resize/scroll. The overlay keys its matrix cache on this so dragging a
  // chart over a 100k-row source doesn't re-materialise the matrix every frame,
  // while edits to the source range still refresh the chart.
  const chartDataVersion = ref(0)
  // What the overlay keys its matrix cache on: bumps on a data change and
  // again when a background read lands, so the chart repaints with it.
  const matrixVersion = ref(0)
  watch(chartDataVersion, () => matrixVersion.value++)
  const selectedChartId = ref('')

  // One source of reactive truth — bumped on every engine mutation so
  // any computed that walks `chart.list()` re-runs.
  chart.setOnChange?.(() => {
    chartVersion.value++
  })

  // Reactive list, automatically filtered by current sub-sheet inside
  // the overlay. We expose the full list because tests + future "show all
  // charts" surfaces may want sheet-agnostic access.
  const charts = computed(() => {
    void chartVersion.value
    return chart.list()
  })

  // ── Insert flow ────────────────────────────────────────────────────────
  function openInsert() {
    contextMenu.open = false
    const grid = getGrid()
    const sel = grid?.getSelection()
    // If the user has a multi-cell selection, prefill the dialog with it.
    if (sel && (sel.r0 !== sel.r1 || sel.c0 !== sel.c1)) {
      const start = _cellId(sel.r0, sel.c0)
      const end = _cellId(sel.r1, sel.c1)
      chartInitialRange.value = `${start}:${end}`
    } else {
      chartInitialRange.value = ''
    }
    chartEditId.value = ''
    chartEditConfig.value = null
    chartDialogOpen.value = true
  }

  // ── Edit flow ──────────────────────────────────────────────────────────
  function openEdit(id) {
    const cfg = chart.get(id)
    if (!cfg) return
    chartEditId.value = id
    chartEditConfig.value = { ...cfg }
    chartInitialRange.value = cfg.sourceRange || ''
    // Drop the canvas-side selection so the chart's cyan ring + floating
    // action toolbar don't render on top of the dialog. The overlay also
    // hides itself wholesale while `chartDialogOpen` is true (see
    // ChartOverlay), but clearing this is cheap defence-in-depth.
    selectedChartId.value = ''
    chartDialogOpen.value = true
  }

  // ── Confirm (create or update) ─────────────────────────────────────────
  function onChartConfirm(config) {
    if (config.id) {
      chart.update(config.id, config)
    } else {
      // Stagger inserts so they don't perfectly stack.
      const existing = chart.list().length
      const offset = (existing % 6) * 24
      const { x, y } = _defaultPosition(config, offset)
      chart.add({
        ...config,
        position: {
          sheet: currentSheet.value,
          x,
          y,
          width: DEFAULT_CHART_SIZE.width,
          height: DEFAULT_CHART_SIZE.height,
        },
      })
    }
    history.push()
    isDirty.value = true
  }

  // Default chart placement. When the source range is on the sheet the
  // chart goes on, put the chart beside it, level with its first row, as
  // Google does; below it when there is no room to the right. It covered
  // the data and the column headers before (ISSUES #65: the row was read
  // as `.r` of a `{row, col}`, so y was NaN and painted at 0). Otherwise
  // keep the top-left stagger.
  function _defaultPosition(config, offset) {
    const fallback = { x: 40 + offset, y: COL_HEADER_H + 16 + offset }
    const sourceSheet = config.sourceSheet || currentSheet.value
    if (sourceSheet !== currentSheet.value || !config.sourceRange) return fallback
    const [start, end = start] = String(config.sourceRange).split(':')
    const a = parseCellId(start.trim().replace(/\$/g, ''))
    const b = parseCellId(end.trim().replace(/\$/g, ''))
    if (!a || !b) return fallback
    const r0 = Math.min(a.row, b.row),
      r1 = Math.max(a.row, b.row)
    const c0 = Math.min(a.col, b.col),
      c1 = Math.max(a.col, b.col)
    // Where the cells are on screen now (widths, heights, scroll, zoom);
    // the default sizes when the grid isn't there to ask.
    const grid = getGrid?.()
    const rect = (r, c) =>
      grid?.getCellRect?.(r, c) ?? {
        x: ROW_HEADER_W + c * DEFAULT_COL_W,
        y: COL_HEADER_H + r * DEFAULT_ROW_H,
        width: DEFAULT_COL_W,
        height: DEFAULT_ROW_H,
      }
    const viewW = grid?.getViewportSize?.()?.w ?? Infinity
    const topRight = rect(r0, c1)
    const right = topRight.x + topRight.width + 16
    if (right + DEFAULT_CHART_SIZE.width <= viewW)
      return { x: right + offset, y: Math.max(COL_HEADER_H, topRight.y) + offset }
    const bottomLeft = rect(r1, c0)
    return {
      x: Math.max(ROW_HEADER_W, bottomLeft.x) + offset,
      y: Math.max(COL_HEADER_H, bottomLeft.y + bottomLeft.height + 16) + offset,
    }
  }

  function onChartDelete(id) {
    if (!id) return
    if (selectedChartId.value === id) selectedChartId.value = ''
    chart.remove(id)
    history.push()
    isDirty.value = true
  }

  function onChartMove(id, { x, y }) {
    const cur = chart.get(id)
    if (!cur) return
    chart.update(id, { position: { ...cur.position, x, y } })
    isDirty.value = true
  }

  function onChartResize(id, { width, height }) {
    const cur = chart.get(id)
    if (!cur) return
    chart.update(id, { position: { ...cur.position, width, height } })
    isDirty.value = true
  }

  // Refresh isn't strictly needed (charts re-derive reactively from the
  // sheet engine) but the explicit "refresh" button is reassuring.
  function onChartRefresh(id) {
    // Invalidate the overlay's matrix cache so it re-pulls fresh source data.
    chartDataVersion.value++
  }

  function selectChart(id) {
    selectedChartId.value = id
  }

  // ── Adapter used by the overlay to pull the source matrix ─────────────-
  // Cells are read from the worker in the background, so this returns the
  // last matrix read for the source (empty at first) and starts a read when
  // the data changed since. When it lands, matrixVersion repaints the chart.
  const _matrices = new Map() // 'sheet\0range' → { version, matrix, reading }
  function getMatrix(sheetName, range) {
    if (!sheetName || !range) return []
    const key = `${sheetName}\0${range}`
    const hit = _matrices.get(key)
    const version = chartDataVersion.value
    if (hit && (hit.version === version || hit.reading)) return hit.matrix
    const [start, end] = range.includes(':') ? range.split(':') : [range, range]
    const a = parseCellId(start),
      b = parseCellId(end)
    if (!a || !b) return []
    const entry = { version, matrix: hit?.matrix ?? [], reading: true }
    _matrices.set(key, entry)
    const rect = {
      r0: Math.min(a.row, b.row),
      c0: Math.min(a.col, b.col),
      r1: Math.max(a.row, b.row),
      c1: Math.max(a.col, b.col),
    }
    readRange(sheetName, rect)
      .then((matrix) => {
        entry.matrix = matrix
        matrixVersion.value++
      })
      .catch((e) => console.error('[sheets] chart data read failed', e))
      .finally(() => {
        entry.reading = false
      })
    return entry.matrix
  }

  return {
    chartDialogOpen,
    chartInitialRange,
    chartEditId,
    chartEditConfig,
    charts,
    selectedChartId,
    chartVersion,
    chartDataVersion,
    matrixVersion,
    openInsert,
    openEdit,
    onChartConfirm,
    onChartDelete,
    onChartMove,
    onChartResize,
    onChartRefresh,
    selectChart,
    getMatrix,
  }
}

function _cellId(row, col) {
  let n = col + 1,
    s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s + (row + 1)
}
