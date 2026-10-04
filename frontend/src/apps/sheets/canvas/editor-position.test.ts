// Regression harness for the "in-cell editor shows up somewhere else" bug.
// The open <textarea> must stay pinned to its cell across ANY scroll/zoom/
// layout mutation — not just the wheel/scrollbar path. The production trigger
// is a ResizeObserver firing mid-edit (a side panel opens, the window
// resizes), which runs through _applyCanvasSize; setZoom hits that same code
// path deterministically without needing to drive off-screen scrolling.
//
// Without the fix these go red: _applyCanvasSize re-clamps scroll and shifts
// every cell, but leaves the textarea floating at its pre-change offset.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGrid } from './index.js'
import { createMockCtx } from './painters/test-utils.js'

// Open the editor on the given cell by synthesizing the dblclick the grid
// listens for. jsdom's getBoundingClientRect() is all-zero (no layout), so
// client coords map straight into the canvas's own coordinate space: a point a
// few px past the 50px row-header / 24px col-header gutter lands in cell A1.
function mount() {
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx())
  parent.appendChild(canvas)
  document.body.appendChild(parent)
  const grid = createGrid(canvas, { getFormat: () => ({}), canEdit: () => true })
  grid.resize(800, 600)
  const editor = () => parent.querySelector('textarea')
  const openA1 = () =>
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 55, clientY: 30, bubbles: true }))
  return { grid, editor, openA1 }
}

// The overlay stores its on-screen offset as inline px styles; strip 'px'.
const leftOf = (el) => parseFloat(el.style.left)
const topOf = (el) => parseFloat(el.style.top)

describe('in-cell editor stays pinned to its cell', () => {
  let h
  beforeEach(() => {
    document.body.innerHTML = ''
    h = mount()
  })

  it('opens the editor anchored to the double-clicked cell', () => {
    h.openA1()
    expect(h.grid.isEditing()).toBe(true)
    const rect = h.grid.getCellRect(0, 0)
    expect(leftOf(h.editor())).toBeCloseTo(rect.x, 3)
    expect(topOf(h.editor())).toBeCloseTo(rect.y, 3)
  })

  it('tracks its cell across a zoom-driven layout change (_applyCanvasSize)', () => {
    h.openA1()
    const before = leftOf(h.editor())
    h.grid.setZoom(2)
    const rect = h.grid.getCellRect(0, 0)
    // Zoom doubles the cell's on-screen rect; the editor must follow it there,
    // not stay at its pre-zoom offset.
    expect(rect.x).toBeGreaterThan(before)
    expect(leftOf(h.editor())).toBeCloseTo(rect.x, 3)
    expect(topOf(h.editor())).toBeCloseTo(rect.y, 3)
  })

  it('does not touch the overlay when no edit is open (guarded no-op)', () => {
    // Nothing editing: a layout change must not move/show the hidden textarea.
    expect(h.grid.isEditing()).toBe(false)
    h.grid.setZoom(2)
    expect(h.editor().style.display).toBe('none')
  })
})
