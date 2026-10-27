// Conditional formatting engine.
//
// Two rule families live here:
//
// 1. Condition-based rules (legacy shape — no `kind` field):
//      { id, range:{r0,c0,r1,c1},
//        condition: { type:'gt'|'lt'|'gte'|'lte'|'eq'|'neq'|'between'|
//                     'contains'|'notcontains'|'empty'|'notempty'|'formula',
//                     value, value2 },
//        format: { backgroundColor?, color? } }
//
// 2. Scale-based rules (new — distinguished by `kind`):
//      { id, range, kind:'color-scale',
//        scale:{ variant:'2color', minColor, maxColor }
//          or { variant:'3color', minColor, midColor, maxColor, midPercent } }
//      { id, range, kind:'data-bar',
//        bar:{ color, negativeColor?, axis?:'auto'|'cell' } }
//      { id, range, kind:'icon-set',
//        icons:{ set:'arrows3'|'circles3'|'traffic3', thresholds:[low, high] } }
//
// All `kind` types share the same range/shift/copy semantics as the legacy
// shape — the new code paths only diverge in `getFormatOverride` (where they
// compute against the entire range's min/max rather than testing one cell).
//
// The format-override shape returned to the painter has grown to:
//      { backgroundColor?, color?, dataBar?:{value,color,negativeColor},
//        icon?:{shape,color} }
// — strictly additive; rules that don't use the new keys are unaffected.

