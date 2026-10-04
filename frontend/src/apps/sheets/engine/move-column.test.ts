import { describe, expect, it } from 'vitest'

import { deleteMap, insertMap, moveMap } from './ref-remap.js'
import { createSheet } from './sheet.js'

// End-to-end through the real evaluation engine: a formula must produce the
// SAME result after a structural op, because both the data and the references
// move together.

describe('sheet.remapCols — formulas survive a column move', () => {
  it('keeps a dependent formula correct after moving a column', () => {
    const s = createSheet()
    s.setCell('A1', '1')
    s.setCell('B1', '2')
    s.setCell('C1', '3')
    s.setCell('D1', '10')
    s.setCell('E1', '=B1+C1+D1')
    expect(s.getCellValue('E1')).toBe(15)

    // Move D (index 3) to before B (index 1): [A,B,C,D] → [A,D,B,C]
    s.remapCols(moveMap(3, 1, 1))

    // Data followed: D's 10 now sits at B, old B/C shifted right.
    expect(s.getCell('B1')).toBe('10')
    expect(s.getCell('C1')).toBe('2')
    expect(s.getCell('D1')).toBe('3')
    // Formula rewritten and still 15.
    expect(s.getCell('E1')).toBe('=C1+D1+B1')
    expect(s.getCellValue('E1')).toBe(15)
  })

  it('rewrites cross-sheet references into the moved sheet', () => {
    const s = createSheet()
    s.addSheet('Sheet2')
    s.setCell('D1', '10', 'Sheet1')
    s.switchSheet('Sheet2')
    s.setCell('A1', '=Sheet1!D1')
    expect(s.getCellValue('A1')).toBe(10)

    s.remapCols(moveMap(3, 1, 1), 'Sheet1') // op on Sheet1, formula on Sheet2

    expect(s.getCell('A1', 'Sheet2')).toBe('=Sheet1!B1')
    expect(s.getCellValue('A1', 'Sheet2')).toBe(10)
  })

  it('insert via remapCols shifts references (parity retrofit)', () => {
    const s = createSheet()
    s.setCell('B1', '5')
    s.setCell('C1', '=B1*2')
    expect(s.getCellValue('C1')).toBe(10)

    s.remapCols(insertMap(0, 1)) // insert a column at A

    expect(s.getCell('C1')).toBe('5') // B → C
    expect(s.getCellValue('D1')).toBe(10)
    expect(s.getCell('D1')).toBe('=C1*2') // formula followed
  })

  it('delete via remapCols collapses references to #REF!', () => {
    const s = createSheet()
    s.setCell('B1', '5')
    s.setCell('C1', '=B1*2')
    expect(s.getCellValue('C1')).toBe(10)

    s.remapCols(deleteMap(1, 1)) // delete column B

    // B is gone; C shifted to B and its ref to the deleted column is #REF!.
    expect(s.getCell('B1')).toBe('=#REF!*2')
  })
})
