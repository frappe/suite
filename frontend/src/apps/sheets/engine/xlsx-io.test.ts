import { describe, expect, it } from 'vitest'

import {
  fromXlsxCell,
  mergesFromXlsx,
  mergesToXlsx,
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
  it('empty non-formula cell → null (skip)', () => {
    expect(toXlsxCell('', null, '')).toBe(null)
    expect(toXlsxCell(null, null, '')).toBe(null)
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
