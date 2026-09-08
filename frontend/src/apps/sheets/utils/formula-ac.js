export const AC_FUNS = {
  ABS:'(number)', AND:'(logical1, ...)', AVERAGE:'(number1, ...)',
  AVERAGEIF:'(range, criteria, [avg_range])', CEILING:'(number, significance)',
  CHOOSE:'(index, value1, ...)', COLUMN:'([reference])', COLUMNS:'(array)',
  CONCAT:'(text1, ...)', CONCATENATE:'(text1, ...)',
  COUNT:'(value1, ...)', COUNTA:'(value1, ...)', COUNTBLANK:'(range)',
  COUNTIF:'(range, criteria)', COUNTIFS:'(range1, criteria1, ...)',
  DATE:'(year, month, day)', DAY:'(date)', EXP:'(number)',
  FALSE:'()', FIND:'(find_text, within_text, [start])',
  FLOOR:'(number, significance)', HLOOKUP:'(value, table, row, [range])',
  HOUR:'(time)', IF:'(test, value_if_true, [value_if_false])',
  IFERROR:'(value, value_if_error)', IFS:'(condition1, value1, ...)',
  INDEX:'(array, row, [col])', INDIRECT:'(ref_text)',
  INT:'(number)', ISBLANK:'(value)', ISERROR:'(value)',
  ISNUMBER:'(value)', ISTEXT:'(value)',
  LARGE:'(array, k)', LEFT:'(text, [num_chars])',
  LEN:'(text)', LN:'(number)', LOG:'(number, [base])',
  LOWER:'(text)', MATCH:'(value, array, [type])',
  MAX:'(number1, ...)', MID:'(text, start, num_chars)',
  MIN:'(number1, ...)', MINUTE:'(time)', MOD:'(number, divisor)',
  MONTH:'(date)', NOT:'(logical)', NOW:'()',
  OR:'(logical1, ...)', PI:'()', POWER:'(base, exponent)',
  PRODUCT:'(number1, ...)', PROPER:'(text)',
  RAND:'()', RANDBETWEEN:'(bottom, top)', RANK:'(number, ref, [order])',
  REPLACE:'(text, start, num_chars, new_text)', REPT:'(text, times)',
  RIGHT:'(text, [num_chars])', ROUND:'(number, digits)',
  ROUNDDOWN:'(number, digits)', ROUNDUP:'(number, digits)',
  ROW:'([reference])', ROWS:'(array)',
  SEARCH:'(find_text, within_text, [start])',
  SMALL:'(array, k)', SQRT:'(number)',
  SUBSTITUTE:'(text, old, new, [instance])',
  SUM:'(number1, ...)', SUMIF:'(range, criteria, [sum_range])',
  SUMIFS:'(sum_range, range1, criteria1, ...)',
  TEXT:'(value, format_text)', TEXTJOIN:'(delimiter, ignore_empty, text1, ...)',
  TIME:'(hour, minute, second)', TODAY:'()', TRIM:'(text)', TRUE:'()',
  UPPER:'(text)', VALUE:'(text)',
  VLOOKUP:'(value, table, col_index, [range_lookup])',
  XLOOKUP:'(lookup, lookup_array, return_array, [if_not_found], [match_mode])',
  WEEKDAY:'(date, [return_type])', YEAR:'(date)',
  SPARKLINE:'(data_range, [type], [color])',
}

// Pre-sorted for O(1) reuse in autocomplete filtering.
export const AC_FUN_KEYS = Object.keys(AC_FUNS).sort()

/**
 * Returns { tok, tokStart } for the identifier token being typed before `cursor`,
 * or null if the value is not a formula or there is no token at the cursor.
 * @param {string} value
 * @param {number} cursor
 * @returns {{ tok: string, tokStart: number } | null}
 */
