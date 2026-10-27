// frappe-ui's colour subset only: 6-digit hex, rgb() or rgba(); #fff, hsl() and names read as null

export interface Rgb {
  red: number
  green: number
  blue: number
}

const CHANNELS = 3
const BYTE = 255
const PERCENT = 100
const HEX = 16

// A colour as frappe-ui's color-parse reads it, when it's the whole value: a hex of exactly 6
// digits, or rgb() or rgba() with 3 channels; the alpha it ignores comes after a ',' or a '/'
export function rgbOf(value: string): (Rgb & { alpha: number }) | null {
  const colour = value.trim()
  const [, ...pairs] = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour) ?? []
  if (pairs.length) {
    const [red, green, blue] = pairs.map((pair) => parseInt(pair, HEX))
    return { red, green, blue, alpha: 1 }
  }

  const [, body] = /^rgba?\(([^)]+)\)$/i.exec(colour) ?? []
  if (!body) {
    return null
  }

  const [channels, slashed] = body.split('/')
  const parts = channels.split(/[\s,]+/).filter(Boolean)
  const [red, green, blue] = parts.slice(0, CHANNELS).map(byteOf)
  if (parts.length < CHANNELS || [red, green, blue].some(Number.isNaN)) {
    return null
  }

  return { red, green, blue, alpha: alphaOf(slashed ?? parts[CHANNELS] ?? '1') }
}

// An alpha as a fraction, from a number or a percentage, clamped as CSS clamps it
function alphaOf(alpha: string) {
  let amount = parseFloat(alpha)
  if (alpha.trim().endsWith('%')) {
    amount /= PERCENT
  }

  return Math.max(0, Math.min(1, amount))
}

// A channel as frappe-ui's color-parse reads it, a number or a percentage, rounded into a byte
function byteOf(channel: string) {
  let byte = parseFloat(channel)
  if (channel.endsWith('%')) {
    byte = (byte / PERCENT) * BYTE
  }

  return Math.max(0, Math.min(BYTE, Math.round(byte)))
}

// How far apart two colours are straight across red, green and blue, squared: it's only compared,
// so a whole-byte tie stays a tie
export function squaredDistance(from: Rgb, to: Rgb) {
  const [red, green, blue] = [from.red - to.red, from.green - to.green, from.blue - to.blue]
  return red * red + green * green + blue * blue
}

// Whether two colours are the same one by channels and alpha
export function isSameColour(one: string, other: string) {
  const [first, second] = [rgbOf(one), rgbOf(other)]
  return !!first && !!second && squaredDistance(first, second) === 0 && first.alpha === second.alpha
}
