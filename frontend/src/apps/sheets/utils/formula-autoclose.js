// Auto-close of parentheses inside a formula input, matching Google Sheets:
// typing `(` inserts a matching `)`, typing `)` in front of an auto-inserted
// one skips over it, and Backspace between an empty `()` pair removes both.
// Pure over (value, caret) so the in-cell overlay and the formula bar can
// share it. Only formulas (`=…`) are auto-closed — plain text is left alone.

// Handle a keydown that may trigger auto-close. Returns the next
// { value, caret } when handled (caller should preventDefault and apply it),
// or null when the key isn't one we act on and native input should proceed.
export function autoCloseKey(key, value, selStart, selEnd) {
  if (!value.startsWith('=')) return null

  if (key === '(') {
    const inner = value.slice(selStart, selEnd) // wrap any selection
    const next = value.slice(0, selStart) + '(' + inner + ')' + value.slice(selEnd)
    // With a selection, drop the caret past the wrapped text (after the new
    // `)`) so typing continues the call — matching Google Sheets. With no
    // selection, leave it inside the fresh pair to type the first argument.
    const caret = selStart === selEnd ? selStart + 1 : selEnd + 2
    return { value: next, caret }
  }

  // Nothing else acts on a non-empty selection.
  if (selStart !== selEnd) return null

  // Typing `)` directly before an existing `)` steps over it instead of
  // stacking a duplicate — the natural counterpart to auto-inserting one.
  if (key === ')' && value[selStart] === ')') {
    return { value, caret: selStart + 1 }
  }

  // Backspace inside an empty `()` clears the whole pair.
  if (key === 'Backspace' && value[selStart - 1] === '(' && value[selStart] === ')') {
    const next = value.slice(0, selStart - 1) + value.slice(selStart + 1)
    return { value: next, caret: selStart - 1 }
  }

  return null
}
