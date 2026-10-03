// Regression + parity tests for the formula engine.
//
// We don't go through the sheet engine here — `evaluate()` is called directly
// with stub cell/range resolvers so each test stays isolated and fast. The
// helper `evalExpr` mirrors the production call signature: the leading `=`
// is stripped, and a tiny in-memory grid backs cell refs when the test
// supplies one.
//
// Test categories follow Google Sheets' function classification so a missing
// function is easy to spot (gap in a section).

import { describe, expect, it } from 'vitest'

import { evaluate } from './formula.js'

// ── Test harness ──────────────────────────────────────────────────────────────

function _colIdx(label) {
  let n = 0
  for (const c of label) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}
function _colLabel(idx) {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function evalExpr(expr, opts = {}) {
  const cells = opts.cells || {}
  const sheetCells = opts.sheetCells || {}
  const namedRanges = opts.namedRanges || {} // name (upper) → { sheet, start, end }

  const getCellValue = (id) => {
    const raw = cells[id]
    if (typeof raw === 'string' && raw.startsWith('=')) {
      return evalExpr(raw, opts)
    }
    return raw === undefined ? '' : raw
  }

  const getRangeValues = (start, end) => {
    const m1 = String(start).match(/^([A-Z]+)(\d+)$/)
    const m2 = String(end).match(/^([A-Z]+)(\d+)$/)
    if (!m1 || !m2) return []
    const c1 = _colIdx(m1[1]),
      r1 = parseInt(m1[2], 10)
    const c2 = _colIdx(m2[1]),
      r2 = parseInt(m2[2], 10)
    const rows = []
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      const row = []
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const id = _colLabel(c) + r
        row.push(cells[id] === undefined ? '' : cells[id])
      }
      rows.push(row)
    }
    return rows
  }

  const getSheetCellValue = (sheet, id) => sheetCells[sheet]?.[id] ?? ''
  const getSheetRangeValues = (sheet, start, end) => {
    const m1 = String(start).match(/^([A-Z]+)(\d+)$/)
    const m2 = String(end).match(/^([A-Z]+)(\d+)$/)
    if (!m1 || !m2) return []
    const c1 = _colIdx(m1[1]),
      r1 = parseInt(m1[2], 10)
    const c2 = _colIdx(m2[1]),
      r2 = parseInt(m2[2], 10)
    const rows = []
    const sheetData = sheetCells[sheet] || {}
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      const row = []
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const id = _colLabel(c) + r
        row.push(sheetData[id] === undefined ? '' : sheetData[id])
      }
      rows.push(row)
    }
    return rows
  }

  const resolveNamedRange = (name) => namedRanges[String(name).toUpperCase()] || null

  const body = expr.startsWith('=') ? expr.slice(1) : expr
  return evaluate(
    body,
    getCellValue,
    getRangeValues,
    getSheetCellValue,
    getSheetRangeValues,
    resolveNamedRange,
  )
}

// Convenience for numeric assertions with floating-point tolerance.
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// ── Math / Arithmetic ────────────────────────────────────────────────────────

describe('arithmetic operators', () => {
  it('addition', () => expect(evalExpr('=1+2')).toBe(3))
  it('subtraction', () => expect(evalExpr('=10-4')).toBe(6))
  it('multiplication', () => expect(evalExpr('=3*4')).toBe(12))
  it('division', () => expect(evalExpr('=20/4')).toBe(5))
  it('exponent', () => expect(evalExpr('=2^10')).toBe(1024))
  it('modulus via MOD', () => expect(evalExpr('=MOD(10,3)')).toBe(1))
  it('precedence', () => expect(evalExpr('=2+3*4')).toBe(14))
  it('parens override', () => expect(evalExpr('=(2+3)*4')).toBe(20))
  it('unary minus', () => expect(evalExpr('=-5+10')).toBe(5))
  it('divide by zero', () => expect(evalExpr('=1/0')).toBe('#DIV/0!'))
})

describe('SUM and aggregates', () => {
  it('SUM literals', () => expect(evalExpr('=SUM(1,2,3)')).toBe(6))
  it('SUM range', () => expect(evalExpr('=SUM(A1:A3)', { cells: { A1: 1, A2: 2, A3: 3 } })).toBe(6))
  it('SUM skips text', () =>
    expect(evalExpr('=SUM(A1:A3)', { cells: { A1: 1, A2: 'x', A3: 3 } })).toBe(4))
  it('SUM 2D range', () =>
    expect(evalExpr('=SUM(A1:B2)', { cells: { A1: 1, B1: 2, A2: 3, B2: 4 } })).toBe(10))
  it('AVERAGE basic', () => expect(evalExpr('=AVERAGE(1,2,3,4)')).toBe(2.5))
  it('AVERAGE empty', () => expect(evalExpr('=AVERAGE(A1:A3)', { cells: {} })).toBe('#DIV/0!'))
  it('MAX', () => expect(evalExpr('=MAX(1,7,3,5)')).toBe(7))
  it('MIN', () => expect(evalExpr('=MIN(1,7,3,5)')).toBe(1))
  it('COUNT only numbers', () => expect(evalExpr('=COUNT(1,"a",3,"")')).toBe(2))
  it('COUNTA non-empty', () => expect(evalExpr('=COUNTA(1,"a",3,"")')).toBe(3))
  it('COUNTBLANK', () =>
    expect(evalExpr('=COUNTBLANK(A1:A3)', { cells: { A1: 1, A3: 3 } })).toBe(1))
  it('PRODUCT', () => expect(evalExpr('=PRODUCT(2,3,4)')).toBe(24))
  it('MEDIAN odd', () => expect(evalExpr('=MEDIAN(1,2,3)')).toBe(2))
  it('MEDIAN even', () => expect(evalExpr('=MEDIAN(1,2,3,4)')).toBe(2.5))
})

