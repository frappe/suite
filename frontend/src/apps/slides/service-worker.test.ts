import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MEDIA_CACHE_NAME, PINNED_CACHE_NAME } from './utils/slidesCaches'

vi.mock('workbox-range-requests', () => ({
	createPartialResponse: async (_request: Request, response: Response) => response,
}))

const listeners = new Map<string, (event: any) => void>()
const pinned = new Map<string, Response>()
const media = new Map<string, Response>()
let respond: (url: string) => Promise<Response>
let online: boolean
let networkFails: boolean
let fetches: string[]

const body = (label: string) =>
	new Response(label, { status: 200, headers: { 'Content-Type': 'image/png' } })

vi.spyOn(self, 'addEventListener').mockImplementation((type: string, listener: any) => {
	listeners.set(type, listener)
})

await import('./service-worker')

const MEDIA_URL = `${location.origin}/private/files/a.png?slides_media=1`
const PINNED_KEY = '/private/files/a.png'

beforeEach(() => {
	pinned.clear()
	media.clear()
	fetches = []
	online = true
	networkFails = false
	Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
	vi.stubGlobal('caches', {
		match: async (key: string, { cacheName }: { cacheName: string }) =>
			cacheName === PINNED_CACHE_NAME ? pinned.get(key) : undefined,
		open: async (name: string) => {
			if (name !== MEDIA_CACHE_NAME) throw new Error(`unexpected cache ${name}`)
			return {
				match: async (request: Request) => media.get(request.url),
				put: async (request: Request, response: Response) => media.set(request.url, response),
				keys: async () => [],
				delete: async () => true,
			}
		},
	})
	vi.stubGlobal('fetch', async (request: Request) => {
		fetches.push(request.url)
		if (networkFails) throw new TypeError('Failed to fetch')
		return new Response('denied', { status: 403 })
	})

	respond = (url) => {
		let responded: any = null
		listeners.get('fetch')!({
			request: new Request(url),
			clientId: 'c1',
			respondWith: (value: Promise<Response>) => {
				responded = value
			},
			waitUntil: () => {},
		})
		return responded
	}
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('pinned media', () => {
	it('serves the pinned copy online without touching the network', async () => {
		pinned.set(PINNED_KEY, body('pinned'))

		const response = await respond(MEDIA_URL)

		expect(await response.text()).toBe('pinned')
		expect(fetches).toEqual([])
	})

	it('serves the pinned copy offline without waiting on the network', async () => {
		pinned.set(PINNED_KEY, body('pinned'))
		online = false

		const response = await respond(MEDIA_URL)

		expect(await response.text()).toBe('pinned')
		expect(fetches).toEqual([])
	})

	it('surfaces the network error when nothing is pinned', async () => {
		networkFails = true

		await expect(respond(MEDIA_URL)).rejects.toThrow()
	})
})
