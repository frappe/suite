// Number-format grammar + renderer.
//
// Format string: `type[:variant][:decimals]`
//   currency           → currency, default USD, 2 decimals
//   currency:INR       → currency, INR, default decimals
//   currency:INR:0     → currency, INR, 0 decimals
//   currency:2         → currency, default variant, 2 decimals  ← legacy two-part form
//   number             → number, default (locale) thousands
//   number:in:0        → number, Indian lakhs grouping, 0 decimals
//   number:3           → number, default variant, 3 decimals    ← legacy
//   date               → date, default (locale)
//   date:dmy           → date, DD/MM/YYYY
//   time:hm12          → 3:30 PM
//   datetime:dmy:hm12  → 15/01/2025, 3:30 PM   (variant carries both halves)
//
// The parser disambiguates legacy two-part `type:N` (decimals-only) from
// new `type:variant` by checking whether the second token is digits-only.
// `type:variant:decimals` keeps both pieces explicit.

export function parseNumberFmt(fmt) {
  if (!fmt) return { type: '', variant: '', decimals: null }
  const parts = String(fmt).split(':')
  const type = parts[0]
  let variant = ''
  let decimals = null
  if (parts.length >= 3) {
    variant = parts[1]
    decimals = parts[2] !== '' ? parseInt(parts[2], 10) : null
  } else if (parts.length === 2) {
    const p = parts[1]
    if (/^-?\d+$/.test(p)) decimals = parseInt(p, 10)
    else variant = p
  }
  if (Number.isNaN(decimals)) decimals = null
  return { type, variant, decimals }
}

export function buildNumberFmt(type, variant, decimals) {
  if (!type) return ''
  const hasV = !!variant
  const hasD = decimals != null
  if (hasV && hasD) return `${type}:${variant}:${decimals}`
  if (hasV)        return `${type}:${variant}`
  if (hasD)        return `${type}:${decimals}`
  return type
}

// Supported currencies. `locale` drives symbol placement, thousand grouping,
// and decimal separator. `defaultDecimals` matters for JPY (whole yen) — the
// rest are 2 by default. Keep this list short on purpose; "More currencies"
// can be a follow-up.
export const CURRENCIES = {
  USD: { symbol: '$',  locale: 'en-US', defaultDecimals: 2 },
  EUR: { symbol: '€',  locale: 'de-DE', defaultDecimals: 2 },
  GBP: { symbol: '£',  locale: 'en-GB', defaultDecimals: 2 },
  INR: { symbol: '₹',  locale: 'en-IN', defaultDecimals: 2 },
  JPY: { symbol: '¥',  locale: 'ja-JP', defaultDecimals: 0 },
  CAD: { symbol: 'C$', locale: 'en-CA', defaultDecimals: 2 },
  AUD: { symbol: 'A$', locale: 'en-AU', defaultDecimals: 2 },
  CNY: { symbol: '¥',  locale: 'zh-CN', defaultDecimals: 2 },
}

// Number variant → locale used by Intl.NumberFormat. 'in' gives the Indian
// lakhs/crores grouping (12,34,56,789). '' means user-default locale.
const NUMBER_LOCALES = {
  '':   undefined,
  'us': 'en-US',
  'in': 'en-IN',
}

