import { describe, it, expect, afterEach, vi } from 'vitest'
import { AlignmentType, LevelFormat } from 'docx'
import { pxToTwips, toDocxLine } from '@/apps/writer/utils/typography'
import {
  cssColorToDocx,
  cssBackgroundToDocx,
  cssFontToDocx,
  pxToDocxSize,
  cssFontWeightToBold,
  resolveAlignment,
  clampSpan,
  resolveHref,
  fitImageSize,
  paragraphSpacing,
  buildListLevels,
  randomId,
  countCols,
  computeColumnWidths,
} from './docxexporter.js'

// Tiny duck-typed stand-ins for the DOM elements these helpers read from —
// only the methods/properties each function actually touches, same spirit
// as sheet.test.ts's local `column()` helper.
const fakeEl = (attrs: Record<string, string | null> = {}) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})
const fakeRow = (cells: ReturnType<typeof fakeEl>[]) => ({
  querySelectorAll: () => cells,
})

describe('cssColorToDocx — CSS color → docx hex', () => {
  it('falsy input → undefined', () => {
    expect(cssColorToDocx(undefined)).toBeUndefined()
    expect(cssColorToDocx('')).toBeUndefined()
  })
  it('known palette var resolves', () => {
    expect(cssColorToDocx('var(--prose-color-red)')).toBe('DC2626')
  })
  it('unknown var is not a hex color either → undefined', () => {
    expect(cssColorToDocx('var(--not-a-real-color)')).toBeUndefined()
  })
  it('6-digit hex, with or without #, is uppercased', () => {
    expect(cssColorToDocx('#1a2b3c')).toBe('1A2B3C')
    expect(cssColorToDocx('1a2b3c')).toBe('1A2B3C')
  })
  it('3-digit hex shorthand expands', () => {
    expect(cssColorToDocx('#abc')).toBe('AABBCC')
  })
  it('surrounding whitespace is trimmed', () => {
    expect(cssColorToDocx('  #1a2b3c  ')).toBe('1A2B3C')
  })
  it('rgb()/hsl() are not parsed — known gap, not a hex or mapped var', () => {
    expect(cssColorToDocx('rgb(255, 0, 0)')).toBeUndefined()
  })
  it('a hex string of the wrong length (too long or too short) is rejected, not truncated', () => {
    expect(cssColorToDocx('#1a2b3c4d')).toBeUndefined()
    expect(cssColorToDocx('#abcd')).toBeUndefined()
  })
})

describe('cssBackgroundToDocx — highlight var → docx hex', () => {
  it('falsy input → undefined', () => {
    expect(cssBackgroundToDocx(undefined)).toBeUndefined()
  })
  it('known highlight var resolves to its tint', () => {
    expect(cssBackgroundToDocx('var(--prose-highlight-red)')).toBe('FECACA')
  })
  it('falls through to cssColorToDocx for a plain hex', () => {
    expect(cssBackgroundToDocx('#112233')).toBe('112233')
  })
  it('unknown var → undefined', () => {
    expect(cssBackgroundToDocx('var(--not-a-real-highlight)')).toBeUndefined()
  })
  it('surrounding whitespace is trimmed before the lookup', () => {
    expect(cssBackgroundToDocx('  var(--prose-highlight-red)  ')).toBe('FECACA')
  })
})

describe('cssFontToDocx — CSS font-family → docx font name', () => {
  it('falsy input → undefined', () => {
    expect(cssFontToDocx(undefined)).toBeUndefined()
  })
  it('known var maps to its display name', () => {
    expect(cssFontToDocx('var(--font-inter)')).toBe('Inter')
  })
  it('unmapped family list takes the first family', () => {
    expect(cssFontToDocx('Arial, sans-serif')).toBe('Arial')
  })
  it('quotes (single or double) around the family are stripped', () => {
    expect(cssFontToDocx('"Comic Sans MS", cursive')).toBe('Comic Sans MS')
    expect(cssFontToDocx("'Times New Roman', serif")).toBe('Times New Roman')
  })
  it('whitespace-only value → undefined', () => {
    expect(cssFontToDocx('   ')).toBeUndefined()
  })
  it('a padded known-font key still hits the map — the outer trim runs before the lookup, not after', () => {
    // without the outer trim, '  inter  ' misses FONT_MAP entirely (no such
    // key) and falls through to the raw fallback, returning lowercase
    // 'inter' instead of the correctly-cased 'Inter'
    expect(cssFontToDocx('  inter  ')).toBe('Inter')
  })
  it('whitespace before the comma in a family list is trimmed off the extracted name', () => {
    expect(cssFontToDocx('Arial , sans-serif')).toBe('Arial')
  })
})

