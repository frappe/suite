import { createPartialResponse } from 'workbox-range-requests'

import { canonicalMediaKey } from './utils/canonicalMediaKey'
import {
  API_CACHE_NAME,
  ASSETS_CACHE_NAME,
  MEDIA_CACHE_NAME,
  PIN_HEADER,
  // outside CACHE_MAX_AGE: a pinned copy must survive the sweep
  PINNED_CACHE_NAME,
  SHELL_CACHE_NAME,
  VISITED_CACHE_NAME,
  VISITED_NODE_HEADER,
  VISITED_SHELL_KEY,
  withCachedTime,
} from './utils/slidesCaches'
import { getRequestType, isBundleAsset, isCacheable, shellKey } from './utils/slidesRequests'

const DAY = 24 * 60 * 60 * 1000

// membership is what makes a cache expiring; the sweep reads straight off this
const CACHE_MAX_AGE = {
  [MEDIA_CACHE_NAME]: DAY,
  [ASSETS_CACHE_NAME]: 30 * DAY,
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

// a broken cache degrades to "no service worker", never "no slides"
const openCache = (name) => caches.open(name).catch(() => null)
const matchCache = (cache, request) => cache.match(request).catch(() => null)

const cleanupOldCacheEntry = async (cache, request, response, maxAge) => {
  const now = Date.now()

  const cachedTimeHeader = response.headers.get('x-cached-time')
  if (!cachedTimeHeader) return

  const cachedTime = parseInt(cachedTimeHeader, 10)
  if (isNaN(cachedTime)) return

  const age = now - cachedTime

  if (age > maxAge) {
    await cache.delete(request)
  }
}

const cleanupOldCacheEntries = async (name, maxAge) => {
  const cache = await openCache(name)
  if (!cache) return

  for (const request of await cache.keys()) {
    const response = await matchCache(cache, request)
    if (!response) continue

    await cleanupOldCacheEntry(cache, request, response, maxAge)
  }
}

const handleSWActivate = async () => {
  // this takes control of all client pages that are already open
  await self.clients.claim()
  // a failed sweep must not block activation
  await Promise.all([
    ...Object.entries(CACHE_MAX_AGE).map(([name, maxAge]) =>
      cleanupOldCacheEntries(name, maxAge).catch(() => {}),
    ),
    // the shell copy an older worker stored; see the fetch listener
    caches.delete(SHELL_CACHE_NAME).catch(() => {}),
  ])
}

self.addEventListener('activate', (event) => {
  event.waitUntil(handleSWActivate())
})

// what each open page last said it is, see getRequestType
const slidesClientState = new Map()

const forgetClosedClients = async () => {
  const clients = await self.clients.matchAll({ type: 'window' })
  const open = new Set(clients.map((client) => client.id))
  for (const clientId of slidesClientState.keys()) {
    if (!open.has(clientId)) slidesClientState.delete(clientId)
  }
}

self.addEventListener('message', (event) => {
  const clientId = event.source?.id
  if (!clientId) return
  if (event.data === 'slides-entered') slidesClientState.set(clientId, 'entered')
  if (event.data === 'slides-left') slidesClientState.set(clientId, 'left')
  // the page waits for this before it loads the next route
  event.ports[0]?.postMessage(true)
  event.waitUntil(forgetClosedClients().catch(() => {}))
})

const addCacheEntry = async (type, cache, request, response) => {
  if (!isCacheable(type, response)) return

  // clone response and add cache timestamp header
  const modifiedResponse = withCachedTime(response.clone())
  await cache.put(request, modifiedResponse)
}

const fetchAndCache = async (event, type, cache) => {
  const response = await fetch(event.request)
  if (response.ok && response.status === 200) {
    const written = addCacheEntry(type, cache, event.request, response).catch((err) => {
      console.warn('Slides SW cache write failed:', err)
    })
    // don't block the response on the cache write
    event.waitUntil(written)
  }
  return response
}

// network-first: serve the live response (preserving its real headers) and fall
// back to cache only when the network fails; with nothing stored the error surfaces
const networkFirst = async (event, type, cache) => {
  const network = fetchAndCache(event, type, cache)
  try {
    return await network
  } catch {}

  const cached = await matchCache(cache, event.request)
  if (!cached) return network

  return cached
}

// the cache holds whole bodies, so a seek is sliced out of the stored 200
const rangeFromCache = async (event, cached) => {
  const partial = await createPartialResponse(event.request, cached)
  // an unsatisfiable range shouldn't beat a working network
  if (partial.status === 416) return fetch(event.request)
  return partial
}

const respondFromCache = (event, cached) =>
  event.request.headers.has('range') ? rangeFromCache(event, cached) : cached

// serve the stored copy at once and refresh it behind the page
const staleWhileRevalidate = async (event, cache) => {
  const cached = await matchCache(cache, event.request)
  const network = fetchAndCache(event, 'asset', cache)
  if (!cached) return network

  event.waitUntil(network.catch(() => {}))
  return cached
}

const cacheFirst = async (event, type, cache) => {
  const cached = await matchCache(cache, event.request)
  if (cached) return respondFromCache(event, cached)
  return fetchAndCache(event, type, cache)
}

// match, not open: never create the cache for a user who doesn't pin
const matchPinned = (request) => {
  const key = canonicalMediaKey(request.url)
  if (!key) return null

  return caches.match(key, { cacheName: PINNED_CACHE_NAME }).catch(() => null)
}

const getPinnedResponse = async (event) => {
  const pinned = await matchPinned(event.request)
  return pinned ? respondFromCache(event, pinned) : null
}

// a pin is a request to present without the network, so it wins even online;
// the user-switch clear and unpinning are what bound it
const getMediaResponse = async (event) => {
  const pinned = await getPinnedResponse(event)
  if (pinned) return pinned

  const cache = await openCache(MEDIA_CACHE_NAME)
  return cache ? cacheFirst(event, 'media', cache) : fetch(event.request)
}

const getAssetResponse = async (event, url) => {
  const cache = await openCache(ASSETS_CACHE_NAME)
  if (!cache) return fetch(event.request)

  if (isBundleAsset(url)) return cacheFirst(event, 'asset', cache)
  return staleWhileRevalidate(event, cache)
}

const getResponseForRequest = async (event, type, url) => {
  if (type === 'media') return getMediaResponse(event)
  if (type === 'asset') return getAssetResponse(event, url)

  const cache = await openCache(API_CACHE_NAME)
  if (!cache) return fetch(event.request)

  return networkFirst(event, 'api', cache)
}

// the store keys a pin by these, see stores/offlineCopy.js
function pinnedKey(request, url) {
  if (request.mode === 'navigate') {
    return shellKey(url.pathname)
  }

  return canonicalMediaKey(url.href) ?? `${url.pathname}${url.search}`
}

function matchVisited(key) {
  return caches.match(key, { cacheName: VISITED_CACHE_NAME }).catch(() => null)
}

// a marker's empty body answers nothing; it only lets a navigation have the shared shell
async function getVisitedResponse(request, url) {
  const marker = shellKey(url.pathname)
  if (request.mode !== 'navigate') {
    if (marker) {
      return null
    }

    const entry = await matchVisited(`${url.pathname}${url.search}`)
    const node = entry?.headers.get(VISITED_NODE_HEADER)
    // data with no marker is what a stopped capture left, maybe half of it
    if (node && !(await matchVisited(`/d/${node}`))) {
      return null
    }

    return entry
  }

  if (marker && (await matchVisited(marker))) {
    return matchVisited(VISITED_SHELL_KEY)
  }

  return null
}

// both caches only ever hold this user's own copies, so offline they may answer any tab
async function getOfflineResponse(event, type, url) {
  const key = pinnedKey(event.request, url)
  const pinned =
    key && (await caches.match(key, { cacheName: PINNED_CACHE_NAME }).catch(() => null))

  if (pinned) {
    return respondFromCache(event, pinned)
  }

  const visited = await getVisitedResponse(event.request, url)
  if (visited) {
    return respondFromCache(event, visited)
  }

  // a signed picture's signature changes, so the page stored it under its file path
  const stored =
    type === 'other' &&
    key &&
    (await caches.match(key, { cacheName: MEDIA_CACHE_NAME }).catch(() => null))
  if (stored) {
    return respondFromCache(event, stored)
  }

  if (type === 'other' || type === 'shell') {
    return fetch(event.request)
  }

  return getResponseForRequest(event, type, url)
}

// respondWith must be called synchronously, so nothing here may await
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // a capture or pin stores the body itself
  if (request.headers.has(PIN_HEADER)) return

  const requestType = getRequestType(request, slidesClientState.get(event.clientId))
  if (!self.navigator.onLine) {
    event.respondWith(getOfflineResponse(event, requestType, url))
    return
  }
  // the shell document is the whole suite's, not slides': a stored copy would
  // keep serving old code after a flip or a deploy, so online it always comes
  // from the network (unified frontend spec §14.9)
  if (requestType === 'other' || requestType === 'shell') return

  event.respondWith(getResponseForRequest(event, requestType, url))
})
