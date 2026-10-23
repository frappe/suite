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

import { CURRENCIES, displayNumber, parseNumberFmt, type Currency } from '../utils/format-number.js'
import type { MergeInfo } from './merge.js'
import type { Rect } from './types.js'

/** A SheetJS cell as this module writes it (see the field list above). */
export interface XlsxCell {
  t: 'n' | 's' | 'b' | 'd'
  v: number | string | boolean | Date
  f?: string
  z?: string
}

/** A SheetJS cell as read from a file: only the fields fromXlsxCell looks at. */
export interface XlsxCellIn {
  t?: string
  v?: unknown
  f?: string | null | undefined
  z?: string | undefined
}

/** A SheetJS merge: start and end cells, 0-based and inclusive. */
export interface XlsxMerge {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

// ── Number-format mapping ────────────────────────────────────────────────────
//
// Our format strings (`type[:variant][:decimals]`, plus `custom:<pattern>`)
// carry the same intent as Excel `z` codes. These two functions are inverses
// for every format the app can produce; an Excel code we don't recognise is
// preserved verbatim as `custom:<code>` so it round-trips untouched.

// The named key is each table's default, so reading it is never undefined.
const DATE_Z: Record<string, string> & { ymd: string } = {
  dmy: 'dd/mm/yyyy',
  mdy: 'mm/dd/yyyy',
  ymd: 'yyyy-mm-dd',
  long: 'd mmm yyyy',
  full: 'ddd, d mmm yyyy',
}
const TIME_Z: Record<string, string> & { hm: string } = {
  hm: 'hh:mm',
  hms: 'hh:mm:ss',
  hm12: 'h:mm AM/PM',
  hms12: 'h:mm:ss AM/PM',
}
const Z_DATE = _invert(DATE_Z)
const Z_TIME = _invert(TIME_Z)
// First currency wins a shared symbol (¥ is both JPY and CNY) so reverse
// mapping is deterministic — a ¥ cell round-trips as JPY.
const SYMBOL_TO_CODE: Record<string, string> = {}
for (const [code, c] of Object.entries(CURRENCIES))
  if (!(c.symbol in SYMBOL_TO_CODE)) SYMBOL_TO_CODE[c.symbol] = code

// Fraction-digit suffix: 2 → ".00", 0 → "".
function _dec(n: number) {
  return n > 0 ? '.' + '0'.repeat(n) : ''
}
// Count of fraction placeholders after the decimal point in a z-code.
function _decCount(z: string) {
  const m = z.match(/\.(0+)/)
  return m ? (m[1] ?? '').length : 0
}
// True only for a '%' that actually scales — i.e. outside quotes and not
// backslash-escaped. A literal `"%"` or `\%` is just a character.
function _hasActivePercent(z: string) {
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
function _invert(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]))
}

// Our format string → Excel z-code (or null for General / no format).
export function numFmtToZ(fmt: unknown): string | null {
  if (!fmt) return null
  const s = String(fmt)
  if (s.startsWith('custom:')) return s.slice(7) || null
  const { type, variant, decimals } = parseNumberFmt(s)
  if (type === 'text') return '@'
  if (type === 'number') return '#,##0' + _dec(decimals ?? 0)
  if (type === 'percentage') return '0' + _dec(decimals ?? 2) + '%'
  if (type === 'currency') {
    // USD is always in CURRENCIES.
    const cfg = CURRENCIES[variant] || (CURRENCIES.USD as Currency)
    return `"${cfg.symbol}"#,##0` + _dec(decimals ?? cfg.defaultDecimals)
  }
  if (type === 'date') return DATE_Z[variant] || DATE_Z.ymd
  if (type === 'time') return TIME_Z[variant] || TIME_Z.hm
  if (type === 'datetime') {
    // No '_' leaves tv '' (absent from TIME_Z), which falls back to the default.
    const [dv = '', tv = ''] = String(variant || '').split('_')
    return `${DATE_Z[dv] || DATE_Z.ymd} ${TIME_Z[tv] || TIME_Z.hm}`
  }
  return null
}

