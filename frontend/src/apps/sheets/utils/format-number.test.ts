import { describe, expect, it } from 'vitest'

import {
  applyNumberFmt,
  buildNumberFmt,
  dateSerialFromShown,
  parseNumberFmt,
} from './format-number.js'

describe('parseNumberFmt', () => {
  it('returns empty fields for falsy input', () => {
    expect(parseNumberFmt('')).toEqual({ type: '', variant: '', decimals: null })
    expect(parseNumberFmt(null)).toEqual({ type: '', variant: '', decimals: null })
    expect(parseNumberFmt(undefined)).toEqual({ type: '', variant: '', decimals: null })
  })

  it('parses bare type', () => {
    expect(parseNumberFmt('number')).toEqual({ type: 'number', variant: '', decimals: null })
    expect(parseNumberFmt('currency')).toEqual({ type: 'currency', variant: '', decimals: null })
  })

  it('parses legacy two-part `type:N` as decimals-only (no variant)', () => {
    expect(parseNumberFmt('number:3')).toEqual({ type: 'number', variant: '', decimals: 3 })
    expect(parseNumberFmt('currency:0')).toEqual({ type: 'currency', variant: '', decimals: 0 })
  })

  it('parses two-part `type:variant` as variant-only', () => {
    expect(parseNumberFmt('currency:INR')).toEqual({
      type: 'currency',
      variant: 'INR',
      decimals: null,
    })
    expect(parseNumberFmt('date:dmy')).toEqual({ type: 'date', variant: 'dmy', decimals: null })
  })

  it('parses three-part `type:variant:N`', () => {
    expect(parseNumberFmt('currency:INR:2')).toEqual({
      type: 'currency',
      variant: 'INR',
      decimals: 2,
    })
    expect(parseNumberFmt('number:in:0')).toEqual({ type: 'number', variant: 'in', decimals: 0 })
  })

  it('handles empty decimals slot in three-part form', () => {
    expect(parseNumberFmt('currency:INR:')).toEqual({
      type: 'currency',
      variant: 'INR',
      decimals: null,
    })
  })
})

describe('buildNumberFmt', () => {
  it('returns empty string for no type', () => {
    expect(buildNumberFmt('', '', null)).toBe('')
    expect(buildNumberFmt(null, 'INR', 2)).toBe('')
  })

  it('emits bare type when no variant + no decimals', () => {
    expect(buildNumberFmt('number', '', null)).toBe('number')
  })

  it('emits legacy `type:N` when decimals-only (backwards-compat)', () => {
    expect(buildNumberFmt('number', '', 3)).toBe('number:3')
    expect(buildNumberFmt('currency', '', 0)).toBe('currency:0')
  })

  it('emits `type:variant` when variant-only', () => {
    expect(buildNumberFmt('currency', 'INR', null)).toBe('currency:INR')
    expect(buildNumberFmt('date', 'dmy', null)).toBe('date:dmy')
  })

  it('emits `type:variant:N` when both', () => {
    expect(buildNumberFmt('currency', 'INR', 2)).toBe('currency:INR:2')
    expect(buildNumberFmt('number', 'in', 0)).toBe('number:in:0')
  })

  it('round-trips through parseNumberFmt', () => {
    for (const fmt of [
      'number',
      'number:3',
      'currency:USD:2',
      'currency:INR',
      'date:dmy',
      'number:in:0',
    ]) {
      const { type, variant, decimals } = parseNumberFmt(fmt)
      expect(buildNumberFmt(type, variant, decimals)).toBe(fmt)
    }
  })
})

