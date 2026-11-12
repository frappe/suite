import { describe, expect, it } from 'vitest'

import { nextIndex, typeAheadMatch } from './listingFocus'

describe('nextIndex', () => {
  it('moves through a list by row and stops at its ends', () => {
    expect(nextIndex('ArrowDown', 0, 5, 1)).toBe(1)
    expect(nextIndex('ArrowUp', 0, 5, 1)).toBeNull()
    expect(nextIndex('ArrowDown', 4, 5, 1)).toBeNull()
    expect(nextIndex('End', 1, 5, 1)).toBe(4)
    expect(nextIndex('Home', 3, 5, 1)).toBe(0)
    expect(nextIndex('ArrowRight', 1, 5, 1)).toBeNull()
  })

  it('moves through a grid by line and by card', () => {
    // Three columns, eight cards: the last line holds two.
    expect(nextIndex('ArrowDown', 1, 8, 3)).toBe(4)
    expect(nextIndex('ArrowUp', 4, 8, 3)).toBe(1)
    expect(nextIndex('ArrowRight', 2, 8, 3)).toBe(3)
    expect(nextIndex('ArrowLeft', 0, 8, 3)).toBeNull()
    // No card below the third column of the middle line: Down goes to the last card.
    expect(nextIndex('ArrowDown', 5, 8, 3)).toBe(7)
    expect(nextIndex('ArrowDown', 6, 8, 3)).toBeNull()
  })

  it('swaps Left and Right in a right-to-left layout', () => {
    expect(nextIndex('ArrowLeft', 1, 8, 3, true)).toBe(2)
    expect(nextIndex('ArrowRight', 1, 8, 3, true)).toBe(0)
  })
})

describe('typeAheadMatch', () => {
  const titles = ['Budget.xlsx', 'beta notes', 'Écoles', 'Ecology', 'Report']

  it('finds the next title with the prefix, wrapping past the end', () => {
    expect(typeAheadMatch(titles, 0, 'r')).toBe(4)
    expect(typeAheadMatch(titles, 4, 'b')).toBe(0)
  })

  it('ignores case and accents', () => {
    expect(typeAheadMatch(titles, -1, 'eco')).toBe(2)
    expect(typeAheadMatch(titles, 2, 'ecolo')).toBe(3)
  })

  it('steps through the titles that start with a letter typed again and again', () => {
    expect(typeAheadMatch(titles, 0, 'bb')).toBe(1)
    expect(typeAheadMatch(titles, 1, 'bbb')).toBe(0)
  })

  it('stays on the current title while a longer prefix still matches it', () => {
    expect(typeAheadMatch(titles, 1, 'be')).toBe(1)
    expect(typeAheadMatch(titles, 1, 'zz')).toBeNull()
  })
})
