import { describe, expect, it } from 'vitest'

import { shrinkRangesForDelete } from './delete-ranges.js'

// Deleting rows 1..1 of Sheet1, from a formula on Sheet1, unless a test says otherwise.
const rows = (formula, at = 1, count = 1, more = {}) =>
  shrinkRangesForDelete(formula, {
    formulaSheet: 'Sheet1',
    sheet: 'Sheet1',
    axis: 'row',
    at,
    count,
    ...more,
  })
const cols = (formula, at = 1, count = 1) =>
  shrinkRangesForDelete(formula, {
    formulaSheet: 'Sheet1',
    sheet: 'Sheet1',
    axis: 'col',
    at,
    count,
  })

describe('shrinkRangesForDelete — rows', () => {
  it('moves a deleted first row to the first row left', () => {
    expect(rows('=SUM(A1:A10)')).toBe('=SUM(A2:A10)')
    expect(rows('=SUM(A3:A10)', 2, 3)).toBe('=SUM(A5:A10)')
  })

  it('moves a deleted last row to the row before the deletion', () => {
    expect(rows('=SUM(A1:A10)', 10)).toBe('=SUM(A1:A9)')
    expect(rows('=SUM(A1:A10)', 9, 3)).toBe('=SUM(A1:A8)')
  })

  it('leaves ranges the deletion is inside, misses, or swallows whole', () => {
    expect(rows('=SUM(A1:A10)', 5, 2)).toBe('=SUM(A1:A10)')
    expect(rows('=SUM(A1:A10)', 11)).toBe('=SUM(A1:A10)')
    expect(rows('=SUM(A2:A3)', 2, 2)).toBe('=SUM(A2:A3)')
  })

  it('keeps $ markers and multi-column ranges', () => {
    expect(rows('=SUM($A$1:$A$10)')).toBe('=SUM($A$2:$A$10)')
    expect(rows('=SUM(A$1:C10)')).toBe('=SUM(A$2:C10)')
  })

  it('handles whole-row ranges and leaves whole-column ranges alone', () => {
    expect(rows('=SUM(1:3)')).toBe('=SUM(2:3)')
    expect(rows('=SUM($1:$3)', 3)).toBe('=SUM($1:$2)')
    expect(rows('=SUM(A:A)')).toBe('=SUM(A:A)')
  })

  it('handles a range written bottom-up', () => {
    expect(rows('=SUM(A10:A1)')).toBe('=SUM(A10:A2)')
  })

  it('fixes every range in the formula, and nothing inside strings', () => {
    expect(rows('=SUM(A1:A10)+AVERAGE(B1:B4)&"A1:A3"')).toBe('=SUM(A2:A10)+AVERAGE(B2:B4)&"A1:A3"')
    expect(rows('="say ""A1:A2"""&COUNT(A1:A2)')).toBe('="say ""A1:A2"""&COUNT(A2:A2)')
  })

  it('only touches ranges on the sheet that loses the rows', () => {
    const fromSheet1 = { formulaSheet: 'Sheet1', sheet: 'Data' }
    expect(rows('=SUM(Data!A1:A10)+SUM(A1:A10)', 1, 1, fromSheet1)).toBe(
      '=SUM(Data!A2:A10)+SUM(A1:A10)',
    )
    expect(rows("=SUM('My data'!A1:A10)", 1, 1, { sheet: 'My data' })).toBe(
      "=SUM('My data'!A2:A10)",
    )
    expect(rows("=SUM('it''s'!A1:A3)", 1, 1, { sheet: "it's" })).toBe("=SUM('it''s'!A2:A3)")
    expect(rows('=SUM(Sheet1!A1:A3)', 1, 1, { formulaSheet: 'Other' })).toBe('=SUM(Sheet1!A2:A3)')
    expect(rows('=SUM(sheet1!A1:A3)', 1, 1, { formulaSheet: 'Other' })).toBe('=SUM(sheet1!A2:A3)')
    expect(rows('=SUM(A1:A3)', 1, 1, { formulaSheet: 'Other' })).toBe('=SUM(A1:A3)')
    // A sheet name with letters outside A–Z is still a sheet name.
    expect(rows('=SUM(Été!A1:A3)')).toBe('=SUM(Été!A1:A3)')
    expect(rows('=SUM(Été!A1:A3)', 1, 1, { sheet: 'Été' })).toBe('=SUM(Été!A2:A3)')
    // IronCalc keeps a digit-led name unquoted.
    expect(rows('=SUM(2024!A1:A3)')).toBe('=SUM(2024!A1:A3)')
    expect(rows('=SUM(2024!A1:A3)', 1, 1, { sheet: '2024' })).toBe('=SUM(2024!A2:A3)')
  })

  it('does not read function names or single cells as ranges', () => {
    expect(rows('=LOG10(A1)+A1')).toBe('=LOG10(A1)+A1')
    expect(rows('=A1+A2')).toBe('=A1+A2')
  })
})

describe('shrinkRangesForDelete — columns', () => {
  it('moves deleted range ends to the columns left', () => {
    expect(cols('=SUM(A1:C1)')).toBe('=SUM(B1:C1)')
    expect(cols('=SUM(A1:C1)', 3)).toBe('=SUM(A1:B1)')
    expect(cols('=SUM($Z$1:$AB$2)', 26, 2)).toBe('=SUM($AB$1:$AB$2)')
    expect(cols('=SUM(Y1:AA1)', 27)).toBe('=SUM(Y1:Z1)')
  })

  it('handles whole-column ranges and leaves whole-row ranges alone', () => {
    expect(cols('=SUM(A:C)')).toBe('=SUM(B:C)')
    expect(cols('=SUM(1:3)')).toBe('=SUM(1:3)')
  })

  it('leaves a fully deleted range to IronCalc', () => {
    expect(cols('=SUM(B1:C1)', 2, 2)).toBe('=SUM(B1:C1)')
  })
})
