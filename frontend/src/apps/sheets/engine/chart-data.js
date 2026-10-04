// Convert a sheet range + chart config into the ECharts `option` object.
//
// This is the pure adapter between our data model and ECharts. It takes:
//   * the chart config (chartType, encoding, options, title, hasHeader)
//   * the source matrix (a 2D array from sheet.getRangeValues)
//   * optional boolean `isDark` indicating whether dark mode is active
//
// and returns a fully-populated ECharts option suitable for `<v-chart :option="…" />`.
// No Vue, no DOM, no sheet engine — easy to unit-test.

import { ESPRESSO_PALETTE } from './charts.js'

const ESPRESSO_FONT = 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif'

/**
 * Build the ECharts option object.
 * @param {object} config  — ChartConfig from createChartEngine
 * @param {Array[]} matrix — 2D source values from getRangeValues
 * @param {boolean} [isDark=false] — whether dark mode is active
 * @returns ECharts option object
 */
export function buildOption(config, matrix, isDark = false) {
  if (!matrix?.length) return _emptyOption(config, isDark)
  const { headerRow, dataRows } = _splitHeader(matrix, config.hasHeader !== false)
  const encoding = _normaliseEncoding(config.encoding, matrix[0]?.length || 0)
  // Group-and-aggregate by the X column when the user asks for it. With
  // aggregation off this is a no-op and each row plots as-is (the original
  // behaviour); with it on, rows sharing an X value collapse into one, which
  // is what turns raw transactional data into a chart worth looking at.
  const rows = _aggregate(dataRows, encoding, config.options?.aggregate)

  switch (config.chartType) {
    case 'pie':
      return _pieOption(config, headerRow, rows, encoding, isDark)
    case 'bar':
      return _cartesianOption(config, headerRow, rows, encoding, 'bar', isDark)
    case 'line':
      return _cartesianOption(config, headerRow, rows, encoding, 'line', isDark)
    case 'area':
      return _cartesianOption(config, headerRow, rows, encoding, 'area', isDark)
    case 'scatter':
      return _cartesianOption(config, headerRow, rows, encoding, 'scatter', isDark)
    default:
      return _cartesianOption(config, headerRow, rows, encoding, 'bar', isDark)
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

// Collapse rows sharing the same X value into one, applying `aggFn` to each
// series column. Returns synthetic rows keyed only at the X and Y indices the
// encoding uses — enough for the option builders, which read nothing else.
// Group order follows first appearance so the axis stays in data order.
function _aggregate(dataRows, encoding, aggFn) {
  if (!aggFn || aggFn === 'none') return dataRows
  const groups = new Map() // label → { keyVal, rows: [] }
  for (const r of dataRows) {
    const keyVal = r[encoding.x]
    const key = _toLabel(keyVal)
    let g = groups.get(key)
    if (!g) {
      g = { keyVal, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(r)
  }
  const width = Math.max(encoding.x, ...encoding.y, 0) + 1
  const out = []
  for (const g of groups.values()) {
    const row = new Array(width).fill('')
    row[encoding.x] = g.keyVal
    for (const col of encoding.y) row[col] = _applyAgg(aggFn, g.rows, col)
    out.push(row)
  }
  return out
}

// Apply one aggregation function over a group's values in column `col`.
// `count` counts non-empty cells; the numeric functions ignore non-numeric
// cells and fall back to 0 for an all-empty group.
function _applyAgg(fn, rows, col) {
  const nums = []
  let nonEmpty = 0
  for (const r of rows) {
    const v = r[col]
    if (v === '' || v == null) continue
    nonEmpty++
    const n = Number(v)
    if (!isNaN(n)) nums.push(n)
  }
  switch (fn) {
    case 'count':
      return nonEmpty
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
    case 'min':
      return nums.length ? nums.reduce((a, b) => (b < a ? b : a)) : 0
    case 'max':
      return nums.length ? nums.reduce((a, b) => (b > a ? b : a)) : 0
    case 'sum':
    default:
      return nums.reduce((a, b) => a + b, 0)
  }
}

// ── Cartesian (line / bar / area / scatter) ──────────────────────────────────

function _cartesianOption(config, headerRow, dataRows, encoding, kind, isDark) {
  const xs = dataRows.map((r) => r[encoding.x])
  const seriesIx = encoding.y
  const stacked = !!config.options?.stacked
  // Stacked bars/areas need the label *inside* the segment — `top` would
  // stack labels in mid-air above the top of the stack instead of on each
  // segment. For scatter we float above the dot; everything else sits on top.
  const labelPos = stacked ? 'inside' : kind === 'scatter' ? 'top' : 'top'
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

  const labelColor = stacked ? '#ffffff' : isDark ? '#f5f5f5' : '#171717'
  const labelBorderColor = stacked
    ? 'rgba(0, 0, 0, 0.6)'
    : isDark
      ? 'rgba(0, 0, 0, 0.8)'
      : 'rgba(255, 255, 255, 0.8)'

  const series = seriesIx.map((colIdx, i) => ({
    name: uniqueNames[i],
    type: isLineish ? 'line' : kind,
    stack: stacked ? 'total' : undefined,
    smooth: !!config.options?.smooth,
    // Big-data rendering: LTTB downsamples line/area to roughly the pixel
    // width (visually identical, but plotting 113k points instead of ~1k
    // was the chart's main render cost); large-mode batches bar/scatter.
    // Both only engage past their thresholds, so small charts are unaffected.
    sampling: isLineish ? 'lttb' : undefined,
    large: kind === 'scatter' || kind === 'bar' || undefined,
    largeThreshold: 2000,
    // Line/area normally hide point symbols for a cleaner look — but
    // ECharts anchors per-point labels on the symbol, so symbol:'none'
    // silently kills labels too. When labels are on, draw a small dot at
    // each point so the label has something to attach to (and the dot
    // itself doubles as a value-position marker).
    symbol: kind === 'scatter' ? 'circle' : isLineish && showLabels ? 'circle' : 'none',
    symbolSize: kind === 'scatter' ? 8 : isLineish && showLabels ? 5 : 4,
    areaStyle: kind === 'area' ? { opacity: 0.25 } : undefined,
    label: showLabels
      ? {
          show: true,
          position: labelPos,
          fontFamily: ESPRESSO_FONT,
          fontSize: 10,
          color: labelColor,
          textBorderColor: labelBorderColor,
          textBorderWidth: 2,
        }
      : { show: false },
    data: dataRows.map((r) => _toNum(r[colIdx])),
  }))

  const showGrid = config.options?.gridLines !== false
  const axisLineColor = isDark ? '#404040' : '#d4d4d4'
  const axisLabelColor = isDark ? '#e5e5e5' : '#525252'
  const splitLineColor = isDark ? '#262626' : '#f0f0f0'
  const tooltipBg = isDark ? '#262626' : '#ffffff'
  const tooltipBorder = isDark ? '#404040' : '#e5e5e5'
  const tooltipText = isDark ? '#f5f5f5' : '#171717'

  return {
    ..._baseOption(config, isDark),
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontFamily: ESPRESSO_FONT, fontSize: 12 },
    },
    grid: { top: 56, left: 56, right: 24, bottom: 40, containLabel: true },
    xAxis: {
      type: kind === 'scatter' ? 'value' : 'category',
      data: kind === 'scatter' ? undefined : xs.map(_toLabel),
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, fontFamily: ESPRESSO_FONT, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, fontFamily: ESPRESSO_FONT, fontSize: 11 },
      splitLine: { show: showGrid, lineStyle: { color: splitLineColor } },
    },
    series,
  }
}

// ── Pie ──────────────────────────────────────────────────────────────────────

function _pieOption(config, headerRow, dataRows, encoding, isDark) {
  const labelCol = encoding.x
  const valueCol = encoding.y[0] // pies always use just the first y series
  const data = dataRows
    .map((r) => ({
      name: _toLabel(r[labelCol]),
      value: _toNum(r[valueCol]),
    }))
    .filter((d) => d.value !== 0)

  const pieLabelColor = isDark ? '#f5f5f5' : '#171717'
  const pieBorderColor = isDark ? '#171717' : '#ffffff'
  const labelBorderColor = isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)'
  const labelLineColor = isDark ? '#a3a3a3' : '#a3a3a3'
  const tooltipBg = isDark ? '#262626' : '#ffffff'
  const tooltipBorder = isDark ? '#404040' : '#e5e5e5'
  const tooltipText = isDark ? '#f5f5f5' : '#171717'

  return {
    ..._baseOption(config, isDark),
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: '{b}: {c} ({d}%)',
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontFamily: ESPRESSO_FONT, fontSize: 12 },
    },
    series: [
      {
        name: headerRow?.[valueCol] || 'Value',
        type: 'pie',
        radius: ['40%', '70%'], // donut chart — easier to label, identical math
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: pieBorderColor, borderWidth: 2 },
        labelLine: {
          lineStyle: { color: labelLineColor },
        },
        label: {
          show: config.options?.dataLabels !== false,
          fontFamily: ESPRESSO_FONT,
          fontSize: 11,
          color: pieLabelColor,
          textBorderColor: labelBorderColor,
          textBorderWidth: 2,
        },
        data,
      },
    ],
  }
}

