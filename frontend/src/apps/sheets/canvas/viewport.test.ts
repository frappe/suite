import { describe, expect, it, vi } from 'vitest'

import { createViewport, watchPixelRatio, type ViewportOptions } from './viewport.js'

// 100 columns × 100px and 1000 rows × 20px, headers 50 × 24: the sheet is
// 10,050 × 20,024 logical px. Geometry here ignores scroll, which is all
// these tests need from colX/rowY (positions relative to the sheet origin).
function setup(over: Partial<ViewportOptions> = {}) {
  const scroll = { x: 0, y: 0 }
  const freeze = { rows: 0, cols: 0 }
  let zoom = 1
  let ratio = 1
  const vp = createViewport({
    scroll,
    geo: {
      colX: (c) => 50 + c * 100 - scroll.x,
      rowY: (r) => 24 + r * 20 - scroll.y,
      cw: () => 100,
      rh: () => 20,
      frozenW: () => freeze.cols * 100,
      frozenH: () => freeze.rows * 20,
    },
    totalCols: () => 100,
    totalRows: () => 1000,
    getZoom: () => zoom,
    getFreeze: () => freeze,
    rowHeaderW: 50,
    colHeaderH: 24,
    pixelRatio: () => ratio,
    ...over,
  })
  return {
    vp,
    scroll,
    freeze,
    setZoom: (z: number) => {
      zoom = z
    },
    setRatio: (r: number) => {
      ratio = r
    },
  }
}

describe('viewport — layout', () => {
  it('sizes the canvas to the viewport', () => {
    const { vp } = setup()
    vp.setViewportSize(800, 600)
    expect(vp.layout()).toEqual({
      cssW: 800,
      cssH: 600,
      styleW: 800,
      styleH: 600,
      backingW: 800,
      backingH: 600,
    })
  })

  it('caps the canvas at the sheet extent', () => {
    const { vp } = setup({ totalCols: () => 3 }) // 50 + 300 px wide
    vp.setViewportSize(800, 600)
    expect(vp.layout().cssW).toBe(350)
  })

  it('shrinks the logical area with zoom, keeping the on-screen size', () => {
    const { vp, setZoom } = setup()
    setZoom(2)
    vp.setViewportSize(800, 600)
    const s = vp.layout()
    expect([s.cssW, s.cssH, s.styleW, s.styleH]).toEqual([400, 300, 800, 600])
  })

  it('reads the pixel ratio at every layout, not once', () => {
    const { vp, setRatio } = setup()
    vp.setViewportSize(800, 600)
    expect(vp.layout().backingW).toBe(800)
    setRatio(2) // browser zoom / monitor change
    expect(vp.layout().backingW).toBe(1600)
  })
})

describe('viewport — scrolling', () => {
  it('clamps scrollTo to the sheet', () => {
    const { vp, scroll } = setup()
    vp.setViewportSize(800, 600)
    vp.layout()
    vp.scrollTo(-10, 1e9)
    expect(scroll).toEqual({ x: 0, y: 20024 - 600 })
  })

  it('reports the scroll model the scrollbars draw from', () => {
    const { vp } = setup()
    vp.setViewportSize(800, 600)
    vp.layout()
    vp.scrollTo(100, 200)
    expect(vp.scrollModel()).toEqual({
      x: { pos: 100, max: 10050 - 800, view: 800, content: 10050 },
      y: { pos: 200, max: 20024 - 600, view: 600, content: 20024 },
      viewportW: 800,
      viewportH: 600,
    })
  })

  it('ensureVisible scrolls down just enough to show a cell below the view', () => {
    const { vp, scroll } = setup()
    vp.setViewportSize(800, 600)
    vp.layout()
    vp.ensureVisible(40, 0) // row 40 sits at y 824..844
    expect(scroll.y).toBe(844 - 600 + 8)
    expect(scroll.x).toBe(0)
  })

  it('ensureVisible scrolls back up to a cell above the view', () => {
    const { vp, scroll } = setup()
    vp.setViewportSize(800, 600)
    vp.layout()
    vp.scrollTo(0, 1000)
    vp.ensureVisible(10, 0)
    expect(scroll.y).toBe(1000 - (24 - (24 + 200 - 1000)))
  })

  it('still scrolls vertically for a cell in a frozen column', () => {
    const { vp, scroll, freeze } = setup()
    freeze.cols = 1
    vp.setViewportSize(800, 600)
    vp.layout()
    vp.ensureVisible(40, 0) // column A is frozen, row 40 is off-screen
    expect(scroll.y).toBeGreaterThan(0)
    expect(scroll.x).toBe(0)
  })
})

describe('watchPixelRatio', () => {
  it('fires on a ratio change and re-arms for the new ratio', () => {
    const queries: { media: string; listeners: (() => void)[] }[] = []
    const win = {
      devicePixelRatio: 1,
      matchMedia(media: string) {
        const q = { media, listeners: [] as (() => void)[] }
        queries.push(q)
        return {
          addEventListener: (_: string, cb: () => void) => q.listeners.push(cb),
          removeEventListener: (_: string, cb: () => void) => {
            q.listeners = q.listeners.filter((l) => l !== cb)
          },
        }
      },
    } as unknown as Window
    const onChange = vi.fn()
    const stop = watchPixelRatio(onChange, win)
    expect(queries[0]!.media).toBe('(resolution: 1dppx)')

    ;(win as { devicePixelRatio: number }).devicePixelRatio = 2
    queries[0]!.listeners[0]!()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(queries[1]!.media).toBe('(resolution: 2dppx)')
    expect(queries[0]!.listeners).toHaveLength(0)

    stop()
    expect(queries[1]!.listeners).toHaveLength(0)
  })

  it('is a no-op where matchMedia does not exist', () => {
    expect(() => watchPixelRatio(() => {}, {} as Window)()).not.toThrow()
  })
})
