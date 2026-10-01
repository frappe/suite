import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claimSlidesCachesFor, clearSlidesUserData, postToServiceWorker } from './serviceWorker'

const deleted: string[] = []

beforeEach(() => {
	deleted.length = 0
	localStorage.clear()
	vi.stubGlobal('caches', { delete: async (name: string) => deleted.push(name) })
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('slides caches per user', () => {
	it('clears the user data and the records, never the bundle', async () => {
		localStorage.setItem('slides-offline-copy:p1', '{}')
		localStorage.setItem('unrelated', '1')

		await clearSlidesUserData()

		expect(deleted).toEqual(['slides-shell', 'slides-api', 'slides-media', 'slides-pinned'])
		expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
		expect(localStorage.getItem('unrelated')).toBe('1')
	})

	it('clears when another user last owned the caches, then keeps them for the new one', async () => {
		await claimSlidesCachesFor('a@x.com')
		expect(deleted).toHaveLength(4)

		deleted.length = 0
		await claimSlidesCachesFor('a@x.com')
		expect(deleted).toHaveLength(0)

		await claimSlidesCachesFor('b@x.com')
		expect(deleted).toHaveLength(4)
	})
})

describe('postToServiceWorker', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	const withController = (postMessage: (message: string, transfer: MessagePort[]) => void) => {
		vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage } } })
	}

	it('resolves at once when no worker controls the page', async () => {
		vi.stubGlobal('navigator', { serviceWorker: {} })
		await expect(postToServiceWorker('slides-entered')).resolves.toBeUndefined()
	})

	it('resolves when the worker acks over the channel', async () => {
		let sent: string | undefined
		withController((message, [port]) => {
			sent = message
			port.postMessage(true)
		})
		const posted = postToServiceWorker('slides-entered')
		await vi.advanceTimersByTimeAsync(0)
		await expect(posted).resolves.toBeUndefined()
		expect(sent).toBe('slides-entered')
	})

	it('resolves on the timeout when the worker never answers', async () => {
		let settled = false
		withController(() => {})
		const posted = postToServiceWorker('slides-left').then(() => (settled = true))
		await vi.advanceTimersByTimeAsync(499)
		expect(settled).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		await posted
		expect(settled).toBe(true)
	})
})
