import { ref } from 'vue'

import { isMediaNodeId, mediaSettled } from '@/apps/slides/stores/documentMedia'
import { presentationDoc, presentationId, viewOnly } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { loadBundledFonts } from '@/apps/slides/utils/bundledFonts'
import { canonicalMediaKey } from '@/apps/slides/utils/canonicalMediaKey'
import { loadedAssets } from '@/apps/slides/utils/loadedAssets'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'
import { collectMediaSources, entryAssets, startupUrls } from '@/apps/slides/utils/pinTargets'
import { PIN_HEADER, PINNED_CACHE_NAME, RECORD_PREFIX } from '@/apps/slides/utils/slidesCaches'
import { isCacheable, isMediaContentType } from '@/apps/slides/utils/slidesRequests'

const CONCURRENCY = 4
const RETRY_DELAYS = [500, 1500]
const QUOTA = 'quota'
const UNSIGNED = 'timeout'
const HTTP_OK = 200

const offlineCopyProgress = ref({ running: false, done: 0, total: 0, failed: [] })

// a save or a visit's refresh: { id, node, controller, previous, done, settle }
let run = null

// nodes refused since their last save; nothing more is stored for them
const forgotten = new Set()

const recordKey = (id) => `${RECORD_PREFIX}${id}`

// the record is the ledger: every key in `slides-pinned` is listed by a record
const readRecord = (id) => {
  try {
    const record = JSON.parse(localStorage.getItem(recordKey(id)))
    return Array.isArray(record?.keys) ? record : null
  } catch {
    return null
  }
}

function writeRecord(id, record) {
  if (forgotten.has(record.node)) {
    return
  }

  localStorage.setItem(recordKey(id), JSON.stringify(record))
}

const readAllRecords = () => {
  const records = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(RECORD_PREFIX)) continue
    const id = key.slice(RECORD_PREFIX.length)
    const record = readRecord(id)
    if (record) records[id] = record
  }
  return records
}

// the pictures; every other key is the start-up copy, which a visit replaces whole
function isMediaKey(key) {
  return canonicalMediaKey(key) === key
}

function startupKeys(record) {
  return record?.keys.filter((key) => !isMediaKey(key)) ?? []
}

// keys no copy other than `id` lists
const unsharedKeys = (id, keys) => {
  const records = readAllRecords()
  delete records[id]
  const shared = new Set(Object.values(records).flatMap((record) => record.keys))
  return keys.filter((key) => !shared.has(key))
}

// one entry per canonical key
const getMediaTargets = () => {
  const targets = new Map()
  for (const { slideIndex, src } of collectMediaSources(slides.value)) {
    const url = getAttachmentUrl(src)
    const key = canonicalMediaKey(url)
    if (!key || targets.has(key)) continue
    targets.set(key, { key, url, src, slideIndex })
  }
  return [...targets.values()]
}

function mediaNodeIds() {
  return collectMediaSources(slides.value)
    .map(({ src }) => src)
    .filter(isMediaNodeId)
}

// one entry per node Drive never signed
function unsignedSources(ids) {
  const sources = new Map()
  for (const source of collectMediaSources(slides.value)) {
    if (ids.includes(source.src) && !sources.has(source.src)) {
      sources.set(source.src, source)
    }
  }

  return [...sources.values()]
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const openPinnedCache = () => caches.open(PINNED_CACHE_NAME)

const isMediaResponse = (response) => response.status === 200 && isMediaContentType(response)

// a server error is as transient as a dropped connection
const fetchWithRetries = async (url, signal) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { [PIN_HEADER]: '1' }, signal })
      if (response.status < 500) return response
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    } catch (err) {
      if (signal.aborted || attempt >= RETRY_DELAYS.length) throw err
      await delay(RETRY_DELAYS[attempt])
    }
  }
}

// the body streams into the cache, never into memory
const pinTarget = async (cache, target, signal) => {
  const response = await fetchWithRetries(target.url, signal)
  if (!isMediaResponse(response)) {
    await response.body?.cancel()
    return { ok: false, status: response.status }
  }
  await cache.put(target.key, response)
  return { ok: true }
}

// the status a picture failed with, or null once it is stored and listed
async function storeTarget(cache, id, record, target, signal) {
  const result = await pinTarget(cache, target, signal)
  if (!result.ok) {
    return result.status
  }

  if (forgotten.has(record.node)) {
    await deleteUnshared(cache, id, [target.key])
    return null
  }

  record.keys.push(target.key)
  writeRecord(id, record)
  return null
}

const recordFailure = (progress, target, status) => {
  progress.failed.push({ slideIndex: target.slideIndex, src: target.src, status })
}

