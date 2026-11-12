import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

// A share of the visible page's height. EDITOR_TEXT_CLASS leaves room below the last line to reach it.
const EYE_LEVEL = 0.6

/** Keeps the caret from sinking to the bottom of the page while writing. */
export const CaretAtEyeLevel = Extension.create({
  name: 'caretAtEyeLevel',

  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleScrollToSelection: holdCaretAtEyeLevel } })]
  },
})

/** Returns false so the editor still does its own scrolling, such as sideways in a wide table. */
export function holdCaretAtEyeLevel(view: EditorView): boolean {
  const scroller = view.dom.closest('#editor-scroll-container')
  // Formatting a selection also asks for a scroll, and should not move the page.
  if (!scroller || !view.state.selection.empty) return false
  const { top, height } = scroller.getBoundingClientRect()
  const caretBottom = view.coordsAtPos(view.state.selection.head).bottom
  scroller.scrollTop += Math.max(0, caretBottom - (top + height * EYE_LEVEL))
  return false
}
