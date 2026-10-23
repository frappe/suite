import { describe, expect, it } from 'vitest'

import { overlayRectStyle } from './overlay-rect.js'

// Header gutter + a 1000×600 viewport for all cases.
const opts = { headerX: 50, headerY: 24, viewW: 1000, viewH: 600 }
const cell = (x, y, width = 100, height = 24) => ({ x, y, width, height })

describe('overlayRectStyle', () => {
  it('draws a full frame for a range that fits inside the viewport', () => {
    const s = overlayRectStyle(cell(200, 100), cell(400, 300), opts)
    expect(s).toEqual({ top: '100px', left: '200px', width: '300px', height: '224px' })
    // Both far edges are on-screen, so no border is dropped.
    expect(s.borderRightWidth).toBeUndefined()
    expect(s.borderBottomWidth).toBeUndefined()
  })

  it('clamps a range taller/wider than the viewport and drops the clipped borders', () => {
    // br runs to (120000, 120000) — far past a 1000×600 viewport.
    const s = overlayRectStyle(cell(50, 24), cell(118000, 118000, 200, 24), opts)
    // Width/height are pinned to the viewport, never the true extent — this is
    // what stops the grid-wrap from gaining scrollable overflow.
    expect(s.width).toBe('950px') // 1000 - left(50)
    expect(s.height).toBe('576px') // 600 - top(24)
    expect(s.borderRightWidth).toBe('0')
    expect(s.borderBottomWidth).toBe('0')
  })

  it('clamps only the axis that overflows', () => {
    // Wide but short: overflows right only.
    const s = overlayRectStyle(cell(100, 100), cell(5000, 200), opts)
    expect(s.width).toBe('900px') // clamped to viewW - left
    expect(s.borderRightWidth).toBe('0')
    expect(s.height).toBe('124px') // unclamped
    expect(s.borderBottomWidth).toBeUndefined()
  })

  it('keeps the top-left pinned to the header gutter when scrolled under it', () => {
    // tl above/left of the gutter — the visible outline starts at the gutter.
    const s = overlayRectStyle(cell(-300, -200), cell(400, 300), opts)
    expect(s.top).toBe('24px')
    expect(s.left).toBe('50px')
  })

  it('returns null when the range sits entirely under the header gutter', () => {
    // Entirely left of the row-header gutter (right edge ≤ headerX).
    expect(overlayRectStyle(cell(-300, 100), cell(-100, 200), opts)).toBeNull()
    // Entirely above the column-header gutter (bottom edge ≤ headerY).
    expect(overlayRectStyle(cell(200, -200), cell(400, -100), opts)).toBeNull()
  })
})
