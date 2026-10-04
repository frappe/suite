// Shared fixture grid + both engine adapters + result normalisation.
//
// The point of this file: give the Sheets engine and the oracle (HyperFormula)
// the *exact same* backing grid, evaluate the same formula string through each,
// and reduce both results to a canonical shape so they can be compared without
// false diffs from float noise or differing error spellings.

import HF from 'hyperformula'

import { evaluate } from '../formula.js'

const { HyperFormula } = HF

// ── The fixture grid ─────────────────────────────────────────────────────────
// Columns A..E, rows 1..10. Deliberately mixes: positives, negatives, zero,
// blanks (''), text, and a decimal — so range functions hit every awkward case.
// `null` = genuinely empty cell.
export const GRID = [
  //  A      B      C      D       E
  [1, 10, -1, 2.5, 'apple'], // row 1
  [2, null, null, 0, 'banana'], // row 2
  [3, 30, -5, -2.5, 'apple'], // row 3
  [4, null, 7, 100, ''], // row 4
  [5, 50, 0, -0.5, 'cherry'], // row 5
  [-6, 60, 12, 1000, 'apple'], // row 6
  ['x', 70, -3, 3.14159, 'date'], // row 7  (A7 is text on purpose)
  [8, null, 4, -1000, ''], // row 8
  [9, 90, -9, 0.001, 'banana'], // row 9
  [10, 100, 100, -12345, 'apple'], // row 10
]

const COLS = 5
const colIdx = (l) => {
  let n = 0
  for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}
const colLbl = (i) => {
  let s = '',
    n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Map "A1" style id -> grid value ('' for blank, matching Sheets' own resolver).
function cellAt(id) {
  const m = String(id).match(/^([A-Z]+)(\d+)$/)
  if (!m) return ''
  const c = colIdx(m[1]),
    r = parseInt(m[2], 10) - 1
  if (r < 0 || r >= GRID.length || c < 0 || c >= COLS) return ''
  const v = GRID[r][c]
  return v === null || v === undefined ? '' : v
}

// ── Sheets engine adapter ────────────────────────────────────────────────────
const getCellValue = (id) => cellAt(id)
const getRangeValues = (a, b) => {
  const m1 = String(a).match(/^([A-Z]+)(\d+)$/),
    m2 = String(b).match(/^([A-Z]+)(\d+)$/)
  if (!m1 || !m2) return []
  const c1 = colIdx(m1[1]),
    r1 = +m1[2],
    c2 = colIdx(m2[1]),
    r2 = +m2[2]
  const rows = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    const row = []
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) row.push(cellAt(colLbl(c) + r))
    rows.push(row)
  }
  return rows
}
export function sheetsEval(formula) {
  try {
    return evaluate(
      formula.replace(/^=/, ''),
      getCellValue,
      getRangeValues,
      () => '',
      () => [],
      () => null,
    )
  } catch (e) {
    return { __throw: e.message }
  }
}

// ── HyperFormula (oracle) adapter ────────────────────────────────────────────
// Blanks must be null for HF; text stays text; numbers stay numbers.
const hfArray = GRID.map((row) => row.map((v) => (v === '' || v === null ? null : v)))
const hf = HyperFormula.buildFromArray(hfArray, { licenseKey: 'gpl-v3' })
const SCRATCH = { sheet: 0, col: COLS + 2, row: 0 } // a cell outside the data region

export function oracleEval(formula) {
  try {
    hf.setCellContents(SCRATCH, [[formula.startsWith('=') ? formula : '=' + formula]])
    const v = hf.getCellValue(SCRATCH)
    return v && typeof v === 'object' && 'value' in v ? v.value : v
  } catch (e) {
    return { __throw: e.message }
  }
}

// ── Normalisation + comparison ───────────────────────────────────────────────
const isErrTok = (v) => typeof v === 'string' && /^#.+[!?]$/.test(v)

// Reduce a raw engine result to: {kind:'num'|'err'|'text'|'bool'|'blank'|'throw', v}
export function canon(raw) {
  if (raw && typeof raw === 'object' && '__throw' in raw) return { kind: 'throw', v: raw.__throw }
  if (raw === null || raw === undefined || raw === '') return { kind: 'blank', v: '' }
  if (typeof raw === 'boolean') return { kind: 'bool', v: raw }
  if (isErrTok(raw)) return { kind: 'err', v: raw }
  if (typeof raw === 'number') return { kind: 'num', v: raw }
  // numeric string?
  if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw)))
    return { kind: 'num', v: Number(raw) }
  return { kind: 'text', v: String(raw) }
}

// Compare two canon()'d results. Returns { match, reason }.
export function compare(a, b, eps = 1e-9) {
  const ca = canon(a),
    cb = canon(b)
  // Both errors: we count as a match on the *class* (both refuse), even if the
  // specific error code differs — that is a far smaller problem than a silent
  // wrong number, and we track code-mismatches separately in the report.
  if (ca.kind === 'err' && cb.kind === 'err') {
    return { match: true, reason: ca.v === cb.v ? 'err-exact' : 'err-code-diff', ca, cb }
  }
  if (ca.kind !== cb.kind) return { match: false, reason: `kind ${ca.kind}!=${cb.kind}`, ca, cb }
  if (ca.kind === 'num') {
    const d = Math.abs(ca.v - cb.v)
    const rel = d / Math.max(1, Math.abs(ca.v), Math.abs(cb.v))
    return { match: rel <= eps, reason: rel <= eps ? 'num-eq' : 'num-diff', ca, cb }
  }
  if (ca.kind === 'bool') return { match: ca.v === cb.v, reason: 'bool', ca, cb }
  if (ca.kind === 'text') return { match: ca.v === cb.v, reason: 'text', ca, cb }
  if (ca.kind === 'blank') return { match: true, reason: 'blank', ca, cb }
  if (ca.kind === 'throw') return { match: false, reason: 'both-throw', ca, cb }
  return { match: false, reason: 'unknown', ca, cb }
}
