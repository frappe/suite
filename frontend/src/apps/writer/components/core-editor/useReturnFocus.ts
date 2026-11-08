import type { Editor } from '@tiptap/core'
import { useEventListener } from '@vueuse/core'

/**
 * A menu closed after a pointer pick hands focus back to its trigger, which leaves a focus ring
 * while the writer is in the text. The returned `focusin` handler sends focus that lands on a
 * menu trigger the pointer did not press on to the editor; after a keyboard pick it stays on the
 * trigger. Focus moving into an open menu or panel is left alone. Call it in a component's setup.
 */
export function useReturnFocus(editor: () => Editor) {
  let pointerLast = false
  let pressed: EventTarget | null = null
  useEventListener(
    window,
    'pointerdown',
    (event) => {
      pointerLast = true
      pressed = event.target
    },
    true,
  )
  useEventListener(window, 'keydown', () => (pointerLast = false), true)

  return (event: FocusEvent) => {
    if (!pointerLast) return
    const control = event.target
    if (!(control instanceof Element) || !control.hasAttribute('aria-expanded')) return
    if (pressed instanceof Node && control.contains(pressed)) return
    editor().commands.focus()
  }
}
