import { onScopeDispose, watch, type Ref } from 'vue'

/**
 * Gives an overlay one browser history entry of its own while it is open, at the URL already
 * showing, so Back (the phone's back gesture) closes the overlay and leaves the page as it was.
 * The entry keeps the router's own state, so vue-router sees the same position and treats the pop
 * as a no-op; Settings' drill-in (shell/settings/SettingsDrillIn.vue) works the same way, one entry
 * per level.
 *
 * Closed any other way, the overlay takes its entry back out, unless the page has moved on since:
 * then the entry is left where it is, under the new page, rather than undoing the move.
 */
export function useHistoryEntry(open: Ref<boolean>): void {
  // The entry this open pushed, and the address it was pushed at, while it is still there.
  let entry: { id: string; href: string } | undefined

  const isEntry = (state: unknown, id: string) =>
    !!state && typeof state === 'object' && 'suiteOverlay' in state && state.suiteOverlay === id

  const leave = () => {
    const left = entry
    entry = undefined
    if (left && isEntry(history.state, left.id) && location.href === left.href) history.back()
  }

  const onPopState = (event: PopStateEvent) => {
    if (!entry || isEntry(event.state, entry.id)) return
    entry = undefined
    open.value = false
  }

  watch(
    open,
    (isOpen) => {
      if (!isOpen) return leave()
      if (entry) return
      entry = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        href: location.href,
      }
      history.pushState(
        {
          ...(history.state && typeof history.state === 'object' ? history.state : null),
          suiteOverlay: entry.id,
        },
        '',
      )
    },
    { immediate: true },
  )

  window.addEventListener('popstate', onPopState)
  onScopeDispose(() => {
    window.removeEventListener('popstate', onPopState)
    leave()
  })
}
