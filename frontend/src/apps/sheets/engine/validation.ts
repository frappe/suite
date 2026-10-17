// Data validation engine — stores per-cell validation rules.
// Rule shape: { type: 'list',        options: ['A','B','C'], message? }
//             { type: 'number',      operator: 'between'|'gt'|'gte'|'lt'|'lte'|'eq'|'neq'|'not_between', min, max?, message? }
//             { type: 'text_length', operator: 'between'|'gt'|'gte'|'lt'|'lte'|'eq'|'neq'|'not_between', min, max?, message? }
//             { type: 'checkbox',    message? }  — cell holds TRUE / FALSE, painted as a tickbox
// Pure state, no DOM dependency.

import { colLabel, parseCellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { remapCellKeys } from './ref-remap.js'
import type { CellPos, IndexMap } from './types.js'

export type RuleOperator = 'between' | 'not_between' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'

/** A data-validation rule on one cell. */
export interface ValidationRule {
  type: 'list' | 'number' | 'text_length' | 'checkbox' | string
  /** list: the allowed values, in order. */
  options?: string[]
  /** list: a custom chip colour per option. */
  colors?: { [value: string]: string }
  operator?: RuleOperator
  min?: number
  max?: number
  message?: string
  /** 'reject' (default) blocks the edit; 'warn' lets it through. */
  severity?: 'reject' | 'warn'
}

export interface RuleResult {
  valid: boolean
  message?: string | null
  severity?: 'reject' | 'warn' | undefined
}

/** { sheetName: { cellId: rule } } */
export type ValidationSnapshot = Record<string, Record<string, ValidationRule>>

export type ValidationEngine = ReturnType<typeof createValidationEngine>

// `min`/`max` can be missing (the dialog saves an empty value as undefined).
// A comparison with undefined is false, so gt/gte/lt/lte/eq then reject every
// value and not_between/neq accept every value; only 'between' treats a
// missing bound as open. The casts keep that behaviour as it is.
function _checkNumOp(
  n: number,
  op: RuleOperator | undefined,
  min: number | undefined,
  max: number | undefined,
) {
  switch (op || 'between') {
    case 'between':
      return (min == null || n >= min) && (max == null || n <= max)
    case 'not_between':
      return !(n >= (min as number) && n <= (max as number))
    case 'gt':
      return n > (min as number)
    case 'gte':
      return n >= (min as number)
    case 'lt':
      return n < (min as number)
    case 'lte':
      return n <= (min as number)
    case 'eq':
      return n === min
    case 'neq':
      return n !== min
    default:
      return true
  }
}

// Pure rule check — given a rule and a value, is the value allowed?
// Shared by the engine's per-cell validate() and the canvas painter (which
// needs to know validity to draw the invalid marker) so there's one source
// of truth for what "valid" means. No state, no sheet lookup.
//
// `severity` echoes the rule's setting: 'reject' (default) blocks the edit,
// 'warn' lets it through but flags the cell. Callers gate on it.
export function checkRule(rule: ValidationRule | null | undefined, value: unknown): RuleResult {
  if (!rule) return { valid: true }
  const res = _evalRule(rule, value)
  return { ...res, severity: res.valid ? undefined : rule.severity || 'reject' }
}

function _evalRule(rule: ValidationRule, value: unknown): RuleResult {
  if (rule.type === 'list') {
    const opts = rule.options || []
    const ok = opts.includes(String(value))
    return {
      valid: ok,
      message: ok ? null : rule.message || `Value must be one of: ${opts.join(', ')}`,
    }
  }

  if (rule.type === 'number') {
    // parseFloat stringifies whatever it's given.
    const n = parseFloat(value as string)
    if (isNaN(n)) return { valid: false, message: rule.message || 'Value must be a number' }
    const ok = _checkNumOp(n, rule.operator, rule.min, rule.max)
    return { valid: ok, message: ok ? null : rule.message || 'Value out of allowed range' }
  }

  if (rule.type === 'text_length') {
    const len = String(value == null ? '' : value).length
    const ok = _checkNumOp(len, rule.operator, rule.min, rule.max)
    return { valid: ok, message: ok ? null : rule.message || 'Text length out of allowed range' }
  }

  if (rule.type === 'checkbox') {
    const up = String(value).toUpperCase()
    const ok = up === 'TRUE' || up === 'FALSE'
    return { valid: ok, message: ok ? null : rule.message || 'Value must be TRUE or FALSE' }
  }

  return { valid: true }
}

interface RuleEntry {
  id: string
  p: CellPos
  rule: ValidationRule
}

// Each stored rule with its parsed position; ids that don't parse are skipped.
function _entries(st: Record<string, ValidationRule>, pred: (p: CellPos) => boolean): RuleEntry[] {
  return Object.entries(st)
    .map(([id, rule]) => ({ id, p: parseCellId(id), rule }))
    .filter((e): e is RuleEntry => !!e.p && pred(e.p))
}

export function createValidationEngine() {
  const store: ValidationSnapshot = {}

  function ensure(sheet: string): Record<string, ValidationRule> {
    if (!store[sheet]) store[sheet] = {}
    return store[sheet]
  }

  function get(id: string, sheet = 'Sheet1') {
    return store[sheet]?.[id] ?? null
  }

  function set(id: string, rule: ValidationRule | null | undefined, sheet = 'Sheet1') {
    const st = ensure(sheet)
    if (rule) st[id] = rule
    else delete st[id]
  }

  function clear(id: string, sheet = 'Sheet1') {
    if (store[sheet]) delete store[sheet][id]
  }

  function getAll(sheet = 'Sheet1') {
    return store[sheet] || {}
  }

  function validate(id: string, value: unknown, sheet = 'Sheet1') {
    return checkRule(get(id, sheet), value)
  }

  function _shift(
    sheet: string,
    pred: (p: CellPos) => boolean,
    newIdFn: (p: CellPos) => string,
    descending: boolean,
  ) {
    const st = ensure(sheet)
    const entries = _entries(st, pred)
    entries.sort((a, b) => (descending ? b.p.row - a.p.row : a.p.row - b.p.row))
    for (const { id, p, rule } of entries) {
      delete st[id]
      const nid = newIdFn(p)
      if (nid) st[nid] = rule
    }
  }

  function insertRow(atRow: number, sheet = 'Sheet1') {
    _shift(
      sheet,
      (p) => p.row >= atRow,
      (p) => colLabel(p.col) + (p.row + 2),
      true,
    )
  }

  function deleteRow(atRow: number, sheet = 'Sheet1') {
    const st = ensure(sheet)
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.row === atRow) delete st[id]
    }
    _shift(
      sheet,
      (p) => p.row > atRow,
      (p) => colLabel(p.col) + p.row,
      false,
    )
  }

  function insertCol(atCol: number, sheet = 'Sheet1') {
    const st = ensure(sheet)
    const entries = _entries(st, (p) => p.col >= atCol).sort((a, b) => b.p.col - a.p.col)
    for (const { id, p, rule } of entries) {
      delete st[id]
      st[colLabel(p.col + 1) + (p.row + 1)] = rule
    }
  }

  function deleteCol(atCol: number, sheet = 'Sheet1') {
    const st = ensure(sheet)
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.col === atCol) delete st[id]
    }
    const entries = _entries(st, (p) => p.col > atCol).sort((a, b) => a.p.col - b.p.col)
    for (const { id, p, rule } of entries) {
      delete st[id]
      st[colLabel(p.col - 1) + (p.row + 1)] = rule
    }
  }

  function remapCols(mapCol: IndexMap, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = remapCellKeys(store[sheet], mapCol, null)
  }

  function remapRows(mapRow: IndexMap, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = remapCellKeys(store[sheet], null, mapRow)
  }

  function renameSheet(oldName: string, newName: string) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName: string, newName: string) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || {})
  }

  function deleteSheet(name: string) {
    delete store[name]
  }

  function snapshot() {
    return deepClone(store)
  }

  function restore(snap: ValidationSnapshot) {
    for (const k of Object.keys(store)) delete store[k]
    for (const [k, v] of Object.entries(snap)) store[k] = v
  }

  return {
    get,
    set,
    clear,
    getAll,
    validate,
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
  }
}
