import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const server = vi.hoisted(() => ({ answer: null as ((options: any) => any) | null }))

vi.mock('frappe-ui', () => ({
	createResource: () => ({}),
	call: vi.fn(),
	frappeRequest: (options: any) =>
		server.answer
			? Promise.resolve().then(() => server.answer!(options))
			: new Promise((_, reject) => {
					options.signal?.addEventListener('abort', () => reject(options.signal.reason))
				}),
	toast: { warning: vi.fn(), error: vi.fn() },
}))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides: ref([]) }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: { clearHistory: vi.fn() } }))
vi.mock('@/apps/slides/stores/element', () => ({ normalizeZIndices: (els: any) => els }))
vi.mock('@/boot/session', () => ({ getSessionUser: () => 'me@example.com' }))
vi.mock('@/apps/slides/stores/saving', () => ({
	markDirty: vi.fn(),
	markClean: vi.fn(),
	clearSaveFailure: vi.fn(),
	saveRefused: ref(false),
	getPresentationFromLocalDB: async () => null,
}))

const { savePresentationDoc, presentationDoc, presentationId, resetEditorState } =
	await import('./presentation')

describe('savePresentationDoc', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it('gives up on a push that never answers', async () => {
		presentationDoc.value = { name: 'p1', modified: 'M1' }

		const outcome = savePresentationDoc('p1', [], 'M1').then(
			() => 'saved',
			(err) => err.name,
		)
		await vi.advanceTimersByTimeAsync(30_000)

		expect(await outcome).toBe('AbortError')
	})

	it('stamps the presentation it pushed, not the one on screen', async () => {
		server.answer = (options) => ({ modified: `${options.params.name}-M2` })
		presentationDoc.value = { name: 'p2', modified: 'N1' }

		try {
			expect(await savePresentationDoc('p1', [], 'M1')).toBe('p1-M2')
		} finally {
			server.answer = null
		}
		expect(presentationDoc.value.modified).toBe('N1')
	})

	const stale = () => Object.assign(new Error('stale'), { exc_type: 'TimestampMismatchError' })
	const slide = { clientId: 'c1', background: '#ff0000ff', elements: [], fadeUnmatchedElements: true }
	const row = {
		client_id: 'c1',
		background: '#ff0000ff',
		elements: '[]',
		transition: null,
		transition_duration: null,
		fade_unmatched_elements: 1,
	}

	it('adopts the version a push left when the retry finds its own rows there', async () => {
		presentationDoc.value = { name: 'p1', modified: 'M1' }
		server.answer = (options) => {
			if (options.url === 'frappe.client.get') {
				return { modified: 'M2', modified_by: 'me@example.com', slides: [row] }
			}
			throw stale()
		}

		try {
			expect(await savePresentationDoc('p1', [slide], 'M1')).toBe('M2')
		} finally {
			server.answer = null
		}
		expect(presentationDoc.value.modified).toBe('M2')
	})

	it('moves to the version a push it gave up on made', async () => {
		presentationDoc.value = { name: 'p1', modified: 'M1' }
		server.answer = () => {
			throw new Error('network')
		}
		await expect(savePresentationDoc('p1', [slide], 'M1')).rejects.toThrow('network')

		const edited = { ...slide, background: '#00ff00ff' }
		server.answer = (options) => {
			if (options.url === 'frappe.client.get') {
				return { modified: 'M2', modified_by: 'me@example.com', slides: [row] }
			}
			throw stale()
		}
		try {
			await expect(savePresentationDoc('p1', [edited], 'M1')).rejects.toMatchObject({
				exc_type: 'TimestampMismatchError',
			})
		} finally {
			server.answer = null
		}
		expect(presentationDoc.value.modified).toBe('M2')
	})

	it('stays refused when the server holds a different version', async () => {
		presentationDoc.value = { name: 'p1', modified: 'M1' }
		server.answer = (options) => {
			if (options.url === 'frappe.client.get') {
				return { modified: 'M2', modified_by: 'me@example.com', slides: [{ ...row, background: '#00ff00ff' }] }
			}
			throw stale()
		}

		try {
			await expect(savePresentationDoc('p1', [slide], 'M1')).rejects.toMatchObject({
				exc_type: 'TimestampMismatchError',
			})
		} finally {
			server.answer = null
		}
		expect(presentationDoc.value.modified).toBe('M1')
	})
})

describe('resetEditorState', () => {
	it('leaves no presentation for a push in flight to land on', () => {
		presentationId.value = 'p1'

		resetEditorState()

		expect(presentationId.value).toBe(null)
	})
})
