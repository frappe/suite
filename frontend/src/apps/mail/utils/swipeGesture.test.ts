import { describe, expect, it } from 'vitest'

import { createSwipeGesture } from './swipeGesture'

// A phone's width: a drag commits past 30% of it, 120px.
const WIDTH = 400

describe('createSwipeGesture', () => {
  it('drags the page with the finger once it has gone sideways', () => {
    const gesture = createSwipeGesture()
    gesture.start(300, 400, 0)

    expect(gesture.move(296, 401, 10)).toEqual({ phase: 'pending', dx: 0 })
    expect(gesture.move(260, 402, 50)).toEqual({ phase: 'drag', dx: -40 })
  })

  it('goes on to the next thread when let go past a third of the way, slowly', () => {
    const gesture = createSwipeGesture()
    gesture.start(300, 400, 0)
    gesture.move(250, 402, 100)
    gesture.move(150, 404, 400)

    expect(gesture.end(150, 600, WIDTH)).toBe(1)
  })

  it('settles back when let go short of that, slowly', () => {
    const gesture = createSwipeGesture()
    gesture.start(300, 400, 0)
    gesture.move(260, 401, 200)

    expect(gesture.end(260, 500, WIDTH)).toBeNull()
  })

  it('goes on to the previous thread on a short fast fling to the right', () => {
    const gesture = createSwipeGesture()
    gesture.start(100, 400, 0)
    gesture.move(120, 401, 20)
    gesture.move(140, 401, 40)

    expect(gesture.end(150, 50, WIDTH)).toBe(-1)
  })

  it('settles back when thrown back the way it came, however far it went', () => {
    const gesture = createSwipeGesture()
    gesture.start(380, 400, 0)
    gesture.move(100, 400, 300)
    gesture.move(140, 400, 320)
    gesture.move(180, 400, 340)

    expect(gesture.end(200, 350, WIDTH)).toBeNull()
  })

  it('stays a scroll once it began as one, even when the finger then goes sideways', () => {
    const gesture = createSwipeGesture()
    gesture.start(300, 400, 0)
    gesture.move(300, 380, 50)

    expect(gesture.move(100, 380, 200)).toEqual({ phase: 'scroll', dx: 0 })
    expect(gesture.end(100, 400, WIDTH)).toBeNull()
  })

  it('ignores a two-finger gesture', () => {
    const gesture = createSwipeGesture()
    gesture.start(300, 400, 0, 2)

    expect(gesture.move(100, 400, 100).phase).toBe('scroll')
    expect(gesture.end(100, 400, WIDTH)).toBeNull()
  })

  it('forgets a cancelled gesture', () => {
    const gesture = createSwipeGesture()
    gesture.start(300, 400, 0)
    gesture.move(150, 400, 300)
    gesture.cancel()

    expect(gesture.end(100, 600, WIDTH)).toBeNull()
  })
})
