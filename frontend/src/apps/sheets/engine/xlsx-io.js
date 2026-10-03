// XLSX interchange adapter — maps between the engine's per-cell state and
// SheetJS cell objects, with lossless round-tripping of the formats this app
// produces. Pure functions only (no SheetJS import, no DOM) so the mapping is
// unit-testable in isolation; the composable that owns file I/O calls in.
//
// A SheetJS cell is { t, v, f?, z? }:
//   t  cell type — 'n' number, 's' string, 'b' boolean, 'd' date
//   v  the value (typed per t)
//   f  a formula WITHOUT the leading '=' (Excel convention)
//   z  a number-format code (Excel's grammar, e.g. '#,##0.00', '0.00%')

import { CURRENCIES, parseNumberFmt } from '../utils/format-number.js'

// ── Number-format mapping ────────────────────────────────────────────────────
//
// Our format strings (`type[:variant][:decimals]`, plus `custom:<pattern>`)
// carry the same intent as Excel `z` codes. These two functions are inverses
// for every format the app can produce; an Excel code we don't recognise is
// preserved verbatim as `custom:<code>` so it round-trips untouched.

const DATE_Z = {
  dmy: 'dd/mm/yyyy',
  mdy: 'mm/dd/yyyy',
  ymd: 'yyyy-mm-dd',
  long: 'd mmm yyyy',
  full: 'ddd, d mmm yyyy',
}
const TIME_Z = { hm: 'hh:mm', hms: 'hh:mm:ss', hm12: 'h:mm AM/PM', hms12: 'h:mm:ss AM/PM' }
const Z_DATE = _invert(DATE_Z)
const Z_TIME = _invert(TIME_Z)
// First currency wins a shared symbol (¥ is both JPY and CNY) so reverse
// mapping is deterministic — a ¥ cell round-trips as JPY.
const SYMBOL_TO_CODE = {}
for (const [code, c] of Object.entries(CURRENCIES))
  if (!(c.symbol in SYMBOL_TO_CODE)) SYMBOL_TO_CODE[c.symbol] = code

// Fraction-digit suffix: 2 → ".00", 0 → "".
function _dec(n) {
  return n > 0 ? '.' + '0'.repeat(n) : ''
}
// Count of fraction placeholders after the decimal point in a z-code.
function _decCount(z) {
  const m = z.match(/\.(0+)/)
  return m ? m[1].length : 0
}
// True only for a '%' that actually scales — i.e. outside quotes and not
// backslash-escaped. A literal `"%"` or `\%` is just a character.
function _hasActivePercent(z) {
  let inQuote = false
  for (let i = 0; i < z.length; i++) {
    const c = z[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"') {
      inQuote = !inQuote
      continue
    }
    if (c === '%' && !inQuote) return true
  }
  return false
}
function _invert(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]))
}

// Our format string → Excel z-code (or null for General / no format).
export function numFmtToZ(fmt) {
  if (!fmt) return null
  const s = String(fmt)
  if (s.startsWith('custom:')) return s.slice(7) || null
  const { type, variant, decimals } = parseNumberFmt(s)
  if (type === 'text') return '@'
  if (type === 'number') return '#,##0' + _dec(decimals ?? 0)
  if (type === 'percentage') return '0' + _dec(decimals ?? 2) + '%'
  if (type === 'currency') {
    const cfg = CURRENCIES[variant] || CURRENCIES.USD
    return `"${cfg.symbol}"#,##0` + _dec(decimals ?? cfg.defaultDecimals)
  }
  if (type === 'date') return DATE_Z[variant] || DATE_Z.ymd
  if (type === 'time') return TIME_Z[variant] || TIME_Z.hm
  if (type === 'datetime') {
    const [dv, tv] = String(variant || '').split('_')
    return `${DATE_Z[dv] || DATE_Z.ymd} ${TIME_Z[tv] || TIME_Z.hm}`
  }
  return null
}

// Excel z-code → our format string (best-effort; unknown codes preserved as
// `custom:` so a re-export reproduces them exactly).
export function zToNumFmt(z) {
  if (!z || z === 'General') return ''
  const t = z.trim()
  if (t === '@') return 'text'
  if (Z_DATE[t]) return 'date:' + Z_DATE[t]
  if (Z_TIME[t]) return 'time:' + Z_TIME[t]
  // datetime = a known date code + space + known time code
  const sp = t.indexOf(' ')
  if (sp > 0 && Z_DATE[t.slice(0, sp)] && Z_TIME[t.slice(sp + 1)]) {
    return `datetime:${Z_DATE[t.slice(0, sp)]}_${Z_TIME[t.slice(sp + 1)]}`
  }
  if (_hasActivePercent(t)) return _withDec('percentage', _decCount(t))
  const cur = t.match(/^"([^"]+)"#,##0/) // capture the WHOLE symbol (C$, A$, …)
  if (cur && SYMBOL_TO_CODE[cur[1]]) return `currency:${SYMBOL_TO_CODE[cur[1]]}:${_decCount(t)}`
  if (/^#,##0(\.0+)?$/.test(t)) return _withDec('number', _decCount(t))
  return 'custom:' + z // preserve verbatim
}

