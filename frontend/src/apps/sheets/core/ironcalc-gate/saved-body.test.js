// Saved sheets must keep opening. Every sheet's body in sheets_data is
// IronCalc's own bytes (workbook.toBytes(), core/snapshot-codec.ts), and
// IronCalc's byte format is not versioned: 0.9.0 cannot read bytes saved by
// 0.8.4 ("Error parsing workbook: bitcode error"). An IronCalc bump that
// breaks reading saved bodies would break every existing sheet, so this test
// opens a body saved by IronCalc 0.9.0 with the installed IronCalc and checks
// that inputs, values, names, styles and sizes come back.
//
// The fixture is frozen: it stands for bodies already saved in sites. Never
// regenerate it with a newer IronCalc (the generator refuses). To rebuild it
// on 0.9.0: SHEETS_WRITE_SAVED_BODY=1 npx vitest run saved-body

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initSync } from '@ironcalc/wasm'
import pkg from '@ironcalc/wasm/package.json'
import { describe, expect, it } from 'vitest'

import { CommandTypes } from '../commands.js'
import { base64ToBytes, bytesToBase64 } from '../snapshot-codec.js'
import { createWorkbook } from '../workbook.js'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

const FIXTURE_VERSION = '0.9.0'
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  `saved-body-${FIXTURE_VERSION}.json`,
)
const ODD = "Q3 'odd' sheet"

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })
const input = (sheet, row, col, value) =>
  cmd(CommandTypes.setInput, { sheet, row, col, input: value })

// What the fixture was built from: the kinds of content a saved sheet holds.
const BUILD = [
  cmd(CommandTypes.addSheet, { name: 'Data' }),
  cmd(CommandTypes.addSheet, { name: ODD }),
  input('Data', 1, 1, '21'),
  input('Data', 1, 2, '0.5'),
  cmd(CommandTypes.setDefinedName, { name: 'Rate', formula: 'Data!$B$1', scope: null }),
  cmd(CommandTypes.setDefinedName, {
    name: 'Local',
    formula: `'Q3 ''odd'' sheet'!$A$1`,
    scope: ODD,
  }),
  input(ODD, 1, 1, '5'),
  input(ODD, 1, 2, '=Local+1'),
  input('Sheet1', 1, 1, '10'),
  input('Sheet1', 2, 1, '20'),
  input('Sheet1', 3, 1, '=SUM(A1:A2)'),
  input('Sheet1', 4, 1, '=A1/0'),
  input('Sheet1', 5, 1, '=NOSUCHFN(1)'),
  input('Sheet1', 6, 1, '=Data!A1*2'),
  input('Sheet1', 7, 1, '=Rate*100'),
  input('Sheet1', 8, 1, '=SEQUENCE(3)'),
  input('Sheet1', 1, 2, '1,000'),
  input('Sheet1', 2, 2, '50%'),
  input('Sheet1', 3, 2, '$5'),
  input('Sheet1', 4, 2, '2026-10-20'),
  input('Sheet1', 5, 2, "'0042"),
  input('Sheet1', 6, 2, 'TRUE'),
  input('Sheet1', 7, 2, 'plain text'),
  input('Sheet1', 1, 3, '=TEXTJOIN(",",TRUE,"a","b")'),
  input('Sheet1', 2, 3, '=IF(A1>5,"big","small")'),
  input('Sheet1', 3, 3, `='Q3 ''odd'' sheet'!B1`),
  input('Sheet1', 4, 3, '=REGEXMATCH("ab","a")'),
  cmd(CommandTypes.setArrayFormula, {
    sheet: 'Sheet1',
    row: 1,
    col: 5,
    input: '=A1:A2*2',
    width: 1,
    height: 2,
  }),
  cmd(CommandTypes.setRangeStyle, {
    sheet: 'Sheet1',
    range: { r1: 1, c1: 1, r2: 2, c2: 1 },
    style: { 'font.b': true, 'fill.color': '#FFEE00' },
  }),
  cmd(CommandTypes.setRangeStyle, {
    sheet: 'Sheet1',
    range: { r1: 3, c1: 1, r2: 3, c2: 1 },
    style: { num_fmt: '0.00' },
  }),
  cmd(CommandTypes.setColumnsWidth, { sheet: 'Sheet1', c1: 2, c2: 2, width: 150 }),
  cmd(CommandTypes.setRowsHeight, { sheet: 'Sheet1', r1: 3, r2: 3, height: 40 }),
  cmd(CommandTypes.setFrozen, { sheet: 'Sheet1', rows: 1, cols: 1 }),
]

