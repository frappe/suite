import { describe, expect, it } from 'vitest'

import { isCanvasClipboardTarget } from './clipboard-target.js'

describe('isCanvasClipboardTarget', () => {
  const canvasEl = { tag: 'canvas' }
  const formulaEl = { tag: 'fx-input' }
  const inner = { tag: 'overlay-textarea' } // lives inside the grid wrapper
  const outside = { tag: 'somewhere-else' }
  const gridWrap = { contains: (el: unknown) => el === canvasEl || el === inner }

  const base = { canvasEl, formulaEl, gridWrap }

  it('is false while a cell is being edited, even when the overlay is focused', () => {
    // The open inline editor lives inside gridWrap, so contains() is true —
    // but editing must win so the paste reaches the textarea.
    expect(isCanvasClipboardTarget({ ...base, activeEl: inner, editing: true })).toBe(false)
    // ...and true regardless of which element holds focus.
    expect(isCanvasClipboardTarget({ ...base, activeEl: canvasEl, editing: true })).toBe(false)
  })

  it('is true when the canvas itself holds focus (not editing)', () => {
    expect(isCanvasClipboardTarget({ ...base, activeEl: canvasEl, editing: false })).toBe(true)
  })

  it('is false when the formula bar holds focus, so a paste lands in its text', () => {
    expect(isCanvasClipboardTarget({ ...base, activeEl: formulaEl, editing: false })).toBe(false)
  })

  it('is true for any element inside the grid wrapper (not editing)', () => {
    expect(isCanvasClipboardTarget({ ...base, activeEl: inner, editing: false })).toBe(true)
  })

  it('is false when focus is outside the grid entirely', () => {
    expect(isCanvasClipboardTarget({ ...base, activeEl: outside, editing: false })).toBe(false)
  })

  it('does not throw when the grid wrapper is not mounted yet', () => {
    expect(
      isCanvasClipboardTarget({
        activeEl: outside,
        canvasEl: null,
        formulaEl: null,
        gridWrap: null,
        editing: false,
      }),
    ).toBe(false)
  })
})
