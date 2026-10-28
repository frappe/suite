import { describe, expect, it } from 'vitest'

import { goToPlace, readingPlace } from './readingPlace'

const BLOCK_HEIGHT = 100

// An editor page 300px tall at the top of the window, with blocks 100px tall laid out by scrollTop
function page(blockCount: number) {
  const scroller = document.createElement('div')
  const body = document.createElement('div')
  body.className = 'ProseMirror'
  scroller.append(body)
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 800, 300)
  for (let index = 0; index < blockCount; index++) {
    const block = document.createElement('p')
    block.getBoundingClientRect = () =>
      new DOMRect(0, index * BLOCK_HEIGHT - scroller.scrollTop, 800, BLOCK_HEIGHT)
    body.append(block)
  }

  return scroller
}

describe('reading place', () => {
  it('is the first block showing at the top, and how far up it has scrolled', () => {
    const scroller = page(10)
    scroller.scrollTop = 430

    expect(readingPlace(scroller)).toEqual({ block: 4, offset: -30 })
  })

  it('puts the same block at the same height on another page', () => {
    const preview = page(10)
    preview.scrollTop = 430
    const live = page(10)

    goToPlace(live, readingPlace(preview))

    expect(live.scrollTop).toBe(430)
  })

  it('goes to the last block when the page has fewer blocks than the place', () => {
    const preview = page(10)
    preview.scrollTop = 830
    const live = page(5)

    goToPlace(live, readingPlace(preview))

    expect(live.scrollTop).toBe(430)
  })

  it('has no place on a page with no blocks, and leaves a page alone without one', () => {
    const empty = page(0)
    const live = page(5)
    live.scrollTop = 120

    expect(readingPlace(empty)).toBeNull()
    goToPlace(live, null)
    expect(live.scrollTop).toBe(120)
  })
})
