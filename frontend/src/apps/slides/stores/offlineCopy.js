import { ref } from 'vue'
import { frappeRequest } from 'frappe-ui'

import { presentationDoc, presentationId, inReadonlyMode } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'
import { canonicalMediaKey } from '@/apps/slides/utils/canonicalMediaKey'
import { collectMediaSources, presentationLoadRequests } from '@/apps/slides/utils/pinTargets'
import { loadBundledFonts } from '@/apps/slides/utils/bundledFonts'
import { PINNED_CACHE_NAME, PIN_HEADER, RECORD_PREFIX } from '@/apps/slides/utils/slidesCaches'
import { isMediaContentType } from '@/apps/slides/utils/slidesRequests'

const CONCURRENCY = 4
const RETRY_DELAYS = [500, 1500]
const QUOTA = 'quota'

const offlineCopyProgress = ref({ running: false, done: 0, total: 0, failed: [] })

let controller = null

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

const writeRecord = (id, record) => localStorage.setItem(recordKey(id), JSON.stringify(record))

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

const warmShellAndApi = async (id, loadOptions, signal) => {
	await fetch(location.pathname, { headers: { [PIN_HEADER]: 'shell' }, signal }).then(
		(response) => response.body?.cancel(),
		() => {},
	)
	for (const { url, params } of presentationLoadRequests(id, loadOptions)) {
		await frappeRequest({ url, method: 'GET', params }).catch(() => {})
	}
}

// after a deploy an online visit refreshes everything a copy needs except this
const warmOfflineCopyAssets = (id) => {
	if (readRecord(id)) warmAssets()
}

// bytes the presentation no longer shows go, and its ledger stops listing them
const pruneOfflineCopy = async (id, targets = null) => {
	const record = readRecord(id)
	if (!record) return

	const needed = new Set((targets ?? getMediaTargets()).map((target) => target.key))
	const orphans = new Set(unsharedKeys(id, record.keys.filter((key) => !needed.has(key))))
	if (!orphans.size) return

	const cache = await openPinnedCache()
	await Promise.all([...orphans].map((key) => cache.delete(key)))
	writeRecord(id, { keys: record.keys.filter((key) => !orphans.has(key)) })
}

const saveOfflineCopy = async (id) => {
	if (offlineCopyProgress.value.running) return null
	controller = new AbortController()
	const { signal } = controller

	const targets = getMediaTargets()
	const loadOptions = {
		readonly: inReadonlyMode.value,
		composite: !!presentationDoc.value?.is_composite,
	}
	offlineCopyProgress.value = { running: true, done: 0, total: targets.length, failed: [] }
	const progress = offlineCopyProgress.value

	try {
		if (!(await waitForController())) {
			const registered = !!(await navigator.serviceWorker?.getRegistration?.())
			return { ok: false, uncontrolled: true, registered }
		}
		await warmAssets()
		await warmShellAndApi(id, loadOptions, signal)

		const cache = await openPinnedCache()
		const pinned = new Set((await cache.keys()).map((request) => new URL(request.url).pathname))

		await pruneOfflineCopy(id, targets)

		const record = { keys: targets.map((target) => target.key).filter((key) => pinned.has(key)) }
		writeRecord(id, record)
		navigator.storage?.persist?.().catch(() => {})

		await runPool(targets, async (target) => {
			if (signal.aborted) return
			if (!pinned.has(target.key)) {
				try {
					const result = await pinTarget(cache, target, signal)
					if (result.ok) {
						record.keys.push(target.key)
						writeRecord(id, record)
					} else {
						recordFailure(progress, target, result.status)
					}
				} catch (err) {
					if (signal.aborted) return
					if (err?.name === 'QuotaExceededError') {
						// every later put fails the same way
						recordFailure(progress, target, QUOTA)
						controller.abort(QUOTA)
						return
					}
					recordFailure(progress, target, 'network')
				}
			}
			progress.done += 1
		})

		// the ledger is current, so a cancelled run needs no report
		if (signal.aborted && signal.reason !== QUOTA) return null

		return { ok: progress.failed.length === 0, failed: [...progress.failed], count: targets.length }
	} finally {
		progress.running = false
		controller = null
	}
}

const cancelOfflineCopy = () => controller?.abort()

// the record outlives the bytes it lists
const removeOfflineCopy = async (id) => {
	const record = readRecord(id)
	if (record) {
		const cache = await openPinnedCache()
		await Promise.all(unsharedKeys(id, record.keys).map((key) => cache.delete(key)))
	}
	localStorage.removeItem(recordKey(id))
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
	refreshOfflineStatus,
	warmOfflineCopyAssets,
}
