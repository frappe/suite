/** Keep automatic text and shortcut labels legible against the colors Draw renders. */
import { paletteColor } from './palette'

const defaultInk = 'var(--draw-ink, var(--ink-gray-9))'
const themeInks = ['var(--ink-base)', 'var(--ink-gray-9)'] as const
// The theme cache only holds Draw's dark palette and the two ink tokens.
const darkLuminances = new Map<string, number>()
let colorSample: CanvasRenderingContext2D | null | undefined

export function textInk(ink?: string, background?: string, dark = false): string {
  if (ink !== undefined) return paletteColor(ink, dark) ?? ink

  const displayed = paletteColor(background, dark, 'fill')
  return contrastingInk(displayed, displayed !== background)
}

export function contrastingInk(background: string | undefined, themed: boolean): string {
  if (!background) return defaultInk
  const luminance = themed ? renderedLuminance(background) : hexLuminance(background)
  if (luminance === undefined) return defaultInk

  if (themed) {
    const [darkInk, lightInk] = themeInks
    const dark = renderedLuminance(darkInk)
    const light = renderedLuminance(lightInk)
    if (dark !== undefined && light !== undefined) {
      const darkContrast = contrast(luminance, dark)
      const lightContrast = contrast(luminance, light)
      if (Math.max(darkContrast, lightContrast) >= 4.5) {
        return darkContrast >= lightContrast ? darkInk : lightInk
      }
    }
  }

  const dark = contrast(luminance, relativeLuminance(23, 23, 23))
  const light = contrast(luminance, 1)
  if (Math.max(dark, light) < 4.5) {
    return contrast(luminance, 0) >= light ? '#000000' : '#ffffff'
  }
  return dark >= light ? '#171717' : '#ffffff'
}

function renderedLuminance(color: string): number | undefined {
  const cached = darkLuminances.get(color)
  if (cached !== undefined) return cached

  const token = /^var\((--[\w-]+)\)$/.exec(color)?.[1]
  const value = token
    ? getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    : color
  const luminance = hexLuminance(value) ?? sampleLuminance(value)
  if (luminance !== undefined) darkLuminances.set(color, luminance)
  return luminance
}

function sampleLuminance(color: string): number | undefined {
  if (!globalThis.CSS?.supports('color', color)) return undefined
  if (colorSample === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    colorSample = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!colorSample) return undefined

  // Let the browser convert OKLCH tokens and relative colors to displayable sRGB.
  colorSample.clearRect(0, 0, 1, 1)
  colorSample.fillStyle = color
  colorSample.fillRect(0, 0, 1, 1)
  const pixel = colorSample.getImageData(0, 0, 1, 1).data
  return pixel[3] === 255 ? relativeLuminance(pixel[0]!, pixel[1]!, pixel[2]!) : undefined
}

function hexLuminance(color: string): number | undefined {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim())?.[1]
  if (!hex) return undefined
  const rgb = Number.parseInt(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex, 16)
  return relativeLuminance((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
}

function relativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
}

function linearChannel(value: number): number {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