// Reattach a decimals suffix only when non-zero, so `number`/`percentage`
// (whose defaults differ) stay minimal and round-trip.
function _withDec(type, dec) {
  if (type === 'percentage') return dec === 2 ? 'percentage' : `percentage:${dec}`
  return dec === 0 ? 'number' : `number:${dec}`
}

// ── Cell mapping ─────────────────────────────────────────────────────────────

const DATE_TYPES = new Set(['date', 'time', 'datetime'])

// Is `v` a value that should export as an Excel number (not text)? Rejects ''
// and whitespace, and leading-zero / plus-sign strings that must stay text.
function _isNumeric(v) {
  if (typeof v === 'number') return isFinite(v)
  if (typeof v !== 'string' || v.trim() === '') return false
  return isFinite(Number(v)) && !/^[+0]\d/.test(v.trim())
}

// Parse loosely into a Date for date-typed export. Anchored to UTC so the
// serial SheetJS writes and reads back (with cellDates:true) doesn't drift by a
// timezone offset — a local-midnight Date would lose up to a full day on
// round-trip in any non-UTC zone.
function _toDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v
  const s = String(v).trim()
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m)
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)))
  const d = new Date(s)
  return isNaN(d) ? null : d
}

function _iso(d) {
  // Read UTC components to match _toDate's UTC anchoring — stable across zones.
  const p = (n) => String(n).padStart(2, '0')
  const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  if (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) {
    return `${base} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  }
  return base
}

/**
 * Build a SheetJS cell from the engine's raw value, its computed display value
 * (for formula cells), and the cell's format string. Returns null for an empty
 * non-formula cell (nothing to write).
 */
export function toXlsxCell(raw, computed, fmt) {
  const isFormula = typeof raw === 'string' && raw.startsWith('=')
  const src = isFormula ? computed : raw
  if (!isFormula && (src === '' || src == null)) return null

  const z = numFmtToZ(fmt)
  const cell = {}
  if (isFormula) cell.f = raw.slice(1)

  const { type } = parseNumberFmt(fmt || '')
  const asDate = DATE_TYPES.has(type) ? _toDate(src) : null
  if (asDate) {
    cell.t = 'd'
    cell.v = asDate
  } else if (src === true || src === false || src === 'TRUE' || src === 'FALSE') {
    cell.t = 'b'
    cell.v = src === true || src === 'TRUE'
  } else if (_isNumeric(src) && type !== 'text') {
    cell.t = 'n'
    cell.v = Number(src)
  } else {
    cell.t = 's'
    cell.v = src == null ? '' : String(src)
  }
  // A value that fell back to text under a numeric format (e.g. "007", kept as
  // text to preserve the leading zero) is genuinely text — don't stamp it with
  // a numeric format code Excel ignores and our renderer would mis-apply (→ 7).
  const numericFmt = type === 'number' || type === 'currency' || type === 'percentage'
  if (z && !(cell.t === 's' && numericFmt)) cell.z = z
  return cell
}

/**
 * Convert a parsed SheetJS cell back into the engine's { value, fmt } shape.
 * `value` is the raw string the engine stores (formulas keep their leading '=').
 */
export function fromXlsxCell(cell) {
  if (!cell) return { value: '', fmt: '' }
  const fmt = cell.z ? zToNumFmt(cell.z) : ''
  let value
  if (cell.f != null && cell.f !== '') value = '=' + cell.f
  else if (cell.t === 'd' && cell.v instanceof Date) value = _iso(cell.v)
  else if (cell.t === 'b') value = cell.v ? 'TRUE' : 'FALSE'
  else if (cell.v == null) value = ''
  else value = String(cell.v)
  return { value, fmt }
}

// ── Merge mapping ────────────────────────────────────────────────────────────

// engine masterMap ({ id: { r, c, rowSpan, colSpan } }) → SheetJS !merges.
export function mergesToXlsx(masterMap) {
  return Object.values(masterMap || {}).map(({ r, c, rowSpan, colSpan }) => ({
    s: { r, c },
    e: { r: r + rowSpan - 1, c: c + colSpan - 1 },
  }))
}

// SheetJS !merges → [{ r0, c0, r1, c1 }] for the merge engine's merge().
export function mergesFromXlsx(merges) {
  return (merges || []).map(({ s, e }) => ({ r0: s.r, c0: s.c, r1: e.r, c1: e.c }))
}
