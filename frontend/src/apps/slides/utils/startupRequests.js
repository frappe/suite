import { api } from '@/apps/slides/client/api'
import { loadBundledFonts } from '@/apps/slides/utils/bundledFonts'
import { API_CACHE_NAME, PIN_HEADER } from '@/apps/slides/utils/slidesCaches'
import { isCacheable } from '@/apps/slides/utils/slidesRequests'

const CONCURRENCY = 4
const HTTP_OK = 200
const CONTROLLER_WAIT = 3000

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// a failure stops the taking, and answers only once the lanes at work have finished
export async function runPool(items, worker) {
  let next = 0
  const failures = []
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (!failures.length && next < items.length) {
      const item = items[next++]
      try {
        await worker(item)
      } catch (err) {
        failures.push(err)
      }
    }
  })
  await Promise.all(lanes)
  if (failures.length) {
    throw failures[0]
  }
}

// an uncontrolled page's fetches bypass the worker
export async function waitForController() {
  if (!navigator.serviceWorker) {
    return false
  }

  if (navigator.serviceWorker.controller) {
    return true
  }

  const claimed = new Promise((resolve) =>
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
  )
  await Promise.race([claimed, delay(CONTROLLER_WAIT)])
  return !!navigator.serviceWorker.controller
}

// a first-ever open isn't controlled, so the worker can't store these for it
async function warmTemplates() {
  const url = api.templates.list.path
  // held across the fetch, so a wipe during it isn't undone by opening the name again
  const cache = await caches.open(API_CACHE_NAME)
  const response = await fetchCacheable(url, 'api')
  if (response) {
    await cache.put(url, response)
  }
}

// the slideshow chunk and the fonts load lazily
export function warmAssets() {
  return Promise.all([
    import('@/apps/slides/pages/Slideshow.vue').catch(() => {}),
    loadBundledFonts().catch(() => {}),
    warmTemplates().catch(() => {}),
  ])
}

// a shell from another build would pair its code with this page's chunks
export async function fetchShell(node, signal) {
  const response = await fetch(`/d/${node}`, { headers: { [PIN_HEADER]: '1' }, signal })
  const build = Number(response.headers.get('X-Suite-Build'))

  if (
    response.status === HTTP_OK &&
    isCacheable('shell', response) &&
    build === Number(__SUITE_BUILD__)
  ) {
    return response
  }

  await response.body?.cancel()
  throw new Error(`The presentation page could not be stored (${response.status})`)
}

async function fetchCacheable(url, type, signal) {
  const response = await fetch(url, { headers: { [PIN_HEADER]: '1' }, signal }).catch(() => null)

  if (response?.status === HTTP_OK && isCacheable(type, response)) {
    return response
  }

  await response?.body?.cancel()
  return null
}

// every [url, type] that came back storable, and the urls that didn't
export async function fetchAllCacheable(requests, signal) {
  const responses = new Map()
  const missing = []
  await runPool(requests, async ([url, type]) => {
    const response = await fetchCacheable(url, type, signal)

    if (response) {
      responses.set(url, response)
    } else {
      missing.push(url)
    }
  })

  return { responses, missing }
}

export async function cancelBodies(responses) {
  await Promise.allSettled([...responses].map((response) => response.body?.cancel()))
}
