import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const presentationId = ref('p1')
const presentationDoc = ref<any>({ modified: 'M1' })
const inReadonlyMode = ref(false)
const slides = ref<any[]>([{ clientId: 'c1', background: '#ff0000ff', elements: [] }])

let serverSave: (id: string, content: any, baseModified?: string) => Promise<string | undefined>

vi.mock('@/apps/slides/stores/presentation', () => ({
	presentationId,
	presentationDoc,
	inReadonlyMode,
	savePresentationDoc: (id: string, content: any, baseModified?: string) =>
		serverSave(id, content, baseModified),
}))

vi.mock('@/apps/slides/stores/slide', () => ({ slides }))

vi.mock('@/apps/slides/utils/helpers', () => ({
	cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

let sessionUser: string | null = 'me@example.com'
vi.mock('@/boot/session', () => ({ getSessionUser: () => sessionUser }))

const {
	saveCurrentState,
	saveWithoutDelay,
	markDirty,
	dirty,
	saveFailed,
	clearSaveFailure,
	getPresentationFromLocalDB,
} = await import('./saving')

const conflict = () => Object.assign(new Error('stale'), { exc_type: 'TimestampMismatchError' })

describe('saveCurrentState', () => {
	// a refused base is held for good, so each test opens on a version of its own
	let base = ''
	let opens = 0

	beforeEach(() => {
		// the draft store schedules its work with timers, so only the clock is faked
		vi.useFakeTimers({ toFake: ['Date'] })
		base = `M${++opens}`
		clearSaveFailure()
		sessionUser = 'me@example.com'
		presentationId.value = 'p1'
		presentationDoc.value = { modified: base }
		slides.value = [{ clientId: 'c1', background: '#ff0000ff', elements: [] }]
		serverSave = async () => {
			presentationDoc.value = { modified: 'M2' }
			return 'M2'
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('persists edits made while the server save is in flight', async () => {
		markDirty()

		serverSave = async () => {
			// the user picks a second color while the first save is still in flight
			slides.value[0].background = '#00ff00ff'
			markDirty()
			presentationDoc.value = { modified: 'M2' }
			return 'M2'
		}

		await saveCurrentState()

		const local: any = await getPresentationFromLocalDB('p1')
		expect(dirty.value).toBe(true)
		expect(local.dirty).toBe(true)
		expect(local.content[0].background).toBe('#00ff00ff')
	})

	it('records the version the server took when the editor moved on mid-save', async () => {
		markDirty()

		serverSave = async () => {
			// resetEditorState() blanks slides, then the editor loads another presentation
			slides.value = []
			presentationId.value = 'p2'
			// presentationDoc belongs to p2 by now, so baseModified has to come
			// from what this save returned
			presentationDoc.value = { modified: 'M9' }
			return 'M2'
		}

		await saveCurrentState()

		const local: any = await getPresentationFromLocalDB('p1')
		// the snapshot the server took, not the blanked slides of the presentation
		// the editor moved on to
		expect(local.content).toHaveLength(1)
		expect(local.dirty).toBe(false)
		expect(local.baseModified).toBe('M2')
	})

	it('marks the local copy clean when nothing changed during the save', async () => {
		markDirty()

		await saveCurrentState()

		const local: any = await getPresentationFromLocalDB('p1')
		expect(dirty.value).toBe(false)
		expect(local.dirty).toBe(false)
		expect(local.baseModified).toBe('M2')
	})

	it('pushes the content and version it snapshotted, not what it can read back later', async () => {
		markDirty()

		let sent: any
		serverSave = async (_id, content, baseModified) => {
			sent = { content, baseModified }
			// a rename lands between the draft write and the push
			presentationDoc.value = { modified: 'M9' }
			return 'M2'
		}

		await saveCurrentState()

		expect(sent.content[0].background).toBe('#ff0000ff')
		expect(sent.baseModified).toBe(base)
	})

	it('keeps a snapshot the server refused as stale', async () => {
		markDirty()

		serverSave = async () => {
			throw conflict()
		}

		await saveCurrentState()

		const local: any = await getPresentationFromLocalDB('p1')
		// the edits are still the only copy of the user's work; discarding them loses it
		expect(local.dirty).toBe(true)
		expect(local.content[0].background).toBe('#ff0000ff')
		expect(dirty.value).toBe(true)
		expect(saveFailed.value).toBe(true)
	})

	it('drafts the edits made during a refused push before holding', async () => {
		markDirty()

		serverSave = async () => {
			slides.value[0].background = '#00ff00ff'
			markDirty()
			throw conflict()
		}

		await saveCurrentState()

		const local: any = await getPresentationFromLocalDB('p1')
		expect(local.content[0].background).toBe('#00ff00ff')
		expect(local.dirty).toBe(true)
	})

	it('stops pushing once the server refuses this tab as stale', async () => {
		markDirty()

		let pushes = 0
		serverSave = async () => {
			pushes++
			throw conflict()
		}

		await saveCurrentState()
		await saveCurrentState()
		expect(pushes).toBe(1)

		// the edits still go to the draft
		slides.value[0].background = '#00ff00ff'
		markDirty()
		await saveCurrentState()
		const local: any = await getPresentationFromLocalDB('p1')
		expect(local.content[0].background).toBe('#00ff00ff')
		expect(local.dirty).toBe(true)
		expect(pushes).toBe(1)

		// a reload gives this tab a newer base, and the hold is on the refused version only
		presentationDoc.value = { modified: 'M-reloaded' }
		serverSave = async () => {
			pushes++
			return 'M-next'
		}
		markDirty()
		await saveCurrentState()
		expect(pushes).toBe(2)
	})

	it('pushes even when the draft store refuses the write', async () => {
		markDirty()

		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
			throw new Error('quota exceeded')
		})
		let pushes = 0
		serverSave = async () => {
			pushes++
			presentationDoc.value = { modified: 'M2' }
			return 'M2'
		}

		await saveCurrentState()
		put.mockRestore()

		// the server copy is what makes the edits durable; a broken draft store is not a save failure
		expect(pushes).toBe(1)
		expect(dirty.value).toBe(false)
		expect(saveFailed.value).toBe(false)
	})

	it('keeps writing the draft while a push is stuck', async () => {
		markDirty()

		let release: (modified: string) => void = () => {}
		serverSave = () => new Promise((resolve) => (release = resolve))
		const stuck = saveCurrentState()
		await new Promise((resolve) => setTimeout(resolve))

		slides.value[0].background = '#00ff00ff'
		markDirty()
		await saveCurrentState()

		// the second edit never got a push, but a crash now must still find it
		const local: any = await getPresentationFromLocalDB('p1')
		expect(local.content[0].background).toBe('#00ff00ff')
		expect(local.dirty).toBe(true)

		release('M2')
		await stuck
	})

	it('pushes what the editor typed mid-push once it moved on', async () => {
		markDirty()

		const sent: any[] = []
		serverSave = async (id, content, baseModified) => {
			sent.push({ id, content, baseModified })
			if (sent.length > 1) return 'M3'
			// typed mid-push, turned away by the gate, then the editor leaves
			slides.value[0].background = '#00ff00ff'
			markDirty()
			await saveCurrentState()
			slides.value = []
			presentationId.value = 'p2'
			presentationDoc.value = { modified: 'M9' }
			return 'M2'
		}

		await saveCurrentState()

		expect(sent).toHaveLength(2)
		expect(sent[1].id).toBe('p1')
		expect(sent[1].content[0].background).toBe('#00ff00ff')
		expect(sent[1].baseModified).toBe('M2')
		const local: any = await getPresentationFromLocalDB('p1')
		expect(local.content[0].background).toBe('#00ff00ff')
		expect(local.dirty).toBe(false)
		expect(local.baseModified).toBe('M3')
	})

	it('drops a queued edit once the push it waited on fails', async () => {
		markDirty()

		let fail: (err: Error) => void = () => {}
		serverSave = () => new Promise((_, reject) => (fail = reject))
		const stuck = saveCurrentState()
		await new Promise((resolve) => setTimeout(resolve))

		slides.value[0].background = '#222222ff'
		markDirty()
		await saveCurrentState()

		fail(new Error('network'))
		await stuck
		vi.advanceTimersByTime(500)

		// its push lands after the editor moved on
		slides.value[0].background = '#333333ff'
		markDirty()
		const sent: string[] = []
		serverSave = async (_id, content) => {
			sent.push(content[0].background)
			slides.value = []
			presentationId.value = 'p2'
			presentationDoc.value = { modified: 'M9' }
			return 'M2'
		}
		await saveCurrentState()

		// sent as a tail, the older queued edit would overwrite this one
		expect(sent).toEqual(['#333333ff'])
		const local: any = await getPresentationFromLocalDB('p1')
		expect(local.content[0].background).toBe('#333333ff')
		expect(local.dirty).toBe(false)
	})

	it('keeps the tail on the new base when its own push dies', async () => {
		markDirty()

		let pushes = 0
		serverSave = async () => {
			if (++pushes > 1) throw new Error('network')
			slides.value[0].background = '#00ff00ff'
			markDirty()
			await saveCurrentState()
			slides.value = []
			presentationId.value = 'p2'
			presentationDoc.value = { modified: 'M9' }
			return 'M2'
		}

		await saveCurrentState()

		// on an older base the next load would throw the tail away as stale
		const local: any = await getPresentationFromLocalDB('p1')
		expect(local.content[0].background).toBe('#00ff00ff')
		expect(local.dirty).toBe(true)
		expect(local.baseModified).toBe('M2')
		expect(saveFailed.value).toBe(true)
	})

	it('waits longer after each failed push', async () => {
		markDirty()

		let pushes = 0
		serverSave = async () => {
			pushes++
			throw new Error('500')
		}

		await saveCurrentState()
		await saveCurrentState()
		expect(pushes).toBe(1)

		vi.advanceTimersByTime(500)
		await saveCurrentState()
		expect(pushes).toBe(2)

		vi.advanceTimersByTime(500)
		await saveCurrentState()
		expect(pushes).toBe(2)
		vi.advanceTimersByTime(500)
		await saveCurrentState()
		expect(pushes).toBe(3)
	})

	it('pushes on request without waiting out the backoff', async () => {
		markDirty()

		let pushes = 0
		serverSave = async () => {
			pushes++
			throw new Error('500')
		}

		await saveCurrentState()
		await saveCurrentState()
		expect(pushes).toBe(1)

		await saveWithoutDelay()
		expect(pushes).toBe(2)
	})
})

describe('drafts', () => {
	beforeEach(() => {
		sessionUser = 'me@example.com'
		presentationDoc.value = { modified: 'M1' }
		slides.value = [{ clientId: 'c1', background: '#ff0000ff', elements: [] }]
		serverSave = async () => 'M2'
	})

	it('ignores a draft another user of this browser left', async () => {
		presentationId.value = 'p-user'
		sessionUser = 'other@example.com'
		markDirty()
		await saveCurrentState()
		expect(await getPresentationFromLocalDB('p-user')).not.toBeNull()

		sessionUser = 'me@example.com'
		expect(await getPresentationFromLocalDB('p-user')).toBeNull()
	})
})
