// Correctness gate for the rebuilt engine (engine2.js). Oracle-free: every
// expected value is the hand-verified Excel / Google Sheets answer, so this runs
// in plain `vitest` with no external dependency. It locks in the operator bug
// class the old engine got wrong plus a smoke of every ported function family.

import { describe, expect, it } from 'vitest'

import { evaluate2 } from './engine2.js'

// tiny backing grid for ref/range cases
const GRID = {
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5,
  B1: 10,
  B2: '',
  B3: 30,
  B4: '',
  B5: 50,
  C1: -1,
  C2: '',
  C3: -5,
  E1: 'apple',
  E2: 'banana',
  E3: 'apple',
  E4: '',
  E5: 'cherry',
}
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
const at = (id) => (GRID[id] === undefined ? '' : GRID[id])
const range = (a, b) => {
  const m1 = a.match(/([A-Z]+)(\d+)/),
    m2 = b.match(/([A-Z]+)(\d+)/)
  const c1 = colIdx(m1[1]),
    r1 = +m1[2],
    c2 = colIdx(m2[1]),
    r2 = +m2[2]
  const rows = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
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
const ev = (f) => evaluate2(f.replace(/^=/, ''), R)
const near = (v, want) => expect(Math.abs(Number(v) - want)).toBeLessThan(1e-9)

describe('operator precedence / associativity / unary / percent', () => {
  it('^ is left-associative', () => near(ev('=2^3^2'), 64))
  it('unary minus binds tighter than ^ (Excel)', () => near(ev('=-10^2'), 100))
  it('double unary minus', () => near(ev('=--1'), 1))
  it('postfix percent', () => near(ev('=-5%'), -0.05))
  it('percent with multiply', () => near(ev('=-2%*3'), -0.06))
  it('mixed precedence', () => near(ev('=2+3*4'), 14))
})

describe('math functions', () => {
  it('ROUND is half-away-from-zero', () => near(ev('=ROUND(-2.5,0)'), -3))
  it('TRUNC to digits', () => near(ev('=TRUNC(3.14159,2)'), 3.14))
  it('TRUNC negative digits', () => near(ev('=TRUNC(3,-1)'), 0))
  it('MOD sign follows divisor', () => {
    near(ev('=MOD(-3,2)'), 1)
    near(ev('=MOD(1,-5)'), -4)
  })
  it('INT floors toward -inf', () => near(ev('=INT(-2.5)'), -3))
  it('GCD of many', () => near(ev('=GCD(8,12,10)'), 2))
  it('EVEN rounds away from zero', () => near(ev('=EVEN(-1)'), -2))
  it('function names with digits parse (LOG10/ATAN2)', () => {
    near(ev('=LOG10(1000)'), 3)
    near(ev('=ATAN2(1,1)'), Math.PI / 4)
  })
  it('negative base fractional power → #NUM!', () => expect(ev('=(-2)^0.5')).toBe('#NUM!'))
})

describe('type coercion / errors', () => {
  it('text literal into SUM → #VALUE!', () => expect(ev('=SUM("abc",4)')).toBe('#VALUE!'))
  it('text inside a range is ignored, not errored', () => near(ev('=SUM(A1:A3)'), 6))
  it('divide by zero → #DIV/0!', () => expect(ev('=1/0')).toBe('#DIV/0!'))
  it('unknown name → #NAME?', () => expect(ev('=NOSUCHFN1')).toBe('#NAME?'))
  it('malformed formula → #VALUE!, never a throw', () => expect(ev('=SUM(')).toBe('#VALUE!'))
})

describe('ranges / absolute refs', () => {
  it('SUM over $-anchored range', () => near(ev('=SUM($A$1:$A$3)'), 6))
  it('MAX over negatives', () => near(ev('=MAX(C1:C3)'), -1))
  it('AVERAGE ignores blanks', () => near(ev('=AVERAGE(B1:B5)'), 30))
  it('COUNT counts only numbers', () => near(ev('=COUNT(B1:B5)'), 3))
})

describe('logical', () => {
  it('IF', () => expect(ev('=IF(A1>0,"pos","neg")')).toBe('pos'))
  it('AND/OR/NOT', () => {
    expect(ev('=AND(A1>0,A2>0)')).toBe(true)
    expect(ev('=OR(A1>5,A2>5)')).toBe(false)
    expect(ev('=NOT(A1>0)')).toBe(false)
  })
  it('IFERROR traps errors', () => near(ev('=IFERROR(1/0,42)'), 42))
})

describe('stats / criteria', () => {
  it('SUMIF numeric criteria', () => near(ev('=SUMIF(A1:A5,">2")'), 12))
  it('SUMIF text criteria with sum range', () => near(ev('=SUMIF(E1:E5,"apple",A1:A5)'), 4)) // A1+A3
  it('COUNTIF text', () => near(ev('=COUNTIF(E1:E5,"apple")'), 2))
  it('MEDIAN', () => near(ev('=MEDIAN(A1:A5)'), 3))
  it('LARGE / SMALL', () => {
    near(ev('=LARGE(A1:A5,2)'), 4)
    near(ev('=SMALL(A1:A5,2)'), 2)
  })
})

describe('text', () => {
  it('LEN/LEFT/RIGHT/MID', () => {
    near(ev('=LEN("hello")'), 5)
    expect(ev('=LEFT("hello",3)')).toBe('hel')
    expect(ev('=RIGHT("hello",2)')).toBe('lo')
    expect(ev('=MID("hello",2,3)')).toBe('ell')
  })
  it('UPPER/LOWER/TRIM', () => {
    expect(ev('=UPPER("abc")')).toBe('ABC')
    expect(ev('=TRIM("  a  b  ")')).toBe('a b')
  })
  it('CONCATENATE', () => expect(ev('=CONCATENATE("a","b","c")')).toBe('abc'))
})

describe('lookup / reference', () => {
  it('ROW / COLUMN report the address, not the value', () => {
    near(ev('=ROW(B3)'), 3)
    near(ev('=COLUMN(C1)'), 3)
  })
  it('CHOOSE', () => near(ev('=CHOOSE(2,10,20,30)'), 20))
  it('MATCH exact', () => near(ev('=MATCH(30,B1:B5,0)'), 3))
  it('INDEX scalar', () => near(ev('=INDEX(A1:A5,3)'), 3))
  it('VLOOKUP exact', () => near(ev('=VLOOKUP(3,A1:C5,3,FALSE)'), -5))
})
