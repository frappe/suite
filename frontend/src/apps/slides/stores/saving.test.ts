import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const presentationId = ref('p1')
const presentationDoc = ref<any>({ modified: 'M1' })
const inReadonlyMode = ref(false)
const slides = ref<any[]>([{ clientId: 'c1', background: '#ff0000ff', elements: [] }])

let serverSave: (content: any) => Promise<string | undefined>

vi.mock('@/apps/slides/stores/presentation', () => ({
	presentationId,
	presentationDoc,
	inReadonlyMode,
	savePresentationDoc: (content: any) => serverSave(content),
}))

vi.mock('@/apps/slides/stores/slide', () => ({ slides }))

vi.mock('@/apps/slides/utils/helpers', () => ({
	cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

const { saveCurrentState, markDirty, dirty, getPresentationFromLocalDB } = await import('./saving')

describe('saveCurrentState', () => {
	beforeEach(() => {
		presentationId.value = 'p1'
		presentationDoc.value = { modified: 'M1' }
		slides.value = [{ clientId: 'c1', background: '#ff0000ff', elements: [] }]
		serverSave = async () => {
			presentationDoc.value = { modified: 'M2' }
			return 'M2'
		}
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
			markDirty()
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

	it('still marks the local copy clean when the editor moved on without editing', async () => {
		markDirty()

		serverSave = async () => {
			presentationId.value = 'p2'
			presentationDoc.value = { modified: 'M2' }
			return 'M2'
		}

		await saveCurrentState()

		const local: any = await getPresentationFromLocalDB('p1')
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
})