describe('rounding + integer math', () => {
  it('ROUND down', () => expect(evalExpr('=ROUND(2.4,0)')).toBe(2))
  it('ROUND up', () => expect(evalExpr('=ROUND(2.5,0)')).toBe(3))
  it('ROUND digits', () => expect(evalExpr('=ROUND(3.14159,2)')).toBe(3.14))
  it('ROUNDUP', () => expect(evalExpr('=ROUNDUP(2.1,0)')).toBe(3))
  it('ROUNDDOWN', () => expect(evalExpr('=ROUNDDOWN(2.9,0)')).toBe(2))
  it('INT', () => expect(evalExpr('=INT(7.8)')).toBe(7))
  it('INT negative', () => expect(evalExpr('=INT(-7.2)')).toBe(-8))
  it('TRUNC', () => expect(evalExpr('=TRUNC(-7.8)')).toBe(-7))
  it('FLOOR', () => expect(evalExpr('=FLOOR(7.8,1)')).toBe(7))
  it('CEILING', () => expect(evalExpr('=CEILING(7.2,1)')).toBe(8))
  it('EVEN positive', () => expect(evalExpr('=EVEN(3)')).toBe(4))
  it('ODD positive', () => expect(evalExpr('=ODD(4)')).toBe(5))
})

describe('math: ABS, SQRT, POWER, LN, LOG, EXP, SIGN, FACT, GCD, QUOTIENT', () => {
  it('ABS', () => expect(evalExpr('=ABS(-5)')).toBe(5))
  it('SQRT', () => expect(evalExpr('=SQRT(16)')).toBe(4))
  it('SQRT negative #NUM!', () => expect(evalExpr('=SQRT(-1)')).toBe('#NUM!'))
  it('POWER', () => expect(evalExpr('=POWER(2,8)')).toBe(256))
  it('LN', () => expect(near(evalExpr('=LN(2.718281828)'), 1, 1e-6)).toBe(true))
  it('LN negative', () => expect(evalExpr('=LN(-1)')).toBe('#NUM!'))
  it('LOG default 10', () => expect(evalExpr('=LOG(100)')).toBe(2))
  it('LOG base 2', () => expect(evalExpr('=LOG(8,2)')).toBe(3))
  it('EXP', () => expect(near(evalExpr('=EXP(1)'), Math.E, 1e-9)).toBe(true))
  it('SIGN positive', () => expect(evalExpr('=SIGN(5)')).toBe(1))
  it('SIGN negative', () => expect(evalExpr('=SIGN(-3)')).toBe(-1))
  it('SIGN zero', () => expect(evalExpr('=SIGN(0)')).toBe(0))
  it('FACT 5', () => expect(evalExpr('=FACT(5)')).toBe(120))
  it('GCD', () => expect(evalExpr('=GCD(12,18)')).toBe(6))
  it('QUOTIENT', () => expect(evalExpr('=QUOTIENT(11,3)')).toBe(3))
  it('PI', () => expect(near(evalExpr('=PI()'), Math.PI)).toBe(true))
})

// ── Logical ──────────────────────────────────────────────────────────────────

describe('logical', () => {
  it('IF true branch', () => expect(evalExpr('=IF(1>0,"yes","no")')).toBe('yes'))
  it('IF false branch', () => expect(evalExpr('=IF(1<0,"yes","no")')).toBe('no'))
  it('IF defaults to FALSE when no else', () => expect(evalExpr('=IF(1<0,"yes")')).toBe(false))
  it('IFS first match', () => expect(evalExpr('=IFS(FALSE(),"a",TRUE(),"b",TRUE(),"c")')).toBe('b'))
  it('IFS no match', () => expect(evalExpr('=IFS(FALSE(),"a",FALSE(),"b")')).toBe('#N/A'))
  it('AND all true', () => expect(evalExpr('=AND(TRUE(),1=1)')).toBe(true))
  it('AND any false', () => expect(evalExpr('=AND(TRUE(),FALSE())')).toBe(false))
  it('OR any true', () => expect(evalExpr('=OR(FALSE(),TRUE())')).toBe(true))
  it('NOT', () => expect(evalExpr('=NOT(TRUE())')).toBe(false))
  it('XOR', () => expect(evalExpr('=XOR(TRUE(),FALSE(),FALSE())')).toBe(true))
  it('TRUE / FALSE', () => {
    expect(evalExpr('=TRUE()')).toBe(true)
    expect(evalExpr('=FALSE()')).toBe(false)
  })
  it('IFERROR catches', () => expect(evalExpr('=IFERROR(1/0,"err")')).toBe('err'))
  it('IFERROR passes ok', () => expect(evalExpr('=IFERROR(5,"err")')).toBe(5))
  it('IFNA catches NA', () => expect(evalExpr('=IFNA(NA(),"na")')).toBe('na'))
  it('SWITCH match', () => expect(evalExpr('=SWITCH(2,1,"one",2,"two",3,"three")')).toBe('two'))
  it('SWITCH default', () => expect(evalExpr('=SWITCH(9,1,"one","other")')).toBe('other'))
})

// ── Text ─────────────────────────────────────────────────────────────────────

