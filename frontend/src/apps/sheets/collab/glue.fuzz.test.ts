// Convergence: three tabs make random edits, syncing at random moments, then
// sync fully (test-fuzz.ts). Every tab must end with the same inputs, the
// same shown values, the same side stores and the same sheets.
//
// Runs a few seeds by default; SHEETS_FUZZ=<n> runs n seeds.

/// <reference types="node" />

import { describe, it } from 'vitest'

import { runFuzz } from './test-fuzz'

const SEEDS = Number(process.env.SHEETS_FUZZ ?? 3)
// SHEETS_FUZZ_SEED=<n> replays one seed.
const ONLY = Number(process.env.SHEETS_FUZZ_SEED ?? 0)

describe('fuzz: three tabs converge', () => {
  it(`${ONLY ? `seed ${ONLY}` : `${SEEDS} random runs`}`, { timeout: 600_000 }, async () => {
    if (ONLY) return runFuzz(ONLY, 30)
    for (let seed = 1; seed <= SEEDS; seed++) await runFuzz(seed, 30)
  })
})
