// Chart engine — pure store, no Vue / DOM / ECharts here.
//
// Same shape as `engine/pivot.js`: an in-memory map of chart configs with
// `add/update/remove/list/snapshot/restore` and an `onChange` callback the
// Vue layer subscribes to so reactive computeds re-evaluate when configs
// mutate. The mutation set is what lands in sheets_data, persisted by
// usePersistence alongside formats / merge / pivots / etc.
//
// ChartConfig shape:
//   {
//     id, sourceSheet, sourceRange,    // e.g. "Sheet1", "A1:D20"
//     chartType,                       // 'line' | 'bar' | 'pie' | 'area' | 'scatter'
//     title,
//     hasHeader,                       // first row of source treated as labels
//     encoding: {                      // which column maps to which axis
//       x: number,                     // column index (0-based) into sourceRange
//       y: number[],                   // 1+ series columns
//     },
//     position: { sheet, x, y, width, height },  // px on the canvas overlay
//     options: { stacked, smooth, showLegend, colorScheme }
//   }
//
// Pure store — no rendering, no data fetching, no ECharts.

import { remapRangeString, parseA1Range } from './ref-remap.js'
import { deepClone } from '../utils/deep-clone.js'

export function createChartEngine() {
	let _charts  = {}   // id → ChartConfig
	let _nextId  = 1
	let _onChange = null

	function _newId() { return `chart_${_nextId++}` }
	function _notify() { _onChange?.() }

	function setOnChange(cb) { _onChange = cb }

	function add(config) {
		const id = config.id || _newId()
		_charts[id] = { ...config, id }
		_notify()
		return id
	}

	function update(id, patch) {
		if (!_charts[id]) return
		_charts[id] = { ..._charts[id], ...patch, id }
		_notify()
	}

	function remove(id) {
		if (id in _charts) { delete _charts[id]; _notify() }
	}

	function get(id)  { return _charts[id] }
	function list()   { return Object.values(_charts) }

	function listForSheet(sheetName) {
		return Object.values(_charts).filter(c => c.position?.sheet === sheetName)
	}

	// True when `sheetName` is the source for any chart — drives "should I
	// recompute" decisions when cells change.
	function affectsChart(sheetName) {
		return Object.values(_charts).some(c => c.sourceSheet === sheetName)
	}

	function snapshot() {
		return { charts: deepClone(_charts), nextId: _nextId }
	}

	function restore(data) {
		if (!data) return
		_charts = deepClone(data.charts || {})
		_nextId = data.nextId || 1
		// Defensive: keep nextId ahead of any restored id so future _newId()
		// can't collide with one that's already there.
		for (const id of Object.keys(_charts)) {
			const m = /^chart_(\d+)$/.exec(id)
			if (m) {
				const n = parseInt(m[1], 10)
				if (n >= _nextId) _nextId = n + 1
			}
		}
		_notify()
	}

	// Structural permutation. Remap each chart's source range, and — because the
	// encoding x/y are column indices *into that range* — remap those through the
	// induced local permutation so a reorder inside the range keeps series bound
	// to the same data. Charts whose source column vanished drop that series.
	function _remap(sheet, mapCol, mapRow) {
		const lc = String(sheet || '').toLowerCase()
		let changed = false
		for (const id of Object.keys(_charts)) {
			const ch = _charts[id]
			if (String(ch.sourceSheet || '').toLowerCase() !== lc) continue
			const before = parseA1Range(ch.sourceRange)
			const nextRange = remapRangeString(ch.sourceRange, { opSheet: ch.sourceSheet, mapCol, mapRow })
			ch.sourceRange = nextRange
			changed = true
			if (mapCol && before && nextRange !== '#REF!' && ch.encoding) {
				const after = parseA1Range(nextRange)
				const local = (li) => { const g = mapCol(before.c0 + li); return g == null || g < 0 ? null : g - after.c0 }
				if (typeof ch.encoding.x === 'number') { const nx = local(ch.encoding.x); ch.encoding.x = nx == null ? 0 : nx }
				if (Array.isArray(ch.encoding.y)) ch.encoding.y = ch.encoding.y.map(local).filter(v => v != null && v >= 0)
			}
		}
		if (changed) _notify()
	}
	function remapCols(mapCol, sheet) { _remap(sheet, mapCol, null) }
	function remapRows(mapRow, sheet) { _remap(sheet, null, mapRow) }

	return {
		add, update, remove, get, list, listForSheet, affectsChart,
		remapCols, remapRows,
		snapshot, restore, setOnChange,
	}
}

// ── Helpers shared with view layer ───────────────────────────────────────────

// Default position for a freshly-inserted chart. The overlay offsets
// subsequent inserts so they don't stack perfectly on top of each other.
export const DEFAULT_CHART_SIZE = { width: 480, height: 320 }

// Stable list of supported chart types — keep in sync with what ChartView
// knows how to render.
export const CHART_TYPES = ['line', 'bar', 'pie', 'area', 'scatter']

// Aggregation functions offered in the chart dialog. `none` (the default)
// plots each source row as-is; the rest group rows by the X-axis value and
// summarise each series column — see `_aggregate` in chart-data.js. Values are
// the authoritative keys stored in a chart's `options.aggregate`.
export const CHART_AGGREGATIONS = [
	{ value: 'none',  label: 'None (plot each row)' },
	{ value: 'sum',   label: 'Sum' },
	{ value: 'avg',   label: 'Average' },
	{ value: 'count', label: 'Count' },
	{ value: 'min',   label: 'Min' },
	{ value: 'max',   label: 'Max' },
]

// Espresso-aligned categorical palette. ECharts default greys clash with
// the rest of the UI; this set matches the cyan accent already used in the
// brand mark and the cursor palette.
export const ESPRESSO_PALETTE = [
	'#0E7490', '#A5F0FA', '#0891B2', '#67E8F9',
	'#155E75', '#22D3EE', '#0C4A6E', '#7DD3FC',
]

// Curated categorical palettes offered in the chart dialog. Each is 8 stops so
// it lines up with the default series cap. `colorScheme` in a chart's options,
// when set, overrides the default (read in chart-data.js `_baseOption`); the
// first entry here IS the default palette, so a chart with no colorScheme and
// one explicitly set to Espresso render identically.
export const CHART_PALETTES = [
	{ name: 'Espresso', colors: ESPRESSO_PALETTE },
	{ name: 'Ocean',    colors: ['#1E3A8A', '#3B82F6', '#0891B2', '#60A5FA', '#1E40AF', '#38BDF8', '#1D4ED8', '#93C5FD'] },
	{ name: 'Forest',   colors: ['#166534', '#22C55E', '#65A30D', '#4ADE80', '#15803D', '#84CC16', '#14532D', '#BEF264'] },
	{ name: 'Sunset',   colors: ['#B45309', '#F59E0B', '#DC2626', '#FB923C', '#92400E', '#FBBF24', '#7C2D12', '#FDBA74'] },
	{ name: 'Berry',    colors: ['#9D174D', '#EC4899', '#7C3AED', '#F472B6', '#BE185D', '#A78BFA', '#831843', '#C4B5FD'] },
	{ name: 'Slate',    colors: ['#334155', '#64748B', '#94A3B8', '#475569', '#1E293B', '#CBD5E1', '#0F172A', '#E2E8F0'] },
]
