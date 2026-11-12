import { TransportError } from '@/platform/transport'

/** Statuses that mean "try again later": no connection, a timeout, or a busy server. */
const TRANSIENT_STATUSES = new Set([0, 408, 429, 502, 503, 504])
/** Spreads the requests that wake on one `online` event, so they do not all start at once. */
const WAKE_SPREAD_MS = 500

export function isTransient(cause: unknown): cause is TransportError {
  return cause instanceof TransportError && TRANSIENT_STATUSES.has(cause.status)
}

/**
 * Resolves after `ms`. With `wake`, it resolves soon after the browser comes
 * online or the page becomes visible, because phones pause timers in a
 * background tab.
 */
export function pause(ms: number, signal: AbortSignal, { wake = false } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const listening = new AbortController()
    const done = () => {
      listening.abort()
      resolve()
    }
    let timer = setTimeout(done, ms)
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(done, Math.random() * WAKE_SPREAD_MS)
    }
    const options = { signal: listening.signal }
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        listening.abort()
        reject(signal.reason)
      },
      options,
    )
    if (!wake) return
    window.addEventListener('online', soon, options)
    document.addEventListener(
      'visibilitychange',
      () => document.visibilityState === 'visible' && soon(),
      options,
    )
  })
}

/** Resolves when the browser reports a network again, after a short random spread. */
export async function online(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const listening = new AbortController()
    const options = { signal: listening.signal }
    window.addEventListener(
      'online',
      () => {
        listening.abort()
        resolve()
      },
      options,
    )
    signal.addEventListener(
      'abort',
      () => {
        listening.abort()
        reject(signal.reason)
      },
      options,
    )
  })
  await pause(Math.random() * WAKE_SPREAD_MS, signal)
}
