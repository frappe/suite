import type { Editor } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Storage {
    /** frappe-ui's StyleClipboard, which does not declare its storage */
    styleClipboard: { painting: boolean; data: unknown }
  }
}

/**
 * Turns the format painter on with the styles of the selection, or of the word at the caret, or
 * turns it off when it is on.
 */
export function togglePainting(editor: Editor): boolean {
  const storage = editor.storage.styleClipboard
  if (storage.painting) {
    storage.painting = false
    storage.data = null
    editor.view.dispatch(editor.state.tr)
    return editor.commands.focus()
  }
  const { selection } = editor.state
  if (!selection.empty) return editor.chain().focus().storeStyles().run()
  const word = wordAround(editor)
  if (!word) return false
  editor.commands.setTextSelection(word)
  editor.commands.storeStyles()
  return editor.chain().focus().setTextSelection(selection.from).run()
}

/**
 * Paints the styles on the next selection once the user finishes it, whether by mouse (drag,
 * double or triple click) or keyboard (Shift with arrows, select all). Returns a cleanup.
 *
 * A keyboard selection is finished a short pause after the keys are released, so pressing
 * Shift+Arrow several times paints the whole selection, or when a key without Shift is pressed.
 */
export function watchPaintTarget(editor: Editor): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined
  const paint = () => {
    clearTimeout(pending)
    const { styleClipboard } = editor.storage
    if (styleClipboard.painting && !editor.state.selection.empty) editor.commands.applyStyles()
  }
  // The browser settles a double-click's selection after mouseup
  const afterMouseUp = () => setTimeout(paint)
  const onKeyDown = (event: KeyboardEvent) => (event.shiftKey ? clearTimeout(pending) : paint())
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Shift' || !event.shiftKey) pending = setTimeout(paint, PAINT_PAUSE_MS)
  }
  const dom = editor.view.dom
  dom.addEventListener('mouseup', afterMouseUp)
  dom.addEventListener('keydown', onKeyDown)
  dom.addEventListener('keyup', onKeyUp)
  return () => {
    clearTimeout(pending)
    dom.removeEventListener('mouseup', afterMouseUp)
    dom.removeEventListener('keydown', onKeyDown)
    dom.removeEventListener('keyup', onKeyUp)
  }
}

const PAINT_PAUSE_MS = 500

/** The word the caret is in or next to, or the character before it in other text. */
function wordAround(editor: Editor): { from: number; to: number } | null {
  const { $from } = editor.state.selection
  // Inline nodes such as mentions count as one character, as they take one position
  const text = $from.parent.textBetween(0, $from.parent.content.size, '', '\ufffc')
  const offset = $from.parentOffset
  const before = /[\p{L}\p{N}_]*$/u.exec(text.slice(0, offset))?.[0].length ?? 0
  const after = /^[\p{L}\p{N}_]*/u.exec(text.slice(offset))?.[0].length ?? 0
  const start = $from.start()
  if (before + after) return { from: start + offset - before, to: start + offset + after }
  return offset ? { from: start + offset - 1, to: start + offset } : null
}