describe('text functions', () => {
  it('LEN', () => expect(evalExpr('=LEN("hello")')).toBe(5))
  it('UPPER', () => expect(evalExpr('=UPPER("hi")')).toBe('HI'))
  it('LOWER', () => expect(evalExpr('=LOWER("HI")')).toBe('hi'))
  it('PROPER', () => expect(evalExpr('=PROPER("hello world")')).toBe('Hello World'))
  it('TRIM', () => expect(evalExpr('=TRIM("  hi   there  ")')).toBe('hi there'))
  it('LEFT', () => expect(evalExpr('=LEFT("hello",3)')).toBe('hel'))
  it('RIGHT', () => expect(evalExpr('=RIGHT("hello",3)')).toBe('llo'))
  it('MID', () => expect(evalExpr('=MID("hello",2,3)')).toBe('ell'))
  it('CONCATENATE', () => expect(evalExpr('=CONCATENATE("a","b","c")')).toBe('abc'))
  it('CONCAT alias', () => expect(evalExpr('=CONCAT("a","b")')).toBe('ab'))
  it('TEXTJOIN ignore empty', () =>
    expect(evalExpr('=TEXTJOIN("-",TRUE(),"a","","b")')).toBe('a-b'))
  it('TEXTJOIN keep empty', () =>
    expect(evalExpr('=TEXTJOIN("-",FALSE(),"a","","b")')).toBe('a--b'))
  it('REPT', () => expect(evalExpr('=REPT("ab",3)')).toBe('ababab'))
  it('CHAR / CODE round trip', () => {
    expect(evalExpr('=CHAR(65)')).toBe('A')
    expect(evalExpr('=CODE("A")')).toBe(65)
  })
  it('EXACT same', () => expect(evalExpr('=EXACT("abc","abc")')).toBe(true))
  it('EXACT case', () => expect(evalExpr('=EXACT("abc","ABC")')).toBe(false))
  it('SUBSTITUTE', () => expect(evalExpr('=SUBSTITUTE("a-b-c","-","_")')).toBe('a_b_c'))
  it('SUBSTITUTE nth', () => expect(evalExpr('=SUBSTITUTE("a-b-c-d","-","_",2)')).toBe('a-b_c-d'))
  it('REPLACE', () => expect(evalExpr('=REPLACE("abcdef",2,3,"ZZZ")')).toBe('aZZZef'))
  it('FIND found', () => expect(evalExpr('=FIND("b","abcd")')).toBe(2))
  it('FIND missing', () => expect(evalExpr('=FIND("z","abcd")')).toBe('#VALUE!'))
  it('SEARCH case insensitive', () => expect(evalExpr('=SEARCH("B","abcd")')).toBe(2))
  it('VALUE numeric', () => expect(evalExpr('=VALUE("123.5")')).toBe(123.5))
  it('VALUE not numeric', () => expect(evalExpr('=VALUE("abc")')).toBe('#VALUE!'))
  it('TEXT %', () => expect(evalExpr('=TEXT(0.5,"0.0%")')).toBe('50.0%'))
  it('TEXT decimals', () => expect(evalExpr('=TEXT(3.14159,"0.00")')).toBe('3.14'))
  it('DOLLAR', () => expect(evalExpr('=DOLLAR(1234.5)')).toBe('$1234.50'))
  it('FIXED', () => expect(evalExpr('=FIXED(1.236,2)')).toBe('1.24'))
})

// ── Date / Time ──────────────────────────────────────────────────────────────

describe('date functions', () => {
  it('DATE returns ISO date', () => expect(evalExpr('=DATE(2026,5,23)')).toBe('2026-05-23'))
  it('YEAR', () => expect(evalExpr('=YEAR("2026-05-23")')).toBe(2026))
  it('MONTH', () => expect(evalExpr('=MONTH("2026-05-23")')).toBe(5))
  it('DAY', () => expect(evalExpr('=DAY("2026-05-23")')).toBe(23))
  it('DAYS between dates', () => expect(evalExpr('=DAYS("2026-05-30","2026-05-23")')).toBe(7))
  it('DATEDIF days', () => expect(evalExpr('=DATEDIF("2026-01-01","2026-01-31","D")')).toBe(30))
  it('DATEDIF months', () => expect(evalExpr('=DATEDIF("2026-01-01","2026-04-01","M")')).toBe(3))
  it('DATEDIF years', () => expect(evalExpr('=DATEDIF("2024-01-01","2026-01-01","Y")')).toBe(2))
  it('WEEKDAY default Sunday=1', () => expect(evalExpr('=WEEKDAY("2026-05-24")')).toBe(1)) // Sunday
  it('NETWORKDAYS skips weekends', () =>
    expect(evalExpr('=NETWORKDAYS("2026-05-18","2026-05-22")')).toBe(5))
  it('EOMONTH this month', () => expect(evalExpr('=EOMONTH("2026-05-15",0)')).toBe('2026-05-31'))
  it('EOMONTH next month', () => expect(evalExpr('=EOMONTH("2026-05-15",1)')).toBe('2026-06-30'))
})

// ── Lookup / Reference ──────────────────────────────────────────────────────

