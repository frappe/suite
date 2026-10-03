import { describe, expect, it } from 'vitest'

import { applyNumberFmt, buildNumberFmt, parseNumberFmt } from './format-number.js'

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

describe('applyNumberFmt — date variants', () => {
  // 2025-01-15T00:00:00 UTC — exact ms varies with the test-runner TZ, so we
  // assert on character/format shape rather than exact string.
  const ms = Date.UTC(2025, 0, 15)

  it('bare `date` defers to user locale (legacy)', () => {
    // Just verify we get *some* date-like string, not the raw number.
    const out = applyNumberFmt(ms, 'date')
    expect(out).not.toBe(String(ms))
    expect(out).toMatch(/\d/)
  })

  it('date:dmy → DD/MM/YYYY', () => {
    expect(applyNumberFmt(ms, 'date:dmy')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('date:mdy → MM/DD/YYYY', () => {
    expect(applyNumberFmt(ms, 'date:mdy')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('date:ymd → YYYY-MM-DD', () => {
    expect(applyNumberFmt(ms, 'date:ymd')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('date:long → "15 Jan 2025"', () => {
    const out = applyNumberFmt(ms, 'date:long')
    expect(out).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/)
  })

  it('date:full → weekday-prefixed long date', () => {
    const out = applyNumberFmt(ms, 'date:full')
    expect(out).toMatch(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}$/)
  })

  it('unknown date variant falls back to locale default', () => {
    expect(applyNumberFmt(ms, 'date:xyz')).toMatch(/\d/)
  })

  it('non-numeric value passes through (no ms-since-epoch to parse)', () => {
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
})

describe('applyNumberFmt — time variants', () => {
  // 15:30:45 local — pick a fixed clock-only ms so all assertions stay in
  // local timezone without ms-since-epoch arithmetic.
  const d = new Date(2025, 0, 15, 15, 30, 45)
  const ms = d.getTime()

  it('time:hm → HH:MM (24h)', () => {
    expect(applyNumberFmt(ms, 'time:hm')).toBe('15:30')
  })

  it('time:hms → HH:MM:SS (24h)', () => {
    expect(applyNumberFmt(ms, 'time:hms')).toBe('15:30:45')
  })

  it('time:hm12 → H:MM AM/PM', () => {
    expect(applyNumberFmt(ms, 'time:hm12')).toMatch(/^3:30 PM$/)
  })

  it('time:hms12 → H:MM:SS AM/PM', () => {
    expect(applyNumberFmt(ms, 'time:hms12')).toMatch(/^3:30:45 PM$/)
  })

  it('non-numeric value passes through', () => {
    expect(applyNumberFmt('hello', 'time:hm')).toBe('hello')
  })
})

describe('applyNumberFmt — datetime', () => {
  const d = new Date(2025, 0, 15, 15, 30, 0)
  const ms = d.getTime()

  it('datetime:dmy_hm12 → "DD/MM/YYYY, H:MM AM/PM"', () => {
    expect(applyNumberFmt(ms, 'datetime:dmy_hm12')).toBe('15/01/2025, 3:30 PM')
  })

  it('datetime:ymd_hms → "YYYY-MM-DD, HH:MM:SS"', () => {
    expect(applyNumberFmt(ms, 'datetime:ymd_hms')).toBe('2025-01-15, 15:30:00')
  })

  it('datetime:long_hm → "15 Jan 2025, 15:30"', () => {
    expect(applyNumberFmt(ms, 'datetime:long_hm')).toBe('15 Jan 2025, 15:30')
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
