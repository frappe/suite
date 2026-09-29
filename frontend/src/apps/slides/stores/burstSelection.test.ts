import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { addElementCommand, editElementCommand } = await import('./commands')
const { actionOrder, actions } = await import('./historyMeta')
const { activeElementIds, focusElementId, cropSelectionToFitContent } = await import('./element')
const { slides, slideIndex, selectionBounds, updateSelectionBounds } = await import('./slide')

const slideId = 'c1'
const image = (id: number) => ({ id, type: 'image', left: 10, top: 10, width: 100, height: 100 })

describe('a held-key run of undos', () => {
	beforeEach(() => {
		slides.value = [{ clientId: slideId, elements: [] }] as any
		slideIndex.value = 0
		activeElementIds.value = []
		focusElementId.value = null
	})

	it('leaves nothing selected once every element it named is gone', async () => {
		const history = useCommandHistory(slides, { actionOrder, actions })

		await history.execute(addElementCommand({ slideId, element: image(1) }))
		await nextTick()
		await history.execute(addElementCommand({ slideId, element: image(2) }))
		await nextTick()
		await history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'left',
				oldValue: 10,
				newValue: 50,
			}),
		)
		await nextTick()

		// the user clicks the other element before holding Cmd+Z
		activeElementIds.value = [2]

		const runs = [history.undo(), history.undo(), history.undo()]

		await Promise.all(runs)
		for (let i = 0; i < 5; i++) await nextTick()

		expect(slides.value[0].elements).toEqual([])
		expect(activeElementIds.value).toEqual([])
	})

	it('lets the last undo decide the selection, not the first to be deferred', async () => {
		const history = useCommandHistory(slides, { actionOrder, actions })

		history.execute(addElementCommand({ slideId, element: image(1) }))
		await nextTick()
		history.execute(addElementCommand({ slideId, element: image(2) }))
		await nextTick()
		history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'left',
				oldValue: 10,
				newValue: 50,
			}),
		)
		await nextTick()

		activeElementIds.value = []

		// the edit undo defers a selection of element 1; the undo after it removes
		// element 2 and clears the selection, and it spoke last
		history.undo()
		history.undo()

		for (let i = 0; i < 5; i++) await nextTick()

		expect(slides.value[0].elements.map((e: any) => e.id)).toEqual([1])
		expect(activeElementIds.value).toEqual([])
	})

	it('drops the deferred crop of an element it went on to remove', async () => {
		const history = useCommandHistory(slides, { actionOrder, actions })

		history.execute(addElementCommand({ slideId, element: image(1) }))
		await nextTick()
		history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'left',
				oldValue: 10,
				newValue: 50,
			}),
		)
		await nextTick()

		// the crop only defers when the selection already names the element
		activeElementIds.value = [1]

		history.undo()
		history.undo()
		for (let i = 0; i < 5; i++) await nextTick()

		expect(slides.value[0].elements).toEqual([])
		expect(activeElementIds.value).toEqual([])
	})

	it('drops the stale deferred crop once a later undo has retaken the selection', async () => {
		const history = useCommandHistory(slides, { actionOrder, actions })

		history.execute(addElementCommand({ slideId, element: image(1) }))
		await nextTick()
		history.execute(addElementCommand({ slideId, element: image(2) }))
		await nextTick()
		history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'left',
				oldValue: 10,
				newValue: 50,
			}),
		)
		await nextTick()

		activeElementIds.value = [1]
		updateSelectionBounds({ left: 400, top: 400, width: 50, height: 50 })

		// the edit undo defers a crop of element 1, which survives; the undo after
		// it clears the selection, so the crop must not repaint the old box
		history.undo()
		history.undo()

		for (let i = 0; i < 5; i++) await nextTick()

		expect(activeElementIds.value).toEqual([])
		expect(selectionBounds.left).toBe(400)
	})
})

describe('a write to the selected element', () => {
	it('fits the box in the tick after the write, without waiting for a frame', async () => {
		slides.value = [{ clientId: slideId, elements: [] }] as any
		slideIndex.value = 0
		activeElementIds.value = []
		const history = useCommandHistory(slides, { actionOrder, actions })

		history.execute(addElementCommand({ slideId, element: image(1) }))
		await nextTick()
		activeElementIds.value = [1]
		updateSelectionBounds({ left: 10, top: 10, width: 100, height: 100 })

		history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'left',
				oldValue: 10,
				newValue: 50,
			}),
		)
		for (let i = 0; i < 5; i++) await nextTick()

		expect(selectionBounds.left).toBe(50)
	})
})

describe('cropSelectionToFitContent', () => {
	it('ignores an id that is no longer on the slide', () => {
		slides.value = [{ clientId: slideId, elements: [] }] as any
		slideIndex.value = 0

		expect(() => cropSelectionToFitContent([99])).not.toThrow()
	})
})