describe('lookup functions', () => {
  // VLOOKUP exact
  it('VLOOKUP exact match', () => {
    const cells = { A1: 'k1', B1: 'v1', A2: 'k2', B2: 'v2', A3: 'k3', B3: 'v3' }
    expect(evalExpr('=VLOOKUP("k2",A1:B3,2,FALSE())', { cells })).toBe('v2')
  })
  it('VLOOKUP exact no match', () => {
    const cells = { A1: 'a', B1: 1, A2: 'b', B2: 2 }
    expect(evalExpr('=VLOOKUP("z",A1:B2,2,FALSE())', { cells })).toBe('#N/A')
  })
  it('VLOOKUP approximate', () => {
    const cells = { A1: 10, B1: 'low', A2: 20, B2: 'mid', A3: 30, B3: 'hi' }
    expect(evalExpr('=VLOOKUP(25,A1:B3,2,TRUE())', { cells })).toBe('mid')
  })
  it('VLOOKUP with range as lookup_value uses first cell (implicit intersection)', () => {
    // Without spill arrays, =VLOOKUP(D1:D3, A1:B3, 2, 0) used to coerce the
    // range to a joined string ("k1,k2,k3") and return #N/A. Now the lookup
    // reduces to D1 ("k2") so the formula returns a useful value the user
    // can then fill down.
    const cells = {
      A1: 'k1',
      B1: 'v1',
      A2: 'k2',
      B2: 'v2',
      A3: 'k3',
      B3: 'v3',
      D1: 'k2',
      D2: 'k3',
      D3: 'k1',
    }
    expect(evalExpr('=VLOOKUP(D1:D3,A1:B3,2,FALSE())', { cells })).toBe('v2')
  })
  it('HLOOKUP exact match', () => {
    const cells = { A1: 'k1', B1: 'k2', C1: 'k3', A2: 'v1', B2: 'v2', C2: 'v3' }
    expect(evalExpr('=HLOOKUP("k2",A1:C2,2,FALSE())', { cells })).toBe('v2')
  })
  it('XLOOKUP exact match', () => {
    const cells = { A1: 'k1', A2: 'k2', A3: 'k3', B1: 'v1', B2: 'v2', B3: 'v3' }
    expect(evalExpr('=XLOOKUP("k2",A1:A3,B1:B3)', { cells })).toBe('v2')
  })
  it('XLOOKUP no match returns #N/A by default', () => {
    const cells = { A1: 'k1', A2: 'k2', B1: 'v1', B2: 'v2' }
    expect(evalExpr('=XLOOKUP("z",A1:A2,B1:B2)', { cells })).toBe('#N/A')
  })
  it('XLOOKUP no match returns if_not_found when given', () => {
    const cells = { A1: 'k1', A2: 'k2', B1: 'v1', B2: 'v2' }
    expect(evalExpr('=XLOOKUP("z",A1:A2,B1:B2,"none")', { cells })).toBe('none')
  })
  it('XLOOKUP match_mode 1 finds next larger', () => {
    const cells = { A1: 10, A2: 20, A3: 30, B1: 'low', B2: 'mid', B3: 'hi' }
    expect(evalExpr('=XLOOKUP(25,A1:A3,B1:B3,"none",1)', { cells })).toBe('hi')
  })
  it('XLOOKUP match_mode -1 finds next smaller', () => {
    const cells = { A1: 10, A2: 20, A3: 30, B1: 'low', B2: 'mid', B3: 'hi' }
    expect(evalExpr('=XLOOKUP(25,A1:A3,B1:B3,"none",-1)', { cells })).toBe('mid')
  })
  it('XLOOKUP does not string-match a non-numeric lookup to the first row', () => {
    const cells = { A1: 'apple', A2: 'banana', B1: 1, B2: 2 }
    expect(evalExpr('=XLOOKUP("cherry",A1:A2,B1:B2)', { cells })).toBe('#N/A')
  })
  it('XLOOKUP approximate mode ignores a non-numeric lookup (no toNum(0) match)', () => {
    const cells = { A1: 10, A2: 20, A3: 30, B1: 'low', B2: 'mid', B3: 'hi' }
    expect(evalExpr('=XLOOKUP("cherry",A1:A3,B1:B3,"none",1)', { cells })).toBe('none')
    expect(evalExpr('=XLOOKUP("cherry",A1:A3,B1:B3,"none",-1)', { cells })).toBe('none')
  })
  it('MATCH exact', () => {
    const cells = { A1: 'a', A2: 'b', A3: 'c' }
    expect(evalExpr('=MATCH("b",A1:A3,0)', { cells })).toBe(2)
  })
  it('INDEX 1D', () => {
    const cells = { A1: 'a', A2: 'b', A3: 'c' }
    expect(evalExpr('=INDEX(A1:A3,2)', { cells })).toBe('b')
  })
  it('INDEX 2D', () => {
    const cells = { A1: 1, B1: 2, A2: 3, B2: 4 }
    expect(evalExpr('=INDEX(A1:B2,2,2)', { cells })).toBe(4)
  })
  it('CHOOSE', () => expect(evalExpr('=CHOOSE(2,"a","b","c")')).toBe('b'))
  // ROW()/COLUMN() of a ref — the engine resolves cell refs to *values*
  // before passing to functions, so the current ROW/COLUMN can only
  // introspect the literal text representation of a ref. With a literal
  // string argument it parses the digits/letters correctly; with a real
  // cell ref it sees the cell's empty value and falls back to 1. That's
  // a known limitation we'll address when we wire ROW/COLUMN to receive
  // the reference token instead of the resolved value.
  it('ROW from string ref', () => expect(evalExpr('=ROW("B5")')).toBe(5))
  it('COLUMN from string ref', () => expect(evalExpr('=COLUMN("C1")')).toBe(3))
  it('ROWS of array', () => expect(evalExpr('=ROWS(A1:A5)', { cells: {} })).toBe(5))
  it('COLUMNS of array', () => expect(evalExpr('=COLUMNS(A1:E1)', { cells: {} })).toBe(5))
})

// ── Conditional aggregates ──────────────────────────────────────────────────

describe('conditional aggregates', () => {
  const cells = {
    A1: 'a',
    B1: 1,
    A2: 'b',
    B2: 2,
    A3: 'a',
    B3: 3,
    A4: 'c',
    B4: 4,
    A5: 'a',
    B5: 5,
  }
  it('SUMIF', () => expect(evalExpr('=SUMIF(A1:A5,"a",B1:B5)', { cells })).toBe(9))
  it('SUMIF >', () => expect(evalExpr('=SUMIF(B1:B5,">2")', { cells })).toBe(12))
  it('SUMIFS', () => expect(evalExpr('=SUMIFS(B1:B5,A1:A5,"a")', { cells })).toBe(9))
  it('COUNTIF', () => expect(evalExpr('=COUNTIF(A1:A5,"a")', { cells })).toBe(3))
  it('COUNTIFS', () => expect(evalExpr('=COUNTIFS(A1:A5,"a",B1:B5,">2")', { cells })).toBe(2))
  it('AVERAGEIF', () => expect(evalExpr('=AVERAGEIF(A1:A5,"a",B1:B5)', { cells })).toBe(3))
})

