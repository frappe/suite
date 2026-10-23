import { describe, expect, it, vi } from 'vitest'

import { createMarchingAnts } from './marching-ants.js'
import type { FrameScheduler } from './render-loop.js'

// Frames run only when the test says so.
function manualFrames() {
  let next = 1
  const queue = new Map<number, () => void>()
  const frames: FrameScheduler = {
    request(cb) {
      const h = next++
      queue.set(h, cb)
      return h
    },
    cancel(h) {
      queue.delete(h)
    },
  }
  const tick = () => {
    const cbs = [...queue.values()]
    queue.clear()
    cbs.forEach((cb) => cb())
  }
  return { frames, tick, pending: () => queue.size }
}

describe('marching ants', () => {
  it('animates while a rect is set: the phase advances and each frame repaints', () => {
    const render = vi.fn()
    const f = manualFrames()
    const ants = createMarchingAnts(render, f.frames)
    ants.set({ r0: 0, c0: 0, r1: 2, c1: 1 })
    expect(ants.rect).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 })
    f.tick()
    f.tick()
    expect(ants.phase).toBe(1)
    expect(render).toHaveBeenCalledTimes(2)
    expect(f.pending()).toBe(1)
  })

  it('clearing stops the animation and repaints once', () => {
    const render = vi.fn()
    const f = manualFrames()
    const ants = createMarchingAnts(render, f.frames)
    ants.set({ r0: 0, c0: 0, r1: 0, c1: 0 })
    ants.set(null)
    expect(ants.rect).toBeNull()
    expect(f.pending()).toBe(0)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('treats an incomplete rect as clearing', () => {
    const ants = createMarchingAnts(vi.fn(), manualFrames().frames)
    ants.set({ r0: 1 })
    expect(ants.rect).toBeNull()
  })

  it('setting a new rect never runs two animations', () => {
    const f = manualFrames()
    const ants = createMarchingAnts(vi.fn(), f.frames)
    ants.set({ r0: 0, c0: 0, r1: 0, c1: 0 })
    ants.set({ r0: 1, c0: 1, r1: 1, c1: 1 })
    expect(f.pending()).toBe(1)
  })

  it('cancel stops without repainting', () => {
    const render = vi.fn()
    const f = manualFrames()
    const ants = createMarchingAnts(render, f.frames)
    ants.set({ r0: 0, c0: 0, r1: 0, c1: 0 })
    ants.cancel()
    f.tick()
    expect(render).not.toHaveBeenCalled()
  })
})