// Excel z-code → our format string (best-effort; unknown codes preserved as
// `custom:` so a re-export reproduces them exactly).
export function zToNumFmt(z: string | null | undefined): string {
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
  const sym = t.match(/^"([^"]+)"#,##0/)?.[1] // capture the WHOLE symbol (C$, A$, …)
  if (sym && SYMBOL_TO_CODE[sym]) return `currency:${SYMBOL_TO_CODE[sym]}:${_decCount(t)}`
  if (/^#,##0(\.0+)?$/.test(t)) return _withDec('number', _decCount(t))
  return 'custom:' + z // preserve verbatim
}

/**
 * IronCalc's own number format for a cell (what typing `$1.50`, `15%` or
 * `1,000` sets; Excel-style codes) as one of ours, or '' when there is
 * nothing to carry. Copy and fill use it, since a cell's input is its bare
 * number (`1.5`) and would otherwise lose the format. Dates are left out
 * unless asked for (`dates: true`): their input is the typed text, which
 * re-parses to the same date.
 */
export function numFmtFromEngine(
  code: string | null | undefined,
  { dates = false }: { dates?: boolean } = {},
): string {
  if (!code || /^general$/i.test(code) || code === '@') return ''
  // IronCalc writes `$#,##0.00` unquoted; as our USD currency (not a custom
  // pattern) the decimal buttons can change it.
  const fmt = zToNumFmt(/^\$#,##0(\.0+)?$/.test(code) ? `"$"${code.slice(1)}` : code)
  if (DATE_TYPES.has(parseNumberFmt(fmt).type)) return dates ? fmt : ''
  if (dates && /[dy]/i.test(code.replace(/"[^"]*"/g, ''))) {
    // A date code ours has no exact variant for (IronCalc's m/d/yyyy).
    if (/h/i.test(code)) return 'datetime'
    return /^\s*y/i.test(code) ? 'date:ymd' : /^\s*d/i.test(code) ? 'date:dmy' : 'date:mdy'
  }
  // A code zToNumFmt doesn't know stays custom; only a numeric pattern
  // renders (a date code like m/d/yyyy would paint as literal text).
  if (fmt.startsWith('custom:') && !/[0#]/.test(code.replace(/"[^"]*"/g, ''))) return ''
  return fmt
}

// Reattach a decimals suffix only when non-zero, so `number`/`percentage`
// (whose defaults differ) stay minimal and round-trip.
function _withDec(type: 'number' | 'percentage', dec: number) {
  if (type === 'percentage') return dec === 2 ? 'percentage' : `percentage:${dec}`
  return dec === 0 ? 'number' : `number:${dec}`
}

// ── Cell mapping ─────────────────────────────────────────────────────────────

const DATE_TYPES = new Set(['date', 'time', 'datetime'])

// Is `v` a value that should export as an Excel number (not text)? Rejects ''
// and whitespace, and leading-zero / plus-sign strings that must stay text.
function _isNumeric(v: unknown) {
  if (typeof v === 'number') return isFinite(v)
  if (typeof v !== 'string' || v.trim() === '') return false
  return isFinite(Number(v)) && !/^[+0]\d/.test(v.trim())
}

// The day serial (days since 1899-12-30, the fraction the time of day) of a
// calendar date and time. From the parts, not a Date's milliseconds:
// SheetJS converts Date objects in the runner's local time, so a UTC
// midnight went out as 05:30:10 in India (ISSUES #59).
function _serial(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo, d) / 86400000 + 25569 + (h * 3600 + mi * 60 + s) / 86400
}

// Parse loosely into a day serial for date-typed export, or null.
function _toSerial(v: unknown): number | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return _serial(
      v.getUTCFullYear(),
      v.getUTCMonth(),
      v.getUTCDate(),
      v.getUTCHours(),
      v.getUTCMinutes(),
      v.getUTCSeconds(),
    )
  }
  const s = String(v).trim()
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const [y, mo, d, h, mi, sec] = m.slice(1).map((x) => Number(x || 0)) as number[]
    return _serial(y!, mo! - 1, d!, h, mi, sec)
  }
  // Any other text a Date can read ("1 Apr 2026") is local time.
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return _serial(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  )
}