// ── Statistical ─────────────────────────────────────────────────────────────

describe('statistical', () => {
  // Sample STDEV (Bessel-corrected) of [2,4,4,4,5,5,7,9] = sqrt(32/7) ≈ 2.138.
  it('STDEV sample', () =>
    expect(near(evalExpr('=STDEV(2,4,4,4,5,5,7,9)'), Math.sqrt(32 / 7), 1e-9)).toBe(true))
  it('LARGE', () =>
    expect(evalExpr('=LARGE(A1:A5,2)', { cells: { A1: 1, A2: 5, A3: 3, A4: 9, A5: 7 } })).toBe(7))
  it('SMALL', () =>
    expect(evalExpr('=SMALL(A1:A5,2)', { cells: { A1: 1, A2: 5, A3: 3, A4: 9, A5: 7 } })).toBe(3))
  it('PERCENTILE 0.5 = median for odd', () => {
    expect(
      evalExpr('=PERCENTILE(A1:A5,0.5)', { cells: { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 } }),
    ).toBe(3)
  })
  it('SUMPRODUCT', () =>
    expect(
      evalExpr('=SUMPRODUCT(A1:A3,B1:B3)', { cells: { A1: 1, A2: 2, A3: 3, B1: 4, B2: 5, B3: 6 } }),
    ).toBe(32))
})

// ── Info / Type ─────────────────────────────────────────────────────────────

describe('info / type predicates', () => {
  it('ISBLANK true', () => expect(evalExpr('=ISBLANK(A1)', { cells: {} })).toBe(true))
  it('ISBLANK false', () => expect(evalExpr('=ISBLANK(A1)', { cells: { A1: 0 } })).toBe(false))
  it('ISNUMBER true', () => expect(evalExpr('=ISNUMBER(42)')).toBe(true))
  it('ISTEXT true', () => expect(evalExpr('=ISTEXT("hi")')).toBe(true))
  it('ISERROR catches', () => expect(evalExpr('=ISERROR(1/0)')).toBe(true))
  it('ISERR not NA', () => expect(evalExpr('=ISERR(NA())')).toBe(false))
  it('ISNA matches NA', () => expect(evalExpr('=ISNA(NA())')).toBe(true))
  it('ISLOGICAL true', () => expect(evalExpr('=ISLOGICAL(TRUE())')).toBe(true))
  it('ISODD', () => expect(evalExpr('=ISODD(3)')).toBe(true))
  it('ISEVEN', () => expect(evalExpr('=ISEVEN(4)')).toBe(true))
  it('N coerces', () => expect(evalExpr('=N("5")')).toBe(5))
  it('T preserves text', () => expect(evalExpr('=T("hello")')).toBe('hello'))
  it('T strips number', () => expect(evalExpr('=T(42)')).toBe(''))
  it('NA returns #N/A', () => expect(evalExpr('=NA()')).toBe('#N/A'))
})

// ── Errors ──────────────────────────────────────────────────────────────────

describe('errors propagate', () => {
  it('#DIV/0!', () => expect(evalExpr('=1/0')).toBe('#DIV/0!'))
  it('#NUM! from negative SQRT', () => expect(evalExpr('=SQRT(-1)')).toBe('#NUM!'))
  it('SUM ignores errors gracefully', () => expect(evalExpr('=SUM(1,SQRT(-1),3)')).toBe(4))
  it('IFERROR wraps', () => expect(evalExpr('=IFERROR(SQRT(-1),"caught")')).toBe('caught'))
})

// ── Cell-ref resolution ────────────────────────────────────────────────────

// ── Trigonometry (newly added) ──────────────────────────────────────────────

describe('trigonometry', () => {
  it('SIN(0)', () => expect(evalExpr('=SIN(0)')).toBe(0))
  it('COS(0)', () => expect(evalExpr('=COS(0)')).toBe(1))
  it('TAN(0)', () => expect(evalExpr('=TAN(0)')).toBe(0))
  it('SIN(PI/2)', () => expect(near(evalExpr('=SIN(PI()/2)'), 1)).toBe(true))
  it('COS(PI)', () => expect(near(evalExpr('=COS(PI())'), -1)).toBe(true))
  it('ASIN(1)', () => expect(near(evalExpr('=ASIN(1)'), Math.PI / 2)).toBe(true))
  it('ACOS(0)', () => expect(near(evalExpr('=ACOS(0)'), Math.PI / 2)).toBe(true))
  it('ATAN(1)', () => expect(near(evalExpr('=ATAN(1)'), Math.PI / 4)).toBe(true))
  it('ATAN2(1,0)', () => expect(evalExpr('=ATAN2(1,0)')).toBe(0))
  it('ASIN domain err', () => expect(evalExpr('=ASIN(2)')).toBe('#NUM!'))
  it('DEGREES round-trip', () => expect(near(evalExpr('=DEGREES(PI())'), 180)).toBe(true))
  it('RADIANS round-trip', () => expect(near(evalExpr('=RADIANS(180)'), Math.PI)).toBe(true))
  it('SINH(0)', () => expect(evalExpr('=SINH(0)')).toBe(0))
  it('COSH(0)', () => expect(evalExpr('=COSH(0)')).toBe(1))
  it('TANH(0)', () => expect(evalExpr('=TANH(0)')).toBe(0))
})

