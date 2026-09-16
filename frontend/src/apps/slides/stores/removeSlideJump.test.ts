import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { removeSlideCommand } = await import('./commands')
const { actionOrder, actions } = await import('./historyMeta')
const { slides, slideIndex } = await import('./slide')
const { slidesLength } = await import('./presentation')

const slide = (clientId: string) => ({ clientId, elements: [] })

const removeAt = (history: any, index: number) =>
	history.execute(removeSlideCommand({ slide: slides.value[index], index, slideIndex: index }))

describe('removing the slide being viewed', () => {
	let history: any

	beforeEach(() => {
		slides.value = [slide('A'), slide('B'), slide('C')] as any
		slidesLength.value = 3
		history = useCommandHistory(slides, { actionOrder, actions })
	})

	it('shows the slide that moved up into the gap', async () => {
		slideIndex.value = 1

		await removeAt(history, 1)
		await nextTick()

		expect(slides.value.map((s) => s.clientId)).toEqual(['A', 'C'])
		expect(slideIndex.value).toBe(1)
	})

	it('falls back to the new last slide when the last one goes', async () => {
		slideIndex.value = 2

		await removeAt(history, 2)
		await nextTick()

		expect(slides.value.map((s) => s.clientId)).toEqual(['A', 'B'])
		expect(slideIndex.value).toBe(1)

		await history.undo()
		await nextTick()

		expect(slideIndex.value).toBe(2)
	})
})
