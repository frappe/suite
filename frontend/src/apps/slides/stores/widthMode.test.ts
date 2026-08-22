import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

// jsdom lays nothing out, so this div stands in for the rendered element
const { elementDiv } = vi.hoisted(() => ({ elementDiv: document.createElement('div') }))
vi.mock('@/apps/slides/stores/elementRegistry', () => ({
	registerElementDiv: () => {},
	getElementDiv: () => elementDiv,
}))

const { slides, slideIndex, slideBounds } = await import('./slide')
const { activeElementIds, addFixedWidthToElement, setAutoWidth, setFixedWidth } = await import(
	'./element'
)
const { interactionOffset, commitInteraction, resetInteractionOffset } = await import(
	'./interaction'
)
const { setCommandHistory } = await import('./historyMeta')
const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')

const actionOrder = {
	execute: { editElement: ['execute'], batch: ['execute'] },
	undo: { editElement: ['undo'], batch: ['undo'] },
}

const AUTO_WIDTH = 100

let history: ReturnType<typeof useCommandHistory>

const element = () => slides.value[0].elements[0] as any

const seedText = (align: string, overrides = {}) => {
	const content = `<p style="text-align: ${align}">one</p>`
	slides.value = [
		{
			clientId: 'c1',
			elements: [{ id: 't1', type: 'text', left: 400, top: 0, content, ...overrides }],
		},
	] as any
	slideIndex.value = 0
	activeElementIds.value = ['t1']
	elementDiv.innerHTML = content
}

beforeEach(() => {
	slideBounds.scale = 1
	// the stand-in renders at its stored width, or at the width its text needs
	elementDiv.getBoundingClientRect = () =>
		({ width: element().width || AUTO_WIDTH }) as DOMRect
	resetInteractionOffset()
	history = useCommandHistory(slides, { actionOrder, actions: {} } as any)
	setCommandHistory(history)
})

describe('switching a text box to a fixed width', () => {
	it('freezes it at the width it already renders at', () => {
		seedText('left')

		setFixedWidth()

		expect(element().width).toBe(AUTO_WIDTH)
	})

	it('undoes back to auto', () => {
		seedText('left')

		setFixedWidth()
		history.undo()

		expect(element().width).toBe(null)
	})

	// the conversion rides along with the gesture that triggered it, one entry
	it('undoes a side-handle drag past the conversion it started with', () => {
		seedText('left')

		addFixedWidthToElement()
		interactionOffset.width = 50
		commitInteraction()
		expect(element().width).toBe(150)

		history.undo()

		expect(element().width).toBe(null)
	})
})

describe('switching a text box back to auto', () => {
	it('clears the stored width', async () => {
		seedText('left', { width: 300 })

		await setAutoWidth()

		expect(element().width).toBe(null)
	})

	it('leaves left-aligned text on its left edge', async () => {
		seedText('left', { width: 300 })

		await setAutoWidth()

		expect(element().left).toBe(400)
	})

	it('keeps centered text on its center', async () => {
		seedText('center', { width: 300 })

		await setAutoWidth()

		expect(element().left).toBe(500)
	})

	it('keeps right-aligned text on its right edge', async () => {
		seedText('right', { width: 300 })

		await setAutoWidth()

		expect(element().left).toBe(600)
	})

	it('undoes the width and the shift as one step', async () => {
		seedText('center', { width: 300 })

		await setAutoWidth()
		history.undo()

		expect(element().width).toBe(300)
		expect(element().left).toBe(400)
	})
})
