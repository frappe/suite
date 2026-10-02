import { shellScrollContainer } from 'frappe-ui'
import { nextTick, onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'

/**
 * Scroll restoration for the element that scrolls the page. The window never
 * scrolls in Suite: a shell route scrolls the shell's scroll region, and a
 * route that scrolls its own content names its scroller with
 * `useRestoredScroll`.
 *
 * - Back and Forward restore the position the history entry had when it was
 *   left. Positions are kept per entry, so one folder open in two entries keeps
 *   two positions.
 * - A navigation to another path starts at the top.
 * - A navigation that keeps the path (a sort, view or search change in the
 *   query) keeps the position.
 */

/** How long a restore waits for the page to grow tall enough to reach it. */
const RESTORE_TIMEOUT_MS = 2000
/** Input that means the person is scrolling, so a pending restore stops. */
const SCROLL_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/** Scrollers named by mounted pages of content-scrolling routes. The last one wins. */
const pageScrollers: HTMLElement[] = []

/** The element that scrolls `route`, following the shell's reading of `meta.scroll`. */
function scroller(route: RouteLocationNormalized): HTMLElement | null {
  return route.meta.scroll === 'content'
    ? (pageScrollers.at(-1) ?? null)
    : shellScrollContainer.value
}

/**
 * Names the element that scrolls this page, for a route with
 * `meta.scroll: 'content'`. Shell routes need nothing: the shell's scroll
 * region is restored by default.
 */
export function useRestoredScroll(element: MaybeRefOrGetter<HTMLElement | null | undefined>): void {
  let registered: HTMLElement | null = null
  const release = () => {
    if (!registered) return
    const index = pageScrollers.lastIndexOf(registered)
    if (index !== -1) pageScrollers.splice(index, 1)
    registered = null
  }
  watch(
    () => toValue(element) ?? null,
    (el) => {
      release()
      if (el) pageScrollers.push((registered = el))
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(release)
}

export function installScrollRestoration(router: Router): () => void {
  const positions = new Map<number, number>()
  let entry = entryKey(router)
  let popped = false
  let pending: { target: number; cancel: () => void } | null = null

  // The history reports Back and Forward before the router navigates.
  const stopListening = router.options.history.listen(() => {
    popped = true
  })

  // The last guard before the page changes. On Back the history entry has
  // already moved, so the position goes to the entry still on screen.
  const removeBeforeResolve = router.beforeResolve((_to, from) => {
    const el = scroller(from)
    if (entry !== undefined && el) positions.set(entry, pending?.target ?? el.scrollTop)
  })

  const removeAfterEach = router.afterEach((to, from, failure) => {
    const isPop = popped
    popped = false
    if (failure) return
    entry = entryKey(router)
    if (isPop) scrollTo(entry === undefined ? 0 : (positions.get(entry) ?? 0))
    else if (to.path !== from.path) scrollTo(0)
  })

  function scrollTo(target: number) {
    pending?.cancel()
    pending = target > 0 ? restore(router, target, () => (pending = null)) : null
    // A new scroller starts at the top, so only one already on screen moves.
    if (target === 0)
      void nextTick(() => {
        const el = scroller(router.currentRoute.value)
        if (el) el.scrollTop = 0
      })
  }

  return () => {
    pending?.cancel()
    stopListening()
    removeBeforeResolve()
    removeAfterEach()
  }
}

/**
 * Scrolls to `target` once the page is tall enough to reach it. Cached content
 * is usually there when the page renders, so the first try lands before the
 * first paint; later tries run once a frame until the timeout.
 */
function restore(
  router: Router,
  target: number,
  done: () => void,
): { target: number; cancel: () => void } {
  const deadline = performance.now() + RESTORE_TIMEOUT_MS
  let frame = 0
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    for (const type of SCROLL_INPUT) window.removeEventListener(type, stop, true)
    done()
  }
  const attempt = () => {
    if (stopped) return
    const el = scroller(router.currentRoute.value)
    if (el && el.scrollHeight - el.clientHeight >= target) {
      el.scrollTop = target
      return stop()
    }
    if (performance.now() >= deadline) return stop()
    frame = requestAnimationFrame(attempt)
  }

  for (const type of SCROLL_INPUT) window.addEventListener(type, stop, { capture: true, passive: true })
  void nextTick(attempt)
  return { target, cancel: stop }
}

/** The history entry's position in the session history, kept by the router. */
function entryKey(router: Router): number | undefined {
  const position = router.options.history.state.position
  return typeof position === 'number' ? position : undefined
}
