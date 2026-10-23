import { describe, expect, it } from 'vitest'

import { nameBoxLabel, parseNameBox } from './name-box.js'

// ISSUES #66: the name box couldn't be typed into, and a Shift+arrow range
// showed only its first cell.
describe('name box label', () => {
  it('names a cell, a range, rows and columns', () => {
    expect(nameBoxLabel({ r0: 0, c0: 0, r1: 0, c1: 0, mode: 'cell' })).toBe('A1')
    expect(nameBoxLabel({ r0: 0, c0: 0, r1: 1, c1: 1, mode: 'cell' })).toBe('A1:B2')
    expect(nameBoxLabel({ r0: 2, c0: 0, r1: 4, c1: 25, mode: 'row' })).toBe('3:5')
    expect(nameBoxLabel({ r0: 0, c0: 1, r1: 999, c1: 3, mode: 'col' })).toBe('B:D')
  })
})

describe('typing into the name box', () => {
  const parse = (t: string) => parseNameBox(t, 1000, 26)
  it('reads a cell, in any case, with or without $', () => {
    expect(parse('k40')).toEqual({ r0: 39, c0: 10, r1: 39, c1: 10, mode: 'cell' })
    expect(parse(' $B$2 ')).toEqual({ r0: 1, c0: 1, r1: 1, c1: 1, mode: 'cell' })
  })
  it('reads a range, whichever corner comes first', () => {
    expect(parse('B5:A1')).toEqual({ r0: 0, c0: 0, r1: 4, c1: 1, mode: 'cell' })
  })
  it('reads whole rows and columns', () => {
    expect(parse('3:5')).toEqual({ r0: 2, c0: 0, r1: 4, c1: 25, mode: 'row' })
    expect(parse('d:b')).toEqual({ r0: 0, c0: 1, r1: 999, c1: 3, mode: 'col' })
  })
  it('rejects anything else, and cells off the sheet', () => {
    for (const t of ['', 'hello', 'A1:', 'A1:B2:C3', 'A0', 'AA1', 'A1001', '0:2'])
      expect(parse(t)).toBeNull()
  })
})
