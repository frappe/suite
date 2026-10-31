// Chart engine — pure store, no Vue / DOM / ECharts here.
//
// Same shape as `engine/pivot.ts`: an in-memory map of chart configs with
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

import { deepClone } from '../utils/deep-clone.js'
import { newItemId } from './item-id.js'
import { parseA1Range, remapRangeString } from './ref-remap.js'
import type { IndexMap } from './types.js'

/** One of CHART_TYPES; anything else renders as a bar chart. */
export type ChartType = 'line' | 'bar' | 'pie' | 'area' | 'scatter'

/** Column indices into the chart's source range, 0-based. */
export interface ChartEncoding {
  x: number
  y: number[]
}

/** Where the chart floats on the canvas overlay, px. */
export interface ChartPosition {
  sheet: string
  x: number
  y: number
  width: number
  height: number
}

export interface ChartOptions {
  stacked?: boolean
  smooth?: boolean
  showLegend?: boolean
  dataLabels?: boolean
  gridLines?: boolean
  /** A CHART_AGGREGATIONS value; absent or 'none' plots each row. */
  aggregate?: string
  /** Overrides ESPRESSO_PALETTE when non-empty. */
  colorScheme?: string[]
}

/**
 * What a chart is drawn from. Every field is optional: saved charts and
 * callers fill in only some of them, and the readers default the rest.
 * `chartType` is a string because buildOption treats unknown types as bar.
 */
export interface ChartSpec {
  sourceSheet?: string
  sourceRange?: string | undefined
  chartType?: string
  title?: string
  hasHeader?: boolean
  encoding?: ChartEncoding
  position?: ChartPosition
  options?: ChartOptions
}

export interface ChartConfig extends ChartSpec {
  id: string
}

export interface ChartSnapshot {
  charts: Record<string, ChartConfig>
  /** From when ids were counted; ignored. */
  nextId?: number
}

export type ChartEngine = ReturnType<typeof createChartEngine>

export function createChartEngine() {
  let _charts: Record<string, ChartConfig> = {} // id → ChartConfig
  let _onChange: (() => void) | null = null

  // Random, so two tabs adding a chart at once never share an id (item-id.ts).
  function _newId() {
    return `chart_${newItemId()}`
  }
  function _notify() {
    _onChange?.()
  }

  function setOnChange(cb: (() => void) | null) {
    _onChange = cb
  }

  function add(config: ChartSpec & { id?: string }) {
    const id = config.id || _newId()
    _charts[id] = { ...config, id }
    _notify()
    return id
  }

  function update(id: string, patch: Partial<ChartConfig>) {
    if (!_charts[id]) return
    _charts[id] = { ..._charts[id], ...patch, id }
    _notify()
  }

  function remove(id: string) {
    if (id in _charts) {
      delete _charts[id]
      _notify()
    }
  }

  function get(id: string) {
    return _charts[id]
  }
  function list() {
    return Object.values(_charts)
  }

  function listForSheet(sheetName: string) {
    return Object.values(_charts).filter((c) => c.position?.sheet === sheetName)
  }

  // True when `sheetName` is the source for any chart — drives "should I
  // recompute" decisions when cells change.
  function affectsChart(sheetName: string) {
    return Object.values(_charts).some((c) => c.sourceSheet === sheetName)
  }

  function snapshot(): ChartSnapshot {
    return { charts: deepClone(_charts) }
  }

  function restore(data: ChartSnapshot | null | undefined) {
    if (!data) return
    _charts = deepClone(data.charts || {})
    _notify()
  }

  // Structural permutation. Remap each chart's source range, and — because the
  // encoding x/y are column indices *into that range* — remap those through the
  // induced local permutation so a reorder inside the range keeps series bound
  // to the same data. Charts whose source column vanished drop that series.
  function _remap(sheet: string, mapCol: IndexMap | null, mapRow: IndexMap | null) {
    const lc = String(sheet || '').toLowerCase()
    let changed = false
    for (const ch of Object.values(_charts)) {
      if (String(ch.sourceSheet || '').toLowerCase() !== lc) continue
      const before = parseA1Range(ch.sourceRange)
      const nextRange = remapRangeString(ch.sourceRange, {
        opSheet: ch.sourceSheet,
        mapCol,
        mapRow,
      })
      ch.sourceRange = nextRange
      changed = true
      if (mapCol && before && nextRange !== '#REF!' && ch.encoding) {
        // A remapped range that isn't #REF! is still a valid A1 range.
        const after = parseA1Range(nextRange) as { c0: number }
        const local = (li: number) => {
          const g = mapCol(before.c0 + li)
          return g == null || g < 0 ? null : g - after.c0
        }
        if (typeof ch.encoding.x === 'number') {
          const nx = local(ch.encoding.x)
          ch.encoding.x = nx == null ? 0 : nx
        }
        if (Array.isArray(ch.encoding.y))
          ch.encoding.y = ch.encoding.y.map(local).filter((v): v is number => v != null && v >= 0)
      }
    }
    if (changed) _notify()
  }
  function remapCols(mapCol: IndexMap, sheet: string) {
    _remap(sheet, mapCol, null)
  }
  function remapRows(mapRow: IndexMap, sheet: string) {
    _remap(sheet, null, mapRow)
  }

  // Sheet operations, run alongside the other stores' (useSheetTabs extras).
  // A chart names two sheets: the one it reads (sourceSheet) and the one it
  // is drawn on (position.sheet).
  function renameSheet(oldName: string, newName: string) {
    let changed = false
    for (const ch of Object.values(_charts)) {
      if (ch.sourceSheet === oldName) {
        ch.sourceSheet = newName
        changed = true
      }
      if (ch.position?.sheet === oldName) {
        ch.position = { ...ch.position, sheet: newName }
        changed = true
      }
    }
    if (changed) _notify()
  }

  // The copy gets its own charts; one that read the source sheet reads the copy.
  function duplicateSheet(srcName: string, newName: string) {
    const onSheet = Object.values(_charts).filter((ch) => ch.position?.sheet === srcName)
    for (const ch of onSheet) {
      const id = _newId()
      const copy = deepClone(ch)
      _charts[id] = {
        ...copy,
        id,
        position: { ...(copy.position as ChartPosition), sheet: newName },
        ...(copy.sourceSheet === srcName ? { sourceSheet: newName } : {}),
      }
    }
    if (onSheet.length) _notify()
  }

  // Charts drawn on the sheet go with it. One drawn elsewhere that read it
  // stays and shows no data, like a formula pointing at a deleted sheet.
  function deleteSheet(name: string) {
    const gone = Object.values(_charts).filter((ch) => ch.position?.sheet === name)
    for (const ch of gone) delete _charts[ch.id]
    if (gone.length) _notify()
  }

  return {
    add,
    update,
    remove,
    get,
    list,
    listForSheet,
    affectsChart,
    remapCols,
    remapRows,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    snapshot,
    restore,
    setOnChange,
  }
}

