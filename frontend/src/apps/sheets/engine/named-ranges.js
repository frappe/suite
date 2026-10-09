// Named ranges — workbook-level bindings from a human name to a target cell
// or range. Used so a formula like `=Revenue` resolves the same way Sheets
// and Excel handle `Defined names`.
//
// Each entry has shape:
//   {
//     name:        "Revenue",          // unique, validated, uppercase-normalised
//     sheet:       "Sheet1",           // target sub-sheet
//     range:       "B2:B100" | "A1",   // single cell or range, no sheet prefix
//   }
//
// Names are case-insensitive at the lookup site (Sheets behaviour). They
// cannot collide with built-in function names or with valid A1 cell
// references — the validator below catches both.
//
// Persistence: `snapshot()` / `restore()` round-trip the store as part of
// `sheets_data`, alongside formats / pivots / charts.

import { deepClone } from '../utils/deep-clone.js'
import { remapRangeString } from './ref-remap.js'

const _RESERVED = new Set(['TRUE', 'FALSE', 'NULL'])

const _CELL_RE = /^[A-Z]+\d+$/
const _NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

// An entry as an IronCalc defined-name formula: absolute, sheet-qualified,
// no leading '=' ({ sheet: 'My Data', range: 'B2:B9' } → 'My Data'!$B$2:$B$9).
// IronCalc evaluates `=Revenue` from these; the store stays the source the
// dialog edits and the document saves.
export function definedNameFormula({ sheet, range }) {
  const quoted = `'${String(sheet).replace(/'/g, "''")}'`
  const abs = String(range)
    .split(':')
    .map((ref) =>
      ref
        .trim()
        .toUpperCase()
        .replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2'),
    )
    .join(':')
  return `${quoted}!${abs}`
}

/**
 * @param {{ isBuiltinFunction?: (name: string) => boolean }} [opts]
 *   Optional hook to detect collisions with built-in formula functions
 *   (so names like "SUM" or "VLOOKUP" can't be defined).
 */
export function createNamedRanges({ isBuiltinFunction } = {}) {
  let _store = {} // upper-case name → entry
  let _onChange = null

  function setOnChange(cb) {
    _onChange = cb
  }
  function _notify() {
    _onChange?.()
  }

  function _validateName(name) {
    const trimmed = String(name || '').trim()
    if (!trimmed) return 'Name is required'
    if (!_NAME_RE.test(trimmed))
      return 'Name must start with a letter or "_" and use only letters, digits and "_"'
    const up = trimmed.toUpperCase()
    if (_RESERVED.has(up)) return `"${trimmed}" is a reserved word`
    if (_CELL_RE.test(up)) return `"${trimmed}" looks like a cell reference`
    if (isBuiltinFunction?.(up)) return `"${trimmed}" conflicts with a built-in function`
    return null
  }

  function _validateRange(range) {
    const r = String(range || '').trim()
    if (!r) return 'Range is required'
    // Accept A1 single-cell or A1:B5 ranges. Sheet prefix is stored
    // separately, not embedded.
    const ok = /^[A-Z]+\d+(:[A-Z]+\d+)?$/i.test(r)
    if (!ok) return 'Range must look like "A1" or "A1:B5"'
    return null
  }

  function _key(name) {
    return String(name || '')
      .trim()
      .toUpperCase()
  }

  // ── Public API ──────────────────────────────────────────────────────────

  function add({ name, sheet, range } = {}) {
    const nameErr = _validateName(name)
    if (nameErr) return { error: nameErr }
    const rangeErr = _validateRange(range)
    if (rangeErr) return { error: rangeErr }
    const k = _key(name)
    if (_store[k]) return { error: `"${name}" already exists` }
    _store[k] = { name: name.trim(), sheet: sheet || '', range: range.trim().toUpperCase() }
    _notify()
    return { name: name.trim() }
  }

  function update(oldName, patch = {}) {
    const k = _key(oldName)
    const cur = _store[k]
    if (!cur) return { error: `"${oldName}" not found` }
    const next = { ...cur, ...patch }
    if (patch.name !== undefined && _key(patch.name) !== k) {
      const nameErr = _validateName(patch.name)
      if (nameErr) return { error: nameErr }
      const newKey = _key(patch.name)
      if (_store[newKey]) return { error: `"${patch.name}" already exists` }
      delete _store[k]
      _store[newKey] = { ...next, name: patch.name.trim() }
    } else {
      if (patch.range !== undefined) {
        const re = _validateRange(patch.range)
        if (re) return { error: re }
        next.range = patch.range.trim().toUpperCase()
      }
      _store[k] = next
    }
    _notify()
    return { name: (patch.name ?? cur.name).trim() }
  }

  function remove(name) {
    const k = _key(name)
    if (!_store[k]) return
    delete _store[k]
    _notify()
  }

  function get(name) {
    return _store[_key(name)]
  }
  function list() {
    return Object.values(_store)
  }

  // Returns true if `name` is a defined named range — lookup is case-
  // insensitive. Used by the tokenizer / parser to choose ref-vs-function.
  function has(name) {
    return !!_store[_key(name)]
  }

  // Resolve a name to its underlying reference. Returns:
  //   { sheet, start, end }   — start/end are cell IDs (A1, B5, etc.)
  //   null if not found
  function resolve(name) {
    const entry = _store[_key(name)]
    if (!entry) return null
    const range = entry.range
    const [start, end] = range.includes(':') ? range.split(':') : [range, range]
    return { sheet: entry.sheet, start, end }
  }

  // Walk all entries on a sheet — used when the sheet gets renamed so we
  // can rewrite the `sheet` field rather than break the binding.
  function renameSheet(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return
    let changed = false
    for (const k of Object.keys(_store)) {
      if (_store[k].sheet === oldName) {
        _store[k] = { ..._store[k], sheet: newName }
        changed = true
      }
    }
    if (changed) _notify()
  }

  // Structural permutation — rewrite the range of every named range that lives
  // on the op sheet so it keeps pointing at the same logical data.
  function _remap(sheet, mapCol, mapRow) {
    const lc = String(sheet || '').toLowerCase()
    let changed = false
    for (const k of Object.keys(_store)) {
      const e = _store[k]
      if (String(e.sheet || '').toLowerCase() !== lc) continue
      const next = remapRangeString(e.range, { opSheet: e.sheet, mapCol, mapRow })
      if (next !== e.range) {
        _store[k] = { ...e, range: next }
        changed = true
      }
    }
    if (changed) _notify()
  }
  function remapCols(mapCol, sheet) {
    _remap(sheet, mapCol, null)
  }
  function remapRows(mapRow, sheet) {
    _remap(sheet, null, mapRow)
  }

  function snapshot() {
    return { entries: deepClone(_store) }
  }
  function restore(data) {
    _store = {}
    if (data?.entries) {
      for (const [k, v] of Object.entries(data.entries)) _store[k] = { ...v }
    }
    _notify()
  }

  return {
    add,
    update,
    remove,
    get,
    has,
    list,
    resolve,
    remapCols,
    remapRows,
    renameSheet,
    snapshot,
    restore,
    setOnChange,
  }
}
