// Overlay scrollbars for the canvas grid.
//
// The grid owns its scroll position as a logical `{x, y}` offset, driven by the
// wheel handler and keyboard navigation. These scrollbars are a draggable DOM
// affordance layered over that same state — they don't own it. On every render
// they re-read the grid's scroll model and resize/reposition their thumbs; on
// drag or track-click they write back through `scrollTo`.
//
// Everything here is fraction-based (pos/max, view/content) so it stays correct
// at any zoom without the module needing to know logical-vs-physical units: the
// track's physical pixel length is the only device measurement it takes.
//
// Dragging uses Pointer Events with pointer capture so a fast drag that outruns
// the thumb keeps tracking, and so touch / pen work alongside the mouse.
//
// The bars auto-hide: they fade in on scroll, stay while hovered/dragged, and
// fade back out soon after scrolling stops. Moving the mouse over the grid does
// not wake them. When hidden they drop pointer-events so the cells beneath the
// gutter stay clickable.

import { SCROLLBAR_THICK as THICK } from './constants.js'
import type { ScrollModel } from './viewport.js'

interface ScrollGeometry {
  x: AxisGeom | null
  y: AxisGeom | null
}

export interface Scrollbars {
  /** Re-place the thumbs for the current scroll (called after every paint). */
  layout(): void
  destroy(): void
}

type Axis = 'x' | 'y'

interface AxisGeom {
  trackPx: number
  thumbPx: number
  travel: number
  offset: number
  posFrac: number
  max: number
}

const MIN_THUMB = 24 // floor on thumb length so it stays grabbable near the ends
// ms after scrolling stops before the fade starts. With the 150ms fade in
// SheetEditor.global.css, the bars are gone within 800ms.
const HIDE_DELAY = 600

