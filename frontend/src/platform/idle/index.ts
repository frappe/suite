/**
 * Runs `work` once the page has nothing else to do, or after `timeout` ms at the latest: for loading
 * ahead what a tap is likely to want next. Safari has no `requestIdleCallback`, so there it waits a
 * moment instead.
 */
export function whenIdle(work: () => void, timeout = 2000): void {
  if (typeof window === 'undefined') return
  if ('requestIdleCallback' in window) window.requestIdleCallback(work, { timeout })
  else setTimeout(work, Math.min(timeout, 300))
}
