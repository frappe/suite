import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'

import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '@/apps/writer/utils/typography'

/**
 * The size, in px, of the text the caret types with, or the selection starts with. A heading
 * without a size of its own reads as its heading size.
 */
export function selectionFontSize(editor: Editor): number {
  const stored = parseFloat(editor.getAttributes('textStyle').fontSize)
  if (Number.isFinite(stored)) return stored
  const { from, empty, $from } = editor.state.selection
  return renderedSize(editor.view, from, empty && $from.parentOffset > 0 ? -1 : 1)
}

/**
 * Makes each run of selected text one px larger or smaller than it is now, so a heading and the
 * text under it keep their difference. A run that lands on its block's own size loses its size.
 */
export function stepFontSize(editor: Editor, step: 1 | -1): boolean {
  const { view, state } = editor
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const next = clampSize(selectionFontSize(editor) + step)
    const chain = editor.chain().focus()
    if (next === blockSize(view, $from.before())) return chain.unsetFontSize().run()
    return chain.setFontSize(`${next}px`).run()
  }
  const textStyle = state.schema.marks.textStyle
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return
        const start = Math.max(from, pos)
        const end = Math.min(to, pos + node.nodeSize)
        const next = clampSize(renderedSize(view, start, 1) + step)
        const base = blockSize(view, state.doc.resolve(pos).before())
        const attrs = textStyle.isInSet(node.marks)?.attrs
        tr.addMark(
          start,
          end,
          textStyle.create({ ...attrs, fontSize: next === base ? null : `${next}px` }),
        )
      })
      return true
    })
    .removeEmptyTextStyle()
    .run()
}

function clampSize(size: number) {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)))
}

/** `side` picks the text after `pos` (1) or before it (-1) when `pos` sits between two runs. */
function renderedSize(view: EditorView, pos: number, side: 1 | -1) {
  const { node } = view.domAtPos(pos, side)
  return sizeOf(node instanceof Element ? node : node.parentElement)
}

function blockSize(view: EditorView, blockPos: number) {
  const block = view.nodeDOM(blockPos)
  return sizeOf(block instanceof Element ? block : null)
}

function sizeOf(element: Element | null) {
  return Math.round(parseFloat(element ? getComputedStyle(element).fontSize : '') || 0)
}
