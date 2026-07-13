import { describe, expect, it } from 'vitest'

import {
  getCommentAnchorTop,
  isCommentPositioned,
  stackCommentTop,
} from './commentPosition'

describe('Writer comment positioning', () => {
  it('calculates an anchor position when the element is at viewport top', () => {
    expect(getCommentAnchorTop(0, -42)).toBe(42)
    expect(getCommentAnchorTop(0, 0)).toBe(0)
  })

  it('treats zero as positioned and only nullish values as hidden', () => {
    expect(isCommentPositioned(0)).toBe(true)
    expect(isCommentPositioned(48)).toBe(true)
    expect(isCommentPositioned(null)).toBe(false)
    expect(isCommentPositioned(undefined)).toBe(false)
  })

  it('keeps a card at zero and advances stacking from it', () => {
    expect(stackCommentTop(0, 0)).toBe(0)
    expect(stackCommentTop(10, 100)).toBe(100)
  })

  it('does not position hidden comments or disturb the stack', () => {
    expect(stackCommentTop(null, 100)).toBeNull()
    expect(stackCommentTop(undefined, 100)).toBeNull()
  })
})