describe('pxToDocxSize — CSS px → docx half-points', () => {
  it('falsy input → undefined', () => {
    expect(pxToDocxSize(0)).toBeUndefined()
    expect(pxToDocxSize(null)).toBeUndefined()
    expect(pxToDocxSize('')).toBeUndefined()
  })
  it('non-numeric input → undefined', () => {
    expect(pxToDocxSize('abc')).toBeUndefined()
  })
  it('converts px to half-points, rounded-4', () => {
    expect(pxToDocxSize('15px')).toBe(23)
    expect(pxToDocxSize(20)).toBe(30)
  })
})

describe('cssFontWeightToBold — CSS font-weight → bold?', () => {
  it('falsy input → false', () => {
    expect(cssFontWeightToBold(0)).toBe(false)
    expect(cssFontWeightToBold(undefined)).toBe(false)
  })
  it('numeric weight >= 600 is bold, below is not (boundary)', () => {
    expect(cssFontWeightToBold(600)).toBe(true)
    expect(cssFontWeightToBold(599)).toBe(false)
  })
  it('string weight is parsed the same way', () => {
    expect(cssFontWeightToBold('700')).toBe(true)
    expect(cssFontWeightToBold('400')).toBe(false)
  })
  it('the CSS keyword "bold" is not recognized — known gap, parses as NaN', () => {
    expect(cssFontWeightToBold('bold')).toBe(false)
  })
  it('a string weight is parsed with parseInt, not raw numeric coercion — a unit-suffixed value like "600px" still parses its numeric prefix', () => {
    // this is the difference between the string branch (parseInt('600px') === 600)
    // and the number branch / raw coercion (Number('600px') is NaN)
    expect(cssFontWeightToBold('600px')).toBe(true)
  })
})

describe('resolveAlignment — element style.textAlign → docx AlignmentType', () => {
  it('maps each known value', () => {
    expect(resolveAlignment({ style: { textAlign: 'left' } })).toBe(AlignmentType.LEFT)
    expect(resolveAlignment({ style: { textAlign: 'center' } })).toBe(AlignmentType.CENTER)
    expect(resolveAlignment({ style: { textAlign: 'right' } })).toBe(AlignmentType.RIGHT)
    expect(resolveAlignment({ style: { textAlign: 'justify' } })).toBe(AlignmentType.JUSTIFIED)
  })
  it('is case-insensitive', () => {
    expect(resolveAlignment({ style: { textAlign: 'CENTER' } })).toBe(AlignmentType.CENTER)
  })
  it('missing/empty/unknown value → undefined', () => {
    expect(resolveAlignment({ style: { textAlign: '' } })).toBeUndefined()
    expect(resolveAlignment({ style: {} })).toBeUndefined()
    expect(resolveAlignment({ style: { textAlign: 'diagonal' } })).toBeUndefined()
  })
  it('missing style, or no element at all, does not throw', () => {
    expect(resolveAlignment({})).toBeUndefined()
    expect(resolveAlignment(null)).toBeUndefined()
  })
})

