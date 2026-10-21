import { describe, expect, it } from 'vitest'

import { applyNumberFmt } from '../utils/format-number.js'
import {
  fromXlsxCell,
  mergesFromXlsx,
  mergesToXlsx,
  numFmtFromEngine,
  numFmtToZ,
  toXlsxCell,
  zToNumFmt,
} from './xlsx-io.js'

describe('numFmtToZ — our format → Excel z', () => {
  it('General / empty → null', () => expect(numFmtToZ('')).toBe(null))
  it('text → @', () => expect(numFmtToZ('text')).toBe('@'))
  it('number, no decimals', () => expect(numFmtToZ('number')).toBe('#,##0'))
  it('number with decimals', () => expect(numFmtToZ('number:2')).toBe('#,##0.00'))
  it('percentage default 2', () => expect(numFmtToZ('percentage')).toBe('0.00%'))
  it('percentage 0', () => expect(numFmtToZ('percentage:0')).toBe('0%'))
  it('currency USD 2', () => expect(numFmtToZ('currency:USD:2')).toBe('"$"#,##0.00'))
  it('currency JPY 0', () => expect(numFmtToZ('currency:JPY:0')).toBe('"¥"#,##0'))
  it('date variants', () => {
    expect(numFmtToZ('date:dmy')).toBe('dd/mm/yyyy')
    expect(numFmtToZ('date:ymd')).toBe('yyyy-mm-dd')
  })
  it('time + datetime', () => {
    expect(numFmtToZ('time:hm12')).toBe('h:mm AM/PM')
    expect(numFmtToZ('datetime:ymd_hms')).toBe('yyyy-mm-dd hh:mm:ss')
  })
  it('custom passes the raw pattern through', () => {
    expect(numFmtToZ('custom:#,##0.00 "kg"')).toBe('#,##0.00 "kg"')
  })
})

describe('zToNumFmt — Excel z → our format', () => {
  it('General → empty', () => expect(zToNumFmt('General')).toBe(''))
  it('@ → text', () => expect(zToNumFmt('@')).toBe('text'))
  it('unknown code preserved as custom', () => {
    expect(zToNumFmt('#,##0.000;[Red]-#,##0.000')).toBe('custom:#,##0.000;[Red]-#,##0.000')
  })
  it('a real percent still maps to percentage', () => {
    expect(zToNumFmt('0.00%')).toBe('percentage')
  })
  it('a quoted or escaped percent is a literal, not a percentage', () => {
    expect(zToNumFmt('0 "50%"')).toBe('custom:0 "50%"')
    expect(zToNumFmt('#,##0\\%')).toBe('custom:#,##0\\%')
  })
})

describe('format round-trips (our → z → our) are lossless', () => {
  const cases = [
    'text',
    'number',
    'number:3',
    'percentage',
    'percentage:0',
    'currency:USD:2',
    'currency:INR:0',
    'currency:CAD:2',
    'currency:AUD:0',
    'currency:JPY:0',
    'date:dmy',
    'date:ymd',
    'time:hms',
    'datetime:ymd_hms',
    'custom:#,##0.00 "kg"',
  ]
  for (const f of cases) {
    it(f, () => expect(zToNumFmt(numFmtToZ(f))).toBe(f))
  }
  it("General round-trips as ''", () => expect(numFmtToZ(zToNumFmt('General'))).toBe(null))
  it('multi-char currency symbols (C$/A$) map back to their code', () => {
    expect(zToNumFmt('"C$"#,##0.00')).toBe('currency:CAD:2')
    expect(zToNumFmt('"A$"#,##0')).toBe('currency:AUD:0')
  })
  it('¥ resolves deterministically to JPY (shared with CNY)', () => {
    expect(zToNumFmt('"¥"#,##0')).toBe('currency:JPY:0')
  })
})

