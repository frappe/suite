import { describe, expect, it } from 'vitest'

import { boxBetween, marqueeSelection, type MarqueeItem } from './marquee'

// A 2 × 2 grid of 100 × 60 cards with a 10px gap.
const items: MarqueeItem[] = [
  { id: 'a', box: { left: 0, top: 0, right: 100, bottom: 60 } },
  { id: 'b', box: { left: 110, top: 0, right: 210, bottom: 60 } },
  { id: 'c', box: { left: 0, top: 70, right: 100, bottom: 130 } },
  { id: 'd', box: { left: 110, top: 70, right: 210, bottom: 130 } },
]

describe('marqueeSelection', () => {
  it('selects every item the box touches, whichever way the drag runs', () => {
    const forward = boxBetween({ x: 50, y: 30 }, { x: 150, y: 40 })
    const backward = boxBetween({ x: 150, y: 40 }, { x: 50, y: 30 })
    expect(marqueeSelection({ items, box: forward, prior: [], additive: false })).toEqual(['a', 'b'])
    expect(marqueeSelection({ items, box: backward, prior: [], additive: false })).toEqual(['a', 'b'])
  })

  it('selects nothing for a box drawn in the gap between items', () => {
    const box = boxBetween({ x: 101, y: 0 }, { x: 109, y: 130 })
    expect(marqueeSelection({ items, box, prior: ['d'], additive: false })).toEqual([])
  })

  it('replaces the earlier selection on a plain drag', () => {
    const box = boxBetween({ x: 10, y: 80 }, { x: 20, y: 90 })
    expect(marqueeSelection({ items, box, prior: ['b'], additive: false })).toEqual(['c'])
  })

  it('adds to the earlier selection on an additive drag, and gives back items the box leaves', () => {
    const wide = boxBetween({ x: 10, y: 10 }, { x: 150, y: 100 })
    expect(marqueeSelection({ items, box: wide, prior: ['b'], additive: true })).toEqual(['b', 'a', 'c', 'd'])
    // The pointer comes back: only `a` is under the box now, and `b` stays selected from before.
    const narrow = boxBetween({ x: 10, y: 10 }, { x: 20, y: 20 })
    expect(marqueeSelection({ items, box: narrow, prior: ['b'], additive: true })).toEqual(['b', 'a'])
  })
})
