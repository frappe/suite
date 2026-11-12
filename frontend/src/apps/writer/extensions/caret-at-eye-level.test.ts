import type { EditorView } from '@tiptap/pm/view'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'

import { holdCaretAtEyeLevel } from './caret-at-eye-level'

function page({ caretBottom, isRange = false }: { caretBottom: number; isRange?: boolean }) {
  const scroller = document.createElement('div')
  scroller.id = 'editor-scroll-container'
  scroller.getBoundingClientRect = () => fromPartial<DOMRect>({ top: 100, height: 1000 })
  scroller.scrollTop = 50
  const dom = scroller.appendChild(document.createElement('div'))
  const view = fromPartial<EditorView>({
    dom,
    state: { selection: { empty: !isRange, head: 1 } },
    coordsAtPos: () => ({ bottom: caretBottom }),
  })
  return { scroller, view }
}

describe('holdCaretAtEyeLevel', () => {
  it('scrolls a caret low on the page up to 60% of the page', () => {
    const { scroller, view } = page({ caretBottom: 1000 })
    holdCaretAtEyeLevel(view)
    expect(scroller.scrollTop).toBe(50 + 1000 - 700)
  })

  it('leaves a caret above that line where it is', () => {
    const { scroller, view } = page({ caretBottom: 600 })
    holdCaretAtEyeLevel(view)
    expect(scroller.scrollTop).toBe(50)
  })

  it('does not move the page for a selected range', () => {
    const { scroller, view } = page({ caretBottom: 1000, isRange: true })
    holdCaretAtEyeLevel(view)
    expect(scroller.scrollTop).toBe(50)
  })

  it('leaves the rest of the scrolling to the editor', () => {
    expect(holdCaretAtEyeLevel(page({ caretBottom: 1000 }).view)).toBe(false)
  })
})
