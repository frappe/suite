import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createScrollbars, type Scrollbars } from './scrollbars'
import type { ScrollModel } from './viewport'

function model(y = 0, x = 0): ScrollModel {
  return {
    viewportW: 800,
    viewportH: 400,
    x: { view: 800, content: 3200, pos: x, max: 2400 },
    y: { view: 400, content: 4000, pos: y, max: 3600 },
  }
}

// jsdom has no PointerEvent. The handlers read only the fields MouseEvent has.
const pointer = (type: string, init: MouseEventInit = {}) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })

describe('overlay scrollbars', () => {
  let host: HTMLDivElement
  let current: ScrollModel
  let scrollTo: ReturnType<typeof vi.fn>
  let bars: Scrollbars

  const track = (axis: 'v' | 'h') => host.querySelector<HTMLElement>(`.sn-sb-${axis}`)!
  const thumb = (axis: 'v' | 'h') => track(axis).querySelector<HTMLElement>('.sn-sb-thumb')!
  const isHidden = () => track('v').classList.contains('sn-sb--hidden')
  const scrollDown = (y: number) => {
    current = model(y)
    bars.layout()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.append(host)
    current = model()
    scrollTo = vi.fn()
    bars = createScrollbars(host, { getModel: () => current, scrollTo })
    bars.layout()
  })

  afterEach(() => {
    bars.destroy()
    host.remove()
    vi.useRealTimers()
  })

  it('stays hidden until the grid scrolls', () => {
    expect(isHidden()).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(isHidden()).toBe(true)
  })

  it('has no filler square where the two bars meet', () => {
    expect(host.querySelector('.sn-sb-corner')).toBeNull()
  })

  it('does not appear on plain mouse movement over the grid', () => {
    host.dispatchEvent(pointer('pointermove'))
    expect(isHidden()).toBe(true)
  })

  it('appears on scrolling and is hidden within 800ms of it stopping, fade included', () => {
    scrollDown(100)
    expect(isHidden()).toBe(false)
    // The CSS fade runs after this, and takes 150ms.
    vi.advanceTimersByTime(650)
    expect(isHidden()).toBe(true)
  })

  it('stays up while scrolling continues', () => {
    scrollDown(100)
    vi.advanceTimersByTime(500)
    scrollDown(200)
    vi.advanceTimersByTime(500)
    expect(isHidden()).toBe(false)
  })

  it('stays while hovered, and fades after the pointer leaves', () => {
    scrollDown(100)
    track('v').dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(5000)
    expect(isHidden()).toBe(false)
    track('v').dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(650)
    expect(isHidden()).toBe(true)
  })

  it('stays while dragged, and while still hovered after the drag ends', () => {
    scrollDown(100)
    track('v').dispatchEvent(pointer('pointerenter'))
    thumb('v').dispatchEvent(pointer('pointerdown', { clientY: 10 }))
    vi.advanceTimersByTime(5000)
    expect(isHidden()).toBe(false)
    thumb('v').dispatchEvent(pointer('pointerup', { clientY: 10 }))
    vi.advanceTimersByTime(5000)
    expect(isHidden()).toBe(false)
    track('v').dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(650)
    expect(isHidden()).toBe(true)
  })

  it('stays for a drag that leaves the track, then fades when it ends', () => {
    scrollDown(100)
    thumb('v').dispatchEvent(pointer('pointerdown', { clientY: 10 }))
    vi.advanceTimersByTime(5000)
    expect(isHidden()).toBe(false)
    thumb('v').dispatchEvent(pointer('pointerup', { clientY: 10 }))
    vi.advanceTimersByTime(650)
    expect(isHidden()).toBe(true)
  })

  it('scrolls when the thumb is dragged', () => {
    scrollDown(0)
    thumb('v').dispatchEvent(pointer('pointerdown', { clientY: 0 }))
    thumb('v').dispatchEvent(pointer('pointermove', { clientY: 180 }))
    // The other bar takes 12px of the 400px track, and its 39px thumb travels 349px.
    expect(scrollTo.mock.lastCall?.[1]).toBeCloseTo((180 / 349) * 3600)
  })

  it('pages toward a click on the track', () => {
    scrollDown(0)
    track('v').dispatchEvent(pointer('pointerdown', { clientY: 300 }))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 360)
  })
})
