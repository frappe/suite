import { describe, expect, it } from 'vitest'

import {
  describeSignature,
  detectAdjacentRange,
  isNumericText,
  parseAcToken,
  parseSignatureContext,
  shouldSuggestRange,
} from './formula-ac.js'

describe('parseAcToken', () => {
  it('finds the function name being typed', () => {
    expect(parseAcToken('=SU', 3)).toEqual({ tok: 'SU', tokStart: 1 })
  })
  it('finds a token after an operator', () => {
    expect(parseAcToken('=1+AV', 5)).toEqual({ tok: 'AV', tokStart: 3 })
  })
  it('returns null when the value is not a formula', () => {
    expect(parseAcToken('SUM', 3)).toBeNull()
  })
  it('returns null once inside the parens', () => {
    expect(parseAcToken('=SUM(', 5)).toBeNull()
  })
})

describe('parseSignatureContext', () => {
  it('reports the enclosing function and first argument', () => {
    expect(parseSignatureContext('=VLOOKUP(', 9)).toEqual({ fn: 'VLOOKUP', argIndex: 0 })
  })
  it('counts commas to find the active argument', () => {
    expect(parseSignatureContext('=VLOOKUP(A1, B1:C3, ', 20)).toEqual({
      fn: 'VLOOKUP',
      argIndex: 2,
    })
  })
  it('resolves to the innermost nested call', () => {
    const v = '=IF(SUM(A1,'
    expect(parseSignatureContext(v, v.length)).toEqual({ fn: 'SUM', argIndex: 1 })
  })
  it('pops back to the outer call after a nested call closes', () => {
    const v = '=IF(SUM(A1,A2), '
    expect(parseSignatureContext(v, v.length)).toEqual({ fn: 'IF', argIndex: 1 })
  })
  it('ignores commas inside string literals', () => {
    const v = '=CONCAT("a, b", '
    expect(parseSignatureContext(v, v.length)).toEqual({ fn: 'CONCAT', argIndex: 1 })
  })
  it('returns null when the caret is not inside a known function', () => {
    expect(parseSignatureContext('=A1+', 4)).toBeNull()
  })
})

describe('describeSignature', () => {
  it('marks the active parameter', () => {
    const d = describeSignature('VLOOKUP', 1)
    expect(d.params[d.active]).toBe('table')
  })
  it('keeps the repeating param active past the last index', () => {
    const d = describeSignature('SUM', 3) // SUM(number1, ...)
    expect(d.params[d.active]).toBe('number1')
  })
  it('returns no active param past a fixed arg list', () => {
    const d = describeSignature('ABS', 2)
    expect(d.active).toBe(-1)
  })
  it('returns null for an unknown function', () => {
    expect(describeSignature('NOPE', 0)).toBeNull()
  })
})

describe('isNumericText', () => {
  it('accepts plain, formatted and signed numbers', () => {
    for (const v of ['1', '-5', '3.14', '1,234', '$5', '42%', ' 7 '])
      expect(isNumericText(v)).toBe(true)
  })
  it('rejects blanks and non-numbers', () => {
    for (const v of [null, undefined, '', '   ', 'abc', '=SUM(A1)'])
      expect(isNumericText(v)).toBe(false)
  })
})

describe('shouldSuggestRange', () => {
  it('is true at the empty first arg of a range function', () => {
    expect(shouldSuggestRange('=SUM(', 5)).toBe(true)
    expect(shouldSuggestRange('=AVERAGE(', 9)).toBe(true)
  })
  it('is false once the arg has content', () => {
    expect(shouldSuggestRange('=SUM(A1', 7)).toBe(false)
  })
  it('is true when the caret precedes a closing paren', () => {
    expect(shouldSuggestRange('=SUM()', 5)).toBe(true)
  })
  it('is false past the first argument', () => {
    expect(shouldSuggestRange('=SUM(A1,', 8)).toBe(false)
  })
  it('is false for non-range functions', () => {
    expect(shouldSuggestRange('=IF(', 4)).toBe(false)
    expect(shouldSuggestRange('=CONCAT(', 8)).toBe(false)
  })
})

describe('detectAdjacentRange', () => {
  // Grid of numeric cells keyed "r,c"; everything else is blank.
  const grid = (cells) => (r, c) => cells.has(`${r},${c}`)

  it('walks up a contiguous column above the active cell', () => {
    const numeric = grid(new Set(['0,0', '1,0', '2,0'])) // A1:A3 filled, active A4
    expect(detectAdjacentRange(3, 0, numeric)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 0 })
  })
  it('stops at a blank gap', () => {
    const numeric = grid(new Set(['0,0', '2,0'])) // A2 blank, active A4
    // Only A3 (row 2) abuts A4 → single cell, below the 2-cell floor.
    expect(detectAdjacentRange(3, 0, numeric)).toBeNull()
  })
  it('falls back to the row on the left when nothing is above', () => {
    const numeric = grid(new Set(['3,0', '3,1', '3,2'])) // A4:C4 filled, active D4
    expect(detectAdjacentRange(3, 3, numeric)).toEqual({ r0: 3, c0: 0, r1: 3, c1: 2 })
  })
  it('prefers the column above over the row to the left', () => {
    const numeric = grid(new Set(['1,3', '2,3', '3,0', '3,1', '3,2'])) // above D2:D3, left A4:C4
    expect(detectAdjacentRange(3, 3, numeric)).toEqual({ r0: 1, c0: 3, r1: 2, c1: 3 })
  })
  it('returns null with no adjacent numbers', () => {
    expect(detectAdjacentRange(3, 3, grid(new Set()))).toBeNull()
  })
})
