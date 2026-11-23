import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'

import { CommandTypes } from './commands'
import { createWorkbook } from './workbook'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

// A migrated cell keeps its formula and IronCalc evaluates it, so a function
// IronCalc does not know shows #NAME? (utils/legacy-sheet.ts reports those
// cells). This file is the inventory of that gap, checked against the pinned
// IronCalc on every run.

// Every function develop's own engine evaluated: `getFunctionNames()` of the
// removed engine/formula.js.
const DEVELOP_FUNCTIONS = `
  ABS ACOS ADDRESS AND ASIN ATAN ATAN2 AVEDEV AVERAGE AVERAGEIF AVERAGEIFS CEILING CHAR CHOOSE
  CLEAN CODE COLUMN COLUMNS COMBIN CONCAT CONCATENATE CORREL COS COSH COUNT COUNTA COUNTBLANK
  COUNTIF COUNTIFS DATE DATEDIF DATEVALUE DAY DAYS DEGREES DOLLAR EDATE EOMONTH EVEN EXACT EXP
  FACT FALSE FILTER FIND FIXED FLOOR FV GCD GEOMEAN HARMEAN HLOOKUP HOUR IF IFERROR IFNA IFS
  INDEX INT INTERCEPT IRR ISBLANK ISERR ISERROR ISEVEN ISLOGICAL ISNA ISNUMBER ISODD ISTEXT
  JOIN LARGE LEFT LEN LN LOG LOWER MATCH MAX MAXIFS MEDIAN MID MIN MINIFS MINUTE MOD MONTH N NA
  NETWORKDAYS NOT NOW NPV NUMBERVALUE ODD OR PERCENTILE PERMUT PI PMT POWER PRODUCT PROPER PV
  QUOTIENT RADIANS RAND RANDBETWEEN REGEXEXTRACT REGEXMATCH REGEXREPLACE REPLACE REPT RIGHT
  ROUND ROUNDDOWN ROUNDUP ROW ROWS SEARCH SECOND SEQUENCE SIGN SIN SINH SLOPE SMALL SORT
  SPARKLINE SPLIT SQRT STDEV STDEVP SUBSTITUTE SUM SUMIF SUMIFS SUMPRODUCT SWITCH T TAN TANH
  TEXT TEXTJOIN TIME TIMEVALUE TODAY TRANSPOSE TRIM TRUE TRUNC UNIQUE UPPER VALUE VAR VARP
  VLOOKUP WEEKDAY WORKDAY XLOOKUP XOR YEAR
`
  .trim()
  .split(/\s+/)

// Google Sheets functions develop did not have either. A sheet imported from
// Google can still name them.
const GOOGLE_FUNCTIONS = ['ARRAYFORMULA', 'FLATTEN', 'IMPORTRANGE', 'LET', 'QUERY']

// Drawn by the grid, never evaluated by IronCalc (function-catalog.test.js).
const EDITOR_FUNCTIONS = ['SPARKLINE']

// The gap: what IronCalc 0.9.0 does not know. When an upgrade adds one, the
// first test fails; take the name out of this list.
const MISSING_FROM_IRONCALC = [
  'ARRAYFORMULA',
  'FLATTEN',
  'IMPORTRANGE',
  'JOIN',
  'QUERY',
  'REGEXMATCH',
  'SPLIT',
]

