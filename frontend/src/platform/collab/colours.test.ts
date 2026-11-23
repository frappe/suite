import { describe, expect, it } from 'vitest'

import { PALETTE } from './colours'

// WCAG 2 relative luminance of a #rrggbb colour
function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((channel) => {
    if (channel <= 0.04045) {
      return channel / 12.92
    }

    return ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(one: string, other: string) {
  const [lighter, darker] = [luminance(one), luminance(other)].sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Writer peer colours', () => {
  it('offers ten different colours', () => {
    const solids = new Set(PALETTE.map((colour) => colour.light.solid))

    expect(solids.size).toBe(10)
  })

  it.each(PALETTE)(
    'names and initials on $light.tint read at 4.5:1 or better, in light and dark mode',
    (colour) => {
      expect(contrast(colour.light.ink, colour.light.tint)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colour.dark.ink, colour.dark.tint)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