import { cellId, parseCellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { displayNumber } from '../utils/format-number.js'
import { newItemNumber } from './item-id.js'
import { remapRect } from './ref-remap.js'
import type { IndexMap, Rect } from './types.js'

export interface CfCondition {
  type: string
  /** The comparison value, or the formula text for type 'formula'. */
  value?: string
  /** Upper bound for 'between'. */
  value2?: string
}

export interface CfScale {
  variant?: '2color' | '3color' | string
  minColor?: string
  midColor?: string
  maxColor?: string
  /** 3color: where the mid colour sits, 0..1. */
  midPercent?: number
}

export interface CfBar {
  color?: string
  negativeColor?: string
  axis?: 'auto' | 'cell'
}

export interface CfIcons {
  set?: 'arrows3' | 'circles3' | 'traffic3' | string
  /** Bucket edges, each 0..1 of the range's [min, max]. */
  thresholds?: [number, number]
}

/** A stored rule. `kind` absent = condition rule (uses `condition` + `format`). */
export interface CfRule {
  id: number
  range: Rect
  kind?: 'color-scale' | 'data-bar' | 'icon-set'
  condition?: CfCondition
  format?: CfOverride
  scale?: CfScale
  bar?: CfBar
  icons?: CfIcons
}

export interface CfDataBar {
  /** Bar width, 0..1. */
  value: number
  color: string
  negativeColor?: string
  negative?: boolean
}

export interface CfIcon {
  shape: string
  color: string
}

/** What a cell's rules add on top of its own format. */
export interface CfOverride {
  backgroundColor?: string
  color?: string
  dataBar?: CfDataBar
  icon?: CfIcon
}

/** { sheetName: [rule, ...] } */
export type CfSnapshot = Record<string, CfRule[]>

/** Reads a cell's value by id (or evaluates a formula, for 'formula' rules). */
export type CellValueGetter = (id: string) => unknown

export type CondFormatEngine = ReturnType<typeof createCondFormatEngine>

interface RangeStats {
  min: number
  max: number
  count: number
}

type Bucket = 'low' | 'mid' | 'high'

export function createCondFormatEngine() {
  const store: CfSnapshot = {}

  function ensure(sheet: string): CfRule[] {
    if (!store[sheet]) store[sheet] = []
    return store[sheet]
  }

  function getRules(sheet = 'Sheet1') {
    return store[sheet] || []
  }

  function addRule(rule: Omit<CfRule, 'id'>, sheet = 'Sheet1') {
    const rules = ensure(sheet)
    // Random, so two tabs adding a rule at once never share an id (item-id.ts).
    const r = { ...rule, id: newItemNumber() }
    rules.push(r)
    return r.id
  }

  function updateRule(id: number, patch: Partial<CfRule>, sheet = 'Sheet1') {
    const rules = store[sheet]
    if (!rules) return
    const idx = rules.findIndex((r) => r.id === id)
    if (idx !== -1) rules[idx] = { ...(rules[idx] as CfRule), ...patch }
  }

  function removeRule(id: number, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter((r) => r.id !== id)
  }

  // ── Condition evaluation (legacy rules) ────────────────────────────────────

  // Values are the strings cells show (`1,000`, `$5`, `50%`): displayNumber
  // reads the number in them.
  function _testCondition(
    cond: CfCondition,
    rawVal: unknown,
    getCellValue: CellValueGetter | null | undefined,
  ) {
    if (cond.type === 'empty') return rawVal === '' || rawVal == null
    if (cond.type === 'notempty') return rawVal !== '' && rawVal != null
    if (cond.type === 'formula') {
      try {
        return !!getCellValue?.(cond.value as string)
      } catch {
        return false
      }
    }
    const s = String(rawVal ?? '')
    if (cond.type === 'contains') return s.toLowerCase().includes(String(cond.value).toLowerCase())
    if (cond.type === 'notcontains')
      return !s.toLowerCase().includes(String(cond.value).toLowerCase())
    const n = displayNumber(rawVal)
    const v = displayNumber(cond.value)
    if (isNaN(n) || isNaN(v)) return false
    if (cond.type === 'gt') return n > v
    if (cond.type === 'lt') return n < v
    if (cond.type === 'gte') return n >= v
    if (cond.type === 'lte') return n <= v
    if (cond.type === 'eq') return n === v
    if (cond.type === 'neq') return n !== v
    if (cond.type === 'between') return n >= v && n <= displayNumber(cond.value2)
    return false
  }

  // ── Range stats for scale-based rules ──────────────────────────────────────
  //
  // Computed lazily per (rule.id, sheet) — invalidated when any rule mutates
  // or when the sheet is rebuilt. The painter calls `getFormatOverride` once
  // per visible cell, so without memoisation a 1000-cell range would scan
  // itself a thousand times per render. Cache is cleared by `_invalidate`.

  const _statsCache = new Map<string, RangeStats>() // key = `${sheet}|${ruleId}`

  function _invalidateStats() {
    _statsCache.clear()
  }

  function _rangeStats(
    rule: CfRule,
    sheet: string,
    getCellValue: CellValueGetter | null | undefined,
  ): RangeStats {
    const key = `${sheet}|${rule.id}`
    if (_statsCache.has(key)) return _statsCache.get(key) as RangeStats
    const { r0, c0, r1, c1 } = rule.range
    let min = Infinity,
      max = -Infinity,
      count = 0
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const v = getCellValue?.(cellId(r, c))
        const n = displayNumber(v)
        if (isNaN(n)) continue
        if (n < min) min = n
        if (n > max) max = n
        count++
      }
    }
    const out = count ? { min, max, count } : { min: 0, max: 0, count: 0 }
    _statsCache.set(key, out)
    return out
  }

  // ── Format computation per kind ────────────────────────────────────────────

  function _formatForColorScale(
    rule: CfRule,
    rawVal: unknown,
    stats: RangeStats,
  ): CfOverride | null {
    const n = displayNumber(rawVal)
    if (isNaN(n) || stats.count === 0 || stats.max === stats.min) {
      // No gradient possible — leave the cell unstyled.
      return null
    }
    const t = (n - stats.min) / (stats.max - stats.min) // [0..1]
    const s: CfScale = rule.scale || {}
    if (s.variant === '3color') {
      const mid = s.midPercent ?? 0.5
      const lo = s.minColor || '#ffffff'
      const md = s.midColor || '#ffeb3b'
      const hi = s.maxColor || '#4caf50'
      const c =
        t <= mid
          ? _interp(lo, md, mid === 0 ? 0 : t / mid)
          : _interp(md, hi, mid === 1 ? 1 : (t - mid) / (1 - mid))
      return { backgroundColor: c }
    }
    // 2-color
    const lo = s.minColor || '#ffffff'
    const hi = s.maxColor || '#0E7490'
    return { backgroundColor: _interp(lo, hi, t) }
  }

  function _formatForDataBar(rule: CfRule, rawVal: unknown, stats: RangeStats): CfOverride | null {
    const n = displayNumber(rawVal)
    if (isNaN(n) || stats.count === 0) return null
    // Normalised bar width in [0..1]. Negative values render from the centre
    // in `axis: 'cell'` mode; the simpler `axis: 'auto'` fills from the left.
    const span = stats.max - stats.min
    if (span === 0) return { dataBar: { value: 1, color: rule.bar?.color || '#0E7490' } }
    const t = Math.max(0, Math.min(1, (n - stats.min) / span))
    return {
      dataBar: {
        value: t,
        color: rule.bar?.color || '#0E7490',
        negativeColor: rule.bar?.negativeColor || '#dc2626',
        negative: n < 0,
      },
    }
  }

  // Icon sets — three icons mapped to value buckets at `thresholds[0]` and
  // `thresholds[1]` (each in [0..1] relative to the range's [min, max]).
  function _formatForIconSet(rule: CfRule, rawVal: unknown, stats: RangeStats): CfOverride | null {
    const n = displayNumber(rawVal)
    if (isNaN(n) || stats.count === 0) return null
    const t = stats.max === stats.min ? 0.5 : (n - stats.min) / (stats.max - stats.min)
    const [lo, hi] = rule.icons?.thresholds || [0.33, 0.66]
    const bucket = t < lo ? 'low' : t < hi ? 'mid' : 'high'
    const set = rule.icons?.set || 'arrows3'
    return { icon: _iconForBucket(set, bucket) }
  }

  function _iconForBucket(set: string, bucket: Bucket): CfIcon {
    // Set-specific palettes + shape codes. The painter knows how to draw each
    // `shape` value — see canvas/painters/cell-decorations.ts.
    if (set === 'arrows3') {
      if (bucket === 'low') return { shape: 'arrow-down', color: '#dc2626' }
      if (bucket === 'mid') return { shape: 'arrow-right', color: '#737373' }
      return { shape: 'arrow-up', color: '#16a34a' }
    }
    if (set === 'traffic3') {
      if (bucket === 'low') return { shape: 'circle', color: '#dc2626' }
      if (bucket === 'mid') return { shape: 'circle', color: '#f59e0b' }
      return { shape: 'circle', color: '#16a34a' }
    }
    // circles3 — filled / half / empty visual hierarchy in one neutral colour
    if (bucket === 'low') return { shape: 'circle-empty', color: '#737373' }
    if (bucket === 'mid') return { shape: 'circle-half', color: '#737373' }
    return { shape: 'circle-full', color: '#737373' }
  }

  // ── Public format-override entry point ─────────────────────────────────────
  //
  // Iterates the sheet's rules in declaration order. The FIRST matching rule
  // contributes its keys; subsequent rules add keys that the first didn't
  // populate (e.g. a colour-scale rule providing backgroundColor and a
  // separate icon-set rule providing the icon both contribute to the same
  // cell's final paint — they only conflict on the same key).

  function getFormatOverride(
    id: string,
    rawVal: unknown,
    sheet = 'Sheet1',
    getCellValue: CellValueGetter | null = null,
  ): CfOverride | null {
    const p = parseCellId(id)
    if (!p) return null
    const rules = store[sheet] || []
    let out: CfOverride | null = null
    for (const rule of rules) {
      const { r0, c0, r1, c1 } = rule.range
      if (p.row < r0 || p.row > r1 || p.col < c0 || p.col > c1) continue

      let contribution: CfOverride | null | undefined = null
      if (rule.kind === 'color-scale') {
        contribution = _formatForColorScale(rule, rawVal, _rangeStats(rule, sheet, getCellValue))
      } else if (rule.kind === 'data-bar') {
        contribution = _formatForDataBar(rule, rawVal, _rangeStats(rule, sheet, getCellValue))
      } else if (rule.kind === 'icon-set') {
        contribution = _formatForIconSet(rule, rawVal, _rangeStats(rule, sheet, getCellValue))
      } else if (
        // No kind = a condition rule, which always has a condition.
        _testCondition(rule.condition as CfCondition, rawVal, getCellValue)
      ) {
        contribution = rule.format
      }
      if (!contribution) continue
      if (!out) out = { ...contribution }
      else {
        // Merge — earlier rules win on shared keys.
        const merged = out as Record<string, unknown>
        const add = contribution as Record<string, unknown>
        for (const k of Object.keys(add)) if (merged[k] == null) merged[k] = add[k]
      }
    }
    return out
  }

  // Duplicate any rules that overlap srcRect into destRect (used by copy-paste).
  function addRulesForRange(srcRect: Rect, destRect: Rect, sheet = 'Sheet1') {
    const rules = store[sheet] || []
    const overlapping = rules.filter(
      ({ range: { r0, c0, r1, c1 } }) =>
        r0 <= srcRect.r1 && r1 >= srcRect.r0 && c0 <= srcRect.c1 && c1 >= srcRect.c0,
    )
    for (const rule of overlapping) {
      const clone: Omit<CfRule, 'id'> & { id?: number } = deepClone(rule)
      clone.range = { ...destRect }
      delete clone.id
      addRule(clone, sheet)
    }
  }

  // Expand any rule that overlaps srcRect to also cover newTotal (used by fill handle).
  function extendRulesToRange(srcRect: Rect, newTotal: Rect, sheet = 'Sheet1') {
    const rules = store[sheet]
    if (!rules) return
    for (const rule of rules) {
      const { r0, c0, r1, c1 } = rule.range
      if (r0 > srcRect.r1 || r1 < srcRect.r0 || c0 > srcRect.c1 || c1 < srcRect.c0) continue
      rule.range = {
        r0: Math.min(r0, newTotal.r0),
        c0: Math.min(c0, newTotal.c0),
        r1: Math.max(r1, newTotal.r1),
        c1: Math.max(c1, newTotal.c1),
      }
    }
    _invalidateStats()
  }

  function _shiftRules(
    sheet: string,
    rowDelta: number,
    colDelta: number,
    pred: (r0: number, c0: number, r1: number, c1: number) => boolean,
  ) {
    const rules = store[sheet]
    if (!rules) return
    for (const rule of rules) {
      const { r0, c0, r1, c1 } = rule.range
      if (!pred(r0, c0, r1, c1)) continue
      rule.range = {
        r0: r0 + rowDelta,
        c0: c0 + colDelta,
        r1: r1 + rowDelta,
        c1: c1 + colDelta,
      }
    }
    _invalidateStats()
  }

  function insertRow(atRow: number, sheet = 'Sheet1') {
    _shiftRules(sheet, 1, 0, (r0) => r0 >= atRow)
  }

  function deleteRow(atRow: number, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter((r) => !(r.range.r0 === atRow && r.range.r1 === atRow))
    _shiftRules(sheet, -1, 0, (r0) => r0 > atRow)
  }

  function insertCol(atCol: number, sheet = 'Sheet1') {
    _shiftRules(sheet, 0, 1, (_r0, c0) => c0 >= atCol)
  }

  function deleteCol(atCol: number, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter((r) => !(r.range.c0 === atCol && r.range.c1 === atCol))
    _shiftRules(sheet, 0, -1, (_r0, c0) => c0 > atCol)
  }

  function _remap(sheet: string, mapCol: IndexMap | null, mapRow: IndexMap | null) {
    const rules = store[sheet]
    if (!rules) return
    store[sheet] = rules
      .map((rule) => {
        const range = remapRect(rule.range, mapCol, mapRow)
        return range ? { ...rule, range } : null
      })
      .filter((r): r is CfRule => Boolean(r))
    _invalidateStats()
  }
  function remapCols(mapCol: IndexMap, sheet = 'Sheet1') {
    _remap(sheet, mapCol, null)
  }
  function remapRows(mapRow: IndexMap, sheet = 'Sheet1') {
    _remap(sheet, null, mapRow)
  }

  function renameSheet(oldName: string, newName: string) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
    _invalidateStats()
  }

  // The copies get new ids: a rule id names one rule across the workbook.
  function duplicateSheet(srcName: string, newName: string) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || []).map((rule) => ({
      ...rule,
      id: newItemNumber(),
    }))
  }

  function deleteSheet(name: string) {
    delete store[name]
    _invalidateStats()
  }

  function snapshot() {
    return deepClone(store)
  }

  function restore(snap: CfSnapshot) {
    for (const k of Object.keys(store)) delete store[k]
    for (const [k, v] of Object.entries(snap)) store[k] = v
    _invalidateStats()
  }

  // Public hook so the SheetEditor can invalidate stats when cell data
  // changes outside of a rule mutation (e.g. paste, fill, formula recalc).
  function invalidate() {
    _invalidateStats()
  }

  return {
    getRules,
    addRule,
    updateRule,
    removeRule,
    getFormatOverride,
    addRulesForRange,
    extendRulesToRange,
    insertRow,
    deleteRow,
    insertCol,
    deleteCol,
    remapCols,
    remapRows,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    snapshot,
    restore,
    invalidate,
  }
}

// ── Colour interpolation utility ─────────────────────────────────────────────

interface Rgb {
  r: number
  g: number
  b: number
}

function _interp(loHex: string, hiHex: string, t: number) {
  const lo = _hexToRgb(loHex)
  const hi = _hexToRgb(hiHex)
  return _rgbToHex({
    r: lo.r + (hi.r - lo.r) * t,
    g: lo.g + (hi.g - lo.g) * t,
    b: lo.b + (hi.b - lo.b) * t,
  })
}

function _hexToRgb(hex: string): Rgb {
  const h = String(hex || '').replace(/^#/, '')
  if (h.length === 3) {
    // length 3, so charAt(0..2) are the three digits.
    return {
      r: parseInt(h.charAt(0) + h.charAt(0), 16),
      g: parseInt(h.charAt(1) + h.charAt(1), 16),
      b: parseInt(h.charAt(2) + h.charAt(2), 16),
    }
  }
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  }
}

function _rgbToHex({ r, g, b }: Rgb) {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
