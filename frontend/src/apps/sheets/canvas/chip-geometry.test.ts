import { describe, expect, it } from 'vitest'

import { chipColor, chipPaletteColor } from './chip-geometry.js'

describe('chipPaletteColor', () => {
  it('cycles the palette by position', () => {
    expect(chipPaletteColor(0)).toBe(chipPaletteColor(8)) // 8-colour palette wraps
    expect(chipPaletteColor(0)).not.toBe(chipPaletteColor(1))
  })

  it('handles negative indices without going out of range', () => {
    expect(chipPaletteColor(-1)).toBe(chipPaletteColor(7))
  })
})

describe('chipColor', () => {
  const rule = { type: 'list', options: ['Yes', 'No', 'Maybe'], colors: { Yes: '#22c55e' } }

  it("uses the rule's custom colour when the option has one", () => {
    expect(chipColor('Yes', rule)).toBe('#22c55e')
  })

  it("falls back to the palette slot for the option's position", () => {
    expect(chipColor('No', rule)).toBe(chipPaletteColor(1))
    expect(chipColor('Maybe', rule)).toBe(chipPaletteColor(2))
  })

  it('gives adjacent options distinct auto colours', () => {
    expect(chipColor('No', rule)).not.toBe(chipColor('Maybe', rule))
  })

  it('hashes to a palette colour when there is no rule context', () => {
    const c = chipColor('anything')
    expect(c).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('hashes a value that is not among the options', () => {
    expect(chipColor('Nope', rule)).toMatch(/^#[0-9A-F]{6}$/i)
  })
})
