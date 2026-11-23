// The animated dashed border around a cut/copy source, shown until paste
// or Escape clears it.
//
// While a rect is set, the dash offset (`phase`) advances every STEP_MS and
// the grid repaints; the selection painter draws the dashes. A repaint draws
// the whole grid, so this runs on a timer rather than every display frame
// (ISSUES #87: 138 paints/s on a fast screen).

import type { FrameScheduler } from './render-loop.js'

export interface AntsRect {
  r0: number
  c0: number
  r1: number
  c1: number
}

export interface MarchingAnts {
  /** The rect being marched around, or null. */
  readonly rect: AntsRect | null
  /** Dash offset for the painter. */
  readonly phase: number
  /** Start marching around `rect`; null (or a rect missing its start) stops. */
  set(rect: Partial<AntsRect> | null | undefined): void
  /** Stop animating without repainting (teardown). */
  cancel(): void
}

// 20 steps a second at 1.5 px: 30 px/s, the speed of the old per-frame step
// on a 60 Hz screen.
const STEP_MS = 50
const STEP = 1.5
const WRAP = 1000

const antSteps: FrameScheduler = {
  request: (cb) => window.setTimeout(cb, STEP_MS),
  cancel: (handle) => window.clearTimeout(handle),
}

export function createMarchingAnts(
  render: () => void,
  frames: FrameScheduler = antSteps,
): MarchingAnts {
  let rect: AntsRect | null = null
  let phase = 0
  let frame: number | null = null

  function step(): void {
    frame = null
    if (!rect) return
    phase = (phase + STEP) % WRAP
    render()
    frame = frames.request(step)
  }

  function cancel(): void {
    if (frame !== null) {
      frames.cancel(frame)
      frame = null
    }
  }

  function set(r: Partial<AntsRect> | null | undefined): void {
    rect =
      r && r.r0 !== undefined && r.c0 !== undefined && r.r1 !== undefined && r.c1 !== undefined
        ? { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 }
        : null
    cancel()
    if (rect) frame = frames.request(step)
    else render()
  }

  return {
    get rect() {
      return rect
    },
    get phase() {
      return phase
    },
    set,
    cancel,
  }
}
