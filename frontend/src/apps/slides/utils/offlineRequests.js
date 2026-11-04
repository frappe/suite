// the requests offline copies make outside the api client: they need the raw Response
import { PIN_HEADER } from '@/apps/slides/utils/slidesCaches'

const PROBE_TIMEOUT_MS = 2000

// the header keeps the worker out, so a store doesn't depend on who controls the page
export function fetchPinned(url, signal) {
  return fetch(url, { headers: { [PIN_HEADER]: '1' }, signal })
}

// ping isn't a slides request, so none of the worker's stored answers can stand in for it
export async function serverAnswers() {
  if (!navigator.onLine) {
    return false
  }

  try {
    const response = await fetch('/api/method/ping', {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok || response.redirected) {
      return false
    }

    const { message } = await response.json()
    return message === 'pong'
  } catch {
    return false
  }
}