// [sheet, row, col, input, shown]
const CELLS = [
  ['Data', 1, 1, '21', '21'],
  ['Data', 1, 2, '0.5', '0.5'],
  [ODD, 1, 1, '5', '5'],
  [ODD, 1, 2, '=Local+1', '6'],
  ['Sheet1', 1, 1, '10', '10'],
  ['Sheet1', 2, 1, '20', '20'],
  ['Sheet1', 3, 1, '=SUM(A1:A2)', '30.00'],
  ['Sheet1', 4, 1, '=A1/0', '#DIV/0!'],
  ['Sheet1', 5, 1, '=nosuchfn(1)', '#NAME?'], // unknown names come back lower-case
  ['Sheet1', 6, 1, '=Data!A1*2', '42'],
  ['Sheet1', 7, 1, '=Rate*100', '50'],
  ['Sheet1', 8, 1, '=SEQUENCE(3)', '1'],
  ['Sheet1', 9, 1, '2', '2'],
  ['Sheet1', 10, 1, '3', '3'],
  ['Sheet1', 1, 2, '1000', '1,000'],
  ['Sheet1', 2, 2, '0.5', '50%'],
  ['Sheet1', 3, 2, '5', '$5'],
  ['Sheet1', 4, 2, '2026-10-20', '2026-10-20'],
  ['Sheet1', 5, 2, "'0042", '0042'],
  ['Sheet1', 6, 2, 'TRUE', 'TRUE'],
  ['Sheet1', 7, 2, 'plain text', 'plain text'],
  ['Sheet1', 1, 3, '=TEXTJOIN(",",TRUE,"a","b")', 'a,b'],
  ['Sheet1', 2, 3, '=IF(A1>5,"big","small")', 'big'],
  ['Sheet1', 3, 3, `='Q3 ''odd'' sheet'!B1`, '6'],
  ['Sheet1', 4, 3, '=regexmatch("ab","a")', '#NAME?'],
  ['Sheet1', 1, 5, '=A1:A2*2', '20'],
  ['Sheet1', 2, 5, '40', '40'],
]

function readBack(wb) {
  return {
    sheets: wb.getSheets(),
    cells: CELLS.map(([sheet, row, col]) => [
      sheet,
      row,
      col,
      wb.getInput(sheet, row, col),
      wb.getDisplayValue(sheet, row, col),
    ]),
    bold: [wb.getStyle('Sheet1', 1, 1).style.font.b, wb.getStyle('Sheet1', 2, 1).style.font.b],
    fill: wb.getStyle('Sheet1', 1, 1).style.fill.color,
    numFmt: wb.getStyle('Sheet1', 3, 1).style.num_fmt,
    width: wb.getColumnWidth('Sheet1', 2),
    height: wb.getRowHeight('Sheet1', 3),
    frozen: wb.getFrozen('Sheet1'),
  }
}

const EXPECTED = {
  sheets: ['Sheet1', 'Data', ODD],
  cells: CELLS,
  bold: [true, true],
  fill: '#FFEE00',
  numFmt: '0.00',
  width: 150,
  height: 40,
  frozen: { rows: 1, cols: 1 },
}

if (process.env.SHEETS_WRITE_SAVED_BODY) {
  if (pkg.version !== FIXTURE_VERSION) {
    throw new Error(
      `the fixture stands for bodies saved by ${FIXTURE_VERSION}; installed is ${pkg.version}`,
    )
  }
  const wb = createWorkbook()
  for (const c of BUILD) wb.apply(c)
  const body = { engine_version: pkg.version, engine: bytesToBase64(wb.toBytes()) }
  fs.writeFileSync(FIXTURE, JSON.stringify(body, null, 2) + '\n')
}

describe(`a body saved by IronCalc ${FIXTURE_VERSION}`, () => {
  const body = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

  it('was saved by the version it is named after', () => {
    expect(body.engine_version).toBe(FIXTURE_VERSION)
  })

  it(`opens in the installed IronCalc (${pkg.version}) with the same inputs, values, names, styles and sizes`, () => {
    const wb = createWorkbook({ loadBytes: base64ToBytes(body.engine) })
    expect(readBack(wb)).toEqual(EXPECTED)
  })

  it('keeps calculating after it opens', () => {
    const wb = createWorkbook({ loadBytes: base64ToBytes(body.engine) })
    wb.apply(input('Data', 1, 1, '100'))
    expect(wb.getDisplayValue('Sheet1', 6, 1)).toBe('200')
    wb.apply(input(ODD, 1, 1, '9'))
    expect(wb.getDisplayValue('Sheet1', 3, 3)).toBe('10')
  })

  it('matches what the same steps build today', () => {
    const wb = createWorkbook()
    for (const c of BUILD) wb.apply(c)
    expect(readBack(wb)).toEqual(EXPECTED)
  })
})
