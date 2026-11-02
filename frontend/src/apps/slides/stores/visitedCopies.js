import { presentationDoc } from '@/apps/slides/stores/presentation'
import { loadedAssets } from '@/apps/slides/utils/loadedAssets'
import { entryAssets, startupUrls } from '@/apps/slides/utils/pinTargets'
import { slidesWorkerEnabled } from '@/apps/slides/utils/serviceWorker'
import {
  RECORD_PREFIX,
  VISITED_CACHE_NAME,
  VISITED_SHELL_KEY,
} from '@/apps/slides/utils/slidesCaches'
import { shellKey } from '@/apps/slides/utils/slidesRequests'
import {
  cancelBodies,
  delay,
  fetchAllCacheable,
  fetchShell,
  runPool,
  waitForController,
  warmAssets,
} from '@/apps/slides/utils/startupRequests'
import { getCookieSessionUser } from '@/platform/session'

const LIMIT = 20
const SETTLE_TIME = 3000
const IDLE_TIMEOUT = 5000

const BUILD_HEADER = 'x-visited-build'
const CSRF_HEADER = 'x-visited-csrf'
const NODE_HEADER = 'x-visited-node'
const TIME_HEADER = 'x-visited-time'

// nodes this page has captured or is capturing
const remembered = new Set()

// the capture in flight: { id, node, controller }
let visit = null

function hasPin(id) {
  const key = `${RECORD_PREFIX}${id}`
  return localStorage.getItem(key) !== null
}

function isEligible(id) {
  return (
    slidesWorkerEnabled() &&
    'serviceWorker' in navigator &&
    'caches' in window &&
    !window.disable_slides_service_worker &&
    navigator.onLine &&
    !!getCookieSessionUser() &&
    !!presentationDoc.value?.node &&
    !presentationDoc.value.is_composite &&
    !hasPin(id)
  )
}

function whenIdle() {
  return new Promise((resolve) => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(resolve, { timeout: IDLE_TIMEOUT })
    } else {
      setTimeout(resolve, IDLE_TIMEOUT)
    }
  })
}

