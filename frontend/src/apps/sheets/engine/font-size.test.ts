import { describe, expect, it } from 'vitest'

import { fontSizeOps } from './font-size.js'
import { createFormatsEngine } from './formats.js'

const S = 'Sheet1'
const plusOne = (size: number) => size + 1
const size = (f: ReturnType<typeof createFormatsEngine>, id: string) => f.get(id, S).fontSize

// A whole column or row selected, then font size +/− or a picked size: every
// cell in it changes, as in Google Sheets. Changing only the column/row layer
// left cells with their own size as they were.
describe('fontSizeOps', () => {
  it('+1 on a whole column also steps the cells with their own size', () => {
    const f = createFormatsEngine()
    f.set('B2', { fontSize: 18, bold: true }, S)
    fontSizeOps(f, plusOne).cols([1], S)
    expect(size(f, 'B2')).toBe(19)
    expect(size(f, 'B3')).toBe(14)
    expect(f.get('B2', S).bold).toBe(true)
  })

  it('+1 on a whole column also steps cells sized by their row', () => {
    const f = createFormatsEngine()
    f.setRow(0, { fontSize: 20 }, S)
    fontSizeOps(f, plusOne).cols([1], S)
    expect(size(f, 'B1')).toBe(21)
    expect(size(f, 'A1')).toBe(20)
  })

  it('a picked size on a whole column sets every cell in it', () => {
    const f = createFormatsEngine()
    f.set('B2', { fontSize: 18 }, S)
    f.set('C2', { fontSize: 18 }, S)
    fontSizeOps(f, () => 24).cols([1], S)
    expect(size(f, 'B2')).toBe(24)
    expect(size(f, 'B9')).toBe(24)
    expect(size(f, 'C2')).toBe(18)
  })

  it('+1 on a whole row also steps the cells with their own size', () => {
    const f = createFormatsEngine()
    f.set('C2', { fontSize: 18 }, S)
    fontSizeOps(f, plusOne).rows([1], S)
    expect(size(f, 'C2')).toBe(19)
    expect(size(f, 'D2')).toBe(14)
    expect(size(f, 'C3')).toBeUndefined()
  })

  it('a cell range changes only its own cells', () => {
    const f = createFormatsEngine()
    f.set('B2', { fontSize: 18 }, S)
    fontSizeOps(f, plusOne).cells(['B2', 'B3'], S)
    expect(size(f, 'B2')).toBe(19)
    expect(size(f, 'B3')).toBe(14)
    expect(f.getCol(1, S)).toEqual({})
  })
})