describe('combinatorics', () => {
  it('COMBIN 5 choose 2', () => expect(evalExpr('=COMBIN(5,2)')).toBe(10))
  it('PERMUT 5 perm 2', () => expect(evalExpr('=PERMUT(5,2)')).toBe(20))
  it('COMBIN domain err', () => expect(evalExpr('=COMBIN(2,5)')).toBe('#NUM!'))
})

// ── Conditional aggregates (newly added: AVERAGEIFS / MAXIFS / MINIFS) ──────

describe('AVERAGEIFS / MAXIFS / MINIFS', () => {
  const cells = {
    A1: 'a',
    B1: 1,
    C1: 10,
    A2: 'b',
    B2: 2,
    C2: 20,
    A3: 'a',
    B3: 3,
    C3: 30,
    A4: 'c',
    B4: 4,
    C4: 40,
    A5: 'a',
    B5: 5,
    C5: 50,
  }
  it('AVERAGEIFS by single criterion', () =>
    expect(evalExpr('=AVERAGEIFS(C1:C5,A1:A5,"a")', { cells })).toBe(30))
  it('AVERAGEIFS by two criteria', () =>
    expect(evalExpr('=AVERAGEIFS(C1:C5,A1:A5,"a",B1:B5,">2")', { cells })).toBe(40))
  it('MAXIFS', () => expect(evalExpr('=MAXIFS(C1:C5,A1:A5,"a")', { cells })).toBe(50))
  it('MINIFS', () => expect(evalExpr('=MINIFS(C1:C5,A1:A5,"a")', { cells })).toBe(10))
})

// ── Date / Time (newly added: TIME / EDATE / WORKDAY / DATEVALUE / TIMEVALUE) ──

describe('extended date/time', () => {
  it('TIME midnight', () => expect(evalExpr('=TIME(0,0,0)')).toBe(0))
  it('TIME noon = 0.5', () => expect(evalExpr('=TIME(12,0,0)')).toBe(0.5))
  it('EDATE same day next mo', () => expect(evalExpr('=EDATE("2026-05-23",1)')).toBe('2026-06-23'))
  it('EDATE clamps short month', () =>
    expect(evalExpr('=EDATE("2026-01-31",1)')).toBe('2026-02-28'))
  it('WORKDAY skip weekends', () => expect(evalExpr('=WORKDAY("2026-05-22",1)')).toBe('2026-05-25')) // Fri+1 → Mon
  it('WORKDAY negative', () => expect(evalExpr('=WORKDAY("2026-05-25",-1)')).toBe('2026-05-22'))
  it('DATEVALUE returns serial', () => expect(evalExpr('=DATEVALUE("1900-01-01")')).toBe(2))
  it('TIMEVALUE noon = 0.5', () => expect(evalExpr('=TIMEVALUE("12:00")')).toBe(0.5))
  it('TIMEVALUE invalid', () => expect(evalExpr('=TIMEVALUE("nonsense")')).toBe('#VALUE!'))
})

// ── Statistical (newly added) ────────────────────────────────────────────────

describe('extended statistical', () => {
  it('STDEVP population', () => {
    // Population stdev of [1,2,3,4,5] = sqrt(2) ≈ 1.414
    expect(near(evalExpr('=STDEVP(1,2,3,4,5)'), Math.sqrt(2))).toBe(true)
  })
  it('VAR sample', () => expect(near(evalExpr('=VAR(1,2,3,4,5)'), 2.5)).toBe(true))
  it('VARP population', () => expect(near(evalExpr('=VARP(1,2,3,4,5)'), 2)).toBe(true))
  it('AVEDEV', () => expect(evalExpr('=AVEDEV(1,2,3,4,5)')).toBe(1.2))
  it('GEOMEAN of (2,8)', () => expect(evalExpr('=GEOMEAN(2,8)')).toBe(4))
  it('HARMEAN of (1,4)', () => expect(near(evalExpr('=HARMEAN(1,4)'), 8 / 5)).toBe(true))
  it('CORREL perfect +1', () => {
    expect(
      near(
        evalExpr('=CORREL(A1:A5,B1:B5)', {
          cells: { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, B1: 2, B2: 4, B3: 6, B4: 8, B5: 10 },
        }),
        1,
      ),
    ).toBe(true)
  })
  it('SLOPE 2x linear', () => {
    expect(
      near(
        evalExpr('=SLOPE(B1:B5,A1:A5)', {
          cells: { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, B1: 2, B2: 4, B3: 6, B4: 8, B5: 10 },
        }),
        2,
      ),
    ).toBe(true)
  })
  it('INTERCEPT', () => {
    expect(
      near(
        evalExpr('=INTERCEPT(B1:B5,A1:A5)', {
          cells: { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, B1: 2, B2: 4, B3: 6, B4: 8, B5: 10 },
        }),
        0,
        1e-9,
      ),
    ).toBe(true)
  })
})

// ── Text (newly added: SPLIT / JOIN / regex) ────────────────────────────────

describe('extended text', () => {
  it('SPLIT comma', () => expect(evalExpr('=SPLIT("a,b,c",",")')).toEqual(['a', 'b', 'c']))
  it('SPLIT remove empty', () => expect(evalExpr('=SPLIT("a,,c",",")')).toEqual(['a', 'c']))
  it('SPLIT each char default', () =>
    expect(evalExpr('=SPLIT("a-b/c","-/")')).toEqual(['a', 'b', 'c']))
  it('JOIN', () => expect(evalExpr('=JOIN("-","a","b","c")')).toBe('a-b-c'))
  it('REGEXMATCH true', () => expect(evalExpr('=REGEXMATCH("abc123","\\d+")')).toBe(true))
  it('REGEXMATCH false', () => expect(evalExpr('=REGEXMATCH("abc","\\d+")')).toBe(false))
  it('REGEXEXTRACT first group', () =>
    expect(evalExpr('=REGEXEXTRACT("hello world","(\\w+) (\\w+)")')).toBe('hello'))
  it('REGEXEXTRACT no match', () => expect(evalExpr('=REGEXEXTRACT("abc","\\d+")')).toBe('#N/A'))
  it('REGEXREPLACE', () =>
    expect(evalExpr('=REGEXREPLACE("hello world","o","0")')).toBe('hell0 w0rld'))
  it('REGEX invalid pattern', () => expect(evalExpr('=REGEXMATCH("a","(")')).toBe('#ERROR!'))
})

