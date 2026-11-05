const MIN_SECONDS = 1
const MAX_SECONDS = 3600

// Seconds a slide waits before it advances, or null when it waits for a click. Old rows
// can hold anything, so this reads them within what the server accepts and never writes
export function advanceSeconds(stored) {
  const text = String(stored ?? '').trim()
  if (!text) {
    return null
  }

  const seconds = Number(text)
  if (!Number.isFinite(seconds)) {
    return null
  }

  return Math.min(Math.max(seconds, MIN_SECONDS), MAX_SECONDS)
}