describe('toXlsxCell — engine → SheetJS', () => {
  it('numeric string exports as a number', () => {
    expect(toXlsxCell('42', null, '')).toEqual({ t: 'n', v: 42 })
  })
  it('text stays text', () => {
    expect(toXlsxCell('hello', null, '')).toEqual({ t: 's', v: 'hello' })
  })
  it('leading-zero string stays text (not 007 → 7)', () => {
    expect(toXlsxCell('007', null, '')).toEqual({ t: 's', v: '007' })
  })
  it('leading-zero under a numeric format stays text WITHOUT the numeric z', () => {
    // else the imported cell (text "007" + "#,##0") would render as 7.
    expect(toXlsxCell('007', null, 'number')).toEqual({ t: 's', v: '007' })
  })
  it('a text-formatted number stays text', () => {
    expect(toXlsxCell('42', null, 'text')).toEqual({ t: 's', v: '42', z: '@' })
  })
  it('boolean', () => {
    expect(toXlsxCell('TRUE', null, '')).toEqual({ t: 'b', v: true })
  })
  it('formula keeps f + its computed value', () => {
    expect(toXlsxCell('=SUM(A1:A2)', 7, '')).toEqual({ t: 'n', v: 7, f: 'SUM(A1:A2)' })
  })
  it('carries the number format as z', () => {
    expect(toXlsxCell('1234.5', null, 'currency:USD:2')).toEqual({
      t: 'n',
      v: 1234.5,
      z: '"$"#,##0.00',
    })
  })
  it('date-formatted value becomes a date cell', () => {
    const c = toXlsxCell('2026-03-15', null, 'date:ymd')
    expect(c.t).toBe('d')
    expect(c.v instanceof Date).toBe(true)
    expect(c.z).toBe('yyyy-mm-dd')
  })
  // ISSUES #39: IronCalc dates are day serials, which is also what Excel
  // stores, so a serial goes out as that number with the date code. It was
  // parsed as a date string: new Date('46000') is the year 46000.
  it('a date-formatted serial stays a number with the date code', () => {
    expect(toXlsxCell('46000', null, 'date:dmy')).toEqual({ t: 'n', v: 46000, z: 'dd/mm/yyyy' })
    expect(toXlsxCell('=EOMONTH(A1,0)', '46081', 'date:ymd')).toEqual({
      f: 'EOMONTH(A1,0)',
      t: 'n',
      v: 46081,
      z: 'yyyy-mm-dd',
    })
    expect(toXlsxCell('0.5', null, 'time:hm').v).toBe(0.5)
  })
  // A formula's computed value is IronCalc's display, which IronCalc may
  // have formatted ($4.50, 1,000, 50%): it went out as text.
  it('a formatted formula result is still a number', () => {
    expect(toXlsxCell('=B2*C2', '$4.50', 'currency:USD:2')).toMatchObject({ t: 'n', v: 4.5 })
    expect(toXlsxCell('=SUM(A1:A3)', '1,015', '')).toEqual({ f: 'SUM(A1:A3)', t: 'n', v: 1015 })
    expect(toXlsxCell('=A1*2', '100%', '')).toMatchObject({ t: 'n', v: 1 })
    expect(toXlsxCell('=A1&"x"', '12 apples', '')).toMatchObject({ t: 's', v: '12 apples' })
  })
  it('empty non-formula cell → null (skip)', () => {
    expect(toXlsxCell('', null, '')).toBe(null)
    expect(toXlsxCell(null, null, '')).toBe(null)
  })
})

// IronCalc formats a typed `$1.50`, `15%` or `1,000` itself; copy and fill
// carry that format into the side store with this.
describe('numFmtFromEngine — IronCalc num_fmt → our format', () => {
  it('maps the formats typing produces', () => {
    // A currency, not a custom pattern, so the decimal buttons can change it.
    expect(numFmtFromEngine('$#,##0.00')).toBe('currency:USD:2')
    expect(applyNumberFmt('1.5', numFmtFromEngine('$#,##0.00'))).toBe('$1.50')
    expect(numFmtFromEngine('$#,##0')).toBe('currency:USD:0')
    expect(numFmtFromEngine('€#,##0')).toBe('custom:€#,##0') // our EUR paints 2 €
    expect(numFmtFromEngine('#,##0$')).toBe('custom:#,##0$')
    expect(numFmtFromEngine('"₹"#,##0.00')).toBe('currency:INR:2')
    expect(numFmtFromEngine('#,##0%')).toBe('percentage:0')
    expect(numFmtFromEngine('#,##0.00%')).toBe('percentage')
    expect(numFmtFromEngine('#,##0')).toBe('number')
  })
  it('leaves general, text and dates alone', () => {
    // A date's input is its typed text, which re-parses to the same date.
    for (const code of ['general', 'General', '', '@', 'yyyy-mm-dd', 'm/d/yyyy', 'h:mm AM/PM'])
      expect(numFmtFromEngine(code)).toBe('')
  })
})

