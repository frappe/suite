// Head-to-head: OLD engine (formula.js) vs NEW engine (engine2.mjs), both scored
// against the HyperFormula oracle over the SAME corpus. This is the money shot:
// does a real grammar move the agreement number, and does it kill the operator
// bug class outright?

import { evaluate2 } from '../engine2.js'
import { CURATED, genFormula, rng } from './corpus.js'
import { compare, GRID, oracleEval, sheetsEval } from './grid.js'

const N = parseInt(process.argv[2] || '5000', 10)
const SEED = parseInt(process.argv[3] || '12345', 10)

// ── engine2 needs the same grid resolvers grid.mjs uses internally ────────────
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
const cellAt = (id) => {
  const m = String(id).match(/^([A-Z]+)(\d+)$/)
  if (!m) return ''
  const c = colIdx(m[1]),
    r = parseInt(m[2], 10) - 1
  if (r < 0 || r >= GRID.length || c < 0 || c >= COLS) return ''
  const v = GRID[r][c]
  return v === null || v === undefined ? '' : v
}
const rangeAt = (a, b) => {
  const m1 = String(a).match(/^([A-Z]+)(\d+)$/),
    m2 = String(b).match(/^([A-Z]+)(\d+)$/)
  if (!m1 || !m2) return []
  const c1 = colIdx(m1[1]),
    r1 = +m1[2],
    c2 = colIdx(m2[1]),
    r2 = +m2[2]
  const rows = []
  const rEnd = Math.min(Math.max(r1, r2), 100000) // guard whole-column
  for (let r = Math.min(r1, r2); r <= rEnd; r++) {
    const row = []
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) row.push(cellAt(colLbl(c) + r))
    rows.push(row)
  }
  return rows
}
const resolvers = {
  getCell: cellAt,
  getRange: rangeAt,
  getSheetCell: () => '',
  getSheetRange: () => [],
  resolveName: () => null,
}
const newEval = (f) => {
  try {
    return evaluate2(f.replace(/^=/, ''), resolvers)
  } catch (e) {
    return { __throw: e.message }
  }
}

// ── Curated three-way ─────────────────────────────────────────────────────────
const fmt = (v) => (v && typeof v === 'object' && '__throw' in v ? `THROW` : JSON.stringify(v))
console.log('\n' + '═'.repeat(74))
console.log(' OLD vs NEW engine — curated cases (oracle + known-Excel adjudication)')
console.log('═'.repeat(74))
let oldRight = 0,
  newRight = 0,
  scored = 0
for (const { f, excel } of CURATED) {
  if (excel === null || excel === undefined) continue
  scored++
  const o = sheetsEval(f),
    nw = newEval(f)
  const oOk = compare(o, excel).match,
    nOk = compare(nw, excel).match
  if (oOk) oldRight++
  if (nOk) newRight++
  const mark = (ok) => (ok ? '✓' : '✗')
  console.log(
    `  ${f.padEnd(24)} excel=${String(excel).padEnd(9)} old=${fmt(o).padEnd(10)}${mark(oOk)}  new=${fmt(nw).padEnd(10)}${mark(nOk)}`,
  )
}
console.log(`\n  known-Excel correctness:  OLD ${oldRight}/${scored}   NEW ${newRight}/${scored}`)

// ── Random pass, both engines vs oracle ───────────────────────────────────────
const r = rng(SEED)
let ran = 0,
  oldAgree = 0,
  newAgree = 0
const newWins = [],
  newLoses = []
const seen = new Set()
while (ran < N) {
  const f = genFormula(r)
  if (seen.has(f)) continue
  seen.add(f)
  const oracle = oracleEval(f)
  const o = sheetsEval(f),
    nw = newEval(f)
  const oOk = compare(o, oracle).match,
    nOk = compare(nw, oracle).match
  ran++
  if (oOk) oldAgree++
  if (nOk) newAgree++
  if (nOk && !oOk && newWins.length < 12) newWins.push({ f, o, nw, oracle })
  if (oOk && !nOk && newLoses.length < 12) newLoses.push({ f, o, nw, oracle })
}

console.log('\n' + '═'.repeat(74))
console.log(` Random pass — ${ran} formulas, seed ${SEED}, oracle=HyperFormula`)
console.log('═'.repeat(74))
console.log(
  `   OLD engine agreement:  ${((100 * oldAgree) / ran).toFixed(2)}%  (${oldAgree}/${ran})`,
)
console.log(
  `   NEW engine agreement:  ${((100 * newAgree) / ran).toFixed(2)}%  (${newAgree}/${ran})`,
)
console.log(`   net change:            ${((100 * (newAgree - oldAgree)) / ran).toFixed(2)} pts`)

console.log('\n   NEW fixes (new agrees, old diverged):')
for (const w of newWins)
  console.log(
    `     ${w.f.padEnd(30)} old=${JSON.stringify(w.o)}  new=${JSON.stringify(w.nw)}  oracle=${JSON.stringify(w.oracle)}`,
  )
if (newLoses.length) {
  console.log('\n   NEW regressions (old agreed, new diverged) — must investigate:')
  for (const w of newLoses)
    console.log(
      `     ${w.f.padEnd(30)} old=${JSON.stringify(w.o)}  new=${JSON.stringify(w.nw)}  oracle=${JSON.stringify(w.oracle)}`,
    )
} else {
  console.log('\n   NEW regressions: none in this corpus ✅')
}
console.log('')
