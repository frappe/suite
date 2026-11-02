import { describe, expect, it } from 'vitest'

import { draftOutcome, needsServerCheck } from './draftOutcome'

const served = 'M2'

describe('what a load does with the draft it found', () => {
  it.each([
    ['no draft', null, false, false, 'discard', false],
    [
      'clean, on the served version',
      { dirty: false, baseModified: 'M2' },
      false,
      false,
      'discard',
      false,
    ],
    [
      'clean, on an older version',
      { dirty: false, baseModified: 'M1' },
      false,
      false,
      'discard',
      false,
    ],
    [
      'clean, past the served version',
      { dirty: false, baseModified: 'M3' },
      false,
      false,
      'keep',
      false,
    ],
    [
      'dirty, on the served version',
      { dirty: true, baseModified: 'M2' },
      false,
      false,
      'restore',
      false,
    ],
    [
      'dirty, past the served version',
      { dirty: true, baseModified: 'M3' },
      false,
      false,
      'keep',
      false,
    ],
    [
      'dirty, older base, no answer',
      { dirty: true, baseModified: 'M1' },
      false,
      false,
      'keep',
      true,
    ],
    [
      'dirty, older base, server answered',
      { dirty: true, baseModified: 'M1' },
      false,
      true,
      'discard',
      true,
    ],
    [
      'dirty, older base, already landed',
      { dirty: true, baseModified: 'M1' },
      true,
      false,
      'discard',
      false,
    ],
    ['dirty, no base', { dirty: true }, false, false, 'discard', false],
  ])('%s', (_case, local, hasLanded, hasAnswered, outcome, isAsking) => {
    expect(draftOutcome(local, served, hasLanded, hasAnswered)).toBe(outcome)
    expect(Boolean(needsServerCheck(local, served, hasLanded))).toBe(isAsking)
  })
})