describe('clampSpan — colspan/rowspan attribute → a valid span >= 1', () => {
  it('missing value defaults to 1', () => {
    expect(clampSpan(undefined)).toBe(1)
    expect(clampSpan(null)).toBe(1)
  })
  it('a normal positive integer passes through', () => {
    expect(clampSpan('1')).toBe(1)
    expect(clampSpan('5')).toBe(5)
  })
  it('zero, negative, and non-numeric values all fall back to 1', () => {
    expect(clampSpan('0')).toBe(1)
    expect(clampSpan('-3')).toBe(1)
    expect(clampSpan('abc')).toBe(1)
  })
  it('a decimal string is truncated by parseInt, not rejected', () => {
    expect(clampSpan('3.9')).toBe(3)
  })
})

describe('resolveHref — relative/absolute href → an absolute URL string', () => {
  it('falsy input → null', () => {
    expect(resolveHref(null)).toBeNull()
    expect(resolveHref('')).toBeNull()
  })
  it('an absolute URL is returned normalized but unchanged in origin/path', () => {
    expect(resolveHref('https://example.com/a/b?x=1')).toBe('https://example.com/a/b?x=1')
  })
  it('a relative path resolves against window.location.origin', () => {
    const expected = new URL('/files/x.png', window.location.origin).href
    expect(resolveHref('/files/x.png')).toBe(expected)
  })
})

describe('fitImageSize — natural img size, scaled down to fit a max width', () => {
  it('size under the max is unchanged', () => {
    expect(fitImageSize(fakeEl({ width: '200', height: '100' }), 1000)).toEqual({
      width: 200,
      height: 100,
    })
  })
  it('missing or non-numeric width/height fall back to 560x315', () => {
    expect(fitImageSize(fakeEl({}), 1000)).toEqual({ width: 560, height: 315 })
    expect(fitImageSize(fakeEl({ width: 'abc', height: 'abc' }), 1000)).toEqual({
      width: 560,
      height: 315,
    })
  })
  it('an explicit zero or negative width/height is also invalid, not a real 0px image', () => {
    expect(fitImageSize(fakeEl({ width: '0', height: '0' }), 1000)).toEqual({
      width: 560,
      height: 315,
    })
    expect(fitImageSize(fakeEl({ width: '-5', height: '-5' }), 1000)).toEqual({
      width: 560,
      height: 315,
    })
  })
  it('oversized images scale down proportionally', () => {
    expect(fitImageSize(fakeEl({ width: '1000', height: '500' }), 400)).toEqual({
      width: 400,
      height: 200,
    })
  })
  it('a falsy/zero max width disables scaling entirely (guard: maxWidthPx > 0)', () => {
    expect(fitImageSize(fakeEl({ width: '1000', height: '500' }), 0)).toEqual({
      width: 1000,
      height: 500,
    })
  })
  it('extreme downscale is still clamped to at least 1x1', () => {
    expect(fitImageSize(fakeEl({ width: '1000000', height: '1' }), 1)).toEqual({
      width: 1,
      height: 1,
    })
  })
})

describe('paragraphSpacing — paragraph-level style overrides document defaults', () => {
  const defaults = { before: 100, after: 200, line: 300, lineRule: 'auto' }

  it('no element / no inline style → defaults pass through untouched', () => {
    expect(paragraphSpacing(null, defaults)).toEqual({ ...defaults, lineRule: 'auto' })
    expect(paragraphSpacing({ style: {} }, defaults)).toEqual({ ...defaults, lineRule: 'auto' })
  })
  it('marginTop overrides "before"; marginBottom and line are untouched', () => {
    const result = paragraphSpacing({ style: { marginTop: '10px' } }, defaults)
    expect(result.before).toBe(pxToTwips('10px'))
    expect(result.after).toBe(defaults.after)
    expect(result.line).toBe(defaults.line)
  })
  it('marginBottom overrides "after"', () => {
    const result = paragraphSpacing({ style: { marginBottom: '5px' } }, defaults)
    expect(result.after).toBe(pxToTwips('5px'))
  })
  it('lineHeight overrides "line"', () => {
    const result = paragraphSpacing({ style: { lineHeight: '1.5' } }, defaults)
    expect(result.line).toBe(toDocxLine('1.5'))
  })
  it('lineRule is always "auto", regardless of overrides', () => {
    expect(paragraphSpacing({ style: { marginTop: '1px' } }, defaults).lineRule).toBe('auto')
  })
})

