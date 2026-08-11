import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const slidesLength = ref(0)

vi.mock('@/apps/slides/stores/presentation', () => ({ slidesLength }))
vi.mock('@/apps/slides/stores/element', () => ({ findElement: () => null }))
vi.mock('@/apps/slides/utils/helpers', () => ({
	cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

const { addSlideCommand, removeSlideCommand } = await import('./commands')

const makeSlide = (clientId: string, name: string) => ({ clientId, name, elements: [] })

describe('removeSlideCommand', () => {
	it('drops the child row name so undo re-inserts a slide autosave already deleted', () => {
		const slide = makeSlide('c2', 'srv-row-2')
		const state = [makeSlide('c1', 'srv-row-1'), slide]

		const command = removeSlideCommand({ slide, index: 1, slideIndex: 1 })
		command.execute(state)
		expect(state).toHaveLength(1)

		command.undo(state)

		expect(state).toHaveLength(2)
		expect(state[1].clientId).toBe('c2')
		expect(state[1].name).toBe('')
	})

	it('keeps the restored slide at its original index', () => {
		const slide = makeSlide('c1', 'srv-row-1')
		const state = [slide, makeSlide('c2', 'srv-row-2'), makeSlide('c3', 'srv-row-3')]

		const command = removeSlideCommand({ slide, index: 0, slideIndex: 0 })
		command.execute(state)
		command.undo(state)

		expect(state.map((s) => s.clientId)).toEqual(['c1', 'c2', 'c3'])
		expect(state.map((s) => s.idx)).toEqual([1, 2, 3])
	})
})

describe('addSlideCommand', () => {
	it('never inserts a slide under a child row name it was handed', () => {
		// pasted slides come from json, so the name is not ours to trust
		const slide = makeSlide('c2', 'srv-row-2')
		const state = [makeSlide('c1', 'srv-row-1')]

		addSlideCommand({ slide, index: 1, slideIndex: 0 }).execute(state)

		expect(state).toHaveLength(2)
		expect(state[1].name).toBe('')
	})
})
