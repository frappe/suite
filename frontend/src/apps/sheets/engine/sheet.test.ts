import { beforeEach, describe, expect, it } from 'vitest'

import { createSheet } from './sheet.js'

describe('row / column shifting', () => {
  let sheet
  beforeEach(() => {
    sheet = createSheet()
  })

  function column() {
    // Materialise column A as { row(1-indexed): value } for terse assertions.
    const data = sheet.getRawData()
    const out = {}
    for (const id in data) {
      const m = id.match(/^A(\d+)$/)
      if (m) out[m[1]] = data[id]?.value ?? data[id]
    }
    return out
  }

  it('deleteRow keeps every row below the deleted one (regression)', () => {
    // Deleting a single row used to destroy all rows below it: _shiftCells
    // moved rows up in descending order, so each cell landed on a slot a
    // not-yet-processed cell still held, and the next delete wiped it.
    ;['r1', 'r2', 'r3', 'r4', 'r5'].forEach((v, i) => sheet.setCell('A' + (i + 1), v))
    sheet.deleteRow(1) // remove row 2 (r2), rest shift up
    expect(column()).toEqual({ 1: 'r1', 2: 'r3', 3: 'r4', 4: 'r5' })
  })

  it('deleteRow rewrites formula-bearing cells without loss', () => {
    sheet.setCell('A1', '10')
    sheet.setCell('A2', '20')
    sheet.setCell('A3', '=A1+A2') // 30
    sheet.setCell('A4', 'tail')
    sheet.deleteRow(1) // drop A2; A3→A2, A4→A3
    expect(column()).toEqual({ 1: '10', 2: '=A1+A2', 3: 'tail' })
  })

  it('insertRow still pushes rows down without loss', () => {
    ;['r1', 'r2', 'r3'].forEach((v, i) => sheet.setCell('A' + (i + 1), v))
    sheet.insertRow(1) // open a gap at row 2
    expect(column()).toEqual({ 1: 'r1', 3: 'r2', 4: 'r3' })
  })
})
