// Where the grid is looking: the visible area, the whole sheet's extent, the
// scroll position (clamped to the sheet), and the canvas's pixel size.
//
// Units: "logical" pixels are sheet pixels before zoom; the geometry module
// works in them. "Physical" CSS pixels are logical × zoom. The canvas backing
// store is physical × devicePixelRatio, read live on every layout so browser
// zoom and monitor moves never leave it at a stale ratio.

export interface Scroll {
  x: number
  y: number
}

/** The geometry this module needs; geometry.ts provides it. */
export interface ViewportGeometry {
  colX(c: number): number
  rowY(r: number): number
  cw(c: number): number
  rh(r: number): number
  frozenW?(): number
  frozenH?(): number
}

export interface ViewportOptions {
  /** Shared with the geometry module, which reads it live; mutated in place. */
  scroll: Scroll
  geo: ViewportGeometry
  totalCols(): number
  totalRows(): number
  getZoom(): number
  getFreeze(): { rows: number; cols: number }
  rowHeaderW: number
  colHeaderH: number
  pixelRatio?(): number
}

/** Everything needed to size the <canvas> element. */
export interface CanvasSize {
  /** Logical size the geometry and renderer draw into. */
  cssW: number
  cssH: number
  /** CSS size of the element: logical × zoom. */
  styleW: number
  styleH: number
  /** Backing-store size: style × devicePixelRatio, rounded. */
  backingW: number
  backingH: number
}

interface Axis {
  pos: number
  max: number
  view: number
  content: number
}

/** What the overlay scrollbars need to size and place their thumbs. */
export interface ScrollModel {
  x: Axis
  y: Axis
  viewportW: number
  viewportH: number
}

export interface Viewport {
  /** The parent element's size, in physical CSS pixels. */
  setViewportSize(w: number, h: number): void
  /** Recompute sheet extent and canvas size, then re-clamp the scroll. */
  layout(): CanvasSize
  scrollTo(x: number, y: number): void
  clampScroll(): void
  /** Scroll the least amount that brings cell (r, c) fully into view. */
  ensureVisible(r: number, c: number): void
  scrollModel(): ScrollModel
  readonly cssW: number
  readonly cssH: number
  readonly viewportW: number
  readonly viewportH: number
}

// Extra room left past a cell when scrolling it into view from the far edge.
const EDGE_PAD = 8

export function createViewport(o: ViewportOptions): Viewport {
  const pixelRatio = o.pixelRatio ?? (() => window.devicePixelRatio || 1)
  let viewportW = 0,
    viewportH = 0
  let cssW = 0,
    cssH = 0
  // Full sheet extent including the header gutter, in logical pixels.
  // Summing every column and row is O(cols + rows), so it is cached and
  // recomputed only in layout(), which every structural change goes through.
  let contentW = o.rowHeaderW,
    contentH = o.colHeaderH

  function recomputeExtent(): void {
    let w = 0
    for (let c = 0, n = o.totalCols(); c < n; c++) w += o.geo.cw(c)
    let h = 0
    for (let r = 0, n = o.totalRows(); r < n; r++) h += o.geo.rh(r)
    contentW = w + o.rowHeaderW
    contentH = h + o.colHeaderH
  }

  const maxScrollX = () => Math.max(0, contentW - cssW)
  const maxScrollY = () => Math.max(0, contentH - cssH)

  function clampScroll(): void {
    o.scroll.x = Math.max(0, Math.min(o.scroll.x, maxScrollX()))
    o.scroll.y = Math.max(0, Math.min(o.scroll.y, maxScrollY()))
  }

  function layout(): CanvasSize {
    recomputeExtent()
    const zoom = o.getZoom()
    // The logical view shrinks with zoom, so the geometry sees a smaller
    // area while the on-screen size stays put. It is capped at the sheet
    // extent: nothing is drawn past the last column or row.
    cssW = Math.min(viewportW / zoom, contentW)
    cssH = Math.min(viewportH / zoom, contentH)
    const styleW = cssW * zoom
    const styleH = cssH * zoom
    const dpr = pixelRatio()
    clampScroll()
    return {
      cssW,
      cssH,
      styleW,
      styleH,
      backingW: Math.round(styleW * dpr),
      backingH: Math.round(styleH * dpr),
    }
  }

  // Each axis on its own: a frozen column is always visible horizontally,
  // but a cell in it can still be scrolled out of view vertically.
  function ensureVisible(r: number, c: number): void {
    const freeze = o.getFreeze()
    // `|| 0`: the JS caller's freeze object can carry undefined counts.
    if (c >= (freeze.cols || 0)) {
      const minX = o.rowHeaderW + (o.geo.frozenW?.() ?? 0)
      const x = o.geo.colX(c),
        w = o.geo.cw(c)
      if (x < minX) o.scroll.x = Math.max(0, o.scroll.x - (minX - x))
      else if (x + w > cssW) o.scroll.x += x + w - cssW + EDGE_PAD
    }
    if (r >= (freeze.rows || 0)) {
      const minY = o.colHeaderH + (o.geo.frozenH?.() ?? 0)
      const y = o.geo.rowY(r),
        h = o.geo.rh(r)
      if (y < minY) o.scroll.y = Math.max(0, o.scroll.y - (minY - y))
      else if (y + h > cssH) o.scroll.y += y + h - cssH + EDGE_PAD
    }
    clampScroll()
  }

  // Prime the extent so scrollTo clamps correctly before the first layout().
  recomputeExtent()

  return {
    setViewportSize(w, h) {
      viewportW = w
      viewportH = h
    },
    layout,
    scrollTo(x, y) {
      o.scroll.x = x
      o.scroll.y = y
      clampScroll()
    },
    clampScroll,
    ensureVisible,
    scrollModel: () => ({
      x: { pos: o.scroll.x, max: maxScrollX(), view: cssW, content: contentW },
      y: { pos: o.scroll.y, max: maxScrollY(), view: cssH, content: contentH },
      viewportW,
      viewportH,
    }),
    get cssW() {
      return cssW
    },
    get cssH() {
      return cssH
    },
    get viewportW() {
      return viewportW
    },
    get viewportH() {
      return viewportH
    },
  }
}

/**
 * Calls `onChange` whenever devicePixelRatio changes (browser zoom, moving
 * the window to a monitor with different scaling). A resolution media query
 * matches one exact ratio, so it is re-armed for the new ratio after each
 * change. Returns a function that stops watching.
 */
export function watchPixelRatio(onChange: () => void, win: Window = window): () => void {
  // Test environments (jsdom) have no matchMedia.
  if (typeof win.matchMedia !== 'function') return () => {}
  let query: MediaQueryList | null = null
  const handler = () => {
    arm()
    onChange()
  }
  function arm(): void {
    query?.removeEventListener('change', handler)
    query = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`)
    query.addEventListener('change', handler)
  }
  arm()
  return () => query?.removeEventListener('change', handler)
}
