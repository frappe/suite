import { computed, ref } from 'vue'
import { DEFAULT_CHART_SIZE } from '../../engine/charts.js'
import { COL_HEADER_H, DEFAULT_ROW_H } from '../../canvas/constants.js'
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
 *   sheet:          object,                       // sheet engine
 *   currentSheet:   import('vue').Ref<string>,
 *   contextMenu:    { open: boolean },
 *   history:        { push: () => void },
 *   isDirty:        import('vue').Ref<boolean>,
 *   getGrid:        () => object,
 * }} opts
 */
export function useChartIntegration({
	chart,
	sheet,
	currentSheet,
	contextMenu,
	history,
	isDirty,
	getGrid,
}) {
	const chartDialogOpen   = ref(false)
	const chartInitialRange = ref('')
	const chartEditId       = ref('')
	const chartEditConfig   = ref(null)
	const chartVersion      = ref(0)
	// Bumped when the source data should be re-pulled: on refresh AND on any
	// sheet cell change (index.vue's onCellChanged/onCellsChanged) — but NOT on
	// move/resize/scroll. The overlay keys its matrix cache on this so dragging a
	// chart over a 100k-row source doesn't re-materialise the matrix every frame,
	// while edits to the source range still refresh the chart.
	const chartDataVersion  = ref(0)
	const selectedChartId   = ref('')

	// One source of reactive truth — bumped on every engine mutation so
	// any computed that walks `chart.list()` re-runs.
	chart.setOnChange?.(() => { chartVersion.value++ })

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
		const sel  = grid?.getSelection()
		// If the user has a multi-cell selection, prefill the dialog with it.
		if (sel && (sel.r0 !== sel.r1 || sel.c0 !== sel.c1)) {
			const start = _cellId(sel.r0, sel.c0)
			const end   = _cellId(sel.r1, sel.c1)
			chartInitialRange.value = `${start}:${end}`
		} else {
			chartInitialRange.value = ''
		}
		chartEditId.value     = ''
		chartEditConfig.value = null
		chartDialogOpen.value = true
	}

	// ── Edit flow ──────────────────────────────────────────────────────────
	function openEdit(id) {
		const cfg = chart.get(id)
		if (!cfg) return
		chartEditId.value       = id
		chartEditConfig.value   = { ...cfg }
		chartInitialRange.value = cfg.sourceRange || ''
		// Drop the canvas-side selection so the chart's cyan ring + floating
		// action toolbar don't render on top of the dialog. The overlay also
		// hides itself wholesale while `chartDialogOpen` is true (see
		// ChartOverlay), but clearing this is cheap defence-in-depth.
		selectedChartId.value   = ''
		chartDialogOpen.value   = true
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
					sheet:  currentSheet.value,
					x, y,
					width:  DEFAULT_CHART_SIZE.width,
					height: DEFAULT_CHART_SIZE.height,
				},
			})
		}
		history.push()
		isDirty.value = true
	}

	// Default chart placement. When the source range lives on the SAME sheet
	// the chart is being inserted into (the common pivot-output case), drop
	// the chart below the source's last row so it doesn't cover the data
	// that fed it. Otherwise keep the legacy top-left stagger.
	function _defaultPosition(config, offset) {
		let x = 40 + offset
		let y = 40 + offset
		const sourceSheet = config.sourceSheet || currentSheet.value
		if (sourceSheet === currentSheet.value && config.sourceRange) {
			const endRef = String(config.sourceRange).split(':').pop().trim()
			const parsed = parseCellId(endRef)
			if (parsed) {
				// rows are 0-indexed; +1 to reach BOTTOM of that row, *DEFAULT_ROW_H
				// is a heuristic (custom row heights aren't read here — that would
				// require canvas geometry access) and good enough for a default.
				y = COL_HEADER_H + (parsed.r + 1) * DEFAULT_ROW_H + 16 + offset
			}
		}
		return { x, y }
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

	function selectChart(id) { selectedChartId.value = id }

	// ── Adapter used by the overlay to pull the source matrix ─────────────-
	function getMatrix(sheetName, range) {
		if (!sheetName || !range) return []
		const [start, end] = range.includes(':') ? range.split(':') : [range, range]
		return sheet.getRangeValues(start, end, sheetName)
	}

	return {
		chartDialogOpen, chartInitialRange, chartEditId, chartEditConfig,
		charts, selectedChartId, chartVersion, chartDataVersion,
		openInsert, openEdit,
		onChartConfirm, onChartDelete, onChartMove, onChartResize, onChartRefresh,
		selectChart, getMatrix,
	}
}

function _cellId(row, col) {
	let n = col + 1, s = ''
	while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
	return s + (row + 1)
}
