import type { ChainedCommands, Editor } from '@tiptap/core'
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
  return resize(editor.chain().focus(), editor, (size) => size + step)
}

/** Sets all selected text to `size`, or the text the caret types with, without moving the selection. */
export function setFontSize(editor: Editor, size: number): boolean {
  return resize(editor.chain(), editor, () => size)
}

/** The size in what someone typed, rounded; null when it isn't a number the editor accepts. */
export function typedFontSize(typed: string): number | null {
  const size = Math.round(Number(typed))
  return typed.trim() && size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX ? size : null
}

/** Whether the selected text holds more than one size, so no single number describes it. */
export function hasMixedFontSizes(editor: Editor): boolean {
  const { doc, selection, schema } = editor.state
  const sizes = new Set<string>()
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (sizes.size > 1) return false
    if (!node.isText) return true
    const stored = schema.marks.textStyle.isInSet(node.marks)?.attrs.fontSize
    const $pos = doc.resolve(pos)
    sizes.add(stored ?? `${$pos.parent.type.name}${$pos.parent.attrs.level ?? ''}`)
    return false
  })
  return sizes.size > 1
}

function resize(chain: ChainedCommands, editor: Editor, next: (size: number) => number) {
  const { view, state } = editor
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const size = clampSize(next(selectionFontSize(editor)))
    if (size === blockSize(view, $from.before())) return chain.unsetFontSize().run()
    return chain.setFontSize(`${size}px`).run()
  }
  const textStyle = state.schema.marks.textStyle
  return chain
    .command(({ tr }) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return
        const start = Math.max(from, pos)
        const end = Math.min(to, pos + node.nodeSize)
        const size = clampSize(next(renderedSize(view, start, 1)))
        const base = blockSize(view, state.doc.resolve(pos).before())
        const attrs = textStyle.isInSet(node.marks)?.attrs
        tr.addMark(
          start,
          end,
          textStyle.create({ ...attrs, fontSize: size === base ? null : `${size}px` }),
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