export function parseAcToken(value, cursor) {
  if (!value || !value.startsWith('=')) return null
  const before = value.slice(0, cursor)
  const m = before.match(/(?:[=(+\-*/&^,])([A-Za-z][A-Za-z0-9_]*)$|^=([A-Za-z][A-Za-z0-9_]*)$/)
  if (!m) return null
  const tok = m[1] || m[2]
  return { tok, tokStart: cursor - tok.length }
}

/**
 * Given a formula and caret, find the innermost function call the caret sits
 * inside and which argument is being typed. Used to show parameter help once
 * the user has passed the opening paren (where {@link parseAcToken} stops).
 * Respects string literals and nested calls.
 * @returns {{ fn: string, argIndex: number } | null}
 */
export function parseSignatureContext(value, cursor) {
  if (!value || !value.startsWith('=')) return null
  const s = value.slice(0, cursor)
  const stack = []
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) { if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '(') {
      const name = s.slice(0, i).match(/([A-Za-z][A-Za-z0-9_]*)$/)
      stack.push(name ? { fn: name[1].toUpperCase(), argIndex: 0 } : null)
    }
    else if (ch === ')') stack.pop()
    else if (ch === ',' && stack.length && stack[stack.length - 1]) stack[stack.length - 1].argIndex++
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] && AC_FUNS[stack[i].fn]) return stack[i]
  }
  return null
}

// Functions where an adjacent numeric run is a sensible first-argument guess.
// Kept narrow so we never nudge a range into e.g. IF( or CONCAT(.
const RANGE_SUGGEST_FUNS = new Set([
  'SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN', 'PRODUCT', 'MEDIAN',
])

/**
 * True when the caret sits at the empty first argument of a range-friendly
 * function — the spot where Google Sheets offers an adjacent-range guess.
 * Requires the arg to be empty on both sides so `=SUM(A1)` never re-suggests.
 */
export function shouldSuggestRange(value, cursor) {
  const ctx = parseSignatureContext(value, cursor)
  if (!ctx || ctx.argIndex !== 0 || !RANGE_SUGGEST_FUNS.has(ctx.fn)) return false
  const left = value.slice(0, cursor).replace(/\s+$/, '')
  if (!left.endsWith('(')) return false
  const right = value.slice(cursor).replace(/^\s+/, '')
  return right === '' || right.startsWith(')') || right.startsWith(',')
}

/**
 * True when a display string reads as a number (tolerating currency symbols,
 * thousands separators, percent and surrounding space) — used to decide which
 * cells belong to a suggested range.
 */
export function isNumericText(v) {
  if (v == null) return false
  const stripped = String(v).replace(/[$€£₹%,\s]/g, '')
  return stripped !== '' && Number.isFinite(Number(stripped))
}

/**
 * Walk up (then left) from the active cell over a contiguous run of numeric
 * cells — the adjacency Google Sheets guesses for SUM-style ranges.
 * `isNumericAt(r, c)` reports whether that cell holds a number. Returns
 * { r0, c0, r1, c1 } or null when no run of >= 2 cells abuts the cell.
 */
export function detectAdjacentRange(r, c, isNumericAt) {
  if (r - 1 >= 0 && isNumericAt(r - 1, c)) {
    let top = r - 1
    while (top - 1 >= 0 && isNumericAt(top - 1, c)) top--
    if (r - top >= 2) return { r0: top, c0: c, r1: r - 1, c1: c }
  }
  if (c - 1 >= 0 && isNumericAt(r, c - 1)) {
    let left = c - 1
    while (left - 1 >= 0 && isNumericAt(r, left - 1)) left--
    if (c - left >= 2) return { r0: r, c0: left, r1: r, c1: c - 1 }
  }
  return null
}

/**
 * Split a function's signature into its parameter names and mark which one is
 * active for the given argument index. The trailing variadic param (`...`)
 * stays active for any overflow index.
 * @returns {{ params: string[], active: number } | null}
 */
export function describeSignature(fn, argIndex) {
  const sig = AC_FUNS[fn]
  if (!sig) return null
  const inner = sig.slice(1, -1).trim()          // strip the wrapping parens
  if (!inner) return { params: [], active: -1 }
  const params = inner.split(',').map(p => p.trim())
  // A trailing `...` marks the previous param as repeating, so overflow args
  // (and the `...` token itself) keep that repeating param highlighted.
  const repeat = params[params.length - 1] === '...' ? params.length - 2 : -1
  let active
  if (repeat >= 0 && argIndex >= repeat) active = repeat
  else if (argIndex < params.length) active = argIndex
  else active = -1
  return { params, active }
}
