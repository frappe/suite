import { describe, expect, it, vi } from 'vitest'

import { createTextSink, type TextSinkOptions } from './text-sink.js'

function setup(over: Partial<TextSinkOptions> = {}) {
  document.body.innerHTML = ''
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  canvas.tabIndex = 0
  parent.append(canvas)
  document.body.append(parent)
  const onText = vi.fn()
  const sink = createTextSink({
    parent,
    canvas,
    activeRect: () => ({ x: 40, y: 20, w: 100, h: 21 }),
    canEdit: () => true,
    onText,
    ...over,
  })
  return { parent, canvas, sink, el: sink.el, onText }
}

// What a browser sends for text that has no keydown of its own: an IME
// commit, the emoji/symbol picker, a phone keyboard, CDP Input.insertText.
function insertText(el: HTMLTextAreaElement, text: string, inputType = 'insertText') {
  el.value += text
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType }))
}

describe('text sink', () => {
  it('takes focus whenever the canvas gets it', () => {
    const { canvas, el } = setup()
    canvas.focus()
    expect(document.activeElement).toBe(el)
  })

  it('stays out of the tab order and inside the grid wrapper', () => {
    const { parent, el } = setup()
    expect(el.tabIndex).toBe(-1)
    expect(parent.contains(el)).toBe(true)
  })

  it('starts an edit with text that arrived without a keydown', () => {
    const { el, onText } = setup()
    insertText(el, '₹250')
    expect(onText).toHaveBeenCalledWith('₹250')
    expect(el.value).toBe('')
  })

  it('leaves pasted or dropped text to the clipboard handlers', () => {
    const { el, onText } = setup()
    insertText(el, 'a\tb', 'insertFromPaste')
    insertText(el, 'x', 'insertFromDrop')
    expect(onText).not.toHaveBeenCalled()
    expect(el.value).toBe('')
  })

  it('waits for an IME composition to end, then edits with the result', () => {
    const { el, onText } = setup()
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    el.value = 'नम'
    el.dispatchEvent(new InputEvent('input', { data: 'नम', isComposing: true }))
    expect(onText).not.toHaveBeenCalled()
    el.value = 'नमस्ते'
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'नमस्ते' }))
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledWith('नमस्ते')
    expect(el.value).toBe('')
  })

  it('shows the composition over the active cell, and hides it after', () => {
    const { el } = setup()
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    expect(el.style.left).toBe('40px')
    expect(el.style.top).toBe('20px')
    expect(el.style.width).toBe('100px')
    expect(el.style.opacity).toBe('1')
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'क' }))
    expect(el.style.opacity).toBe('0')
  })

  it('starts the edit once when the final input comes before compositionend', () => {
    // Firefox and some Android keyboards send the committed text as an
    // input with isComposing false, then compositionend.
    const { el, onText } = setup()
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    insertText(el, 'नमस्ते')
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'नमस्ते' }))
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledWith('नमस्ते')
    expect(el.value).toBe('')
  })

  it('a cancelled composition (Esc) starts nothing', () => {
    const { el, onText } = setup()
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '' }))
    expect(onText).not.toHaveBeenCalled()
  })

  it('re-fires keys on the canvas, so grid keys and shortcuts work as before', () => {
    const { canvas, el } = setup()
    const onCanvas = vi.fn((e: KeyboardEvent) => e.preventDefault())
    canvas.addEventListener('keydown', onCanvas)
    const seenByDocument: EventTarget[] = []
    const onDoc = (e: Event) => seenByDocument.push(e.target!)
    document.addEventListener('keydown', onDoc)

    const original = new KeyboardEvent('keydown', {
      key: 'b',
      code: 'KeyB',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(original)
    document.removeEventListener('keydown', onDoc)

    expect(onCanvas).toHaveBeenCalledTimes(1)
    const copy = onCanvas.mock.calls[0][0]
    expect(copy).toMatchObject({ key: 'b', code: 'KeyB', ctrlKey: true, shiftKey: true })
    // frappe-ui skips shortcuts whose target is a textarea; the copy's is the canvas.
    expect(seenByDocument).toEqual([canvas])
    // Handled on the canvas → the textarea's own default (typing) is cancelled.
    expect(original.defaultPrevented).toBe(true)
  })

  it('keeps the default when the canvas leaves a key alone (Ctrl+C → copy event)', () => {
    const { el } = setup()
    const original = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(original)
    expect(original.defaultPrevented).toBe(false)
  })

  it('leaves keys that belong to an IME composition with the IME', () => {
    const { canvas, el } = setup()
    const onCanvas = vi.fn()
    canvas.addEventListener('keydown', onCanvas)
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    )
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', bubbles: true }))
    // Android keyboards send key "Unidentified" (keyCode 229) before their input event.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }))
    // Safari confirms a candidate with key "Enter", isComposing false, keyCode 229.
    const safariEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(safariEnter, 'keyCode', { value: 229 })
    el.dispatchEvent(safariEnter)
    expect(onCanvas).not.toHaveBeenCalled()
  })

  it('keeps a viewer’s composition hidden', () => {
    const { el } = setup({ canEdit: () => false })
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    expect(el.style.opacity).toBe('0')
  })

  it('destroy removes the textarea and stops listening', () => {
    const { canvas, el, sink, onText } = setup()
    sink.destroy()
    expect(el.isConnected).toBe(false)
    canvas.focus()
    expect(document.activeElement).toBe(canvas)
    insertText(el, 'x')
    expect(onText).not.toHaveBeenCalled()
  })
})
