// What plain Enter does to the *selected* cell (no editor open).
//
// Google Sheets opens the cell for editing, with the caret after the existing
// text; a second Enter commits and moves down. The grid used to skip the edit
// step and move down straight away, so the value was unreachable from the
// keyboard without F2.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockCtx } from './painters/test-utils.js'
import { createGrid } from './index.js'

function mount(opts = {}) {
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx())
  parent.appendChild(canvas)
  document.body.appendChild(parent)
  const grid = createGrid(canvas, { getFormat: () => ({}), canEdit: () => true, ...opts })
  grid.resize(800, 600)
  const editor = () => parent.querySelector('textarea') as HTMLTextAreaElement | null
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const target = grid.isEditing() ? editor()! : canvas
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  }
  return { grid, editor, press }
}

describe('Enter on the selected cell', () => {
  let h: ReturnType<typeof mount>
  beforeEach(() => { document.body.innerHTML = ''; h = mount() })

  it('opens the in-cell editor on the cell, seeded with its value', () => {
    h.grid.setCell('A1', 'hello')
    h.press('Enter')
    expect(h.grid.isEditing()).toBe(true)
    expect(h.grid.getActiveCell()).toBe('A1')
    expect(h.editor()!.value).toBe('hello')
    // Caret after the text, so typing appends instead of replacing.
    expect(h.editor()!.selectionStart).toBe(5)
  })

  it('keeps arrow keys as caret movement in the cell it opened', () => {
    h.grid.setCell('A1', 'hello')
    h.press('Enter')
    h.press('ArrowLeft')
    expect(h.grid.isEditing()).toBe(true)
    expect(h.grid.getActiveCell()).toBe('A1')
  })

  it('commits and moves down on the second Enter', () => {
    const onCommit = vi.fn()
    h = mount({ onCommit })
    h.grid.setCell('A1', 'hello')
    h.press('Enter')
    h.editor()!.value = 'hello there'
    h.press('Enter')
    expect(h.grid.isEditing()).toBe(false)
    expect(onCommit).toHaveBeenCalledWith('A1', 'hello there')
    expect(h.grid.getActiveCell()).toBe('A2')
  })

  it('still navigates instead of editing when Shift is held', () => {
    h.grid.moveTo(2, 0)
    h.press('Enter', { shiftKey: true })
    expect(h.grid.isEditing()).toBe(false)
    expect(h.grid.getActiveCell()).toBe('A2')
  })

  it('moves down over a multi-cell selection instead of collapsing it to an edit', () => {
    h.grid.setSelection({ r0: 0, c0: 0, r1: 3, c1: 1 })
    h.press('Enter')
    expect(h.grid.isEditing()).toBe(false)
  })

  it('still moves down for a read-only viewer', () => {
    h = mount({ canEdit: () => false })
    h.press('Enter')
    expect(h.grid.isEditing()).toBe(false)
    expect(h.grid.getActiveCell()).toBe('A2')
  })
})
