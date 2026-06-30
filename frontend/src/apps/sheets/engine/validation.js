// Data validation engine — stores per-cell validation rules.
// Rule shape: { type: 'list',        options: ['A','B','C'], message? }
//             { type: 'number',      operator: 'between'|'gt'|'gte'|'lt'|'lte'|'eq'|'neq'|'not_between', min, max?, message? }
//             { type: 'text_length', operator: 'between'|'gt'|'gte'|'lt'|'lte'|'eq'|'neq'|'not_between', min, max?, message? }
// Pure state, no DOM dependency.

import { parseCellId, colLabel } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'

function _checkNumOp(n, op, min, max) {
  switch (op || 'between') {
    case 'between':     return (min == null || n >= min) && (max == null || n <= max)
    case 'not_between': return !(n >= min && n <= max)
    case 'gt':          return n >  min
    case 'gte':         return n >= min
    case 'lt':          return n <  min
    case 'lte':         return n <= min
    case 'eq':          return n === min
    case 'neq':         return n !== min
    default:            return true
  }
}

// Pure rule check — given a rule and a value, is the value allowed?
// Shared by the engine's per-cell validate() and the canvas painter (which
// needs to know validity to draw the invalid marker) so there's one source
// of truth for what "valid" means. No state, no sheet lookup.
export function checkRule(rule, value) {
  if (!rule) return { valid: true }

  if (rule.type === 'list') {
    const opts = rule.options || []
    const ok = opts.includes(String(value))
    return { valid: ok, message: ok ? null : (rule.message || `Value must be one of: ${opts.join(', ')}`) }
  }

  if (rule.type === 'number') {
    const n = parseFloat(value)
    if (isNaN(n)) return { valid: false, message: rule.message || 'Value must be a number' }
    const ok = _checkNumOp(n, rule.operator, rule.min, rule.max)
    return { valid: ok, message: ok ? null : (rule.message || 'Value out of allowed range') }
  }

  if (rule.type === 'text_length') {
    const len = String(value == null ? '' : value).length
    const ok = _checkNumOp(len, rule.operator, rule.min, rule.max)
    return { valid: ok, message: ok ? null : (rule.message || 'Text length out of allowed range') }
  }

  return { valid: true }
}

export function createValidationEngine() {
  // { sheetName: { cellId: rule } }
  const store = {}

  function ensure(sheet) {
    if (!store[sheet]) store[sheet] = {}
  }

  function get(id, sheet = 'Sheet1') {
    return store[sheet]?.[id] ?? null
  }

  function set(id, rule, sheet = 'Sheet1') {
    ensure(sheet)
    if (rule) store[sheet][id] = rule
    else delete store[sheet][id]
  }

  function clear(id, sheet = 'Sheet1') {
    if (store[sheet]) delete store[sheet][id]
  }

  function getAll(sheet = 'Sheet1') {
    return store[sheet] || {}
  }

  function validate(id, value, sheet = 'Sheet1') {
    return checkRule(get(id, sheet), value)
  }

  function _shift(sheet, pred, newIdFn, descending) {
    ensure(sheet)
    const st = store[sheet]
    const entries = Object.entries(st)
      .map(([id, rule]) => ({ id, p: parseCellId(id), rule }))
      .filter(({ p }) => p && pred(p))
    entries.sort((a, b) => descending ? b.p.row - a.p.row : a.p.row - b.p.row)
    for (const { id, p, rule } of entries) {
      delete st[id]
      const nid = newIdFn(p)
      if (nid) st[nid] = rule
    }
  }

  function insertRow(atRow, sheet = 'Sheet1') {
    _shift(sheet, p => p.row >= atRow, p => colLabel(p.col) + (p.row + 2), true)
  }

  function deleteRow(atRow, sheet = 'Sheet1') {
    ensure(sheet)
    for (const id of Object.keys(store[sheet] || {})) {
      const p = parseCellId(id)
      if (p && p.row === atRow) delete store[sheet][id]
    }
    _shift(sheet, p => p.row > atRow, p => colLabel(p.col) + p.row, false)
  }

  function insertCol(atCol, sheet = 'Sheet1') {
    ensure(sheet)
    const st = store[sheet]
    const entries = Object.entries(st)
      .map(([id, rule]) => ({ id, p: parseCellId(id), rule }))
      .filter(({ p }) => p && p.col >= atCol)
      .sort((a, b) => b.p.col - a.p.col)
    for (const { id, p, rule } of entries) {
      delete st[id]
      st[colLabel(p.col + 1) + (p.row + 1)] = rule
    }
  }

  function deleteCol(atCol, sheet = 'Sheet1') {
    ensure(sheet)
    const st = store[sheet]
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.col === atCol) delete st[id]
    }
    const entries = Object.entries(st)
      .map(([id, rule]) => ({ id, p: parseCellId(id), rule }))
      .filter(({ p }) => p && p.col > atCol)
      .sort((a, b) => a.p.col - b.p.col)
    for (const { id, p, rule } of entries) {
      delete st[id]
      st[colLabel(p.col - 1) + (p.row + 1)] = rule
    }
  }

  function renameSheet(oldName, newName) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName, newName) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || {})
  }

  function deleteSheet(name) { delete store[name] }

  function snapshot() { return deepClone(store) }

  function restore(snap) {
    for (const k of Object.keys(store)) delete store[k]
    for (const [k, v] of Object.entries(snap)) store[k] = v
  }

  return {
    get, set, clear, getAll, validate,
    insertRow, deleteRow, insertCol, deleteCol,
    renameSheet, duplicateSheet, deleteSheet,
    snapshot, restore,
  }
}
