// Undo under fire: the glue fuzz (test-fuzz.ts), where a third of the turns
// are an undo or redo instead of an edit. Undo writes into the doc like any
// edit, so the same checks hold: each tab's IronCalc matches its doc after
// every step, and all tabs converge.
//
// Runs a few seeds by default; SHEETS_FUZZ=<n> runs n seeds.

/// <reference types="node" />

import { describe, it } from 'vitest'

import { runFuzz } from './test-fuzz'
import type { Tab } from './test-tabs'
import { createUndo, type Undo } from './undo'

const SEEDS = Number(process.env.SHEETS_FUZZ ?? 3)
// SHEETS_FUZZ_SEED=<n> replays one seed.
const ONLY = Number(process.env.SHEETS_FUZZ_SEED ?? 0)

async function run(seed: number) {
  const undos = new Map<Tab, Undo>()
  await runFuzz(seed, 40, {
    setup: (t) => undos.set(t, createUndo({ doc: t.doc, glue: t.glue })),
    async act(t, r) {
      if (r.next() >= 0.33) return false
      const u = undos.get(t)!
      await (r.int(3) ? u.undo() : u.redo())
      return true
    },
  })
}

describe('fuzz: three tabs converge with undo and redo', () => {
  it(`${ONLY ? `seed ${ONLY}` : `${SEEDS} random runs`}`, { timeout: 600_000 }, async () => {
    if (ONLY) return run(ONLY)
    for (let seed = 1; seed <= SEEDS; seed++) await run(seed)
  })
})
