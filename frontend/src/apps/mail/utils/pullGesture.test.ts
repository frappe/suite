import { describe, expect, it } from 'vitest'

import { createPullGesture, DECIDE_AT, pullOffset, REFRESH_AT } from '@/apps/mail/utils/pullGesture'

// A finger put down at the list's top (scrollTop 0), or `scrollTop` down it, then drawn through
// `path` (offsets from where it went down), then let go: whether that refreshes.
const drag = (path: [number, number][], scrollTop = 0) => {
  const gesture = createPullGesture()
  gesture.start(100, 200, scrollTop)
  const moves = path.map(([dx, dy]) => gesture.move(100 + dx, 200 + dy))
  return { moves, refreshes: gesture.end() }
}

// Straight down, in steps, to `dy`.
const down = (dy: number): [number, number][] =>
  Array.from({ length: Math.ceil(dy / 5) }, (_, i) => [0, Math.min((i + 1) * 5, dy)])

describe('pull to refresh', () => {
  it('refreshes a list pulled down far enough from its top', () => {
    expect(drag(down(300)).refreshes).toBe(true)
  })

  it('springs back from a pull let go short of the mark', () => {
    expect(drag(down(40)).refreshes).toBe(false)
  })

  it('pulls the spinner less far than the finger, and less the further it goes', () => {
    expect(pullOffset(50)).toBeLessThan(50)
    expect(pullOffset(100) - pullOffset(50)).toBeLessThan(pullOffset(50))
    // However far the finger goes, the spinner stops somewhere.
    expect(pullOffset(10_000)).toBe(pullOffset(100_000))
  })

  it('takes more finger travel to reach the mark than the mark itself', () => {
    // Exactly as far as the mark is too little: the pull resists.
    expect(drag(down(REFRESH_AT)).refreshes).toBe(false)
  })

  it('does not pull a list scrolled down, even once the scroll brings it to the top', () => {
    const { moves, refreshes } = drag(down(300), 120)
    expect(refreshes).toBe(false)
    expect(moves.every((move) => move.offset === 0)).toBe(true)
  })

  it('does not let a scroll up the list turn into a pull when the finger comes back down', () => {
    const { refreshes } = drag([[0, -5], [0, -DECIDE_AT - 2], ...down(300)])
    expect(refreshes).toBe(false)
  })

  it('leaves a sideways swipe alone, even one that drifts down afterwards', () => {
    const { moves, refreshes } = drag([
      [6, 2],
      [DECIDE_AT + 2, 4],
      [20, 200],
    ])
    expect(moves.at(-1)?.phase).toBe('other')
    expect(refreshes).toBe(false)
  })

  it('does not pull with two fingers', () => {
    const gesture = createPullGesture()
    gesture.start(100, 200, 0, 2)
    down(300).forEach(([dx, dy]) => gesture.move(100 + dx, 200 + dy))
    expect(gesture.end()).toBe(false)
  })

  it('refreshes on the pull back up to past the mark, not on the furthest point reached', () => {
    // Taken well past the mark, then eased back up near the top before letting go.
    expect(drag([...down(300), [0, 20]]).refreshes).toBe(false)
  })
})