const runPool = async (items, worker) => {
  let next = 0
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

// an uncontrolled page's fetches bypass the worker
const waitForController = async () => {
  if (!navigator.serviceWorker) return false
  if (navigator.serviceWorker.controller) return true
  const claimed = new Promise((resolve) =>
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
  )
  await Promise.race([claimed, delay(3000)])
  return !!navigator.serviceWorker.controller
}

// the slideshow chunk and the fonts load lazily
const warmAssets = () =>
  Promise.all([
    import('@/apps/slides/pages/Slideshow.vue').catch(() => {}),
    loadBundledFonts().catch(() => {}),
  ])

function getLoadOptions() {
  return { readonly: viewOnly.value, composite: !!presentationDoc.value?.is_composite }
}

// a shell from another build would pair its code with this page's chunks
async function fetchShell(node, signal) {
  const response = await fetch(`/d/${node}`, { signal })
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
  const response = await fetch(url, { signal }).catch(() => null)

  if (response?.status === HTTP_OK && isCacheable(type, response)) {
    return response
  }

  await response?.body?.cancel()
  return null
}

// what opening /d/<node> offline reads, under the keys the worker looks them up by
async function fetchStartup(node, id, pinned, signal) {
  const shell = await fetchShell(node, signal)
  const html = await shell.clone().text()
  const responses = new Map([[`/d/${node}`, shell]])
  const assets = [...new Set([...entryAssets(html), ...loadedAssets()])]
  // content-hashed, so a pinned asset is already current
  const kept = assets.filter((asset) => pinned.has(asset))
  const requests = [
    ...startupUrls(node, id, getLoadOptions()).map((url) => [url, 'api']),
    ...assets.filter((asset) => !pinned.has(asset)).map((asset) => [asset, 'asset']),
  ]
  const missing = []
  await runPool(requests, async ([url, type]) => {
    const response = await fetchCacheable(url, type, signal)

    if (response) {
      responses.set(url, response)
    } else {
      missing.push(url)
    }
  })

  if (missing.length) {
    await Promise.all([...responses.values()].map((response) => response.body?.cancel()))
    const urls = missing.join(', ')
    throw new Error(`The presentation's start-up files could not be stored: ${urls}`)
  }

  return { keys: [...responses.keys(), ...kept], responses }
}

function deleteUnshared(cache, id, keys) {
  return Promise.all(unsharedKeys(id, keys).map((key) => cache.delete(key)))
}

// the puts land before the record lists them, so a failed put leaves the old record whole
async function putStartup(cache, id, record, startup, previous, signal) {
  if (signal.aborted) {
    return
  }

  const puts = [...startup.responses].map(([key, response]) => cache.put(key, response))
  const failure = (await Promise.allSettled(puts)).find((put) => put.status === 'rejected')
  if (failure) {
    await deleteUnshared(
      cache,
      id,
      startup.keys.filter((key) => !previous.includes(key)),
    )
    throw failure.reason
  }

  if (forgotten.has(record.node)) {
    await deleteUnshared(cache, id, startup.keys)
    return
  }

  writeRecord(id, record)
  await deleteUnshared(
    cache,
    id,
    previous.filter((key) => !startup.keys.includes(key)),
  )
}

async function pinnedPaths(cache) {
  return new Set((await cache.keys()).map((request) => new URL(request.url).pathname))
}

// bytes the presentation no longer shows go, and its ledger stops listing them
const pruneOfflineCopy = async (id, targets = null) => {
  const record = readRecord(id)
  if (!record) return

  const needed = new Set((targets ?? getMediaTargets()).map((target) => target.key))
  const orphans = new Set(
    unsharedKeys(
      id,
      record.keys.filter((key) => isMediaKey(key) && !needed.has(key)),
    ),
  )
  if (!orphans.size) return

  const cache = await openPinnedCache()
  await Promise.all([...orphans].map((key) => cache.delete(key)))
  writeRecord(id, { ...record, keys: record.keys.filter((key) => !orphans.has(key)) })
}

// a save and a visit's refresh share one slot; a later run stops the one before and waits for it
function claimRun(id, node) {
  run?.controller.abort()
  const { promise: done, resolve: settle } = Promise.withResolvers()
  run = { id, node, controller: new AbortController(), previous: run?.done, done, settle }
  return run
}

function releaseRun(current) {
  current.settle()
  if (run === current) {
    run = null
  }
}

const saveOfflineCopy = async (id) => {
  if (offlineCopyProgress.value.running) return null
  const node = presentationDoc.value?.node
  forgotten.delete(node)
  const current = claimRun(id, node)
  const { controller } = current
  const { signal } = controller
  offlineCopyProgress.value = { running: true, done: 0, total: 0, failed: [] }
  const progress = offlineCopyProgress.value

  try {
    await current.previous
    if (!(await waitForController())) {
      const registered = !!(await navigator.serviceWorker?.getRegistration?.())
      return { ok: false, uncontrolled: true, registered }
    }
    await warmAssets()
    // a node-id picture has no url until Drive signs it
    const unsigned = unsignedSources(await mediaSettled(mediaNodeIds(), signal))
    if (signal.aborted) {
      return null
    }

    const targets = getMediaTargets()
    progress.total = targets.length
    for (const source of unsigned) {
      recordFailure(progress, source, UNSIGNED)
    }

    const cache = await openPinnedCache()
    const pinned = await pinnedPaths(cache)
    const startup = await fetchStartup(node, id, pinned, signal)

    await pruneOfflineCopy(id, targets)

    const previous = startupKeys(readRecord(id))
    const media = targets.map((target) => target.key).filter((key) => pinned.has(key))
    const record = { node, keys: [...startup.keys, ...media] }
    await putStartup(cache, id, record, startup, previous, signal)
    navigator.storage?.persist?.().catch(() => {})

    await runPool(targets, async (target) => {
      if (signal.aborted) return

      if (pinned.has(target.key)) {
        progress.done += 1
        return
      }

      try {
        const status = await storeTarget(cache, id, record, target, signal)
        if (status) {
          recordFailure(progress, target, status)
        }
      } catch (err) {
        if (signal.aborted) {
          return
        }

        if (err?.name === 'QuotaExceededError') {
          // every later put fails the same way
          recordFailure(progress, target, QUOTA)
          controller.abort(QUOTA)
          return
        }

        recordFailure(progress, target, 'network')
      }
      progress.done += 1
    })

    // the ledger is current, so a cancelled run needs no report
    if (signal.aborted && signal.reason !== QUOTA) return null

    const count = targets.length + unsigned.length
    return { ok: progress.failed.length === 0, failed: [...progress.failed], count }
  } catch (err) {
    if (signal.aborted) {
      return null
    }

    throw err
  } finally {
    progress.running = false
    releaseRun(current)
  }
}

function cancelOfflineCopy() {
  run?.controller.abort()
}

function forget(node) {
  forgotten.add(node)
  if (run?.node === node) {
    run.controller.abort()
  }
}

// the record outlives the bytes it lists
const removeOfflineCopy = async (id) => {
  const record = readRecord(id)
  const node = record?.node ?? (run?.id === id && run.node)
  if (node) {
    forget(node)
  }

  if (record) {
    const cache = await openPinnedCache()
    await Promise.all(unsharedKeys(id, record.keys).map((key) => cache.delete(key)))
  }
  localStorage.removeItem(recordKey(id))
}

// every copy of the node, found by the node because a refused open never learns the docname
async function removeNodeOfflineCopy(node) {
  forget(node)
  const ids = Object.entries(readAllRecords())
    .filter(([, record]) => record.node === node)
    .map(([id]) => id)
  for (const id of ids) {
    await removeOfflineCopy(id)
  }
}

const refreshed = new Set()

// an online visit replaces the start-up copy, so after a deploy it holds the new build
async function warmOfflineCopyAssets(id) {
  const record = readRecord(id)
  if (!record?.node || !navigator.onLine || refreshed.has(id)) return

  if (run) return

  refreshed.add(id)
  const current = claimRun(id, record.node)
  const { signal } = current.controller
  try {
    await warmAssets()
    const cache = await openPinnedCache()
    const startup = await fetchStartup(record.node, id, await pinnedPaths(cache), signal)
    const keys = [...startup.keys, ...record.keys.filter(isMediaKey)]
    await putStartup(cache, id, { ...record, keys }, startup, startupKeys(record), signal)
  } catch (err) {
    if (signal.aborted) {
      return
    }

    throw err
  } finally {
    releaseRun(current)
  }
}

// the ledger says what is pinned; the cache is only walked when a copy is saved
const getOfflineStatus = (id) => {
  if (id !== presentationId.value) return 'none'
  const record = readRecord(id)
  if (!record) return 'none'
  const pinned = new Set(record.keys)
  return getMediaTargets().every((target) => pinned.has(target.key)) ? 'available' : 'outdated'
}

const offlineCopyStatus = ref('none')

const refreshOfflineStatus = (id) => {
  offlineCopyStatus.value = id ? getOfflineStatus(id) : 'none'
}

export {
  offlineCopyProgress,
  offlineCopyStatus,
  saveOfflineCopy,
  pruneOfflineCopy,
  cancelOfflineCopy,
  removeOfflineCopy,
  removeNodeOfflineCopy,
  refreshOfflineStatus,
  warmOfflineCopyAssets,
}