function _iso(d: Date) {
  // Read UTC components to match _toDate's UTC anchoring — stable across zones.
  const p = (n: number) => String(n).padStart(2, '0')
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
export function toXlsxCell(raw: unknown, computed: unknown, fmt: unknown): XlsxCell | null {
  const isFormula = typeof raw === 'string' && raw.startsWith('=')
  let src = isFormula ? computed : raw
  if (!isFormula && (src === '' || src == null)) return null
  // A formula's computed value is IronCalc's display, which it may have
  // formatted ($4.50, 1,000, 50%): the number in it, not the text.
  if (isFormula && !_isNumeric(src) && !isNaN(displayNumber(src))) src = displayNumber(src)

  const z = numFmtToZ(fmt)
  // Filled field by field to keep SheetJS's key order (f, t, v, z); every
  // branch below sets t and v, so the result is a whole XlsxCell.
  const cell: Partial<XlsxCell> = {}
  if (isFormula) cell.f = (raw as string).slice(1)

  const { type } = parseNumberFmt(fmt || '')
  // A number under a date format is a day serial, the same number Excel
  // stores, so it falls through to the number branch with its date code.
  // A date written as text goes out as its serial too.
  const asDate = DATE_TYPES.has(type) && !_isNumeric(src) ? _toSerial(src) : null
  if (asDate != null) {
    cell.t = 'n'
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
  return cell as XlsxCell
}

/**
 * Convert a parsed SheetJS cell back into the engine's { value, fmt } shape.
 * `value` is the raw string the engine stores (formulas keep their leading '=').
 */
export function fromXlsxCell(cell: XlsxCellIn | null | undefined): { value: string; fmt: string } {
  if (!cell) return { value: '', fmt: '' }
  let fmt = cell.z ? zToNumFmt(cell.z) : ''
  // A date code ours has no exact variant for (m/d/yyyy) would paint as
  // literal text under custom:, so take the nearest date format.
  if (fmt.startsWith('custom:')) fmt = numFmtFromEngine(cell.z, { dates: true }) || fmt
  const isDate = parseNumberFmt(fmt).type === 'date'
  let value: string
  if (cell.f != null && cell.f !== '') value = '=' + cell.f
  else if (cell.t === 'd' && cell.v instanceof Date) value = _iso(cell.v)
  // A whole day serial under a date code is typed as the date, which
  // IronCalc reads as a date (ISSUES #58: SheetJS's cellDates turned it into
  // the day before at 18:29:50, as text). A time of day stays the serial.
  else if (isDate && typeof cell.v === 'number' && Number.isInteger(cell.v))
    value = _iso(new Date((cell.v - 25569) * 86400000))
  else if (cell.t === 'b') value = cell.v ? 'TRUE' : 'FALSE'
  else if (cell.v == null) value = ''
  else value = String(cell.v)
  return { value, fmt }
}

// ── Merge mapping ────────────────────────────────────────────────────────────

// engine masterMap ({ id: { r, c, rowSpan, colSpan } }) → SheetJS !merges.
export function mergesToXlsx(masterMap: Record<string, MergeInfo> | null | undefined): XlsxMerge[] {
  return Object.values(masterMap || {}).map(({ r, c, rowSpan, colSpan }) => ({
    s: { r, c },
    e: { r: r + rowSpan - 1, c: c + colSpan - 1 },
  }))
}

// SheetJS !merges → [{ r0, c0, r1, c1 }] for the merge engine's merge().
export function mergesFromXlsx(merges: XlsxMerge[] | null | undefined): Rect[] {
  return (merges || []).map(({ s, e }) => ({ r0: s.r, c0: s.c, r1: e.r, c1: e.c }))
}
