import { paletteColor } from './palette'

// Default ink follows the canvas, or contrasts with an explicitly coloured text background.
export function textInk(ink?: string, background?: string, dark = false): string {
  if (ink !== undefined) return paletteColor(ink, dark) ?? ink
  const match = background?.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)
  if (!match) return 'var(--draw-ink, var(--ink-gray-9))'

  const hex = match[1]!
  const expanded = hex.length === 3 ? [...hex].map((channel) => channel + channel).join('') : hex
  const lightness = luminance(expanded)
  const darkLightness = luminance('171717')
  const darkContrast =
    (Math.max(lightness, darkLightness) + 0.05) / (Math.min(lightness, darkLightness) + 0.05)
  const lightContrast = 1.05 / (lightness + 0.05)
  const contrastingInk = darkContrast >= lightContrast ? '#171717' : '#ffffff'
  return paletteColor(background, dark) !== background
    ? (paletteColor(contrastingInk, dark) ?? contrastingInk)
    : contrastingInk
}

function luminance(hex: string): number {
  return (
    linearChannel(hex.slice(0, 2)) * 0.2126 +
    linearChannel(hex.slice(2, 4)) * 0.7152 +
    linearChannel(hex.slice(4, 6)) * 0.0722
  )
}

function linearChannel(hex: string): number {
  const channel = parseInt(hex, 16) / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}
