import { ref } from 'vue'

import {
  isMediaNodeId,
  isMediaReady,
  isMediaRefused,
  isMediaUnanswered,
  mediaSettled,
  onMediaStatusChange,
} from '@/apps/slides/stores/documentMedia'
import { presentationDoc, presentationId, viewOnly } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { forgetVisitedNode } from '@/apps/slides/stores/visitedCopies'
import { canonicalMediaKey } from '@/apps/slides/utils/canonicalMediaKey'
import { loadedAssets } from '@/apps/slides/utils/loadedAssets'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'
import { fetchPinned } from '@/apps/slides/utils/offlineRequests'
import { collectMediaSources, entryAssets, startupUrls } from '@/apps/slides/utils/pinTargets'
import { clearVisitedCopies } from '@/apps/slides/utils/serviceWorker'
import { isOutOfSpace, PINNED_CACHE_NAME, RECORD_PREFIX } from '@/apps/slides/utils/slidesCaches'
import { isMediaContentType } from '@/apps/slides/utils/slidesRequests'
import {
  cancelBodies,
  delay,
  fetchAllCacheable,
  fetchShell,
  runPool,
  waitForController,
  warmAssets,
} from '@/apps/slides/utils/startupRequests'

const RETRY_DELAYS = [500, 1500]
const QUOTA = 'quota'
const TIMEOUT = 'timeout'

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

const openPinnedCache = () => caches.open(PINNED_CACHE_NAME)

const isMediaResponse = (response) => response.status === 200 && isMediaContentType(response)

// a server error is as transient as a dropped connection
const fetchWithRetries = async (url, signal) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchPinned(url, signal)
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
  const result = await pinTarget(cache, target, signal).catch(async (err) => {
    await clearVisitedOnQuota(err)
    return pinTarget(cache, target, signal)
  })
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

function getLoadOptions() {
  return { readonly: viewOnly.value, composite: !!presentationDoc.value?.is_composite }
}

// what opening /d/<node> offline reads, under the keys the worker looks them up by
async function fetchStartup(node, id, pinned, loadOptions, signal) {
  const shell = await fetchShell(node, signal)
  const html = await shell.clone().text()
  const assets = [...new Set([...entryAssets(html), ...loadedAssets()])]
  // content-hashed, so a pinned asset is already current
  const kept = assets.filter((asset) => pinned.has(asset))
  const requests = [
    ...startupUrls(node, id, loadOptions).map((url) => [url, 'api']),
    ...assets.filter((asset) => !pinned.has(asset)).map((asset) => [asset, 'asset']),
  ]
  const { responses, missing } = await fetchAllCacheable(requests, signal)
  responses.set(`/d/${node}`, shell)

  if (missing.length) {
    await cancelBodies(responses.values())
    const urls = missing.join(', ')
    throw new Error(`The presentation's start-up files could not be stored: ${urls}`)
  }

  return { keys: [...responses.keys(), ...kept], responses }
}

function deleteUnshared(cache, id, keys) {
  return Promise.all(unsharedKeys(id, keys).map((key) => cache.delete(key)))
}

// a pin comes before any visited copy
async function clearVisitedOnQuota(err) {
  if (!isOutOfSpace(err)) {
    throw err
  }

  await clearVisitedCopies().catch(() => {})
}

async function putPinned(cache, key, response) {
  const retry = response.clone()
  try {
    await cache.put(key, response)
  } catch (err) {
    await clearVisitedOnQuota(err)
    await cache.put(key, retry)
  }
}

async function firstFailedPut(cache, entries) {
  const puts = entries.map(([key, response]) => putPinned(cache, key, response))
  return (await Promise.allSettled(puts)).find((put) => put.status === 'rejected')
}

