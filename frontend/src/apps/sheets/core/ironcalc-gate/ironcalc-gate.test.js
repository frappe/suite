// IronCalc upgrade gate. IronCalc (@ironcalc/wasm) is the calculation core
// per ADR 0001 (docs/adr/0001-sheets-ironcalc-calculation-core.md). This
// gate holds it to:
//
//   - curated known-Excel cases: 15/16 (the single miss is the Google-Sheets
//     AVERAGE convention, not a defect),
//   - a seeded random corpus of 2000 formulas, whose answers are recorded
//     from IronCalc 0.8.4 in the snapshot beside this file. An upgrade that
//     changes any answer fails here; review the diff, then update the
//     snapshot (vitest -u) if the new answer is right.
//
// The corpus used to be compared with the old engine (formula.js), measured
// in docs/sheets-ironcalc/IRONCALC-REPORT.md; that engine is gone, so the
// baseline is IronCalc's own answers. The corpus is SEEDED (mulberry32,
// seed 12345), so runs are deterministic, not flaky.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync, Model } from '@ironcalc/wasm'
import { beforeAll, describe, expect, it } from 'vitest'

import { CURATED, genFormula, rng } from './corpus.js'

// ── Fixture grid + canon/compare ─────────────────────────────────────────────
const GRID = [
  //  A      B      C      D       E
  [1, 10, -1, 2.5, 'apple'],
  [2, null, null, 0, 'banana'],
  [3, 30, -5, -2.5, 'apple'],
  [4, null, 7, 100, ''],
  [5, 50, 0, -0.5, 'cherry'],
  [-6, 60, 12, 1000, 'apple'],
  ['x', 70, -3, 3.14159, 'date'],
  [8, null, 4, -1000, ''],
  [9, 90, -9, 0.001, 'banana'],
  [10, 100, 100, -12345, 'apple'],
]
const COLS = 5
const isErrTok = (v) => typeof v === 'string' && /^#.+[!?]$/.test(v)
function canon(raw) {
  if (raw && typeof raw === 'object' && '__throw' in raw) return { kind: 'throw', v: raw.__throw }
  if (raw === null || raw === undefined || raw === '') return { kind: 'blank', v: '' }
  if (typeof raw === 'boolean') return { kind: 'bool', v: raw }
  if (isErrTok(raw)) return { kind: 'err', v: raw }
  if (typeof raw === 'number') return { kind: 'num', v: raw }
  if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw)))
    return { kind: 'num', v: Number(raw) }
  return { kind: 'text', v: String(raw) }
}
function compare(a, b, eps = 1e-9) {
  const ca = canon(a),
    cb = canon(b)
  // Both errors: match on the class even if the code differs (a silent wrong
  // number is the failure mode this harness exists to catch).
  if (ca.kind === 'err' && cb.kind === 'err') {
    return { match: true, reason: ca.v === cb.v ? 'err-exact' : 'err-code-diff' }
  }
  if (ca.kind !== cb.kind) return { match: false, reason: `kind ${ca.kind}!=${cb.kind}` }
  if (ca.kind === 'num') {
    const d = Math.abs(ca.v - cb.v)
    const rel = d / Math.max(1, Math.abs(ca.v), Math.abs(cb.v))
    return { match: rel <= eps, reason: rel <= eps ? 'num-eq' : 'num-diff' }
  }
  if (ca.kind === 'bool') return { match: ca.v === cb.v, reason: 'bool' }
  if (ca.kind === 'text') return { match: ca.v === cb.v, reason: 'text' }
  if (ca.kind === 'blank') return { match: true, reason: 'blank' }
  return { match: false, reason: ca.kind === 'throw' ? 'both-throw' : 'unknown' }
}

// ── IronCalc adapter ─────────────────────────────────────────────────────────
// One Model carries the fixture; each formula is written to scratch cell H1
// and read back. IronCalc exposes no raw-value getter in wasm.d.ts
// (getCellContent returns the input string), so the adapter reads
// getFormattedCellValue + getCellType (probed codes: 1 number, 2 text,
// 4 logical, 16 error). The default "general" format rounds to ~6-10
// significant digits and would break the 1e-9 epsilon, so the scratch cell
// carries the num_fmt '0.###############E+000': 16 significant digits, and a
// 3-digit exponent mask because the 2-digit mask mangles |exp| >= 100.
let ironEval
beforeAll(() => {
  const req = createRequire(import.meta.url)
  const wasmPath = req.resolve('@ironcalc/wasm').replace(/wasm\.js$/, 'wasm_bg.wasm')
  initSync({ module: fs.readFileSync(wasmPath) })
  const model = new Model('wb', 'en', 'UTC', 'en')
  for (let r = 0; r < GRID.length; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = GRID[r][c]
      if (v === null || v === '') continue
      model.setUserInput(0, r + 1, c + 1, String(v))
    }
  }
  const SCRATCH_ROW = 1,
    SCRATCH_COL = 8 // H1, outside the data region
  const st = model.getCellStyle(0, SCRATCH_ROW, SCRATCH_COL).style
  st.num_fmt = '0.###############E+000'
  model.setSelectedSheet(0)
  model.setSelectedCell(SCRATCH_ROW, SCRATCH_COL)
  model.onPasteStyles([[st]])
  ironEval = (f) => {
    try {
      model.setUserInput(0, SCRATCH_ROW, SCRATCH_COL, f.startsWith('=') ? f : '=' + f)
      const t = model.getCellType(0, SCRATCH_ROW, SCRATCH_COL)
      const s = model.getFormattedCellValue(0, SCRATCH_ROW, SCRATCH_COL)
      if (t === 16) return s // error token, e.g. "#VALUE!"
      if (t === 4) return s === 'TRUE' // logical
      if (t === 1) return Number(s) // formatted number -> numeric
      if (s === '') return '' // blank
      return s // text
    } catch (e) {
      return { __throw: e.message }
    }
  }
})

describe('IronCalc upgrade gate (seeded, always on)', () => {
  const N = 2000
  const SEED = 12345
  // From IRONCALC-REPORT.md: curated 15/16.
  const CURATED_FLOOR = 15

  it(`matches at least ${CURATED_FLOOR}/16 curated Excel-verified answers`, () => {
    let scored = 0,
      right = 0
    const misses = []
    for (const { f, excel } of CURATED) {
      if (excel === null || excel === undefined) continue
      scored++
      if (compare(ironEval(f), excel).match) right++
      else misses.push(f)
    }
    // eslint-disable-next-line no-console
    console.log(`  ironcalc curated: ${right}/${scored}  misses: ${misses.join(', ') || 'none'}`)
    expect(scored).toBe(16)
    expect(right).toBeGreaterThanOrEqual(CURATED_FLOOR)
  })

  it(`gives the recorded answers on ${N} seeded random formulas`, () => {
    const r = rng(SEED)
    const seen = new Set()
    const answers = []
    while (answers.length < N) {
      const f = genFormula(r)
      if (seen.has(f)) continue
      seen.add(f)
      const { kind, v } = canon(ironEval(f))
      answers.push(`${f}  →  ${kind} ${typeof v === 'number' ? v.toPrecision(12) : v}`)
    }
    expect(answers.join('\n')).toMatchSnapshot()
  })
})
