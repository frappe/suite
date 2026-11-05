import type { Router } from 'vue-router'

/**
 * What the router does when a page's code fails to load. A tab opened before
 * a deploy asks for chunk files the deploy removed, and a full load of the
 * same URL fetches the new build, so that failure reloads the page once. Any
 * other failure, or a stale chunk again after that reload, opens the error
 * route, which offers a reload.
 */

export interface LoadFailureOptions {
  /** The route that says the page did not load. Its component must not load lazily. */
  errorRoute: string
}

/** Set before the one automatic reload; cleared once a navigation succeeds. */
const RELOAD_KEY = 'suite:load-failure-reload'

// Chromium, Safari, Firefox and webpack-style loaders word a missing chunk differently.
const STALE_CHUNK_MESSAGES = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'ChunkLoadError',
] as const

function isStaleChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name} ${error.message}`
  return STALE_CHUNK_MESSAGES.some((message) => text.includes(message))
}

export function installLoadFailureRecovery(
  router: Router,
  options: LoadFailureOptions,
): () => void {
  const removeErrorHandler = router.onError((error, to) => {
    console.error(`Could not load ${to.fullPath}`, error)
    if (to.name === options.errorRoute) return
    if (isStaleChunkError(error) && claimReload()) {
      window.location.assign(to.fullPath)
      return
    }
    void router.replace({ name: options.errorRoute, query: { redirect: to.fullPath } })
  })
  const removeAfterEach = router.afterEach((to, _from, failure) => {
    if (!failure && to.name !== options.errorRoute) forgetReload()
  })
  return () => {
    removeErrorHandler()
    removeAfterEach()
  }
}

// Storage that cannot be used counts as "already reloaded": one error page is
// better than a loop of full page loads.
function claimReload(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false
    sessionStorage.setItem(RELOAD_KEY, '1')
    return true
  } catch {
    return false
  }
}

function forgetReload(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    // Without storage there is no reload to forget.
  }
}
