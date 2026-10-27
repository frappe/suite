// Text that reaches the grid without a keydown: an IME (Hindi, Marathi,
// Japanese…), the Windows emoji/symbol picker, a phone keyboard, or
// Playwright's insertText. A focused <canvas> never sees it, so the edit
// never started or lost its first character (`₹250` → `250`). The grid now
// keeps focus in a hidden textarea that hears those events.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGrid } from './index.js'
import { createMockCtx } from './painters/test-utils.js'

function mount(host = {}) {
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx())
  parent.appendChild(canvas)
  document.body.appendChild(parent)
  const grid = createGrid(canvas, {
    cells: { getStyle: () => ({}) },
    host: { canEdit: () => true, ...host },
  })
  grid.resize(800, 600)
  canvas.focus()
  const focused = () => document.activeElement as HTMLTextAreaElement
  const editorValue = () => (grid.isEditing() ? focused().value : null)
  return { grid, canvas, parent, focused, editorValue }
}

function insertText(el: HTMLTextAreaElement, text: string) {
  el.value += text
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
}

describe('text typed without a keydown', () => {
  let h: ReturnType<typeof mount>
  beforeEach(() => {
    document.body.innerHTML = ''
    h = mount()
  })

  it('focusing the grid puts focus on a textarea inside it', () => {
    expect(h.focused().tagName).toBe('TEXTAREA')
    expect(h.parent.contains(h.focused())).toBe(true)
    expect(h.grid.isEditing()).toBe(false)
  })

  it('starts the edit with all of it, the first character included', () => {
    insertText(h.focused(), '₹250')
    expect(h.grid.isEditing()).toBe(true)
    expect(h.grid.getActiveCell()).toBe('A1')
    expect(h.editorValue()).toBe('₹250')
  })

  it('starts the edit with a finished IME composition', () => {
    const sink = h.focused()
    sink.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    sink.value = 'नमस्ते'
    sink.dispatchEvent(new InputEvent('input', { data: 'नमस्ते', isComposing: true }))
    expect(h.grid.isEditing()).toBe(false)
    sink.dispatchEvent(new CompositionEvent('compositionend', { data: 'नमस्ते' }))
    expect(h.editorValue()).toBe('नमस्ते')
  })

  it('commits it like typed text', () => {
    const onCommit = vi.fn()
    document.body.innerHTML = ''
    h = mount({ onCommit })
    insertText(h.focused(), '£9.99')
    h.focused().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onCommit).toHaveBeenCalledWith('A1', '£9.99')
    expect(h.grid.getActiveCell()).toBe('A2')
  })

  it('does nothing for a viewer', () => {
    document.body.innerHTML = ''
    h = mount({ canEdit: () => false })
    insertText(h.focused(), 'x')
    expect(h.grid.isEditing()).toBe(false)
  })
})

describe('keys on the focused grid', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('still move the selection and start typing, once', () => {
    const h = mount()
    const key = (k: string) =>
      h
        .focused()
        .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    key('ArrowDown')
    key('ArrowRight')
    expect(h.grid.getActiveCell()).toBe('B2')
    key('x')
    expect(h.editorValue()).toBe('x')
  })
})
