import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// The `/d/` surface hands the store its Drive session's fetch, so a person who
// holds only a share link reaches the body. Old pages keep frappe-ui.

const frappeRequests: Array<{ url: string }> = []
const visits: string[] = []
const served = { name: 'p1', node: 'node-1', modified: 'M1', slides: [] }

vi.mock('frappe-ui', () => ({
	createResource: () => ({}),
	call: vi.fn(),
	frappeRequest: async (options: { url: string }) => {
		frappeRequests.push(options)
		return JSON.parse(JSON.stringify(served))
	},
	toast: { warning: vi.fn(), error: vi.fn() },
}))
vi.mock('./driveVisit', () => ({ recordVisit: async (node: string) => void visits.push(node) }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides: ref([]) }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: {} }))
vi.mock('@/apps/slides/stores/element', () => ({ normalizeZIndices: (els: unknown[]) => els }))
vi.mock('@/apps/slides/stores/saving', () => ({
	markDirty: vi.fn(),
	markClean: vi.fn(),
	writeDraft: vi.fn(),
	clearSaveFailure: vi.fn(),
	saveRefused: ref(false),
	getPresentationFromLocalDB: async () => null,
}))

const { initPresentationDoc, savePresentationDoc, setDocumentFetch } = await import('./presentation')

const answer = (message: unknown, status = 200) =>
	new Response(JSON.stringify(status === 200 ? { message } : message), { status })

describe('where the presentation requests go', () => {
	beforeEach(() => {
		frappeRequests.length = 0
		visits.length = 0
	})

	it('an old page sends through frappe-ui and records the visit on the node', async () => {
		await initPresentationDoc('p1')

		expect(frappeRequests.map((request) => request.url)).toEqual(['frappe.client.get'])
		expect(visits).toEqual(['node-1'])
	})

	it('the surface sends loads and saves through its session fetch and records no visit itself', async () => {
		const sent: Array<{ url: string; init?: RequestInit }> = []
		const release = setDocumentFetch('p1', async (url: string, init?: RequestInit) => {
			sent.push({ url, init })
			return url.includes('save_slides') ? answer({ modified: 'M2' }) : answer(served)
		})

		await initPresentationDoc('p1')
		await savePresentationDoc('p1', [{ clientId: 'c1', elements: [] }], 'M1')
		release()

		expect(frappeRequests).toEqual([])
		expect(visits).toEqual([])
		expect(sent[0].url).toBe('/api/method/frappe.client.get?doctype=Presentation&name=p1')
		expect(sent[0].init?.method).toBe('GET')
		expect(sent[1].url).toBe('/api/method/suite.slides.api.slides.save_slides')
		expect(sent[1].init?.method).toBe('POST')
		expect(JSON.parse(String(sent[1].init?.body))).toMatchObject({ name: 'p1', base_modified: 'M1' })
	})

	it('a refused save through the surface fails with the server exception type', async () => {
		const release = setDocumentFetch('p1', async () =>
			answer({ exc_type: 'PermissionError' }, 403),
		)
		await expect(savePresentationDoc('p1', [], 'M1')).rejects.toMatchObject({
			exc_type: 'PermissionError',
			status: 403,
		})
		release()
	})

	it('a save that lands after another deck opened goes out with its own deck\'s credentials', async () => {
		const deckA = vi.fn(async () => answer({ modified: 'M2' }))
		const deckB = vi.fn(async () => answer({ modified: 'M9' }))
		const releaseA = setDocumentFetch('deck-a', deckA)
		const releaseB = setDocumentFetch('deck-b', deckB)

		await savePresentationDoc('deck-a', [{ clientId: 'c1', elements: [] }], 'M1')

		expect(deckA).toHaveBeenCalledTimes(1)
		expect(deckB).not.toHaveBeenCalled()
		releaseA()
		releaseB()
	})

	it('releasing an older surface leaves the newer surface in place', async () => {
		const older = setDocumentFetch('p1', async () => answer(served))
		const newer = vi.fn(async () => answer(served))
		const releaseNewer = setDocumentFetch('p1', newer)
		older()

		await initPresentationDoc('p1')
		expect(newer).toHaveBeenCalled()
		releaseNewer()
	})
})
