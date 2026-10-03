import { describe, expect, it } from 'vitest'

import { deleteMap, insertMap, moveMap, remapRefs } from './ref-remap.js'

// Convenience: apply a col map to a formula on 'Sheet1' as its own sheet.
const R = (formula, mapCol, opts = {}) =>
  remapRefs(formula, { sheetOfFormula: 'Sheet1', opSheet: 'Sheet1', mapCol, ...opts })

describe('index-map builders', () => {
  const apply = (fn, n) => Array.from({ length: n }, (_, i) => fn(i))

  it('moveMap moves a single column left', () => {
    // [A,B,C,D,E] move D(3)→before B(1) ⇒ [A,D,B,C,E]
    expect(apply(moveMap(3, 1, 1), 5)).toEqual([0, 2, 3, 1, 4])
  })

  it('moveMap moves a single column right', () => {
    // move B(1)→before E(4) ⇒ [A,C,D,B,E]
    expect(apply(moveMap(1, 4, 1), 5)).toEqual([0, 3, 1, 2, 4])
  })

  it('moveMap moves a multi-column block', () => {
    // move [B,C](1,2)→before E(4) ⇒ [A,D,B,C,E]
    expect(apply(moveMap(1, 4, 2), 5)).toEqual([0, 2, 3, 1, 4])
  })

  it('moveMap to the far right', () => {
    // move B(1)→end(5) ⇒ [A,C,D,E,B]
    expect(apply(moveMap(1, 5, 1), 5)).toEqual([0, 4, 1, 2, 3])
  })

  it('moveMap is identity when dropped in place', () => {
    expect(apply(moveMap(3, 3, 1), 5)).toEqual([0, 1, 2, 3, 4])
    expect(apply(moveMap(3, 4, 1), 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('insertMap shifts everything at/after the insert point', () => {
    expect(apply(insertMap(2, 1), 5)).toEqual([0, 1, 3, 4, 5])
    expect(apply(insertMap(2, 3), 5)).toEqual([0, 1, 5, 6, 7])
  })

  it('deleteMap drops the range and shifts the rest down', () => {
    expect(apply(deleteMap(2, 1), 5)).toEqual([0, 1, null, 2, 3])
    expect(apply(deleteMap(1, 2), 5)).toEqual([0, null, null, 1, 2])
  })
})

describe('remapRefs — relative refs follow a column move', () => {
  // move D(3)→before B(1): col map B→C, C→D, D→B
  const m = moveMap(3, 1, 1)

  it('rewrites a single cell ref that moved', () => {
    expect(R('=D1', m)).toBe('=B1')
  })

  it('rewrites cells that shifted to make room', () => {
    expect(R('=B1', m)).toBe('=C1')
    expect(R('=C1', m)).toBe('=D1')
  })

  it('leaves unaffected columns alone', () => {
    expect(R('=A1', m)).toBe('=A1')
    expect(R('=E1', m)).toBe('=E1')
  })

  it('rewrites every ref in an expression', () => {
    expect(R('=B1+C1+D1', m)).toBe('=C1+D1+B1')
  })

  it('preserves row numbers', () => {
    expect(R('=D42', m)).toBe('=B42')
  })
})

describe('remapRefs — ranges', () => {
  it('remaps both endpoints and re-normalises order', () => {
    // move D→before B; SUM(B1:D3): B→C, D→B ⇒ endpoints {C,B} normalise to B1:C3
    expect(R('=SUM(B1:D3)', moveMap(3, 1, 1))).toBe('=SUM(B1:D3)')
  })

  it('shifts a range that sits entirely after an insert', () => {
    expect(R('=SUM(C1:C9)', insertMap(1, 1))).toBe('=SUM(D1:D9)')
  })

  it('handles whole-column ranges', () => {
    expect(R('=SUM(B:B)', insertMap(0, 1))).toBe('=SUM(C:C)')
  })
})

describe('remapRefs — insert / delete parity', () => {
  it('insert column shifts refs at/after the insert point', () => {
    expect(R('=B1', insertMap(1, 1))).toBe('=C1')
    expect(R('=A1', insertMap(1, 1))).toBe('=A1')
  })

  it('delete column collapses a ref to #REF!', () => {
    expect(R('=B1', deleteMap(1, 1))).toBe('=#REF!')
  })

  it('delete shifts refs after the deleted column down', () => {
    expect(R('=C1', deleteMap(1, 1))).toBe('=B1')
  })

  it('delete clamps a range whose endpoint was removed', () => {
    // delete C: SUM(B1:C3) ⇒ endpoint C gone, clamp to B ⇒ B1:B3
    expect(R('=SUM(B1:C3)', deleteMap(2, 1))).toBe('=SUM(B1:B3)')
  })
})

describe('remapRefs — sheet scoping', () => {
  const m = insertMap(1, 1) // insert col at B on the op sheet

  it('rewrites bare refs only when the formula lives on the op sheet', () => {
    expect(remapRefs('=B1', { sheetOfFormula: 'Sheet1', opSheet: 'Sheet1', mapCol: m })).toBe('=C1')
    expect(remapRefs('=B1', { sheetOfFormula: 'Sheet2', opSheet: 'Sheet1', mapCol: m })).toBe('=B1')
  })

  it('rewrites qualified refs that point at the op sheet, from any sheet', () => {
    expect(
      remapRefs('=Sheet1!B1', { sheetOfFormula: 'Sheet2', opSheet: 'Sheet1', mapCol: m }),
    ).toBe('=Sheet1!C1')
  })

  it('leaves qualified refs to other sheets untouched', () => {
    expect(
      remapRefs('=Sheet2!B1', { sheetOfFormula: 'Sheet1', opSheet: 'Sheet1', mapCol: m }),
    ).toBe('=Sheet2!B1')
  })

  it('matches sheet names case-insensitively', () => {
    expect(
      remapRefs('=sheet1!B1', { sheetOfFormula: 'Sheet2', opSheet: 'Sheet1', mapCol: m }),
    ).toBe('=sheet1!C1')
  })

  it('handles quoted sheet names', () => {
    expect(
      remapRefs("='My Sheet'!B1", { sheetOfFormula: 'Sheet2', opSheet: 'My Sheet', mapCol: m }),
    ).toBe("='My Sheet'!C1")
  })
})

describe('remapRefs — anchors and multi-letter columns', () => {
  it('preserves $ anchors while remapping the column/row', () => {
    expect(R('=$D$1', moveMap(3, 1, 1))).toBe('=$B$1')
    expect(R('=D$1', moveMap(3, 1, 1))).toBe('=B$1')
    expect(R('=$D1', moveMap(3, 1, 1))).toBe('=$B1')
  })

  it('remaps multi-letter columns', () => {
    // insert one col at A: Z(25)→AA(26), AA(26)→AB(27)
    expect(R('=Z1', insertMap(0, 1))).toBe('=AA1')
    expect(R('=AA1', insertMap(0, 1))).toBe('=AB1')
  })
})

describe('remapRefs — leaves non-refs alone', () => {
  const m = insertMap(0, 1)

  it('ignores function names that look like refs', () => {
    expect(R('=LOG10(A1)', m)).toBe('=LOG10(B1)')
  })

  it('ignores bare column-only tokens (named ranges)', () => {
    expect(R('=Revenue', m)).toBe('=Revenue')
    expect(R('=SUM(Revenue)', m)).toBe('=SUM(Revenue)')
  })

  it('ignores string literals', () => {
    expect(R('="A1 is a cell"', m)).toBe('="A1 is a cell"')
  })

  it('returns non-formula input unchanged', () => {
    expect(R('B1', m)).toBe('B1')
    expect(R('', m)).toBe('')
    expect(R(42, m)).toBe(42)
  })
})
