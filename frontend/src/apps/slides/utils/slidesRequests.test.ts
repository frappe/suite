import { describe, expect, it } from 'vitest'

import { getRequestType, isCacheable } from '@/apps/slides/utils/slidesRequests'

const ORIGIN = 'https://suite.localhost'

// a real Request refuses mode 'navigate'; the module reads only these fields
const request = (
	path: string,
	{ mode = 'cors', referrer = `${ORIGIN}/slides/p1`, headers = {} } = {},
) => ({ url: `${ORIGIN}${path}`, mode, referrer, headers: new Headers(headers) })

const bundleChunk = '/assets/suite/frontend/assets/chunk-abc123.js'

describe('getRequestType', () => {
	it.each([
		['a slides navigation', request('/slides/p1', { mode: 'navigate' }), undefined, 'shell'],
		['the pin action storing the shell', request('/slides/p1', { headers: { 'x-slides-pin': 'shell' } }), undefined, 'shell'],
		['a drive navigation', request('/drive', { mode: 'navigate' }), undefined, 'other'],
		['owner media with the marker', request('/private/files/a.png?slides_media=1', { referrer: '' }), undefined, 'media'],
		['drive media without the marker', request('/private/files/a.png', { referrer: `${ORIGIN}/drive` }), undefined, 'other'],
		['proxied media from a stylesheet-less viewer', request('/api/method/suite.slides.api.file.get_media_file?src=%2Ffiles%2Fa.png', { referrer: '' }), undefined, 'media'],
		['a slides font from a stylesheet with no client state', request('/assets/suite/slides/fonts/Inter.woff2', { referrer: `${ORIGIN}/assets/suite/frontend/assets/routes-x.css` }), undefined, 'asset'],
		['a slides api call from a slides page', request('/api/method/suite.slides.api.presentation.get'), undefined, 'api'],
		['the presentation doc through the generic client', request('/api/method/frappe.client.get?doctype=Presentation&name=p1'), undefined, 'api'],
		['another doctype through the generic client', request('/api/method/frappe.client.get?doctype=File'), undefined, 'other'],
		['a slides api call from a drive referrer and unknown client', request('/api/method/suite.slides.api.presentation.get', { referrer: `${ORIGIN}/drive` }), undefined, 'other'],
		['a bundle chunk from a slides page', request(bundleChunk), undefined, 'asset'],
		['a bundle chunk from a slides page that has left', request(bundleChunk), 'left', 'other'],
		['a bundle chunk from a drive referrer that entered slides', request(bundleChunk, { referrer: `${ORIGIN}/drive` }), 'entered', 'asset'],
		['a source map', request(`${bundleChunk}.map`), undefined, 'other'],
	])('types %s', (_name, req, clientState, expected) => {
		expect(getRequestType(req, clientState)).toBe(expected)
	})
})

const response = (headers: Record<string, string>, redirected = false) => {
	const res = new Response('', { headers })
	Object.defineProperty(res, 'redirected', { value: redirected })
	return res
}

describe('isCacheable', () => {
	it.each([
		['media', response({ 'Content-Type': 'image/png' }), true],
		['media', response({ 'Content-Type': 'video/mp4' }), true],
		['media', response({ 'Content-Type': 'text/html' }), false],
		['asset', response({ 'Content-Type': 'application/javascript' }), true],
		['asset', response({ 'Content-Type': 'text/html' }), false],
		['asset', response({ 'Content-Type': 'application/javascript' }, true), false],
		['shell', response({ 'Content-Type': 'text/html; charset=utf-8' }), true],
		['shell', response({ 'Content-Type': 'text/html' }, true), false],
		['shell', response({ 'Content-Type': 'text/html', 'x-suite-guest': '1' }), false],
		['api', response({ 'Content-Type': 'application/json' }), true],
		['api', response({ 'Content-Type': 'text/html' }), false],
		['api', response({ 'Content-Type': 'application/json' }, true), false],
	])('%s: %#', (type, res, expected) => {
		expect(isCacheable(type, res)).toBe(expected)
	})
})
