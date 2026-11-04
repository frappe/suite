import { describe, expect, it, vi } from 'vitest'

import { createRenderLoop } from './render-loop.js'

// Frames run only when the test calls flush(), so timing is explicit.
function manualFrames() {
  let next = 1
  const queued = new Map<number, () => void>()
  return {
    request(cb: () => void) {
      const h = next++
      queued.set(h, cb)
      return h
    },
    cancel(h: number) {
      queued.delete(h)
    },
    flush() {
      const cbs = [...queued.values()]
      queued.clear()
      for (const cb of cbs) cb()
    },
    get size() {
      return queued.size
    },
  }
}

describe('render loop', () => {
  it('render paints immediately', () => {
    const paint = vi.fn()
    createRenderLoop(paint, manualFrames()).render()
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('coalesces scheduled renders into one paint per frame', () => {
    const paint = vi.fn()
    const frames = manualFrames()
    const loop = createRenderLoop(paint, frames)
    loop.scheduleRender()
    loop.scheduleRender()
    loop.scheduleRender()
    expect(paint).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    frames.flush()
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('schedules again after a frame has run', () => {
    const paint = vi.fn()
    const frames = manualFrames()
    const loop = createRenderLoop(paint, frames)
    loop.scheduleRender()
    frames.flush()
    loop.scheduleRender()
    frames.flush()
    expect(paint).toHaveBeenCalledTimes(2)
  })

  it('runs listeners after the paint, and unsubscribes', () => {
    const order: string[] = []
    const loop = createRenderLoop(() => order.push('paint'), manualFrames())
    const off = loop.onRender(() => order.push('listener'))
    loop.render()
    off()
    loop.render()
    expect(order).toEqual(['paint', 'listener', 'paint'])
  })

  it('cancel drops the pending frame', () => {
    const paint = vi.fn()
    const frames = manualFrames()
    const loop = createRenderLoop(paint, frames)
    loop.scheduleRender()
    loop.cancel()
    frames.flush()
    expect(paint).not.toHaveBeenCalled()
    loop.scheduleRender()
    frames.flush()
    expect(paint).toHaveBeenCalledTimes(1)
  })
})
