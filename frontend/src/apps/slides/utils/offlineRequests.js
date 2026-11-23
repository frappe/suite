// the requests offline copies make outside the api client: they need the raw Response
import { PIN_HEADER } from '@/apps/slides/utils/slidesCaches'

// the header keeps the worker out, so a store doesn't depend on who controls the page
export function fetchPinned(url, signal) {
  return fetch(url, { headers: { [PIN_HEADER]: '1' }, signal })
}