// ── Reference helpers (newly added: ADDRESS) ────────────────────────────────

describe('ADDRESS', () => {
  it('default absolute', () => expect(evalExpr('=ADDRESS(1,1)')).toBe('$A$1'))
  it('mixed row absolute', () => expect(evalExpr('=ADDRESS(5,2,2)')).toBe('B$5'))
  it('mixed col absolute', () => expect(evalExpr('=ADDRESS(5,2,3)')).toBe('$B5'))
  it('relative', () => expect(evalExpr('=ADDRESS(5,2,4)')).toBe('B5'))
  it('with sheet name', () => expect(evalExpr('=ADDRESS(1,1,1,1,"Sheet2")')).toBe('Sheet2!$A$1'))
  it('rejects zero row', () => expect(evalExpr('=ADDRESS(0,1)')).toBe('#VALUE!'))
})

// ── Array (newly added) ─────────────────────────────────────────────────────

describe('SPARKLINE', () => {
  it('returns a spec with the numeric range data, type and color', () => {
    expect(
      evalExpr('=SPARKLINE(A1:A3, "column", "#f00")', { cells: { A1: 1, A2: 2, A3: 3 } }),
    ).toEqual({ __spark: true, type: 'column', data: [1, 2, 3], color: '#f00' })
  })
  it('defaults to a line chart and drops blank/non-numeric cells', () => {
    const s = evalExpr('=SPARKLINE(A1:A4)', { cells: { A1: 1, A3: 'x', A4: 4 } }) // A2 empty
    expect(s.type).toBe('line')
    expect(s.data).toEqual([1, 4])
  })
})

describe('array functions', () => {
  it('TRANSPOSE 1D vertical → 1 row × 3 cols', () => {
    // A1:A3 arrives as [[1],[2],[3]] (column vector). Transposed it should be
    // a single row of three columns.
    expect(evalExpr('=TRANSPOSE(A1:A3)', { cells: { A1: 1, A2: 2, A3: 3 } })).toEqual([[1, 2, 3]])
  })
  it('TRANSPOSE 2D', () => {
    expect(evalExpr('=TRANSPOSE(A1:B2)', { cells: { A1: 1, B1: 2, A2: 3, B2: 4 } })).toEqual([
      [1, 3],
      [2, 4],
    ])
  })
  it('SUM(TRANSPOSE(range))', () => {
    expect(evalExpr('=SUM(TRANSPOSE(A1:A3))', { cells: { A1: 1, A2: 2, A3: 3 } })).toBe(6)
  })
  it('SORT ascending', () => {
    expect(evalExpr('=SORT(A1:A4)', { cells: { A1: 3, A2: 1, A3: 4, A4: 2 } })).toEqual([
      [1],
      [2],
      [3],
      [4],
    ])
  })
  it('SORT descending', () => {
    expect(evalExpr('=SORT(A1:A4,1,FALSE)', { cells: { A1: 3, A2: 1, A3: 4, A4: 2 } })).toEqual([
      [4],
      [3],
      [2],
      [1],
    ])
  })
  it('UNIQUE 1D', () => {
    expect(evalExpr('=UNIQUE(A1:A5)', { cells: { A1: 1, A2: 2, A3: 1, A4: 3, A5: 2 } })).toEqual([
      [1],
      [2],
      [3],
    ])
  })
  it('FILTER basic', () => {
    expect(
      evalExpr('=FILTER(A1:A4,B1:B4)', {
        cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd', B1: true, B2: false, B3: true, B4: false },
      }),
    ).toEqual([['a'], ['c']])
  })
  it('SEQUENCE 5', () => expect(evalExpr('=SEQUENCE(5)')).toEqual([1, 2, 3, 4, 5]))
  it('SEQUENCE 2x3', () =>
    expect(evalExpr('=SEQUENCE(2,3)')).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]))
  it('SEQUENCE start+step', () => expect(evalExpr('=SEQUENCE(4,1,10,5)')).toEqual([10, 15, 20, 25]))
})

// ── Financial (newly added) ─────────────────────────────────────────────────

describe('financial', () => {
  it('PMT 30-year mortgage at 5%', () => {
    // $200k principal, 30yr, 5% annual → 5/12% monthly, 360 periods.
    const v = evalExpr('=PMT(0.05/12,360,200000)')
    expect(near(v, -1073.64, 0.01)).toBe(true)
  })
  it('PMT zero rate', () => expect(evalExpr('=PMT(0,12,1200)')).toBe(-100))
  it('FV of $100/mo for 1 yr at 0%', () => expect(evalExpr('=FV(0,12,-100)')).toBe(1200))
  it('PV of $1200 due in 1yr at 5%', () => {
    expect(near(evalExpr('=PV(0.05,1,0,-1200)'), 1142.857, 0.01)).toBe(true)
  })
  it('NPV', () => {
    // 10% rate, 3 cashflows
    const v = evalExpr('=NPV(0.1,100,100,100)')
    expect(near(v, 248.685, 0.01)).toBe(true)
  })
  it('IRR break-even', () => {
    // -1000 today, +600 / yr for 2 yrs. IRR should be ~13.07%.
    expect(
      near(evalExpr('=IRR(A1:A3)', { cells: { A1: -1000, A2: 600, A3: 600 } }), 0.1306, 0.001),
    ).toBe(true)
  })
})