function withHeaders(response, added) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(added)) {
    headers.set(name, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function csrfIn(html) {
  const [, token = ''] = html.match(/window\.csrf_token = '([^']*)'/) ?? []
  return token
}

function isCurrentShell(stored) {
  return (
    stored?.headers.get(BUILD_HEADER) === String(__SUITE_BUILD__) &&
    stored.headers.get(CSRF_HEADER) === window.csrf_token
  )
}

// a file a last build also listed still carries its label, so the delete would take it
async function filesToFetch(cache, html) {
  const files = [...new Set([...entryAssets(html), ...loadedAssets()])]
  const stored = await Promise.all(files.map((file) => cache.match(file)))
  return files.filter(
    (_, index) => stored[index]?.headers.get(BUILD_HEADER) !== String(__SUITE_BUILD__),
  )
}

async function cacheKeys(cache) {
  const requests = await cache.keys()
  return requests.map((request) => {
    const url = new URL(request.url)
    return `${url.pathname}${url.search}`
  })
}

// by the stored shell's build, so a tab on another build can't leave that shell without files
async function deleteOtherBuildFiles(cache) {
  const shell = await cache.match(VISITED_SHELL_KEY)
  const build = shell?.headers.get(BUILD_HEADER)
  if (!build) {
    return
  }

  for (const key of await cacheKeys(cache)) {
    const label = (await cache.match(key))?.headers.get(BUILD_HEADER)
    if (label && label !== build) {
      await cache.delete(key)
    }
  }
}

// every marker and data entry; a marker's key is its own shell key
async function readNodeEntries(cache) {
  const keys = (await cacheKeys(cache)).filter((key) => !key.startsWith('/assets/'))
  const entries = await Promise.all(
    keys.map(async (key) => {
      const headers = (await cache.match(key))?.headers
      return {
        key,
        node: headers?.get(NODE_HEADER),
        time: Number(headers?.get(TIME_HEADER)),
        isMarker: shellKey(key) === key,
      }
    }),
  )

  return entries.filter((entry) => entry.node)
}

async function removeEntries(cache, entries) {
  const markers = entries.filter((entry) => entry.isMarker)
  await Promise.all(markers.map((marker) => cache.delete(marker.key)))
  await Promise.all(entries.map((entry) => cache.delete(entry.key)))
}

// the marker goes first, so nothing opens on half the data
async function removeNode(cache, node) {
  const entries = await readNodeEntries(cache)
  await removeEntries(
    cache,
    entries.filter((entry) => entry.node === node),
  )
}

function newestFirst(entries) {
  const markers = entries.filter((entry) => entry.isMarker)
  return markers.sort((one, other) => other.time - one.time)
}

// anything without a marker goes too, so data put by a stopped capture doesn't stay
async function trim(cache) {
  const entries = await readNodeEntries(cache)
  const kept = new Set(
    newestFirst(entries)
      .slice(0, LIMIT)
      .map((marker) => marker.node),
  )
  await removeEntries(
    cache,
    entries.filter((entry) => !kept.has(entry.node)),
  )
}

async function removeOldest(cache, node) {
  const entries = await readNodeEntries(cache)
  const oldest = newestFirst(entries)
    .filter((marker) => marker.node !== node)
    .at(-1)

  if (oldest) {
    await removeNode(cache, oldest.node)
  }
}

// a full disk gives up one presentation per capture, and each put one retry
function putterFor(cache, node) {
  let room = null
  return async (key, response) => {
    const retry = response.clone()
    try {
      await cache.put(key, response)
    } catch (err) {
      if (err?.name !== 'QuotaExceededError') {
        throw err
      }

      room ??= removeOldest(cache, node)
      await room
      await cache.put(key, retry)
    }
  }
}

async function fetchCopy(cache, id, node, signal) {
  const stored = await cache.match(VISITED_SHELL_KEY)
  let shell = null
  if (!isCurrentShell(stored)) {
    shell = await fetchShell(node, signal)
  }

  const html = await (shell ?? stored).clone().text()
  const files = await filesToFetch(cache, html)
  const dataUrls = startupUrls(node, id, { readonly: false, composite: false })
  const apiRequests = dataUrls.map((url) => [url, 'api'])
  const fileRequests = files.map((file) => [file, 'asset'])
  const fetched = await fetchAllCacheable([...apiRequests, ...fileRequests], signal)

  return { shell, html, files, dataUrls, ...fetched }
}

async function dropCopy({ shell, responses }) {
  const bodies = [...responses.values()]
  if (shell) {
    bodies.push(shell)
  }

  await cancelBodies(bodies)
}

// files, then the shell, then the data, so whatever stops this leaves the old copy whole
async function storeCopy(cache, node, copy, isWanted) {
  const { shell, html, files, dataUrls, responses } = copy
  const put = putterFor(cache, node)
  const fileLabel = { [BUILD_HEADER]: String(__SUITE_BUILD__) }
  await runPool(files, (file) => put(file, withHeaders(responses.get(file), fileLabel)))
  if (!isWanted()) {
    return
  }

  if (shell) {
    const labels = { ...fileLabel, [CSRF_HEADER]: csrfIn(html) }
    await put(VISITED_SHELL_KEY, withHeaders(shell, labels))
  }

  await deleteOtherBuildFiles(cache)
  if (!isWanted()) {
    return
  }

  await runPool(dataUrls, (url) =>
    put(url, withHeaders(responses.get(url), { [NODE_HEADER]: node })),
  )
  if (isWanted()) {
    const headers = { [NODE_HEADER]: node, [TIME_HEADER]: String(Date.now()) }
    await put(`/d/${node}`, new Response(null, { headers }))
  }
}

async function capture(id, node, signal) {
  const user = getCookieSessionUser()
  function isWanted() {
    return !signal.aborted && getCookieSessionUser() === user && !hasPin(id)
  }

  if (!(await waitForController())) {
    return
  }

  await warmAssets()
  if (!isWanted()) {
    return
  }

  // held for the whole capture, so a wipe during it isn't undone by opening the name again
  const cache = await caches.open(VISITED_CACHE_NAME)
  const copy = await fetchCopy(cache, id, node, signal)
  if (copy.missing.length || !isWanted()) {
    await dropCopy(copy)
    return
  }

  await storeCopy(cache, node, copy, isWanted)
  if (signal.aborted) {
    await removeNode(cache, node)
    return
  }

  await trim(cache)
}

function cancelVisit() {
  visit?.controller.abort()
}

// nothing awaits this and nothing reads it; a failure only means no copy this time
async function runVisit(current) {
  const { node, controller } = current
  const { signal } = controller
  try {
    await delay(SETTLE_TIME)
    await whenIdle()
    if (!signal.aborted) {
      await capture(current.id, node, signal)
    }
  } catch (err) {
    if (!signal.aborted) {
      console.warn('Slides visited copy failed:', err)
    }
  } finally {
    if (signal.aborted) {
      remembered.delete(node)
    }

    if (visit === current) {
      visit = null
    }
  }
}

async function rememberVisit(id) {
  if (visit && visit.id !== id) {
    cancelVisit()
  }

  const node = presentationDoc.value?.node
  if (remembered.has(node) || !isEligible(id)) {
    return
  }

  remembered.add(node)
  visit = { id, node, controller: new AbortController() }
  await runVisit(visit)
}

// a refused open or a new pin
async function forgetVisitedNode(node) {
  remembered.delete(node)
  if (visit?.node === node) {
    cancelVisit()
  }

  try {
    if (await caches.has(VISITED_CACHE_NAME)) {
      const cache = await caches.open(VISITED_CACHE_NAME)
      await removeNode(cache, node)
    }
  } catch (err) {
    console.warn('Slides visited copy failed:', err)
  }
}

export { cancelVisit, forgetVisitedNode, rememberVisit }