describe('buildListLevels — numbering definition for a <ul>/<ol>', () => {
  it('always builds 4 levels (0 through MAX_LIST_LEVEL), echoing the reference', () => {
    const { reference, levels } = buildListLevels('ref-1', 'bullets', 'Inter')
    expect(reference).toBe('ref-1')
    expect(levels).toHaveLength(4)
    expect(levels.map((l) => l.level)).toEqual([0, 1, 2, 3])
  })
  it('bullets cycle through 4 distinct bullet characters', () => {
    const { levels } = buildListLevels('r', 'bullets', 'Inter')
    expect(levels.map((l) => l.text)).toEqual(['•', '◦', '▪', '‣'])
    expect(levels.every((l) => l.format === LevelFormat.BULLET)).toBe(true)
  })
  it('non-bullet kind gets decimal/letter/roman/decimal ordered formats and text templates', () => {
    const { levels } = buildListLevels('r', 'numbers', 'Inter')
    expect(levels.map((l) => l.format)).toEqual([
      LevelFormat.DECIMAL,
      LevelFormat.LOWER_LETTER,
      LevelFormat.LOWER_ROMAN,
      LevelFormat.DECIMAL,
    ])
    // the %N. placeholders are what actually render as "1." / "a." / "i." in Word
    expect(levels.map((l) => l.text)).toEqual(['%1.', '%2.', '%3.', '%4.'])
  })
  it('indent grows with depth so nested levels visibly step in', () => {
    const { levels } = buildListLevels('r', 'bullets', 'Inter')
    expect(levels.map((l) => l.style.paragraph.indent.left)).toEqual([720, 1440, 2160, 2880])
  })
  it('every level has zero paragraph spacing and a 28-half-point run size', () => {
    // list items shouldn't get extra before/after spacing between them, and
    // the bullet/number glyph itself renders at a fixed 14pt (28 half-points)
    const { levels } = buildListLevels('r', 'bullets', 'Inter')
    for (const l of levels) {
      expect(l.style.paragraph.spacing).toEqual({ before: 0, after: 0 })
      expect(l.style.run.size).toBe(28)
    }
  })
  it('carries the given font into every level\'s run style', () => {
    const { levels } = buildListLevels('r', 'bullets', 'Comic Sans MS')
    expect(levels.every((l) => l.style.run.font === 'Comic Sans MS')).toBe(true)
  })
})

describe('randomId — collision-free id, robust to missing Web Crypto APIs', () => {
  // globalThis.crypto is a getter-only property in jsdom (no setter), so a
  // direct assignment throws — vi.stubGlobal is the mechanism built for this.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available (the common case)', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid-value' })
    expect(randomId()).toBe('fixed-uuid-value')
  })

  it('falls back to crypto.getRandomValues when randomUUID is unavailable — this is the real-world case of a self-hosted instance served over plain HTTP, where randomUUID is undefined because it requires a secure context', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => arr.fill(0xab),
    })
    // 16 bytes of 0xab, hex-encoded
    expect(randomId()).toBe('ab'.repeat(16))
  })

  it('each byte is zero-padded to two hex digits, not left bare for values under 16', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => arr.fill(0x01),
    })
    expect(randomId()).toBe('01'.repeat(16))
  })

  it('falls through to the final fallback when crypto exists but has neither method — a stripped-down/partial implementation, not just "absent"', () => {
    vi.stubGlobal('crypto', {})
    expect(() => randomId()).not.toThrow()
    expect(typeof randomId()).toBe('string')
  })

  it('falls back to a plain alphanumeric string when crypto is entirely absent, without throwing', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => randomId()).not.toThrow()
    const id = randomId()
    expect(id.length).toBeGreaterThan(0)
    // Date.now().toString(36) + Math.random().toString(36).slice(2): the
    // slice(2) matters — Math.random().toString(36) starts with "0.", and an
    // unsliced result would leak that literal "0." into the id.
    expect(id).toMatch(/^[a-z0-9]+$/)
  })
})