// ── Named ranges ────────────────────────────────────────────────────────────

describe('named ranges', () => {
  it('resolves a single-cell named range', () => {
    expect(
      evalExpr('=Revenue', {
        sheetCells: { Data: { B2: 1234 } },
        namedRanges: { REVENUE: { sheet: 'Data', start: 'B2', end: 'B2' } },
      }),
    ).toBe(1234)
  })

  it('resolves a range named range via SUM', () => {
    expect(
      evalExpr('=SUM(Sales)', {
        sheetCells: { Data: { A1: 10, A2: 20, A3: 30 } },
        namedRanges: { SALES: { sheet: 'Data', start: 'A1', end: 'A3' } },
      }),
    ).toBe(60)
  })

  it('case-insensitive lookup', () => {
    expect(
      evalExpr('=revenue', {
        sheetCells: { Data: { B2: 99 } },
        namedRanges: { REVENUE: { sheet: 'Data', start: 'B2', end: 'B2' } },
      }),
    ).toBe(99)
  })

  it('falls back to current sheet when sheet is empty', () => {
    expect(
      evalExpr('=Price', {
        cells: { A1: 42 },
        namedRanges: { PRICE: { sheet: '', start: 'A1', end: 'A1' } },
      }),
    ).toBe(42)
  })

  it('unknown name returns #NAME?', () => {
    expect(evalExpr('=Nope')).toBe('#NAME?')
  })

  it('composes inside arithmetic', () => {
    expect(
      evalExpr('=Revenue*2+10', {
        sheetCells: { Data: { B2: 5 } },
        namedRanges: { REVENUE: { sheet: 'Data', start: 'B2', end: 'B2' } },
      }),
    ).toBe(20)
  })
})

// ── Cross-sheet references ──────────────────────────────────────────────────

describe('cross-sheet references', () => {
  it('reads a single cell from another sheet', () => {
    expect(evalExpr('=Sheet2!A1', { sheetCells: { Sheet2: { A1: 42 } } })).toBe(42)
  })

  it('reads a range from another sheet (SUM)', () => {
    expect(
      evalExpr('=SUM(Sheet2!A1:A3)', {
        sheetCells: { Sheet2: { A1: 1, A2: 2, A3: 3 } },
      }),
    ).toBe(6)
  })

  it('reads a cross-sheet 2D range', () => {
    expect(
      evalExpr('=SUM(Sheet2!A1:B2)', {
        sheetCells: { Sheet2: { A1: 1, B1: 2, A2: 3, B2: 4 } },
      }),
    ).toBe(10)
  })

  it('mixes same-sheet and cross-sheet refs in one formula', () => {
    expect(
      evalExpr('=A1+Sheet2!B5', {
        cells: { A1: 10 },
        sheetCells: { Sheet2: { B5: 32 } },
      }),
    ).toBe(42)
  })

  it('missing cross-sheet cell returns empty (coerced to 0)', () => {
    expect(evalExpr('=SUM(Sheet2!A1:A3)', { sheetCells: { Sheet2: {} } })).toBe(0)
  })

  it('VLOOKUP across sheets (clean name)', () => {
    expect(
      evalExpr('=VLOOKUP("k2",Sheet2!A1:B3,2,FALSE())', {
        sheetCells: { Sheet2: { A1: 'k1', B1: 'v1', A2: 'k2', B2: 'v2', A3: 'k3', B3: 'v3' } },
      }),
    ).toBe('v2')
  })

  it('VLOOKUP across sheets with quoted clean name', () => {
    expect(
      evalExpr('=VLOOKUP("k2",\'Sheet2\'!A1:B3,2,FALSE())', {
        sheetCells: { Sheet2: { A1: 'k1', B1: 'v1', A2: 'k2', B2: 'v2' } },
      }),
    ).toBe('v2')
  })

  it('reads a quoted sheet name containing a space', () => {
    expect(
      evalExpr("=SUM('Sheet 2'!A1:A3)", {
        sheetCells: { 'Sheet 2': { A1: 10, A2: 20, A3: 30 } },
      }),
    ).toBe(60)
  })

  it('reads a quoted sheet name containing a dot', () => {
    expect(
      evalExpr('=VLOOKUP("k2",\'My.Sheet\'!A1:B2,2,FALSE())', {
        sheetCells: { 'My.Sheet': { A1: 'k1', B1: 'v1', A2: 'k2', B2: 'v2' } },
      }),
    ).toBe('v2')
  })

  it("handles an apostrophe inside a quoted sheet name ('' escape)", () => {
    expect(
      evalExpr("=`O''Brien Co`!A1".replace(/`/g, "'"), {
        sheetCells: { "O'Brien Co": { A1: 99 } },
      }),
    ).toBe(99)
  })
})

// ── Cell-ref resolution ────────────────────────────────────────────────────

describe('cell + range resolution', () => {
  it('reads a single cell', () => expect(evalExpr('=A1', { cells: { A1: 42 } })).toBe(42))
  it('reads a formula cell', () => expect(evalExpr('=A1', { cells: { A1: '=2+3' } })).toBe(5))
  it('reads a range as array', () =>
    expect(evalExpr('=SUM(A1:C1)', { cells: { A1: 1, B1: 2, C1: 3 } })).toBe(6))
  it('handles missing cells as blanks', () =>
    expect(evalExpr('=COUNTBLANK(A1:A5)', { cells: {} })).toBe(5))
})
