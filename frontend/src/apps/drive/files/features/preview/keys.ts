/** Places that use the arrow keys and Escape themselves: fields, players, menus, dialogs and the text of a text file. */
const OWNS_KEYS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  'video',
  'audio',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '.cm-editor',
].join(', ')

/** Whether the arrow keys step through files: nothing has focus, or a plain button or link does, such as Next file after a click. */
export function arrowsStep(focused: Element | null): boolean {
  if (!focused || focused === document.body) return true
  const plain = focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement
  return plain && !focused.closest(OWNS_KEYS)
}

/** Whether Escape leaves the preview: no menu, dialog or other layer is open, and the key is not for a field or player. */
export function escapeLeaves(target: Element | null): boolean {
  if (document.fullscreenElement || target?.closest(OWNS_KEYS)) return false
  // A tooltip is a layer too, but Escape over it still leaves.
  return [...document.querySelectorAll('[data-dismissable-layer]')].every(
    (layer) => layer.matches('[role="tooltip"]') || !!layer.querySelector('[role="tooltip"]'),
  )
}
