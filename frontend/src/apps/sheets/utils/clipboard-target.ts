// Decide whether a document-level clipboard event (copy/cut/paste) is meant for
// the grid — i.e. the host should intercept it and run a cell-level op — or
// should be left to the browser's native handling.
//
// The subtlety: the inline cell editor is a <textarea> mounted INSIDE the grid
// wrapper, so a plain "is the focused element inside gridWrap?" check treats an
// open editor as "grid focused" and hijacks Cmd/Ctrl+C/X/V for cell ops —
// breaking paste, and copy/cut of a selected substring, inside the editor.
// While the editor is open, clipboard ops belong to the textarea. The formula
// bar is a text field too, so its copy/cut/paste act on its text.

// Elements are only compared by identity, so any value will do (the tests
// pass plain objects); the grid wrapper only needs `contains`.
export interface ClipboardTargetState {
  activeEl: unknown
  canvasEl: unknown
  formulaEl: unknown
  gridWrap: { contains(el: unknown): boolean } | null | undefined
  editing: boolean
}

export function isCanvasClipboardTarget({
  activeEl,
  canvasEl,
  formulaEl,
  gridWrap,
  editing,
}: ClipboardTargetState): boolean {
  if (editing || activeEl === formulaEl) return false
  return activeEl === canvasEl || !!gridWrap?.contains(activeEl)
}
