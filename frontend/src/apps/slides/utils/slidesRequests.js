// the url contract between the page and the worker: which requests are slides'
// and what the worker may store for them. shared by the service worker, so
// nothing here may import app modules
import { PIN_HEADER } from './slidesCaches'

// marks an owner's /private/files/ request as slides media
export const SLIDES_MEDIA_PARAM = 'slides_media'
export const MEDIA_PROXY_PATH = '/api/method/suite.slides.api.file.get_media_file'

// set by suite/www/suite.py on the shell it renders to a logged-out visitor
const GUEST_HEADER = 'x-suite-guest'

const isMedia = (url) =>
	url.pathname.startsWith(MEDIA_PROXY_PATH) ||
	(url.pathname.startsWith('/private/files/') && url.searchParams.has(SLIDES_MEDIA_PARAM))
const isAPI = (url) => url.pathname.startsWith('/api/method/suite.slides.')
// the owner's editor loads the document itself through the generic client
const isPresentationDoc = (url) =>
	url.pathname === '/api/method/frappe.client.get' &&
	url.searchParams.get('doctype') === 'Presentation'

// every file under the bundle path is content-hashed, so a hit can never be stale
export const isBundleAsset = (url) =>
	url.pathname.startsWith('/assets/suite/frontend/assets/') && !url.pathname.endsWith('.map')
// fonts, served under stable names
const isSlidesStatic = (url) => url.pathname.startsWith('/assets/suite/slides/')

const isSlidesPath = (pathname) => pathname === '/slides' || pathname.startsWith('/slides/')

// the bundle path is shared by every suite app; the referrer is the requesting
// page's url and is the only ownership signal available before respondWith
const isFromSlidesPage = (request) => {
	if (!request.referrer) return false
	return isSlidesPath(new URL(request.referrer).pathname)
}

// the page reports itself ('entered' | 'left') because the referrer alone
// misleads both ways: a switch out of slides imports the next app's graph before
// the url changes, and a font requested by a stylesheet carries the stylesheet's url
const isSlidesClient = (request, clientState) => {
	if (clientState === 'entered') return true
	return isFromSlidesPage(request) && clientState !== 'left'
}

// the pin action stores the shell through the same route
const isShell = (request, url) =>
	isSlidesPath(url.pathname) &&
	(request.mode === 'navigate' || request.headers.get(PIN_HEADER) === 'shell')

export const getRequestType = (request, clientState) => {
	const url = new URL(request.url)
	if (isShell(request, url)) return 'shell'
	// nothing outside slides requests these urls, so they need no client check
	if (isMedia(url)) return 'media'
	if (isSlidesStatic(url)) return 'asset'
	if (!isSlidesClient(request, clientState)) return 'other'
	if (isAPI(url) || isPresentationDoc(url)) return 'api'
	if (isBundleAsset(url)) return 'asset'
	return 'other'
}

export const isMediaContentType = (response) => {
	const contentType = response.headers.get('Content-Type') || ''
	return ['image/', 'video/'].some((ct) => contentType.startsWith(ct))
}

export const isCacheable = (type, response) => {
	const contentType = response.headers.get('Content-Type') || ''
	if (type === 'media') return isMediaContentType(response)
	// a login or 404 page stored under an asset key would be replayed as the asset
	if (type === 'asset') {
		return !response.redirected && !contentType.startsWith('text/html')
	}
	// a login redirect or the logged-out shell would be replayed offline as the app
	if (type === 'shell') {
		return (
			!response.redirected &&
			contentType.startsWith('text/html') &&
			!response.headers.has(GUEST_HEADER)
		)
	}
	// a redirected or HTML body under an API key would be replayed as data
	return !response.redirected && contentType.includes('application/json')
}