// ── Shared ──────────────────────────────────────────────────────────────────

function _baseOption(config, isDark = false) {
  const title = config.title?.trim()
  const titleColor = isDark ? '#f5f5f5' : '#171717'
  const legendColor = isDark ? '#e5e5e5' : '#525252'
  const pageIconColor = isDark ? '#a3a3a3' : '#525252'

  return {
    color: config.options?.colorScheme?.length ? config.options.colorScheme : ESPRESSO_PALETTE,
    backgroundColor: 'transparent',
    title: title
      ? {
          text: title,
          left: 12,
          top: 8,
          textStyle: {
            color: titleColor,
            fontFamily: ESPRESSO_FONT,
            fontSize: 14,
            fontWeight: 600,
          },
        }
      : undefined,
    legend:
      config.options?.showLegend === false
        ? { show: false }
        : {
            bottom: 4,
            type: 'scroll',
            textStyle: { color: legendColor, fontFamily: ESPRESSO_FONT, fontSize: 11 },
            pageIconColor: pageIconColor,
            pageTextStyle: { color: legendColor },
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
  const x = enc && Number.isInteger(enc.x) ? enc.x : 0
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

function _emptyOption(config, isDark = false) {
  const emptyColor = isDark ? '#a3a3a3' : '#a3a3a3'
  return {
    ..._baseOption(config, isDark),
    title: {
      text: 'No data',
      left: 'center',
      top: 'middle',
      textStyle: { color: emptyColor, fontFamily: ESPRESSO_FONT, fontSize: 12 },
    },
  }
}
