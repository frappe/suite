import { Editor } from '@tiptap/core'
import { StyleClipboard } from 'frappe-ui/editor'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { togglePainting, watchPaintTarget } from './paintStyles'

let editor: Editor | null = null
let stopWatching = () => {}

function open(content: string) {
  editor = new Editor({ extensions: [...writerSchema(), StyleClipboard], content })
  stopWatching = watchPaintTarget(editor)
  return editor
}

const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) =>
  editor?.view.dom.dispatchEvent(new KeyboardEvent(type, init))

afterEach(() => {
  vi.useRealTimers()
  stopWatching()
  editor?.destroy()
  editor = null
})

describe('paint styles', () => {
  it('copies the word at the caret and paints a keyboard selection', () => {
    const target = open('<p><strong>Bold</strong> plain</p>')
    target.commands.setTextSelection(3)
    expect(togglePainting(target)).toBe(true)
    expect(target.state.selection.from).toBe(3)

    vi.useFakeTimers()
    for (const to of [7, 8, 9, 10, 11]) {
      key('keydown', { key: 'Shift', shiftKey: true })
      target.commands.setTextSelection({ from: 6, to })
      key('keyup', { key: 'Shift' })
    }
    expect(target.storage.styleClipboard.painting).toBe(true)
    vi.advanceTimersByTime(500)

    expect(target.getHTML()).toBe('<p><strong>Bold</strong> <strong>plain</strong></p>')
    expect(target.storage.styleClipboard.painting).toBe(false)
  })

  it('paints a keyboard selection at once when a key without Shift is pressed', () => {
    const target = open('<p><em>Lean</em> plain</p>')
    target.commands.setTextSelection(3)
    togglePainting(target)
    target.commands.setTextSelection({ from: 6, to: 11 })
    key('keydown', { key: 'ArrowRight' })
    expect(target.getHTML()).toBe('<p><em>Lean</em> <em>plain</em></p>')
  })

  it('turns off when pressed again', () => {
    const target = open('<p><strong>Bold</strong> plain</p>')
    target.commands.setTextSelection(3)
    togglePainting(target)
    togglePainting(target)
    expect(target.storage.styleClipboard.painting).toBe(false)
  })
})
