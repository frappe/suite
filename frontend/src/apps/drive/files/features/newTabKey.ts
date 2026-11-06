import { isApple } from './shortcuts/useListingShortcuts'

/** The attribute a name link carries while a click on it would open a new tab. */
export const NEW_TAB_ATTRIBUTE = 'data-new-tab'

/** Stops watching the keys for the name link under the pointer. One link is watched at a time. */
let stopWatching: (() => void) | undefined

/** Whether the key that makes a click open a new tab is held: Cmd on Apple devices, Ctrl elsewhere. */
export function isNewTabKey(event: KeyboardEvent | MouseEvent): boolean {
  return isApple() ? event.metaKey : event.ctrlKey
}

/**
 * For a name link's `pointerenter`: while the pointer stays on the link, it
 * carries `data-new-tab` whenever the new-tab key is held, so it looks like a
 * link only then. Releasing the key, leaving the link or the window losing
 * focus takes the mark away at once.
 */
export function watchNewTabKey(event: PointerEvent): void {
  const link = event.currentTarget
  if (!(link instanceof HTMLElement)) return
  stopWatching?.()
  const controller = new AbortController()
  const { signal } = controller
  const mark = (held: boolean) => {
    link.toggleAttribute(NEW_TAB_ATTRIBUTE, held)
  }
  const follow = (input: KeyboardEvent | MouseEvent) => mark(isNewTabKey(input))
  window.addEventListener('keydown', follow, { signal })
  window.addEventListener('keyup', follow, { signal })
  window.addEventListener('blur', () => mark(false), { signal })
  link.addEventListener('pointermove', follow, { signal })
  link.addEventListener('pointerleave', () => stopWatching?.(), { signal })
  stopWatching = () => {
    controller.abort()
    mark(false)
    stopWatching = undefined
  }
  follow(event)
}
