// Opening the in-cell editor must not move the text: the <textarea> lays its
// first line out where the canvas drew it (capitals centred on the cell's
// white area, 4px in from the left), and its border sits on the selection
// frame (2px centred on the gridline).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOverlay } from './overlay.js'

// Font metrics the stubbed canvas reports, as shares of the font size.
const ASC = 0.97
const DESC = 0.24
const CAP = 0.73

const px = (v: string) => parseFloat(v)

beforeEach(() => {
  // The overlay measures on an OffscreenCanvas (jsdom has none).
  class FakeOffscreenCanvas {
    getContext() {
      const ctx = {
        font: '13px Inter',
        textBaseline: 'alphabetic',
        measureText() {
          const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)![1])
          return {
            width: 0,
            fontBoundingBoxAscent: size * ASC,
            fontBoundingBoxDescent: size * DESC,
            actualBoundingBoxAscent: size * CAP,
          }
        },
      }
      return ctx
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

// Where the textarea puts its first line's capitals and text start, from its
// inline styles: CSS centres the font's ascent + descent in the line box.
function layout(x: number, y: number, w: number, h: number, fontSize = 13, zoom = 1) {
  const overlay = createOverlay(document.body)
  overlay.position(x, y, w, h, { fontSize }, zoom)
  const s = overlay.el.style
  const size = px(s.fontSize)
  const lineH = px(s.lineHeight)
  const contentTop = px(s.top) + px(s.borderTopWidth) + px(s.paddingTop)
  const baseline = contentTop + (lineH - size * (ASC + DESC)) / 2 + size * ASC
  return {
    s,
    capCentre: baseline - (size * CAP) / 2,
    textLeft: px(s.left) + px(s.borderLeftWidth) + px(s.paddingLeft),
  }
}

describe('in-cell editor lines up with the canvas', () => {
  for (const h of [21, 24, 25, 28, 40]) {
    it(`centres the capitals where the canvas does in a ${h}px row`, () => {
      expect(layout(150, 48, 100, h).capCentre).toBeCloseTo(48 + (h + 1) / 2, 5)
    })
  }

  it('follows the zoom', () => {
    // At zoom 0.8 a 24px row is 19.2px on screen; its gridline is 0.8px.
    const { capCentre, textLeft } = layout(120, 38.4, 80, 19.2, 13, 0.8)
    expect(capCentre).toBeCloseTo(38.4 + (19.2 + 0.8) / 2, 5)
    expect(textLeft).toBeCloseTo(120 + 4 * 0.8, 5)
  })

  it('starts the text 4px into the cell, like the canvas', () => {
    expect(layout(150, 48, 100, 24).textLeft).toBe(154)
  })

  it('adds no letter spacing the canvas does not draw', () => {
    expect(layout(150, 48, 100, 24).s.letterSpacing).toMatch(/^(0|0px|normal)?$/)
  })

  it('puts its border on the selection frame', () => {
    const { s } = layout(150, 48, 100, 24)
    // Frame: 2px centred on the gridlines, i.e. x 149…251, y 47…73.
    expect([px(s.left), px(s.top), px(s.width), px(s.height)]).toEqual([149, 47, 102, 26])
    expect(px(s.borderTopWidth)).toBe(2)
  })
})
