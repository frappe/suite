import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/apps/slides/stores/saving', () => ({ markDirty: () => {} }))
vi.mock('@/apps/slides/stores/presentation', () => ({ slidesLength: ref(0) }))
vi.mock('@/apps/slides/utils/helpers', () => ({
	cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { batchCommand, editElementCommand, removeElementCommand } = await import('./commands')

// the real order also navigates, which needs the whole editor
const historyMeta = {
	actions: {},
	actionOrder: {
		execute: { removeElement: ['execute'], editElement: ['execute'], batch: ['execute'] },
		undo: { removeElement: ['undo'], editElement: ['undo'], batch: ['undo'] },
	},
}

const slideId = 'c1'

let slides: any
let history: ReturnType<typeof useCommandHistory>

const elements = () => slides.value[0].elements
const element = (id: number) => elements().find((el: any) => el.id === id)

const editLeft = (elementIds: number[], newValue: number) =>
	editElementCommand({ slideId, elementIds, property: 'left', oldValue: 0, newValue })

describe('lock enforcement in commandHistory.execute', () => {
	beforeEach(() => {
		slides = ref([
			{
				clientId: slideId,
				elements: [
					{ id: 1, left: 0, zIndex: 2, locked: true },
					{ id: 2, left: 0, zIndex: 1 },
				],
			},
		])
		history = useCommandHistory(slides, historyMeta)
	})

	it('refuses to edit a locked element', async () => {
		await history.execute(editLeft([1], 50))

		expect(element(1).left).toBe(0)
		expect(history.canUndo.value).toBe(false)
	})

	it('edits an unlocked element', async () => {
		await history.execute(editLeft([2], 50))

		expect(element(2).left).toBe(50)
		expect(history.canUndo.value).toBe(true)
	})

	it('refuses a multi-select edit when one of the elements is locked', async () => {
		await history.execute(editLeft([1, 2], 50))

		expect(element(1).left).toBe(0)
		expect(element(2).left).toBe(0)
	})

	it('allows unlocking a locked element', async () => {
		await history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'locked',
				oldValue: true,
				newValue: undefined,
			}),
		)

		expect(element(1).locked).toBeUndefined()
	})

	it('allows magic move to write a refId onto a locked element', async () => {
		await history.execute(
			editElementCommand({
				slideId,
				elementIds: [1],
				property: 'refId',
				oldValue: null,
				newValue: 'r1',
			}),
		)

		expect(element(1).refId).toBe('r1')
	})

	it('refuses to remove a locked element', async () => {
		await history.execute(removeElementCommand({ slideId, element: element(1) }))

		expect(element(1)).toBeDefined()
	})

	it('removes an unlocked element', async () => {
		await history.execute(removeElementCommand({ slideId, element: element(2) }))

		expect(element(2)).toBeUndefined()
	})

	it('refuses a whole batch when one of its commands targets a locked element', async () => {
		await history.execute(
			batchCommand({
				slideId,
				elementIds: [1, 2],
				commands: [editLeft([2], 50), editLeft([1], 50)],
			}),
		)

		expect(element(2).left).toBe(0)
		expect(element(1).left).toBe(0)
	})

	it('applies a delete batch that renumbers a locked sibling', async () => {
		await history.execute(
			batchCommand({
				slideId,
				elementIds: [2],
				commands: [
					removeElementCommand({ slideId, element: element(2) }),
					editElementCommand({
						slideId,
						elementIds: [1],
						property: 'zIndex',
						oldValue: 2,
						newValue: 1,
					}),
				],
			}),
		)

		expect(element(2)).toBeUndefined()
		expect(element(1).zIndex).toBe(1)
	})

	it('undoes an edit that locked the element it changed', async () => {
		await history.execute(
			batchCommand({
				slideId,
				elementIds: [2],
				commands: [
					editLeft([2], 50),
					editElementCommand({
						slideId,
						elementIds: [2],
						property: 'locked',
						oldValue: undefined,
						newValue: true,
					}),
				],
			}),
		)
		expect(element(2).left).toBe(50)

		await history.undo()

		expect(element(2).locked).toBeUndefined()
		expect(element(2).left).toBe(0)
	})
})