describe('numFmtFromEngine with dates', () => {
  // Clear formatting resets IronCalc's format; its undo needs the date look
  // too, since the cell then holds a bare serial.
  it('maps date and time codes when asked', () => {
    const d = (code: string) => numFmtFromEngine(code, { dates: true })
    expect(d('yyyy-mm-dd')).toBe('date:ymd')
    expect(d('mm/dd/yyyy')).toBe('date:mdy')
    expect(d('m/d/yyyy')).toBe('date:mdy')
    expect(d('dd/mm/yyyy')).toBe('date:dmy')
    expect(d('m/d/yyyy h:mm')).toBe('datetime')
    expect(d('h:mm AM/PM')).toBe('time:hm12')
    expect(d('$#,##0.00')).toBe('currency:USD:2')
    expect(d('general')).toBe('')
  })
})

describe('fromXlsxCell — SheetJS → engine', () => {
  it('number', () => expect(fromXlsxCell({ t: 'n', v: 42 })).toEqual({ value: '42', fmt: '' }))
  it('string', () => expect(fromXlsxCell({ t: 's', v: 'hi' })).toEqual({ value: 'hi', fmt: '' }))
  it('boolean', () =>
    expect(fromXlsxCell({ t: 'b', v: false })).toEqual({ value: 'FALSE', fmt: '' }))
  it('formula regains its =', () => {
    expect(fromXlsxCell({ t: 'n', v: 7, f: 'SUM(A1:A2)' })).toEqual({
      value: '=SUM(A1:A2)',
      fmt: '',
    })
  })
  it('z-code maps back to our format', () => {
    expect(fromXlsxCell({ t: 'n', v: 1234.5, z: '"$"#,##0.00' })).toEqual({
      value: '1234.5',
      fmt: 'currency:USD:2',
    })
  })
  it('date cell → iso string + date format (UTC-anchored)', () => {
    const d = new Date(Date.UTC(2026, 2, 15))
    expect(fromXlsxCell({ t: 'd', v: d, z: 'yyyy-mm-dd' })).toEqual({
      value: '2026-03-15',
      fmt: 'date:ymd',
    })
  })
  it('null cell is inert', () => expect(fromXlsxCell(null)).toEqual({ value: '', fmt: '' }))
})

describe('date round-trip is timezone-independent', () => {
  // The whole point of UTC anchoring: export→import yields the same date string
  // regardless of the runner's local zone.
  it('bare date', () => {
    expect(fromXlsxCell(toXlsxCell('2026-03-15', null, 'date:ymd'))).toEqual({
      value: '2026-03-15',
      fmt: 'date:ymd',
    })
  })
  it('datetime', () => {
    expect(fromXlsxCell(toXlsxCell('2026-03-15 14:30:00', null, 'datetime:ymd_hms'))).toEqual({
      value: '2026-03-15 14:30:00',
      fmt: 'datetime:ymd_hms',
    })
  })
})

describe('merge mapping', () => {
  it('engine masterMap → SheetJS !merges', () => {
    expect(mergesToXlsx({ A1: { r: 0, c: 0, rowSpan: 2, colSpan: 3 } })).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 1, c: 2 } },
    ])
  })
  it('!merges → engine rects', () => {
    expect(mergesFromXlsx([{ s: { r: 0, c: 0 }, e: { r: 1, c: 2 } }])).toEqual([
      { r0: 0, c0: 0, r1: 1, c1: 2 },
    ])
  })
  it('round-trips', () => {
    const master = { B2: { r: 1, c: 1, rowSpan: 3, colSpan: 2 } }
    const [rect] = mergesFromXlsx(mergesToXlsx(master))
    expect(rect).toEqual({ r0: 1, c0: 1, r1: 3, c1: 2 })
  })
})