// One formula per Google-style function, over A1:A3 = 3, 1, 2, B1:B3 = x, y, z
// and C1:C3 = TRUE, FALSE, TRUE. `ironcalc` is the cell and the two cells below
// it, where a dynamic array spills. `develop` is what develop's engine answered,
// kept for the record.
const SAMPLES = [
  { formula: '=REGEXMATCH("abc123","\\d+")', develop: 'TRUE', ironcalc: '#NAME?' },
  { formula: '=REGEXEXTRACT("abc123","\\d+")', develop: '123', ironcalc: '123' },
  { formula: '=REGEXREPLACE("abc123","\\d+","X")', develop: 'abcX', ironcalc: 'abcX' },
  { formula: '=SPLIT("a,b,c",",")', develop: 'a b c', ironcalc: '#NAME?' },
  { formula: '=JOIN("-",A1:A3)', develop: '3-1-2', ironcalc: '#NAME?' },
  { formula: '=TEXTJOIN("-",TRUE,A1:A3)', develop: '3-1-2', ironcalc: '3-1-2' },
  { formula: '=ARRAYFORMULA(A1:A3*2)', develop: '#NAME?', ironcalc: '#NAME?' },
  { formula: '=QUERY(A1:B3,"select A")', develop: '#NAME?', ironcalc: '#NAME?' },
  { formula: '=IMPORTRANGE("https://x","Sheet1!A1")', develop: '#NAME?', ironcalc: '#NAME?' },
  { formula: '=FILTER(A1:A3,C1:C3)', develop: '3 2', ironcalc: '3 2' },
  { formula: '=UNIQUE(A1:A3)', develop: '3 1 2', ironcalc: '3 1 2' },
  { formula: '=SORT(A1:A3)', develop: '1 2 3', ironcalc: '1 2 3' },
  { formula: '=SEQUENCE(3)', develop: '1 2 3', ironcalc: '1 2 3' },
  { formula: '=FLATTEN(A1:B3)', develop: '#NAME?', ironcalc: '#NAME?' },
  { formula: '=IFS(A1>2,"big",TRUE,"small")', develop: 'big', ironcalc: 'big' },
  { formula: '=SWITCH(A1,3,"three","other")', develop: 'three', ironcalc: 'three' },
  { formula: '=XLOOKUP(2,A1:A3,B1:B3)', develop: 'z', ironcalc: 'z' },
  { formula: '=LET(x,2,x*3)', develop: '#NAME?', ironcalc: '6' },
]

const DATA = [
  [1, 1, '3'],
  [2, 1, '1'],
  [3, 1, '2'],
  [1, 2, 'x'],
  [2, 2, 'y'],
  [3, 2, 'z'],
  [1, 3, 'TRUE'],
  [2, 3, 'FALSE'],
  [3, 3, 'TRUE'],
] as const

function sheetWithData() {
  const workbook = createWorkbook()
  let sequence = 0
  function type(row: number, col: number, input: string) {
    sequence++
    workbook.apply({
      id: `c${sequence}`,
      actor: 'test',
      ts: sequence,
      type: CommandTypes.setInput,
      payload: { sheet: 'Sheet1', row, col, input },
    })
  }
  for (const [row, col, input] of DATA) type(row, col, input)
  return { workbook, type }
}

describe('develop and Google Sheets functions on IronCalc 0.9.0', () => {
  it('shows #NAME? for exactly the functions listed as missing', () => {
    const { workbook, type } = sheetWithData()
    const names = [...DEVELOP_FUNCTIONS, ...GOOGLE_FUNCTIONS].filter(
      (name) => !EDITOR_FUNCTIONS.includes(name),
    )
    const unknown = names.filter((name, index) => {
      const row = 10 + index
      type(row, 5, `=${name}()`)
      return workbook.getDisplayValue('Sheet1', row, 5) === '#NAME?'
    })
    expect(unknown.sort()).toEqual(MISSING_FROM_IRONCALC)
  })

  it.each(SAMPLES)('$formula shows $ironcalc', ({ formula, ironcalc }) => {
    const { workbook, type } = sheetWithData()
    type(10, 5, formula)
    const shown = [10, 11, 12].map((row) => workbook.getDisplayValue('Sheet1', row, 5))
    expect(shown.filter(Boolean).join(' ')).toBe(ironcalc)
  })

  for (const name of MISSING_FROM_IRONCALC) {
    it.todo(`${name}: a migrated cell shows #NAME? until IronCalc or Suite adds it`)
  }
})
