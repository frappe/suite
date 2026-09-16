import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const slidesLength = ref(0)

vi.mock('@/apps/slides/stores/presentation', () => ({ slidesLength }))
vi.mock('@/apps/slides/stores/element', () => ({ findElement: () => null }))
vi.mock('@/apps/slides/utils/helpers', () => ({
	cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

const { removeSlideCommand } = await import('./commands')

const makeSlide = (clientId: string) => ({ clientId, elements: [] })

describe('removeSlideCommand', () => {
	it('keeps the restored slide at its original index', () => {
		const slide = makeSlide('c1')
		const state = [slide, makeSlide('c2'), makeSlide('c3')]

		const command = removeSlideCommand({ slide, index: 0, slideIndex: 0 })
		command.execute(state)
		command.undo(state)

		expect(state.map((s) => s.clientId)).toEqual(['c1', 'c2', 'c3'])
		expect(state.map((s) => s.idx)).toEqual([1, 2, 3])
	})

	it('lands on the slide that moved up into the gap', () => {
		slidesLength.value = 3
		const command = removeSlideCommand({ slide: makeSlide('c2'), index: 1, slideIndex: 1 })

		expect(command.jumpToSlideIndex).toBe(1)
	})

	it('falls back to the new last slide when the last one goes', () => {
		slidesLength.value = 3
		const command = removeSlideCommand({ slide: makeSlide('c3'), index: 2, slideIndex: 2 })

		expect(command.jumpToSlideIndex).toBe(1)
	})
})
