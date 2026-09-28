import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const replace = vi.fn(() => Promise.resolve())

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({
	router: { replace, currentRoute: { value: { params: { presentationId: 'p1' } } } },
}))

const { slides, slideIndex } = await import('./slide')
const { applyReverseTransition } = await import('./presentation')
const {
	startSlideShow,
	resetSlideShowState,
	endSlideShow,
	changeSlideInSlideshow,
	scheduleAdvance,
	cancelAdvance,
} = await import('./slideshow')

const lastSlideQuery = () => replace.mock.lastCall?.[0]?.query?.slide

const leaveLastSlide = async () => {
	slideIndex.value = slides.value.length - 1
	changeSlideInSlideshow(slides.value.length)
	await nextTick()
}

describe('presenting from the navbar', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		slides.value = [{ elements: [] }, { elements: [] }, { elements: [], advanceAfter: '1' }] as any
		slideIndex.value = 0
		replace.mockClear()
	})

	afterEach(() => {
		endSlideShow()
		cancelAdvance()
		vi.useRealTimers()
	})

	it('starts on loop from the first slide', () => {
		slideIndex.value = 2
		startSlideShow({ loop: true })

		expect(lastSlideQuery()).toBe(1)
	})

	it('starts over after the last slide', async () => {
		startSlideShow({ loop: true })
		applyReverseTransition.value = true

		await leaveLastSlide()

		expect(lastSlideQuery()).toBe(1)
		expect(applyReverseTransition.value).toBe(false)
	})

	it('starts over on its own as well', async () => {
		startSlideShow({ loop: true })
		replace.mockClear()
		slideIndex.value = 2
		scheduleAdvance()

		vi.advanceTimersByTime(1000)
		await nextTick()

		expect(lastSlideQuery()).toBe(1)
	})

	it('replays a single slide on its own', async () => {
		slides.value = [{ elements: [], advanceAfter: '1' }] as any
		const video = document.createElement('video')
		const play = vi.fn(() => Promise.resolve())
		Object.defineProperties(video, {
			autoplay: { value: true },
			paused: { value: true },
			ended: { value: true, writable: true },
			currentTime: { value: 10, writable: true },
			play: { value: play },
		})
		document.body.appendChild(video)
		startSlideShow({ loop: true })
		scheduleAdvance()

		for (const pass of [1, 2]) {
			vi.advanceTimersByTime(1000)
			await nextTick()
			expect(play).toHaveBeenCalledTimes(pass)
			expect(video.currentTime).toBe(0)
			video.currentTime = 10
		}
		video.remove()
	})

	it('opens on the current slide, or on the first when asked', () => {
		slideIndex.value = 2

		startSlideShow()
		expect(lastSlideQuery()).toBe(3)

		startSlideShow({ fromStart: true })
		expect(lastSlideQuery()).toBe(1)
	})

	it('ends after the last slide when presented plainly', async () => {
		startSlideShow()

		await leaveLastSlide()

		expect(lastSlideQuery()).toBe(slides.value.length + 1)
	})

	it('ends after the last slide once the show was left', async () => {
		startSlideShow({ loop: true })
		endSlideShow()
		startSlideShow()

		await leaveLastSlide()

		expect(lastSlideQuery()).toBe(slides.value.length + 1)
	})

	it('ends after the last slide once the show was navigated away from', async () => {
		startSlideShow({ loop: true })
		resetSlideShowState()

		await leaveLastSlide()

		expect(lastSlideQuery()).toBe(slides.value.length + 1)
	})
})
