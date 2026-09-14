import { onScopeDispose } from 'vue'

import emitter from '@/apps/drive/emitter'

/**
 * Subscribe to the app-wide emitter for as long as the calling component lives.
 *
 * `emitter` is a single mitt instance shared by all of Drive, so a plain
 * `emitter.on(...)` outlives the component that registered it: unmounting does
 * not unsubscribe. GenericPage backs eight routes and Navbar is mounted inside
 * it, so navigating between lists stacks a fresh set of handlers on top of the
 * dead ones — one `refresh` becomes N refetches, and handlers keep unmounted
 * pages (and the data they closed over) reachable.
 *
 * `onScopeDispose` fires when the component's effect scope is torn down, which
 * covers unmount without each caller having to remember an `onBeforeUnmount`.
 *
 * The handler is passed to `off` explicitly: mitt's `off(type)` with no handler
 * clears *every* listener for that event, which would unsubscribe whichever
 * other component happens to share it.
 */
export function useEmitter(event, handler) {
  emitter.on(event, handler)
  onScopeDispose(() => emitter.off(event, handler))
}