describe('applyNumberFmt — backwards-compat baseline', () => {
  // These pin the existing behaviour from before the grammar extension.
  // New variant renderers land in subsequent commits — until then, an
  // unknown variant just falls through to the default for that type.
  it('returns value unchanged when no format', () => {
    expect(applyNumberFmt('hello', '')).toBe('hello')
    expect(applyNumberFmt(42, null)).toBe(42)
  })

  it('text passes value through as string', () => {
    expect(applyNumberFmt(42, 'text')).toBe('42')
    expect(applyNumberFmt(null, 'text')).toBe('')
  })

  it('number applies decimals', () => {
    expect(applyNumberFmt(1234.5, 'number:2')).toBe(
      (1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    )
  })

  it('currency defaults to USD with 2 decimals', () => {
    // Locale-sensitive output; just assert it contains the USD symbol and the integer part.
    const out = applyNumberFmt(1234, 'currency')
    expect(out).toMatch(/\$/)
    expect(out).toContain('1,234')
  })

  it('legacy currency:N still works', () => {
    expect(applyNumberFmt(10, 'currency:0')).toBe('$10')
  })

  it('percentage scales x100 and appends %', () => {
    expect(applyNumberFmt(0.25, 'percentage')).toBe('25.00%')
    expect(applyNumberFmt(0.5, 'percentage:0')).toBe('50%')
  })

  it('non-numeric value with numeric format passes through', () => {
    expect(applyNumberFmt('abc', 'number')).toBe('abc')
    expect(applyNumberFmt('abc', 'currency')).toBe('abc')
  })
})

describe('applyNumberFmt — currency variants', () => {
  // Intl output is locale-data-dependent, so assertions check for the
  // currency symbol + the grouped digits rather than exact glyph-for-glyph.
  it('USD uses $ with US grouping', () => {
    const out = applyNumberFmt(1234567.89, 'currency:USD:2')
    expect(out).toContain('$')
    expect(out).toContain('1,234,567')
  })

  it('INR uses ₹ with Indian lakhs grouping', () => {
    const out = applyNumberFmt(1234567.89, 'currency:INR:2')
    expect(out).toContain('₹')
    // en-IN groups as 12,34,567 — first group is 3, then 2s.
    expect(out).toContain('12,34,567')
  })

  it('EUR formats with € (de-DE conventions)', () => {
    const out = applyNumberFmt(1234.5, 'currency:EUR:2')
    expect(out).toContain('€')
    // de-DE uses period as thousands sep: 1.234,50
    expect(out).toMatch(/1[.\s  ]234/)
  })

  it('GBP uses £', () => {
    expect(applyNumberFmt(99, 'currency:GBP:0')).toContain('£')
  })

  it('JPY defaults to 0 decimals', () => {
    const out = applyNumberFmt(12345, 'currency:JPY')
    // ja-JP locale emits fullwidth yen (￥); en-* would emit halfwidth (¥).
    expect(out).toMatch(/[¥￥]/)
    expect(out).not.toContain('.')
  })

  it('unknown currency variant falls back to USD', () => {
    expect(applyNumberFmt(10, 'currency:XYZ:0')).toBe('$10')
  })

  it('bare `currency` still defaults to USD (backwards-compat)', () => {
    expect(applyNumberFmt(10, 'currency:0')).toBe('$10')
    expect(applyNumberFmt(10, 'currency')).toMatch(/^\$10/)
  })
})

// The grid formats IronCalc's display string, which IronCalc has already
// formatted for a typed `1,000`, `50%` or `$1.50`. Reading that with
// parseFloat gave 1, 50 and NaN: `1,000` + the $ button showed $1.00 and
// `50%` + the % button showed 5000.00%.
describe('applyNumberFmt — reads the number back from a formatted display', () => {
  it('drops grouping commas', () => {
    expect(applyNumberFmt('1,000', 'currency')).toBe('$1,000.00')
    expect(applyNumberFmt('1,234,567.5', 'number:1')).toMatch(/^1,234,567\.5$/)
  })
  it('reads a percent as its fraction', () => {
    expect(applyNumberFmt('50%', 'percentage')).toBe('50.00%')
    expect(applyNumberFmt('250%', 'currency')).toBe('$2.50')
    expect(applyNumberFmt('12.5%', 'number:3')).toMatch(/^0\.125$/)
  })
  it('drops a currency symbol', () => {
    expect(applyNumberFmt('$1.50', 'percentage:0')).toBe('150%')
    expect(applyNumberFmt('-$3', 'currency:INR:0')).toBe('-₹3')
    expect(applyNumberFmt('€2', 'number:2')).toMatch(/^2\.00$/)
    expect(applyNumberFmt('₹1,50,000', 'number:in:0')).toBe('1,50,000')
    expect(applyNumberFmt('5$', 'number:1')).toMatch(/^5\.0$/)
  })
  it('custom patterns read it the same way', () => {
    expect(applyNumberFmt('250%', 'custom:$#,##0.00')).toBe('$2.50')
    expect(applyNumberFmt('1,000', 'custom:#,##0.0')).toBe('1,000.0')
  })
  it('reads scientific notation', () => {
    expect(applyNumberFmt('1.5E+11', 'number:us:0')).toBe('150,000,000,000')
  })
  it('leaves text that only starts with a number alone', () => {
    expect(applyNumberFmt('12 apples', 'number:2')).toBe('12 apples')
    expect(applyNumberFmt('1-2', 'currency')).toBe('1-2')
    expect(applyNumberFmt('%', 'percentage')).toBe('%')
  })
})

describe('applyNumberFmt — date variants', () => {
  // Numbers are IronCalc/Google day serials: days since 1899-12-30, the
  // fraction is the time of day. 45672 = 2025-01-15.
  const serial = 45672

  it('bare `date` defers to user locale (legacy)', () => {
    // Just verify we get *some* date-like string, not the raw number.
    const out = applyNumberFmt(serial, 'date')
    expect(out).not.toBe(String(serial))
    expect(out).toMatch(/2025/)
  })

  it('date:dmy → DD/MM/YYYY', () => {
    expect(applyNumberFmt(serial, 'date:dmy')).toBe('15/01/2025')
  })

  it('date:mdy → MM/DD/YYYY', () => {
    expect(applyNumberFmt(serial, 'date:mdy')).toBe('01/15/2025')
  })

  it('date:ymd → YYYY-MM-DD', () => {
    expect(applyNumberFmt(serial, 'date:ymd')).toBe('2025-01-15')
  })

  it('date:long → "15 Jan 2025"', () => {
    expect(applyNumberFmt(serial, 'date:long')).toBe('15 Jan 2025')
  })

  it('date:full → weekday-prefixed long date', () => {
    expect(applyNumberFmt(serial, 'date:full')).toBe('Wed, 15 Jan 2025')
  })

  it('unknown date variant falls back to locale default', () => {
    expect(applyNumberFmt(serial, 'date:xyz')).toMatch(/2025/)
  })

  // ISSUES #39: a serial (what every IronCalc date function returns, shown
  // as a bare number string) was read as Unix milliseconds → 1970.
  it('reads a number as a day serial, not epoch ms (not 1970)', () => {
    expect(applyNumberFmt(46000, 'date:dmy')).toBe('09/12/2025')
    expect(applyNumberFmt('46000', 'date:long')).toBe('9 Dec 2025')
    expect(applyNumberFmt('46081', 'date:ymd')).toBe('2026-02-28') // an EOMONTH result
    expect(applyNumberFmt(1, 'date:ymd')).toBe('1899-12-31')
    expect(applyNumberFmt(0, 'date:ymd')).toBe('1899-12-30')
    expect(applyNumberFmt(-1, 'date:ymd')).toBe('1899-12-29')
  })

  it('reads a grouped serial (IronCalc showed it as 46,000)', () => {
    expect(applyNumberFmt('46,000', 'date:ymd')).toBe('2025-12-09')
  })

  it('drops the time of day for a date format', () => {
    expect(applyNumberFmt(46000.75, 'date:dmy')).toBe('09/12/2025')
  })

  it('non-numeric value passes through (no serial to parse)', () => {
    expect(applyNumberFmt('hello', 'date:dmy')).toBe('hello')
  })

  // Regression: datetime *strings* (e.g. Frappe creation/modified columns)
  // were parseFloat'd to a small int and rendered as 1970-01-01.
  it('parses a datetime string with microseconds (not 1970)', () => {
    expect(applyNumberFmt('2026-03-15 14:50:30.789345', 'date:ymd')).toBe('2026-03-15')
    expect(applyNumberFmt('2026-03-15 14:50:30.789345', 'date:dmy')).toBe('15/03/2026')
  })

  it('parses a bare date string', () => {
    expect(applyNumberFmt('2026-01-08', 'date:ymd')).toBe('2026-01-08')
  })

  it('time/datetime read the same string', () => {
    expect(applyNumberFmt('2026-03-15 14:50:30.789345', 'time:hm')).toBe('14:50')
    expect(applyNumberFmt('2026-03-15 14:50:30.789345', 'datetime:ymd_hm')).toBe(
      '2026-03-15, 14:50',
    )
  })

  it('still takes a Date instance', () => {
    expect(applyNumberFmt(new Date(2025, 0, 15), 'date:ymd')).toBe('2025-01-15')
  })
})

describe('applyNumberFmt — time variants', () => {
  // The fraction of a day: 15:30:45 = 55845 s / 86400. Serial 45672 + that.
  const serial = 45672 + 55845 / 86400

  it('time:hm → HH:MM (24h)', () => {
    expect(applyNumberFmt(serial, 'time:hm')).toBe('15:30')
  })

  it('time:hms → HH:MM:SS (24h)', () => {
    expect(applyNumberFmt(serial, 'time:hms')).toBe('15:30:45')
  })

  it('time:hm12 → H:MM AM/PM', () => {
    expect(applyNumberFmt(serial, 'time:hm12')).toBe('3:30 PM')
  })

  it('time:hms12 → H:MM:SS AM/PM', () => {
    expect(applyNumberFmt(serial, 'time:hms12')).toBe('3:30:45 PM')
  })

  // ISSUES #39: 0.5 (noon) was 1970-01-01 00:00:00.0005 UTC, i.e. the
  // runner's UTC offset ("05:30" in India).
  it('a bare fraction is a time of day', () => {
    expect(applyNumberFmt(0.5, 'time:hm')).toBe('12:00')
    expect(applyNumberFmt('0.75', 'time:hm12')).toBe('6:00 PM')
    expect(applyNumberFmt(0, 'time:hms')).toBe('00:00:00')
  })

  it('rounds to the nearest second (float noise in the serial)', () => {
    // 14:29:59.9999 in floating point is 14:30:00 in Sheets.
    expect(applyNumberFmt(0.6041666666, 'time:hms')).toBe('14:30:00')
  })

  it('non-numeric value passes through', () => {
    expect(applyNumberFmt('hello', 'time:hm')).toBe('hello')
  })
})

describe('applyNumberFmt — datetime', () => {
  const serial = 45672 + (15 * 3600 + 30 * 60) / 86400

  it('datetime:dmy_hm12 → "DD/MM/YYYY, H:MM AM/PM"', () => {
    expect(applyNumberFmt(serial, 'datetime:dmy_hm12')).toBe('15/01/2025, 3:30 PM')
  })

  it('datetime:ymd_hms → "YYYY-MM-DD, HH:MM:SS"', () => {
    expect(applyNumberFmt(serial, 'datetime:ymd_hms')).toBe('2025-01-15, 15:30:00')
  })

  it('datetime:long_hm → "15 Jan 2025, 15:30"', () => {
    expect(applyNumberFmt(serial, 'datetime:long_hm')).toBe('15 Jan 2025, 15:30')
  })

  it('a time that rounds up to midnight rolls the date over', () => {
    expect(applyNumberFmt(45672.9999999, 'datetime:ymd_hms')).toBe('2025-01-16, 00:00:00')
  })
})

describe('applyNumberFmt — number variants', () => {
  it('number:in groups as Indian lakhs', () => {
    expect(applyNumberFmt(1234567, 'number:in:0')).toBe('12,34,567')
  })

  it('number:us groups with commas every 3 digits', () => {
    expect(applyNumberFmt(1234567, 'number:us:0')).toBe('1,234,567')
  })

  it('legacy number:N (no variant) keeps user-default grouping', () => {
    // Just verify the function doesn't throw and emits something sensible —
    // the exact grouping depends on test-runner locale.
    expect(applyNumberFmt(1234, 'number:0')).toMatch(/\d/)
  })
})

describe('applyCustomFmt — Excel-style patterns', () => {
  const f = (v, p) => applyNumberFmt(v, 'custom:' + p)

  it('pads integer digits with 0', () => {
    expect(f(42, '000')).toBe('042')
  })
  it('# does not pad', () => {
    expect(f(42, '#')).toBe('42')
  })
  it('thousands grouping', () => {
    expect(f(1234567, '#,##0')).toBe('1,234,567')
  })
  it('fixed decimals with rounding', () => {
    expect(f(3.14159, '0.00')).toBe('3.14')
    expect(f(2.5, '0')).toBe('3')
  })
  it('optional decimals trim trailing zeros', () => {
    expect(f(3.5, '0.##')).toBe('3.5')
    expect(f(3, '0.##')).toBe('3')
  })
  it('min decimals pad', () => {
    expect(f(3.5, '0.00')).toBe('3.50')
  })
  it('leading digit dropped when no integer placeholder', () => {
    expect(f(0.5, '#.##')).toBe('.5')
  })
  it('percent scales by 100 and appends %', () => {
    expect(f(0.1234, '0.0%')).toBe('12.3%')
  })
  it('literal prefix/suffix passthrough', () => {
    expect(f(1234.5, '"$"#,##0.00')).toBe('$1,234.50')
    expect(f(12, '#,##0 "kg"')).toBe('12 kg')
  })
  it('escaped literal char', () => {
    expect(f(5, '0\\%')).toBe('5%') // backslash-escaped % is literal, no scaling
  })
  it('negative gets a leading minus', () => {
    expect(f(-1234.5, '#,##0.00')).toBe('-1,234.50')
  })
  it('does not render negative zero when the value rounds to 0', () => {
    expect(f(-0.4, '0')).toBe('0')
    expect(f(-0.001, '0.00')).toBe('0.00')
  })
  it('places the sign before a literal prefix', () => {
    expect(f(-1234.5, '"$"#,##0.00')).toBe('-$1,234.50')
    expect(f(-50, '"$"0')).toBe('-$50')
  })
  it('non-numeric value passes through untouched', () => {
    expect(f('hello', '0.00')).toBe('hello')
  })
  it('parseNumberFmt recognises custom and keeps the raw pattern', () => {
    expect(parseNumberFmt('custom:0.00%')).toEqual({
      type: 'custom',
      pattern: '0.00%',
      variant: '',
      decimals: null,
    })
  })
})

describe('dateSerialFromShown', () => {
  it('reads a date in the order its code gives', () => {
    expect(dateSerialFromShown('12/9/2025', 'm/d/yyyy')).toBe(46000)
    expect(dateSerialFromShown('09/12/2025', 'dd/mm/yyyy')).toBe(46000)
    expect(dateSerialFromShown('2025-12-09', 'yyyy-mm-dd')).toBe(46000)
  })
  it('adds the time of day', () => {
    expect(dateSerialFromShown('12/9/2025 6:00 PM', 'm/d/yyyy h:mm AM/PM')).toBe(46000.75)
    expect(dateSerialFromShown('12/9/2025 12:00 AM', 'm/d/yyyy h:mm AM/PM')).toBe(46000)
  })
  it('is NaN for text or a non-date code', () => {
    expect(dateSerialFromShown('hello', 'm/d/yyyy')).toBeNaN()
    expect(dateSerialFromShown('12/9/2025', 'general')).toBeNaN()
    expect(dateSerialFromShown('12/9/2025', '#,##0')).toBeNaN()
  })
})
