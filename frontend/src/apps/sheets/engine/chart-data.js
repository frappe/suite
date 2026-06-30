// Convert a sheet range + chart config into the ECharts `option` object.
//
// This is the pure adapter between our data model and ECharts. It takes:
//   * the chart config (chartType, encoding, options, title, hasHeader)
//   * the source matrix (a 2D array from sheet.getRangeValues)
//
// and returns a fully-populated ECharts option suitable for `<v-chart :option="…" />`.
// No Vue, no DOM, no sheet engine — easy to unit-test.

import { ESPRESSO_PALETTE } from './charts.js'

const ESPRESSO_FONT = 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'

/**
 * Build the ECharts option object.
 * @param {object} config  — ChartConfig from createChartEngine
 * @param {Array[]} matrix — 2D source values from getRangeValues
 * @returns ECharts option object
 */
export function buildOption(config, matrix) {
	if (!matrix?.length) return _emptyOption(config)
	const { headerRow, dataRows } = _splitHeader(matrix, config.hasHeader !== false)
	const encoding = _normaliseEncoding(config.encoding, matrix[0]?.length || 0)

	switch (config.chartType) {
		case 'pie':     return _pieOption(config, headerRow, dataRows, encoding)
		case 'bar':     return _cartesianOption(config, headerRow, dataRows, encoding, 'bar')
		case 'line':    return _cartesianOption(config, headerRow, dataRows, encoding, 'line')
		case 'area':    return _cartesianOption(config, headerRow, dataRows, encoding, 'area')
		case 'scatter': return _cartesianOption(config, headerRow, dataRows, encoding, 'scatter')
		default:        return _cartesianOption(config, headerRow, dataRows, encoding, 'bar')
	}
}

// ── Cartesian (line / bar / area / scatter) ──────────────────────────────────

function _cartesianOption(config, headerRow, dataRows, encoding, kind) {
	const xs       = dataRows.map(r => r[encoding.x])
	const seriesIx = encoding.y
	const stacked  = !!config.options?.stacked
	// Stacked bars/areas need the label *inside* the segment — `top` would
	// stack labels in mid-air above the top of the stack instead of on each
	// segment. For scatter we float above the dot; everything else sits on top.
	const labelPos = stacked ? 'inside' : (kind === 'scatter' ? 'top' : 'top')
	const showLabels = !!config.options?.dataLabels
	// Disambiguate name collisions — two columns headered "Sales" need to render
	// as distinct series ("Sales", "Sales (2)") or ECharts may merge them when
	// stacked, leaving one bar where the user expects two segments.
	const rawNames = seriesIx.map((colIdx, i) => headerRow?.[colIdx] || `Series ${i + 1}`)
	const nameCounts = new Map()
	const uniqueNames = rawNames.map((n) => {
		const seen = nameCounts.get(n) || 0
		nameCounts.set(n, seen + 1)
		return seen === 0 ? n : `${n} (${seen + 1})`
	})
	const isLineish = kind === 'line' || kind === 'area'
	const series   = seriesIx.map((colIdx, i) => ({
		name:      uniqueNames[i],
		type:      isLineish ? 'line' : kind,
		stack:     stacked ? 'total' : undefined,
		smooth:    !!config.options?.smooth,
		// Big-data rendering: LTTB downsamples line/area to roughly the pixel
		// width (visually identical, but plotting 113k points instead of ~1k
		// was the chart's main render cost); large-mode batches bar/scatter.
		// Both only engage past their thresholds, so small charts are unaffected.
		sampling:       isLineish ? 'lttb' : undefined,
		large:          (kind === 'scatter' || kind === 'bar') || undefined,
		largeThreshold: 2000,
		// Line/area normally hide point symbols for a cleaner look — but
		// ECharts anchors per-point labels on the symbol, so symbol:'none'
		// silently kills labels too. When labels are on, draw a small dot at
		// each point so the label has something to attach to (and the dot
		// itself doubles as a value-position marker).
		symbol:    kind === 'scatter' ? 'circle'
			: (isLineish && showLabels ? 'circle' : 'none'),
		symbolSize: kind === 'scatter' ? 8 : (isLineish && showLabels ? 5 : 4),
		areaStyle: kind === 'area' ? { opacity: 0.25 } : undefined,
		label: showLabels ? {
			show: true,
			position: labelPos,
			fontFamily: ESPRESSO_FONT,
			fontSize: 10,
			color: stacked ? '#ffffff' : '#525252',
		} : { show: false },
		data:      dataRows.map(r => _toNum(r[colIdx])),
	}))

	const showGrid = config.options?.gridLines !== false

	return {
		..._baseOption(config),
		tooltip: { trigger: 'axis', confine: true },
		grid:    { top: 56, left: 56, right: 24, bottom: 40, containLabel: true },
		xAxis: {
			type:        kind === 'scatter' ? 'value' : 'category',
			data:        kind === 'scatter' ? undefined : xs.map(_toLabel),
			axisLine:    { lineStyle: { color: '#d4d4d4' } },
			axisLabel:   { color: '#525252', fontFamily: ESPRESSO_FONT, fontSize: 11 },
			splitLine:   { show: false },
		},
		yAxis: {
			type:      'value',
			axisLine:  { lineStyle: { color: '#d4d4d4' } },
			axisLabel: { color: '#525252', fontFamily: ESPRESSO_FONT, fontSize: 11 },
			splitLine: { show: showGrid, lineStyle: { color: '#f0f0f0' } },
		},
		series,
	}
}

