// Whether a typed formula is one date minus another: =A2-A1, =TODAY()-A1,
// =DATE(2025,12,19)-A1. IronCalc gives the result the date format (units.rs),
// so ten days between two dates showed as 1900-01-09; Google Sheets shows 10.
// The worker clears the format for these. A date plus or minus a number
// (=A1-7) stays a date, as everywhere.

import { getTokens } from '@ironcalc/wasm'

import type { NumFmtAt } from './percent-format.js'

// Functions whose result is a date.
const DATE_FUNCTIONS = new Set(['TODAY', 'NOW', 'DATE', 'DATEVALUE', 'EDATE', 'EOMONTH', 'WORKDAY'])

/** Whether an Excel-style num_fmt shows a date (a d or y outside quotes). */
export function isDateFormat(fmt: string): boolean {
  return /[dy]/i.test(fmt.replace(/"[^"]*"/g, '').replace(/\\./g, '')) && !/general/i.test(fmt)
}

type Token = unknown

export function isDateDifference(formula: string, numFmtAt: NumFmtAt): boolean {
  if (!formula.startsWith('=')) return false
  let tokens: Token[]
  try {
    tokens = getTokens(formula.slice(1)).map((t) => t.token)
  } catch {
    return false
  }
  // Split on the one minus outside any parentheses.
  let depth = 0
  let at = -1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'LeftParenthesis') depth++
    else if (t === 'RightParenthesis') depth--
    else if (depth === 0 && _kind(t)[0] !== 'Reference' && _kind(t)[0] !== 'Ident') {
      if (_isMinus(t) && i > 0 && at === -1) at = i
      else return false
    }
  }
  if (at === -1) return false
  return _isDate(tokens.slice(0, at), numFmtAt) && _isDate(tokens.slice(at + 1), numFmtAt)
}

// A date cell, or a call to a date function.
function _isDate(side: Token[], numFmtAt: NumFmtAt): boolean {
  const [kind, value] = _kind(side[0])
  if (side.length === 1 && kind === 'Reference') {
    const ref = value as { sheet?: string; row: number; column: number }
    return isDateFormat(numFmtAt(ref.sheet ?? null, ref.row, ref.column))
  }
  return (
    kind === 'Ident' &&
    DATE_FUNCTIONS.has(String(value).toUpperCase()) &&
    side[1] === 'LeftParenthesis' &&
    side[side.length - 1] === 'RightParenthesis'
  )
}

function _kind(t: Token): [string?, unknown?] {
  return t && typeof t === 'object' ? (Object.entries(t)[0] ?? []) : []
}

function _isMinus(t: Token): boolean {
  const [kind, value] = _kind(t)
  return (kind === 'Addition' || kind === 'Sum') && value === 'Minus'
}
