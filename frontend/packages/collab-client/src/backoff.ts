const MIN_BACKOFF_MS = 1000
const BACKOFF_SPREAD_MS = 29_000

export function backoffMs() {
  return MIN_BACKOFF_MS + Math.random() * BACKOFF_SPREAD_MS
}
