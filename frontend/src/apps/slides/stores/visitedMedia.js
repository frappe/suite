import { isMediaNodeId, mediaSettled } from '@/apps/slides/stores/documentMedia'
import { slides } from '@/apps/slides/stores/slide'
import {
  afterPageSettles,
  canStoreOpen,
  isEligible,
  refreshVisitedMedia,
} from '@/apps/slides/stores/visitedCopies'
import { canonicalMediaKey } from '@/apps/slides/utils/canonicalMediaKey'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'
import { fetchPinned } from '@/apps/slides/utils/offlineRequests'
import { collectMediaSources } from '@/apps/slides/utils/pinTargets'
import { claimSlidesCachesFor } from '@/apps/slides/utils/serviceWorker'
import { isOutOfSpace, MEDIA_CACHE_NAME, withCachedTime } from '@/apps/slides/utils/slidesCaches'
import { isCacheable, isMedia } from '@/apps/slides/utils/slidesRequests'
import { runPool } from '@/apps/slides/utils/startupRequests'
import { getCookieSessionUser } from '@/platform/session'

// a page not yet controlled by the worker asks for its pictures past it, so the
// page stores them itself; this open's tries and its stop: { controller, tried, listed, settled }
let current = null

// a request the worker sees as media finds its exact url; any other, as a signed one, its file path
function keyFor(url) {
  try {
    const parsed = new URL(url, location.origin)
    if (!url || parsed.origin !== location.origin) {
      return null
    }

    if (isMedia(parsed)) {
      return url
    }

    return canonicalMediaKey(url)
  } catch {
    return null
  }
}

function untriedTargets({ tried }) {
  const targets = []
  for (const { src } of collectMediaSources(slides.value)) {
    const url = getAttachmentUrl(src)
    const key = keyFor(url)
    if (key && !tried.has(key)) {
      tried.add(key)
      targets.push({ key, url })
    }
  }

  return targets
}

async function storeTarget(cache, { key, url }, isWanted, signal) {
  if (!isWanted() || (await cache.match(key))) {
    return
  }

  const response = await fetchPinned(url, signal)
  if (isWanted() && response.ok && isCacheable('media', response)) {
    await cache.put(key, withCachedTime(response))
  } else {
    await response.body?.cancel()
  }
}

async function storeUnlessFull(cache, target, isWanted, signal) {
  try {
    await storeTarget(cache, target, isWanted, signal)
  } catch (err) {
    if (isOutOfSpace(err)) {
      throw err
    }

    if (!signal.aborted) {
      console.warn('Slides picture not stored:', err)
    }
  }
}

function shownNodeIds() {
  return collectMediaSources(slides.value)
    .map(({ src }) => src)
    .filter(isMediaNodeId)
}

async function targetsOnceReady(open, user, isWanted) {
  await open.settled
  if (!isWanted()) {
    return []
  }

  open.claimed ??= claimSlidesCachesFor(user)
  await open.claimed
  await mediaSettled(shownNodeIds(), open.controller.signal)
  if (!isWanted()) {
    return []
  }

  return untriedTargets(open)
}

// one at a time, so an earlier answer can't land over a later one
async function refreshListAfter(before, isWanted, signal) {
  await before
  await refreshVisitedMedia(isWanted, signal)
}

function refreshListForNewIds(open, id, isWanted) {
  const newIds = shownNodeIds().filter((nodeId) => !open.listed.has(nodeId))
  if (newIds.length && isWanted() && isEligible(id)) {
    for (const nodeId of newIds) {
      open.listed.add(nodeId)
    }

    open.listing = refreshListAfter(open.listing, isWanted, open.controller.signal)
  }

  return open.listing
}

async function storePictures(targets, isWanted, signal) {
  if (targets.length) {
    const cache = await caches.open(MEDIA_CACHE_NAME)
    await runPool(targets, (target) => storeUnlessFull(cache, target, isWanted, signal))
  }
}

// best effort: nothing else in the browser's storage is given up for a picture
async function storeVisitedMedia(id) {
  if (!canStoreOpen()) {
    return
  }

  current ??= {
    controller: new AbortController(),
    tried: new Set(),
    listed: new Set(),
    settled: afterPageSettles(),
  }
  const open = current
  const { signal } = open.controller
  const user = getCookieSessionUser()
  function isWanted() {
    return !signal.aborted && canStoreOpen() && getCookieSessionUser() === user
  }

  try {
    const targets = await targetsOnceReady(open, user, isWanted)
    await Promise.all([
      refreshListForNewIds(open, id, isWanted),
      storePictures(targets, isWanted, signal),
    ])
  } catch (err) {
    if (!signal.aborted) {
      console.warn('Slides pictures not stored:', err)
    }

    open.controller.abort()
  }
}

function stopVisitedMedia() {
  current?.controller.abort()
  current = null
}

export { stopVisitedMedia, storeVisitedMedia }
