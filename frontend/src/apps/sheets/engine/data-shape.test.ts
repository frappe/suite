import { describe, expect, it } from 'vitest'

import { columnShapes, guessEncoding, guessHasHeader } from './data-shape'

const FRUIT = ['Apple', 'Banana', 'Cherry', 'Date', 'Elder']
// ISSUES #153: A1:A5 = 10..50, B1:B5 = Apple..Elder, no header row.
const headerless = FRUIT.map((f, i) => [String((i + 1) * 10), f])
const withHeader = [['Score', 'Fruit'], ...headerless]

describe('guessHasHeader', () => {
  it('is false when the first row has a number', () => {
    expect(guessHasHeader(headerless)).toBe(false)
  })

  it('is true when a text first row sits over a column of numbers', () => {
    expect(guessHasHeader(withHeader)).toBe(true)
  })

  it('is true for all-text data, where a header is the common case', () => {
    expect(guessHasHeader([['Name', 'City'], ...FRUIT.map((f) => [f, 'Pune'])])).toBe(true)
  })

  it('is false when the text first row has no number column under it', () => {
    // Data with a gap in the first row: no column turns from text to numbers.
    expect(
      guessHasHeader([
        ['Apple', ''],
        ['Banana', '20'],
        ['Cherry', '30'],
      ]),
    ).toBe(false)
  })

  it('reads formatted numbers as numbers', () => {
    expect(
      guessHasHeader([
        ['$1,000', 'Apple'],
        ['$2,000', 'Banana'],
      ]),
    ).toBe(false)
    expect(
      guessHasHeader([
        ['Price', 'Fruit'],
        ['$1,000', 'Apple'],
        ['50%', 'Banana'],
      ]),
    ).toBe(true)
  })

  it('is false for one row or an empty first row', () => {
    expect(guessHasHeader([['Score', 'Fruit']])).toBe(false)
    expect(
      guessHasHeader([
        ['', ''],
        ['10', 'Apple'],
      ]),
    ).toBe(false)
  })
})

describe('guessEncoding', () => {
  it('puts the text column on X and the number columns in the series', () => {
    expect(guessEncoding(columnShapes(headerless, 0))).toEqual({ x: 1, y: [0] })
    expect(guessEncoding(columnShapes(withHeader, 1))).toEqual({ x: 1, y: [0] })
  })

  it('uses the first column for X when every column is numeric', () => {
    expect(guessEncoding(columnShapes([['1', '2', '3']], 0))).toEqual({ x: 0, y: [1, 2] })
  })

  it('falls back to the first other column when no column is numeric', () => {
    expect(guessEncoding(columnShapes([['a', 'b']], 0))).toEqual({ x: 0, y: [1] })
  })

  it('caps the series', () => {
    const row = ['x', ...Array.from({ length: 12 }, (_, i) => String(i))]
    expect(guessEncoding(columnShapes([row], 0)).y).toHaveLength(8)
  })
})
