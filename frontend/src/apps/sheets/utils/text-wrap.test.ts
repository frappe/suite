import { describe, expect, it } from 'vitest'

import { getTextWrap, isWrapText, lineHeightFor, WRAP_MODES, wrapLines } from './text-wrap.js'

// Monospace stand-in: every char is 10px wide, matching the canvas mock style.
const mono = (t) => t.length * 10

describe('getTextWrap', () => {
  it('returns "overflow" for missing format / missing field', () => {
    expect(getTextWrap()).toBe('overflow')
    expect(getTextWrap(null)).toBe('overflow')
    expect(getTextWrap({})).toBe('overflow')
  })

  it('returns the new-style enum when set', () => {
    expect(getTextWrap({ textWrap: 'overflow' })).toBe('overflow')
    expect(getTextWrap({ textWrap: 'clip' })).toBe('clip')
    expect(getTextWrap({ textWrap: 'wrap' })).toBe('wrap')
  })

  it('falls back to legacy wrapText boolean — true → "wrap"', () => {
    expect(getTextWrap({ wrapText: true })).toBe('wrap')
  })

  it('legacy wrapText: false → "overflow" (new default, not "clip")', () => {
    // Pre-3-mode users only ever opted into wrap or didn't. There's no
    // legacy "clip" state to migrate from, so treat absence/false as the
    // new default mode.
    expect(getTextWrap({ wrapText: false })).toBe('overflow')
  })

  it('new field wins over legacy field', () => {
    expect(getTextWrap({ textWrap: 'clip', wrapText: true })).toBe('clip')
    expect(getTextWrap({ textWrap: 'overflow', wrapText: true })).toBe('overflow')
  })

  it('rejects unknown enum values and falls through to fallbacks', () => {
    expect(getTextWrap({ textWrap: 'bogus' })).toBe('overflow')
    expect(getTextWrap({ textWrap: 'bogus', wrapText: true })).toBe('wrap')
  })
})

describe('isWrapText', () => {
  it('true only for wrap mode', () => {
    expect(isWrapText({ textWrap: 'wrap' })).toBe(true)
    expect(isWrapText({ wrapText: true })).toBe(true)
    expect(isWrapText({ textWrap: 'overflow' })).toBe(false)
    expect(isWrapText({ textWrap: 'clip' })).toBe(false)
    expect(isWrapText({})).toBe(false)
  })
})

describe('WRAP_MODES', () => {
  it('exposes the three valid modes', () => {
    expect(WRAP_MODES).toEqual(['overflow', 'clip', 'wrap'])
  })
})

describe('lineHeightFor', () => {
  it('keeps the default 13px font at the historical 16px pitch', () => {
    expect(lineHeightFor({})).toBe(16)
    expect(lineHeightFor(null)).toBe(16)
    expect(lineHeightFor({ fontSize: 13 })).toBe(16)
  })

  it('scales with font size so large text does not overlap', () => {
    // The old fixed 16px would overlap a 24px font — this must exceed it.
    expect(lineHeightFor({ fontSize: 24 })).toBe(30)
    expect(lineHeightFor({ fontSize: 24 })).toBeGreaterThan(24)
    expect(lineHeightFor({ fontSize: 40 })).toBe(50)
  })
})

describe('wrapLines', () => {
  it('breaks on hard newlines regardless of width', () => {
    expect(wrapLines('a\nb\nc', 1000, mono)).toEqual(['a', 'b', 'c'])
  })

  it('preserves blank lines from consecutive newlines', () => {
    expect(wrapLines('a\n\nb', 1000, mono)).toEqual(['a', '', 'b'])
  })

  it('soft-wraps a long paragraph — one hard line becomes several visual lines', () => {
    // maxW=50px fits 5 chars; "hello world" wraps to two lines. The row sizer
    // relies on this count, not the hard-newline count of 1.
    const lines = wrapLines('hello world', 50, mono)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines).toEqual(['hello', 'world'])
  })

  it('combines hard newlines with soft-wrapping', () => {
    // "aa bb" wraps to 2 at maxW=20; plus the "cc" paragraph = 3 visual lines.
    expect(wrapLines('aa bb\ncc', 20, mono)).toEqual(['aa', 'bb', 'cc'])
  })
})
