const MEDIA_CACHE_NAME = 'slides-media'
const API_CACHE_NAME = 'slides-api'

const CACHE_NAMES = { media: MEDIA_CACHE_NAME, api: API_CACHE_NAME }

const MAX_AGE = 24 * 60 * 60 * 1000 // 1 day

self.addEventListener('install', () => {
	self.skipWaiting()
})

const cleanupOldCacheEntry = async (cache, request, response) => {
	const now = Date.now()

	const cachedTimeHeader = response.headers.get('x-cached-time')
	if (!cachedTimeHeader) return

	const cachedTime = parseInt(cachedTimeHeader, 10)
	if (isNaN(cachedTime)) return

	const age = now - cachedTime

	if (age > MAX_AGE) {
		await cache.delete(request)
	}
}

const cleanupOldMediaCache = async () => {
	const cache = await caches.open(MEDIA_CACHE_NAME)
	const keys = await cache.keys()

	await Promise.all(
		keys.map(async (request) => {
			const response = await cache.match(request)
			if (!response) return

			return cleanupOldCacheEntry(cache, request, response)
		}),
	)
}

const handleSWActivate = async () => {
	await cleanupOldMediaCache()
	// this takes control of all client pages that are already open
	await self.clients.claim()
}

self.addEventListener('activate', (event) => {
	event.waitUntil(handleSWActivate())
})

const getModifiedResponse = (response) => {
	const responseToCache = response.clone()
	const headers = new Headers(responseToCache.headers)
	headers.set('x-cached-time', Date.now().toString())

	return new Response(responseToCache.body, {
		status: responseToCache.status,
		statusText: responseToCache.statusText,
		headers: headers,
	})
}

// These matchers mirror the URL contract owned by utils/mediaUploads.js: the
// `slides_media` marker (SLIDES_MEDIA_PARAM) on owner /private/files/ requests
// and the suite.slides.* proxy path. A service worker can't import app modules,
// so keep these in sync with mediaUploads.js if either changes.
const isMedia = (url) =>
	url.pathname.startsWith('/api/method/suite.slides.api.file.get_media_file') ||
	(url.pathname.startsWith('/private/files/') && url.searchParams.has('slides_media'))
const isAPI = (url) => url.pathname.startsWith('/api/method/suite.slides.')

const addCacheEntry = async (type, cache, request, response) => {
	if (type === 'media') {
		const contentType = response.headers.get('Content-Type') || ''
		const validContentTypes = ['image/', 'video/']
		if (!validContentTypes.some((ct) => contentType.startsWith(ct))) return
	}

	// clone response and add cache timestamp header
	const modifiedResponse = getModifiedResponse(response)
	await cache.put(request, modifiedResponse)
}

const fetchAndCache = async (request, type, cache) => {
	const response = await fetch(request)
	if (response.ok && response.status === 200) {
		try {
			await addCacheEntry(type, cache, request, response)
		} catch (err) {
			console.warn('Slides SW cache write failed:', err)
		}
	}
	return response
}

// network-first: serve the live response (preserving its real headers) and fall
// back to cache only when the network is unavailable
const networkFirst = async (request, cache) => {
	try {
		return await fetchAndCache(request, 'api', cache)
	} catch {
		const cached = await cache.match(request)
		if (cached) return cached
		throw new Error('No cached response available')
	}
}

const cacheFirst = async (request, type, cache) => {
	const cached = await cache.match(request)
	if (cached) return cached
	return fetchAndCache(request, type, cache)
}

const getResponseForRequest = async (request, type) => {
	const cache = await caches.open(CACHE_NAMES[type])
	return type === 'api' ? networkFirst(request, cache) : cacheFirst(request, type, cache)
}

const getRequestType = (url) => {
	if (isMedia(url)) return 'media'
	if (isAPI(url)) return 'api'
	return 'other'
}

const handleSWFetch = async (event) => {
	const request = event.request
	const url = new URL(request.url)

	if (request.method !== 'GET' || url.origin !== self.location.origin) return

	const requestType = getRequestType(url)
	const isAffectedByCache = ['media', 'api'].includes(requestType)
	if (!isAffectedByCache) return

	const response = getResponseForRequest(request, requestType)
	event.respondWith(response)
}

self.addEventListener('fetch', (event) => {
	handleSWFetch(event)
})