export function createScrollbars(
  host: HTMLElement,
  { getModel, scrollTo }: { getModel(): ScrollModel; scrollTo(x: number, y: number): void },
): Scrollbars {
  const el = (cls: string): HTMLDivElement => {
    const d = document.createElement('div')
    d.className = cls
    return d
  }

  const vTrack = el('sn-sb sn-sb-v sn-sb--hidden')
  const vThumb = el('sn-sb-thumb')
  vTrack.appendChild(vThumb)
  const hTrack = el('sn-sb sn-sb-h sn-sb--hidden')
  const hThumb = el('sn-sb-thumb')
  hTrack.appendChild(hThumb)
  vTrack.setAttribute('role', 'scrollbar')
  vTrack.setAttribute('aria-orientation', 'vertical')
  hTrack.setAttribute('role', 'scrollbar')
  hTrack.setAttribute('aria-orientation', 'horizontal')
  for (const t of [vTrack, hTrack]) {
    t.setAttribute('aria-valuemin', '0')
    t.setAttribute('aria-valuemax', '100')
  }
  host.appendChild(vTrack)
  host.appendChild(hTrack)
  // Publish the track thickness so the CSS (track width/height) reads a single
  // source of truth instead of duplicating the pixel value.
  host.style.setProperty('--sn-sb-thick', THICK + 'px')

  // Per-axis geometry cached from the last layout(), read by the drag handlers.
  const geom: ScrollGeometry = { x: null, y: null }

  // ── Auto-hide ────────────────────────────────────────────────────────────
  // layout() calls reveal() whenever the scroll position changes. Hovering a
  // track or dragging a thumb holds the bars up; otherwise a timer fades them
  // out after HIDE_DELAY.
  const parts = [vTrack, hTrack]
  const held = { hover: false, drag: false }
  let _hideTimer: ReturnType<typeof setTimeout> | null = null
  // null until the first layout: the initial position is not a scroll.
  let _lastX: number | null = null
  let _lastY: number | null = null

  function clearHideTimer(): void {
    if (_hideTimer) clearTimeout(_hideTimer)
    _hideTimer = null
  }
  function reveal(): void {
    for (const p of parts) p.classList.remove('sn-sb--hidden')
    clearHideTimer()
    if (held.hover || held.drag) return
    _hideTimer = setTimeout(() => {
      _hideTimer = null
      for (const p of parts) p.classList.add('sn-sb--hidden')
    }, HIDE_DELAY)
  }
  function hold(what: keyof typeof held, on: boolean): void {
    held[what] = on
    reveal()
  }

  for (const t of [vTrack, hTrack]) {
    t.addEventListener('pointerenter', () => hold('hover', true))
    t.addEventListener('pointerleave', () => hold('hover', false))
  }

  function measure(
    trackPx: number,
    a: { view: number; content: number; pos: number; max: number },
  ): AxisGeom {
    const thumbPx = Math.max(MIN_THUMB, Math.round(trackPx * Math.min(1, a.view / a.content)))
    const travel = Math.max(0, trackPx - thumbPx)
    const posFrac = a.max > 0 ? a.pos / a.max : 0
    return { trackPx, thumbPx, travel, offset: posFrac * travel, posFrac, max: a.max }
  }

  function layout(): void {
    const m = getModel()
    // Any change in scroll position (wheel, keyboard, drag) wakes the bars.
    if (_lastX !== null && (m.x.pos !== _lastX || m.y.pos !== _lastY)) reveal()
    _lastX = m.x.pos
    _lastY = m.y.pos
    const showV = m.y.max > 1
    const showH = m.x.max > 1
    vTrack.style.display = showV ? 'block' : 'none'
    hTrack.style.display = showH ? 'block' : 'none'
    // Reserve a corner gutter when both are shown so the tracks don't overlap.
    vTrack.style.bottom = showH ? THICK + 'px' : '0'
    hTrack.style.right = showV ? THICK + 'px' : '0'

    // Track length = the viewport minus the perpendicular bar's gutter. Derived
    // from the model's physical viewport rather than read from the DOM, so this
    // hot path (every scroll / selection render) writes styles without ever
    // reading clientWidth/Height — no forced synchronous reflow.
    const vTrackPx = m.viewportH - (showH ? THICK : 0)
    const hTrackPx = m.viewportW - (showV ? THICK : 0)

    if (showV) {
      const g = (geom.y = measure(vTrackPx, m.y))
      vThumb.style.height = g.thumbPx + 'px'
      vThumb.style.transform = `translateY(${g.offset}px)`
      vTrack.setAttribute('aria-valuenow', String(Math.round(g.posFrac * 100)))
    }
    if (showH) {
      const g = (geom.x = measure(hTrackPx, m.x))
      hThumb.style.width = g.thumbPx + 'px'
      hThumb.style.transform = `translateX(${g.offset}px)`
      hTrack.setAttribute('aria-valuenow', String(Math.round(g.posFrac * 100)))
    }
  }

  // Set one axis to `pos`, leaving the other where the model has it.
  function applyAxis(axis: Axis, pos: number): void {
    const m = getModel()
    if (axis === 'y') scrollTo(m.x.pos, pos)
    else scrollTo(pos, m.y.pos)
  }

  function startDrag(axis: Axis, thumb: HTMLElement, e: PointerEvent): void {
    const g = geom[axis]
    if (!g || g.travel <= 0 || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (typeof thumb.setPointerCapture === 'function') thumb.setPointerCapture(e.pointerId)
    const client0 = axis === 'y' ? e.clientY : e.clientX
    const off0 = g.offset
    document.body.classList.add('sn-sb-dragging')
    hold('drag', true) // keep bars up for the whole drag, even off the thumb
    const move = (ev: PointerEvent): void => {
      const client = axis === 'y' ? ev.clientY : ev.clientX
      const off = Math.max(0, Math.min(g.travel, off0 + (client - client0)))
      applyAxis(axis, (off / g.travel) * g.max)
    }
    const up = (): void => {
      thumb.removeEventListener('pointermove', move)
      thumb.removeEventListener('pointerup', up)
      thumb.removeEventListener('pointercancel', up)
      document.body.classList.remove('sn-sb-dragging')
      hold('drag', false)
    }
    // With pointer capture the captured element receives the moves, so listen
    // on the thumb rather than the document.
    thumb.addEventListener('pointermove', move)
    thumb.addEventListener('pointerup', up)
    thumb.addEventListener('pointercancel', up)
  }

  // Click in the track gutter (not the thumb) pages toward the click by ~90% of
  // a viewport — matching the native page-scroll behaviour. scrollTo clamps, so
  // overshoot at the ends is harmless.
  function trackClick(axis: Axis, track: HTMLElement, thumb: HTMLElement, e: PointerEvent): void {
    if (e.target !== track) return
    const g = geom[axis]
    if (!g) return
    const rect = track.getBoundingClientRect()
    const click = axis === 'y' ? e.clientY - rect.top : e.clientX - rect.left
    // The thumb is narrower than the track: a press beside it still grabs it.
    if (click >= g.offset && click <= g.offset + g.thumbPx) {
      startDrag(axis, thumb, e)
      return
    }
    const m = getModel()
    const page = (axis === 'y' ? m.y.view : m.x.view) * 0.9
    const dir = click < g.offset ? -1 : 1
    applyAxis(axis, (axis === 'y' ? m.y.pos : m.x.pos) + dir * page)
  }

  vThumb.addEventListener('pointerdown', (e) => startDrag('y', vThumb, e))
  hThumb.addEventListener('pointerdown', (e) => startDrag('x', hThumb, e))
  vTrack.addEventListener('pointerdown', (e) => trackClick('y', vTrack, vThumb, e))
  hTrack.addEventListener('pointerdown', (e) => trackClick('x', hTrack, hThumb, e))

  function destroy(): void {
    clearHideTimer()
    host.style.removeProperty('--sn-sb-thick')
    vTrack.remove()
    hTrack.remove()
  }

  return { layout, destroy }
}