// the puts land before the record lists them, so a failed put leaves the old record whole
async function putStartup(cache, id, record, startup, previous, signal) {
  if (signal.aborted) {
    return
  }

  // the shell goes last, so a failed put never leaves it naming assets the rollback deletes
  const shellKey = `/d/${record.node}`
  const others = [...startup.responses].filter(([key]) => key !== shellKey)
  const failure =
    (await firstFailedPut(cache, others)) ??
    (await firstFailedPut(cache, [[shellKey, startup.responses.get(shellKey)]]))
  if (failure) {
    await deleteUnshared(
      cache,
      id,
      startup.keys.filter((key) => !previous.includes(key)),
    )
    throw failure.reason
  }

  // a run stopped by an unpin finds its record gone, even once a re-pin has cleared the tombstone
  if (forgotten.has(record.node) || (signal.aborted && !readRecord(id))) {
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

function orphanKeys(id) {
  const record = readRecord(id)
  // a picture with no signed url has no key, so its bytes would pass for orphans, and
  // refused may only mean an expired session; the next open tries again
  if (!record || id !== presentationId.value || !mediaNodeIds().every(isMediaReady)) {
    return []
  }

  const needed = new Set(getMediaTargets().map((target) => target.key))
  return unsharedKeys(
    id,
    record.keys.filter((key) => isMediaKey(key) && !needed.has(key)),
  )
}

// the worker serves the pinned document first, so it must stop naming the bytes before they go;
// the deletes hold the run slot, so no save or visit writes back a list read before them
async function pruneOfflineCopy(id) {
  if (!readRecord(id)) {
    return
  }

  await mediaSettled(mediaNodeIds())
  if (!orphanKeys(id).length) {
    return
  }

  await run?.done
  if (run || !orphanKeys(id).length) {
    return
  }

  const loadOptions = getLoadOptions()
  const record = readRecord(id)
  const current = claimRun(id, record.node)
  const { signal } = current.controller
  try {
    await refreshStartup(id, record, loadOptions, signal)
    if (signal.aborted || forgotten.has(record.node)) {
      return
    }

    const orphans = new Set(orphanKeys(id))
    const cache = await openPinnedCache()
    await Promise.all([...orphans].map((key) => cache.delete(key)))

    const latest = readRecord(id)
    if (latest) {
      writeRecord(id, { ...latest, keys: latest.keys.filter((key) => !orphans.has(key)) })
    }
  } finally {
    releaseRun(current)
  }
}

// a save and a visit's refresh share one slot; a later run stops the one before and waits for it
function claimRun(id, node) {
  run?.controller.abort()
  let settle
  const done = new Promise((resolve) => {
    settle = resolve
  })
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
  // read now, as leaving during the run blanks what they come from
  const loadOptions = getLoadOptions()
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
    // the slides on screen may now be another presentation's
    if (signal.aborted || presentationDoc.value?.node !== node) {
      return null
    }

    const targets = getMediaTargets()
    progress.total = targets.length
    for (const source of unsigned) {
      recordFailure(progress, source, TIMEOUT)
    }

    const cache = await openPinnedCache()
    const pinned = await pinnedPaths(cache)
    const startup = await fetchStartup(node, id, pinned, loadOptions, signal)

    const previous = startupKeys(readRecord(id))
    const media = targets.map((target) => target.key).filter((key) => pinned.has(key))
    // only an open deletes, so what the presentation no longer shows stays listed until then
    const held = readRecord(id)?.keys.filter(isMediaKey) ?? []
    const record = { node, keys: [...new Set([...startup.keys, ...media, ...held])] }
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

        if (isOutOfSpace(err)) {
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
    const ok = progress.failed.length === 0
    if (ok) {
      await forgetVisitedNode(node)
    }

    return { ok, failed: [...progress.failed], count }
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
  await forgetVisitedNode(node)
  const ids = Object.entries(readAllRecords())
    .filter(([, record]) => record.node === node)
    .map(([id]) => id)
  for (const id of ids) {
    await removeOfflineCopy(id)
  }
}

// the media ids each presentation's start-up copy was last refreshed with
const refreshed = new Map()

// a picture added since then has no row in the media list that copy holds
function needsRefresh(id) {
  const known = refreshed.get(id)
  return !known || mediaNodeIds().some((nodeId) => !known.has(nodeId))
}

async function refreshStartup(id, record, loadOptions, signal) {
  await warmAssets()
  const cache = await openPinnedCache()
  const pinned = await pinnedPaths(cache)
  const startup = await fetchStartup(record.node, id, pinned, loadOptions, signal)
  const keys = [...startup.keys, ...record.keys.filter(isMediaKey)]
  await putStartup(cache, id, { ...record, keys }, startup, startupKeys(record), signal)
}

// an online visit replaces the start-up copy, so after a deploy it holds the new build
async function warmOfflineCopyAssets(id) {
  const record = readRecord(id)
  if (!record?.node || !navigator.onLine || !needsRefresh(id)) return

  if (run) return

  refreshed.set(id, new Set(mediaNodeIds()))
  const loadOptions = getLoadOptions()
  const current = claimRun(id, record.node)
  const { signal } = current.controller
  try {
    await refreshStartup(id, record, loadOptions, signal)
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

  // offline, no row means the list this copy holds predates the picture; online it
  // means Drive won't give it to this user as of this read, so no update could add it
  if (!navigator.onLine && mediaNodeIds().some(isMediaRefused)) {
    return 'outdated'
  }

  // with no key for this picture, nothing shows the copy holds it
  if (mediaNodeIds().some(isMediaUnanswered)) {
    return 'outdated'
  }

  const pinned = new Set(record.keys)
  return getMediaTargets().every((target) => pinned.has(target.key)) ? 'available' : 'outdated'
}

const offlineCopyStatus = ref('none')

let stopFollowingMedia = null

function refreshOfflineStatus(id) {
  stopFollowingMedia?.()
  offlineCopyStatus.value = id ? getOfflineStatus(id) : 'none'
  if (offlineCopyStatus.value === 'none') {
    return
  }

  // a picture still loading has no key yet, so the answer above left it out
  stopFollowingMedia = onMediaStatusChange(mediaNodeIds(), () => {
    if (id === presentationId.value) {
      offlineCopyStatus.value = getOfflineStatus(id)
    }
  })
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
