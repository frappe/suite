export const PREVIEW_REFRESH_MS = 10 * 60_000

export interface PreviewRefreshOptions {
  refresh: () => void | Promise<void>
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
  let timer: ReturnType<typeof setInterval> | null = null

  const start = () => {
    if (timer || targetDocument.visibilityState === 'hidden') return
    timer = setEvery(() => void options.refresh(), PREVIEW_REFRESH_MS)
  }
  const stop = () => {
    if (!timer) return
    clearEvery(timer)
    timer = null
  }
  const visibility = () => {
    if (targetDocument.visibilityState === 'hidden') stop()
    else {
      void options.refresh()
      start()
    }
  }
  const focus = () => {
    if (targetDocument.visibilityState !== 'hidden') void options.refresh()
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

