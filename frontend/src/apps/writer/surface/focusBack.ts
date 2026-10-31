const INPUTS = ['pointerdown', 'keydown']

/**
 * An action that waits for a closing menu to hand focus back to its button.
 * Any input before then drops it, so a later, unrelated focus runs nothing.
 */
export function waitForFocusBack() {
  let pending: (() => void) | null = null

  function drop() {
    pending = null
    for (const type of INPUTS) {
      document.removeEventListener(type, drop, true)
    }
  }

  // Called from the menu's select, after the input that picked the item has passed the document
  function wait(act: () => void) {
    pending = act
    for (const type of INPUTS) {
      document.addEventListener(type, drop, { capture: true, once: true })
    }
  }

  function focused() {
    const act = pending
    drop()
    act?.()
  }

  return { wait, focused }
}
