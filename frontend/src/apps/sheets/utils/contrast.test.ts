import { describe, it, expect } from 'vitest'
import { relativeLuminance, prefersLightInk } from './contrast.js'

describe('relativeLuminance', () => {
  it('spans the full range between black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 4)
  })

  it('weights green above red above blue, as the eye does', () => {
    const red = relativeLuminance('#ff0000') as number
    const green = relativeLuminance('#00ff00') as number
    const blue = relativeLuminance('#0000ff') as number
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('reads shorthand hex and rgb() the same as full hex', () => {
    const full = relativeLuminance('#aabbcc')
    expect(relativeLuminance('#abc')).toBe(full)
    expect(relativeLuminance('rgb(170, 187, 204)')).toBe(full)
  })

  it('returns null for a colour it cannot read, including translucent ones', () => {
    expect(relativeLuminance('rebeccapurple')).toBeNull()
    expect(relativeLuminance('var(--ink-gray-9)')).toBeNull()
    expect(relativeLuminance('oklch(0.979 0 0)')).toBeNull()
    expect(relativeLuminance('rgba(0, 0, 0, 0.2)')).toBeNull()
    expect(relativeLuminance('#aabbcc80')).toBeNull()
    expect(relativeLuminance(undefined)).toBeNull()
    expect(relativeLuminance('')).toBeNull()
  })
})

describe('prefersLightInk', () => {
  it('asks for dark ink on pale fills and light ink on deep ones', () => {
    // The two ends of the colour-scale palette in the bug report.
    expect(prefersLightInk('#ffffff')).toBe(false)
    expect(prefersLightInk('#0e7490')).toBe(true)
  })

  it('flips somewhere in the mid greys, not at either extreme', () => {
    expect(prefersLightInk('#333333')).toBe(true)
    expect(prefersLightInk('#cccccc')).toBe(false)
  })

  it('hands the decision back when the fill is unreadable or absent', () => {
    expect(prefersLightInk(undefined)).toBeNull()
    expect(prefersLightInk('transparent')).toBeNull()
  })
})