// Date variants. Each maps to a (locale, Intl.DateTimeFormat options) pair.
// '' is the legacy behaviour — defer to the user's locale's toLocaleDateString.
// Locales are pinned so the *shape* is stable across machines; users who want
// browser-locale output can stay on the default.
const DATE_FORMATTERS = {
  dmy:  ['en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }],   // 15/01/2025
  mdy:  ['en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }],   // 01/15/2025
  ymd:  ['en-CA', { day: '2-digit', month: '2-digit', year: 'numeric' }],   // 2025-01-15
  long: ['en-GB', { day: 'numeric', month: 'short', year: 'numeric' }],     // 15 Jan 2025
  full: ['en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }], // Mon, 15 Jan 2025
}

// Time variants. `12` suffix flips to 12-hour clock with AM/PM.
const TIME_FORMATTERS = {
  hm:    ['en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }], // 15:30
  hms:   ['en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }], // 15:30:45
  hm12:  ['en-US', { hour: 'numeric', minute: '2-digit', hour12: true }],  // 3:30 PM
  hms12: ['en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }],  // 3:30:45 PM
}

// Intl formatters are *expensive* to construct (~1 ms each on V8) and a
// sheet typically uses only a handful of unique format configurations
// across thousands of cells. Cache instances by a string key so we build
// each formatter once and reuse it on every cell.
const _intlCache = new Map()

function _numFmt(locale, decimals) {
  const key = `n|${locale ?? '_'}|${decimals ?? '_'}`
  let f = _intlCache.get(key)
  if (!f) {
    const opts = decimals == null ? undefined : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
    f = new Intl.NumberFormat(locale, opts)
    _intlCache.set(key, f)
  }
  return f
}

function _curFmt(locale, currency, decimals) {
  const key = `c|${locale}|${currency}|${decimals}`
  let f = _intlCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    _intlCache.set(key, f)
  }
  return f
}

function _dtFmt(locale, opts) {
  // Options are small objects with a stable key set — JSON.stringify is fine
  // (and the cost is paid once per unique format string).
  const key = `d|${locale}|${JSON.stringify(opts)}`
  let f = _intlCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts)
    _intlCache.set(key, f)
  }
  return f
}

function _formatWith(map, variant, d) {
  const cfg = map[variant]
  if (!cfg) return null
  return _dtFmt(cfg[0], cfg[1]).format(d)
}

// Coerce a cell value into a Date for date/time/datetime formatting, or null
// if it isn't a date. Handles three shapes:
//   • a Date instance
//   • a number / bare numeric string → epoch milliseconds (the serial model)
//   • a date string like "2026-03-15 14:50:30.789345" or "2026-03-15"
// For strings we normalise "YYYY-MM-DD HH:mm:ss.ffffff": space→T and trim
// sub-millisecond digits (JS Date only takes 3), and pin a bare date to local
// midnight so an ISO date-only value isn't parsed as UTC and shifted a day.
function _toDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return isNaN(value) ? null : new Date(value)
  const s = String(value).trim()
  if (s === '') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return new Date(parseFloat(s))
  let norm = s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) norm += 'T00:00:00'
  let d = new Date(norm)
  if (isNaN(d.getTime())) d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Types whose value is a date, not a plain number to round/group.
const DATE_LIKE = new Set(['date', 'time', 'datetime'])

export function applyNumberFmt(value, format) {
  if (!format) return value
  const { type, variant, decimals } = parseNumberFmt(format)
  // Text format leaves the value untouched (no numeric coercion at display).
  // Cells flagged 'text' should also be treated as text in formulas; that's
  // handled by the engine's strict-arithmetic — see toNumStrict.
  if (type === 'text') return value == null ? '' : String(value)
  const n = parseFloat(value)
  if (isNaN(n) && !DATE_LIKE.has(type)) return value
  if (type === 'number') {
    const loc = NUMBER_LOCALES[variant] !== undefined ? NUMBER_LOCALES[variant] : undefined
    return _numFmt(loc, decimals).format(n)
  }
  if (type === 'currency') {
    const code = CURRENCIES[variant] ? variant : 'USD'
    const cfg  = CURRENCIES[code]
    const d    = decimals ?? cfg.defaultDecimals
    return _curFmt(cfg.locale, code, d).format(n)
  }
  if (type === 'percentage') return (n * 100).toFixed(decimals ?? 2) + '%'
  if (type === 'date') {
    const d = _toDate(value)
    if (!d) return value
    return _formatWith(DATE_FORMATTERS, variant, d) ?? d.toLocaleDateString()
  }
  if (type === 'time') {
    const d = _toDate(value)
    if (!d) return value
    return _formatWith(TIME_FORMATTERS, variant, d) ?? d.toLocaleTimeString()
  }
  if (type === 'datetime') {
    const d = _toDate(value)
    if (!d) return value
    // Combined variant is `<dateKey>_<timeKey>` (e.g. dmy_hm12). Falls back
    // to the locale's default for either half if a token is missing/unknown.
    const [dv, tv] = String(variant || '').split('_')
    const datePart = _formatWith(DATE_FORMATTERS, dv, d) ?? d.toLocaleDateString()
    const timePart = _formatWith(TIME_FORMATTERS, tv, d) ?? d.toLocaleTimeString()
    return `${datePart}, ${timePart}`
  }
  return value
}