// ── Pie ──────────────────────────────────────────────────────────────────────

function _pieOption(config, headerRow, dataRows, encoding) {
	const labelCol = encoding.x
	const valueCol = encoding.y[0]   // pies always use just the first y series
	const data = dataRows.map(r => ({
		name:  _toLabel(r[labelCol]),
		value: _toNum(r[valueCol]),
	})).filter(d => d.value !== 0)

	return {
		..._baseOption(config),
		tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
		series: [{
			name: headerRow?.[valueCol] || 'Value',
			type: 'pie',
			radius: ['40%', '70%'],   // donut chart — easier to label, identical math
			avoidLabelOverlap: true,
			itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
			label: {
				show: config.options?.dataLabels !== false,
				fontFamily: ESPRESSO_FONT,
				fontSize: 11,
				color: '#171717',
			},
			data,
		}],
	}
}

// ── Shared ──────────────────────────────────────────────────────────────────

function _baseOption(config) {
	const title = config.title?.trim()
	return {
		color: config.options?.colorScheme || ESPRESSO_PALETTE,
		backgroundColor: 'transparent',
		title: title ? {
			text: title,
			left: 12, top: 8,
			textStyle: { color: '#171717', fontFamily: ESPRESSO_FONT, fontSize: 14, fontWeight: 600 },
		} : undefined,
		legend: config.options?.showLegend === false
			? { show: false }
			: {
				bottom: 4,
				type: 'scroll',
				textStyle: { color: '#525252', fontFamily: ESPRESSO_FONT, fontSize: 11 },
			},
		animation: true,
	}
}

function _splitHeader(matrix, hasHeader) {
	if (hasHeader && matrix.length > 1) {
		return { headerRow: matrix[0], dataRows: matrix.slice(1) }
	}
	return { headerRow: null, dataRows: matrix }
}

// Coerce a possibly-missing encoding into a usable one.
// Defaults: x = column 0, y = all remaining columns.
function _normaliseEncoding(enc, ncols) {
	const x = (enc && Number.isInteger(enc.x)) ? enc.x : 0
	let y = enc?.y
	if (!Array.isArray(y) || !y.length) {
		y = []
		for (let i = 0; i < ncols; i++) if (i !== x) y.push(i)
	}
	return { x, y }
}

function _toNum(v) {
	if (v === '' || v == null) return 0
	const n = Number(v)
	return isNaN(n) ? 0 : n
}

function _toLabel(v) {
	if (v == null) return ''
	return typeof v === 'string' ? v : String(v)
}

function _emptyOption(config) {
	return {
		..._baseOption(config),
		title: { text: 'No data', left: 'center', top: 'middle',
				 textStyle: { color: '#a3a3a3', fontFamily: ESPRESSO_FONT, fontSize: 12 } },
	}
}