describe('countCols — total columns in a table row, colspan-aware', () => {
  it('counts one per plain cell', () => {
    expect(countCols(fakeRow([fakeEl(), fakeEl(), fakeEl()]))).toBe(3)
  })
  it('a colspan cell counts for its full span', () => {
    expect(countCols(fakeRow([fakeEl({ colspan: '2' }), fakeEl()]))).toBe(3)
  })
  it('missing/invalid colspan counts as 1 (via clampSpan)', () => {
    expect(countCols(fakeRow([fakeEl({ colspan: '0' }), fakeEl()]))).toBe(2)
  })
  it('an empty row has zero columns', () => {
    expect(countCols(fakeRow([]))).toBe(0)
  })
})

describe('computeColumnWidths — resized colwidth attrs → proportional dxa widths', () => {
  it('falls back to an even split when no cell reports a colwidth', () => {
    const trs = [fakeRow([fakeEl(), fakeEl(), fakeEl()])]
    expect(computeColumnWidths(trs, 3, 9000)).toEqual([3000, 3000, 3000])
  })
  it('falls back to an even split when only SOME columns report a width', () => {
    // documents the "empty cell" edge case: one cell with a real resize,
    // its neighbor never resized (no colwidth attr) — the function requires
    // every column to report before it trusts any of them
    const trs = [fakeRow([fakeEl({ colwidth: '100' }), fakeEl()])]
    expect(computeColumnWidths(trs, 2, 9000)).toEqual([4500, 4500])
  })
  it('distributes proportionally to real pixel widths when every column reports one', () => {
    const trs = [fakeRow([fakeEl({ colwidth: '100' }), fakeEl({ colwidth: '300' })])]
    expect(computeColumnWidths(trs, 2, 8000)).toEqual([2000, 6000])
  })
  it('a colwidth spanning multiple columns (colspan) is spread across them', () => {
    const trs = [fakeRow([fakeEl({ colspan: '2', colwidth: '100,200' })])]
    expect(computeColumnWidths(trs, 2, 9000)).toEqual([3000, 6000])
  })
  it('two adjacent colspan cells in the same row each land their own widths in their own columns, without the second cell mistaking an already-set column from the first for one of its own', () => {
    const trs = [
      fakeRow([
        fakeEl({ colspan: '2', colwidth: '100,200' }),
        fakeEl({ colspan: '2', colwidth: '300,400' }),
      ]),
    ]
    expect(computeColumnWidths(trs, 4, 10000)).toEqual([1000, 2000, 3000, 4000])
  })
  it('the first row to report a column\'s width wins — a later row reporting a different width for the same column is ignored, not overwritten', () => {
    const trs = [
      fakeRow([fakeEl({ colwidth: '100' }), fakeEl({ colwidth: '200' })]),
      fakeRow([fakeEl({ colwidth: '999' })]),
    ]
    expect(computeColumnWidths(trs, 2, 9000)).toEqual([3000, 6000])
  })
  it('a single empty-attrs row with unknown widths still returns totalCols entries', () => {
    expect(computeColumnWidths([fakeRow([])], 4, 8000)).toEqual([2000, 2000, 2000, 2000])
  })
  it('a non-numeric segment inside a colspan colwidth is dropped, not left as NaN — the last valid segment is reused for it, same as when too few segments are given at all', () => {
    // colspan=2 cell reports "300,abc" (second segment unparseable). The
    // non-numeric segment is filtered out first, so this behaves exactly
    // like a colwidth of "300" alone spread across 2 columns: both get 300.
    // (Without that filter, the raw NaN would survive the `?? lastValid`
    // fallback — NaN is not null/undefined — leaving that column unset and
    // forcing the whole table back to an even split instead.)
    const trs = [
      fakeRow([fakeEl({ colspan: '2', colwidth: '300,abc' }), fakeEl({ colwidth: '100' })]),
    ]
    expect(computeColumnWidths(trs, 3, 7500)).toEqual([3214, 3214, 1071])
  })
})