// ── Helpers shared with view layer ───────────────────────────────────────────

// Default position for a freshly-inserted chart. The overlay offsets
// subsequent inserts so they don't stack perfectly on top of each other.
export const DEFAULT_CHART_SIZE = { width: 480, height: 320 }

// Stable list of supported chart types — keep in sync with what ChartView
// knows how to render.
export const CHART_TYPES: ChartType[] = ['line', 'bar', 'pie', 'area', 'scatter']

// Aggregation functions offered in the chart dialog. `none` (the default)
// plots each source row as-is; the rest group rows by the X-axis value and
// summarise each series column — see `_aggregate` in chart-data.ts. Values are
// the authoritative keys stored in a chart's `options.aggregate`.
export const CHART_AGGREGATIONS = [
  { value: 'none', label: 'None (plot each row)' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
]

// Espresso-aligned categorical palette. ECharts default greys clash with
// the rest of the UI; this set matches the cyan accent already used in the
// brand mark and the cursor palette.
export const ESPRESSO_PALETTE = [
  '#0E7490',
  '#A5F0FA',
  '#0891B2',
  '#67E8F9',
  '#155E75',
  '#22D3EE',
  '#0C4A6E',
  '#7DD3FC',
]

// Curated categorical palettes offered in the chart dialog. Each is 8 stops so
// it lines up with the default series cap. `colorScheme` in a chart's options,
// when set, overrides the default (read in chart-data.ts `_baseOption`); the
// first entry here IS the default palette, so a chart with no colorScheme and
// one explicitly set to Espresso render identically.
export const CHART_PALETTES = [
  { name: 'Espresso', colors: ESPRESSO_PALETTE },
  {
    name: 'Ocean',
    colors: [
      '#1E3A8A',
      '#3B82F6',
      '#0891B2',
      '#60A5FA',
      '#1E40AF',
      '#38BDF8',
      '#1D4ED8',
      '#93C5FD',
    ],
  },
  {
    name: 'Forest',
    colors: [
      '#166534',
      '#22C55E',
      '#65A30D',
      '#4ADE80',
      '#15803D',
      '#84CC16',
      '#14532D',
      '#BEF264',
    ],
  },
  {
    name: 'Sunset',
    colors: [
      '#B45309',
      '#F59E0B',
      '#DC2626',
      '#FB923C',
      '#92400E',
      '#FBBF24',
      '#7C2D12',
      '#FDBA74',
    ],
  },
  {
    name: 'Berry',
    colors: [
      '#9D174D',
      '#EC4899',
      '#7C3AED',
      '#F472B6',
      '#BE185D',
      '#A78BFA',
      '#831843',
      '#C4B5FD',
    ],
  },
  {
    name: 'Slate',
    colors: [
      '#334155',
      '#64748B',
      '#94A3B8',
      '#475569',
      '#1E293B',
      '#CBD5E1',
      '#0F172A',
      '#E2E8F0',
    ],
  },
]
