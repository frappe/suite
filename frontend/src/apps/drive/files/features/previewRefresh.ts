export const PREVIEW_REFRESH_MS = 10 * 60_000
// A signed preview URL lasts at least 15 minutes. Near-expiry refreshes come 2 minutes before.
const PREVIEW_LIFETIME_MS = 15 * 60_000
const PREVIEW_MARGIN_MS = 2 * 60_000
const PREVIEW_CHECK_MS = 60_000

interface PreviewRow {
  preview?: { expires: number } | null
}

export interface PreviewRefreshOptions {
  refresh: () => void | Promise<void>
  /** The rows on screen. With them, a refresh comes only when a preview is about to expire. */
  rows?: () => readonly PreviewRow[]
  window?: Window
  document?: Document
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}

export function observePreviewRefresh(options: PreviewRefreshOptions): () => void {
  const targetWindow = options.window ?? window
  const targetDocument = options.document ?? document
  const setEvery = options.setInterval ?? globalThis.setInterval
  const clearEvery = options.clearInterval ?? globalThis.clearInterval
  const due = options.rows ? nearExpiry(options.refresh, options.rows) : null
  const refresh = due ? due.refresh : () => void options.refresh()
  const isDue = due ? due.isDue : () => true
  let timer: ReturnType<typeof setInterval> | null = null

  const start = () => {
    if (timer || targetDocument.visibilityState === 'hidden') return
    timer = due
      ? setEvery(() => isDue() && refresh(), PREVIEW_CHECK_MS)
      : setEvery(refresh, PREVIEW_REFRESH_MS)
  }
  const stop = () => {
    if (!timer) return
    clearEvery(timer)
    timer = null
  }
  const visibility = () => {
    if (targetDocument.visibilityState === 'hidden') stop()
    else {
      if (isDue()) refresh()
      start()
    }
  }
  const focus = () => {
    if (targetDocument.visibilityState !== 'hidden' && isDue()) refresh()
  }
  targetDocument.addEventListener('visibilitychange', visibility)
  targetWindow.addEventListener('focus', focus)
  start()
  return () => {
    stop()
    targetDocument.removeEventListener('visibilitychange', visibility)
    targetWindow.removeEventListener('focus', focus)
  }
}

/**
 * With previews on screen, due when the earliest expires within the margin, or when the last
 * refresh is a lifetime less the margin ago. The second rule covers a browser clock behind the
 * server's. When fresh rows already look due, the browser clock is ahead, and only the second
 * rule applies.
 */
function nearExpiry(load: PreviewRefreshOptions['refresh'], rows: () => readonly PreviewRow[]) {
  let refreshedAt = Date.now()
  let clockAgrees = true
  const remaining = () => {
    const earliest = rows().reduce(
      (soonest, row) => Math.min(soonest, row.preview?.expires ?? Infinity),
      Infinity,
    )
    return earliest * 1000 - Date.now()
  }
  return {
    isDue: () => {
      const left = remaining()
      if (left === Infinity) return false
      const lifetimeUsed = Date.now() - refreshedAt >= PREVIEW_LIFETIME_MS - PREVIEW_MARGIN_MS
      return lifetimeUsed || (clockAgrees && left <= PREVIEW_MARGIN_MS)
    },
    refresh: () => {
      refreshedAt = Date.now()
      void Promise.resolve(load()).then(() => {
        clockAgrees = remaining() > PREVIEW_MARGIN_MS
      })
    },
  }
}
