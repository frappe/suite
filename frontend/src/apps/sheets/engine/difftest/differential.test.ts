// Differential smoke gate. Runs a seeded batch of random formulas through the
// new engine and the HyperFormula oracle and asserts (a) the new engine beats
// the old one and (b) it clears an agreement floor. It is SEEDED, so it is
// deterministic, not flaky.
//
// The oracle is a devDependency; if it can't be loaded (e.g. a minimal CI image)
// the suite skips rather than fails — the oracle-free gates (engine2.test.js,
// sheet2.test.js) still hold the line. For the full exploratory report and the
// per-bucket divergence analysis, run `npm run test:diff`.

import { beforeAll, describe, expect, it } from 'vitest'

let mod = null
try {
  const grid = await import('./grid.js') // imports 'hyperformula'
  const corpus = await import('./corpus.js')
  const { evaluate2 } = await import('../engine2.js')
  mod = { ...grid, ...corpus, evaluate2 }
} catch {
  mod = null
}

const d = mod ? describe : describe.skip

d('differential vs HyperFormula (seeded, oracle = devDependency)', () => {
  const N = 1500
  const SEED = 12345
  // The residual divergence is dominated by the oracle's OWN bugs (MOD/INT
  // truncate toward zero; the new engine floors like Excel). We therefore hold
  // the new engine to a floor and, more importantly, require it to beat the old.
  const FLOOR = 0.95

  let evalNew
  beforeAll(() => {
    const { evaluate2, GRID } = mod
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
    const at = (id) => {
      const m = String(id).match(/^([A-Z]+)(\d+)$/)
      if (!m) return ''
      const c = colIdx(m[1]),
        r = +m[2] - 1
      if (r < 0 || r >= GRID.length || c < 0 || c >= 5) return ''
      const v = GRID[r][c]
      return v == null ? '' : v
    }
    const range = (a, b) => {
      const m1 = String(a).match(/^([A-Z]+)(\d+)$/),
        m2 = String(b).match(/^([A-Z]+)(\d+)$/)
      if (!m1 || !m2) return []
      const c1 = colIdx(m1[1]),
        r1 = +m1[2],
        c2 = colIdx(m2[1]),
        r2 = +m2[2]
      const rows = []
      const rE = Math.min(Math.max(r1, r2), 100000)
      for (let r = Math.min(r1, r2); r <= rE; r++) {
        const row = []
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) row.push(at(colLbl(c) + r))
        rows.push(row)
      }
      return rows
    }
    const R = {
      getCell: at,
      getRange: range,
      getSheetCell: () => '',
      getSheetRange: () => [],
      resolveName: () => null,
    }
    evalNew = (f) => {
      try {
        return evaluate2(f.replace(/^=/, ''), R)
      } catch (e) {
        return { __throw: e.message }
      }
    }
  })

  it(`new engine beats old and clears the ${FLOOR * 100}% floor over ${N} seeded formulas`, () => {
    const { sheetsEval, oracleEval, compare, rng, genFormula } = mod
    const r = rng(SEED)
    const seen = new Set()
    let ran = 0,
      oldOk = 0,
      newOk = 0
    while (ran < N) {
      const f = genFormula(r)
      if (seen.has(f)) continue
      seen.add(f)
      const oracle = oracleEval(f)
      ran++
      if (compare(sheetsEval(f), oracle).match) oldOk++
      if (compare(evalNew(f), oracle).match) newOk++
    }
    const newRate = newOk / ran,
      oldRate = oldOk / ran
    // eslint-disable-next-line no-console
    console.log(
      `  differential: old ${(oldRate * 100).toFixed(2)}%  new ${(newRate * 100).toFixed(2)}%  (${ran} formulas)`,
    )
    expect(newRate).toBeGreaterThan(oldRate)
    expect(newRate).toBeGreaterThanOrEqual(FLOOR)
  })
})
