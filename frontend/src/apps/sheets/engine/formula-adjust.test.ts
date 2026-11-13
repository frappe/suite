import { describe, expect, it } from 'vitest'

import { adjustFormula } from './formula-adjust.js'

describe('adjustFormula — in-bounds shifts', () => {
  it('shifts relative refs down and right by several cells', () => {
    expect(adjustFormula('=A1+B2', 3, 2)).toBe('=C4+D5')
  })

  it('shifts relative refs up and left while they stay on the sheet', () => {
    expect(adjustFormula('=D5*2', -4, -3)).toBe('=A1*2')
  })

  it('keeps the anchored part of mixed refs', () => {
    expect(adjustFormula('=$A1+A$1', 2, 3)).toBe('=$A3+D$1')
  })

  it('leaves absolute refs alone', () => {
    expect(adjustFormula('=$A$1', 5, 5)).toBe('=$A$1')
    expect(adjustFormula('=$A$1', -5, -5)).toBe('=$A$1')
  })

  it('shifts both ends of a range', () => {
    expect(adjustFormula('=SUM(A1:B3)', 2, 1)).toBe('=SUM(B3:C5)')
  })

  it('shifts cross-sheet refs and keeps the sheet name', () => {
    expect(adjustFormula('=Sheet2!A1', 1, 1)).toBe('=Sheet2!B2')
    expect(adjustFormula("='My Sheet'!B2:C3", -1, -1)).toBe("='My Sheet'!A1:B2")
  })

  it('does not treat a function name like LOG10 as a reference', () => {
    expect(adjustFormula('=LOG10(A20)', -15, 0)).toBe('=LOG10(A5)')
  })
})

describe('adjustFormula — refs that move off the sheet become #REF! (ISSUES #151)', () => {
  it('a range with an end above row 1 becomes #REF!', () => {
    // A6 =SUM(A1:A5) pasted into H2.
    expect(adjustFormula('=SUM(A1:A5)', -4, 7)).toBe('=SUM(#REF!)')
  })

  it('a single ref above row 1 becomes #REF!', () => {
    // I5 =I1*3 pasted into I2.
    expect(adjustFormula('=I1*3', -3, 0)).toBe('=#REF!*3')
  })

  it('a ref left of column A becomes #REF!', () => {
    // B1 =A1 pasted into A1.
    expect(adjustFormula('=A1', 0, -1)).toBe('=#REF!')
  })

  it('only the ref that leaves the sheet changes', () => {
    expect(adjustFormula('=A1+A5', -2, 0)).toBe('=#REF!+A3')
  })

  it('mixed refs go off the sheet only along their relative axis', () => {
    expect(adjustFormula('=$A2', -2, 0)).toBe('=#REF!')
    expect(adjustFormula('=$A2', 0, -5)).toBe('=$A2')
    expect(adjustFormula('=A$1', -5, 0)).toBe('=A$1')
    expect(adjustFormula('=B$1', 0, -2)).toBe('=#REF!')
  })

  it('a cross-sheet ref off the sheet becomes #REF!', () => {
    expect(adjustFormula('=Sheet2!A1+1', -1, 0)).toBe('=#REF!+1')
    expect(adjustFormula("=SUM('My Sheet'!A1:B2)", 0, -1)).toBe('=SUM(#REF!)')
  })

  it('keeps the old behaviour when asked to (cut-paste, sort)', () => {
    expect(adjustFormula('=SUM(A1:A5)', -4, 7, { keepOffSheet: true })).toBe('=SUM(A1:H1)')
    expect(adjustFormula('=I1*3', -3, 0, { keepOffSheet: true })).toBe('=I1*3')
  })
})
