// Readable ink over a cell fill.
//
// A cell fill is a literal colour: conditional-formatting rules interpolate
// their own hex stops, and the fill picker stores whatever hex you chose.
// Neither follows the light/dark theme. The default cell ink does — it
// resolves `--ink-gray-9`, which is near-white in dark mode. Put the two
// together and a pale colour-scale fill paints white text on a white cell.
//
// So the ink over a fill has to come from the fill, not from the theme.

// WCAG relative luminance, in [0..1]. Returns null for a colour this cannot
// read; callers keep their themed ink rather than guess.
export function relativeLuminance(color) {
  const rgb = _parseRgb(color)
  if (!rgb) return null
  const lin = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

// Luminance where white ink and black ink contrast equally under WCAG:
// sqrt(1.05 * 0.05) - 0.05. Darker than this, light ink wins.
const INK_FLIP = 0.1791

// true  → the fill needs light ink
// false → the fill needs dark ink
// null  → the fill could not be read, so the caller decides
export function prefersLightInk(fill) {
  const l = relativeLuminance(fill)
  return l == null ? null : l < INK_FLIP
}

// Only the opaque forms a cell fill can hold: #rgb, #rrggbb and rgb()/rgba().
// A translucent fill composites over the sheet surface, so its own channels
// do not predict the final contrast — those return null.
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGB = /^rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i

function _parseRgb(color) {
  if (typeof color !== 'string') return null
  const s = color.trim()
  const h3 = HEX3.exec(s)
  if (h3) return { r: parseInt(h3[1] + h3[1], 16), g: parseInt(h3[2] + h3[2], 16), b: parseInt(h3[3] + h3[3], 16) }
  const h6 = HEX6.exec(s)
  if (h6) return { r: parseInt(h6[1], 16), g: parseInt(h6[2], 16), b: parseInt(h6[3], 16) }
  const rgb = RGB.exec(s)
  if (!rgb) return null
  if (rgb[4] != null && parseFloat(rgb[4]) < (rgb[4].endsWith('%') ? 100 : 1)) return null
  return { r: +rgb[1], g: +rgb[2], b: +rgb[3] }
}
