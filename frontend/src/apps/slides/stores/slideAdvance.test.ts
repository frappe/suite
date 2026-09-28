import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const replace = vi.fn(() => Promise.resolve())

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({
	router: { replace, currentRoute: { value: { params: { presentationId: 'p1' } } } },
}))

const { slides, slideIndex } = await import('./slide')
const { scheduleAdvance, cancelAdvance } = await import('./slideshow')

const slideQueryOfLastReplace = () => replace.mock.lastCall?.[0]

const addVideo = ({ paused, loop = false, currentTime = 1, playable = true }) => {
	const video = document.createElement('video')
	Object.defineProperties(video, {
		paused: { value: paused, writable: true },
		ended: { value: false, writable: true },
		error: { value: null, writable: true },
		loop: { value: loop },
		currentTime: { value: currentTime, writable: true },
		play: {
			value: vi.fn(function () {
				if (!playable) return Promise.reject(new DOMException('', 'NotAllowedError'))
				this.paused = false
				return Promise.resolve()
			}),
		},
	})
	document.body.appendChild(video)
	return video
}

const endVideo = (video) => {
	video.ended = true
	video.dispatchEvent(new Event('ended'))
}

describe('a slide that advances on its own', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		replace.mockClear()
		slides.value = [{ elements: [], advanceAfter: '2' }, { elements: [] }] as any
		slideIndex.value = 0
	})

	afterEach(() => {
		cancelAdvance()
		document.body.innerHTML = ''
		vi.useRealTimers()
	})

	it('moves on once its delay is up', async () => {
		scheduleAdvance()

		vi.advanceTimersByTime(1999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ name: 'slides-slideshow', query: { slide: 2 } })
	})

	it('waits for a click when it has no delay', async () => {
		slideIndex.value = 1
		scheduleAdvance()

		vi.advanceTimersByTime(60_000)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()
	})

	it('counts its delay after a video ends', async () => {
		const video = addVideo({ paused: false })
		scheduleAdvance()

		vi.advanceTimersByTime(500)
		endVideo(video)
		vi.advanceTimersByTime(1999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('watches a video longer than its delay to the end first', async () => {
		const video = addVideo({ paused: false })
		scheduleAdvance()

		vi.advanceTimersByTime(5000)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		endVideo(video)
		vi.advanceTimersByTime(1999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('does not hold for a looping video', async () => {
		addVideo({ paused: false, loop: true })
		scheduleAdvance()

		vi.advanceTimersByTime(2000)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('keeps its delay when a looping video fails', async () => {
		const video = addVideo({ paused: false, loop: true })
		scheduleAdvance()

		vi.advanceTimersByTime(1500)
		video.error = { code: 2 }
		video.dispatchEvent(new Event('error'))
		vi.advanceTimersByTime(500)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('moves past a looping video that has not started', async () => {
		const video = addVideo({ paused: true, loop: true, currentTime: 0 })
		scheduleAdvance()

		vi.advanceTimersByTime(2000)
		await nextTick()
		expect(video.play).not.toHaveBeenCalled()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('starts an Autoplay-off video first and watches it to the end', async () => {
		const video = addVideo({ paused: true, currentTime: 0 })
		scheduleAdvance()

		vi.advanceTimersByTime(2000)
		await nextTick()
		expect(video.play).toHaveBeenCalled()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(3000)
		endVideo(video)
		vi.advanceTimersByTime(1999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('waits for a video paused partway', async () => {
		const video = addVideo({ paused: true, currentTime: 3 })
		scheduleAdvance()

		vi.advanceTimersByTime(60_000)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		video.paused = false
		endVideo(video)
		vi.advanceTimersByTime(2000)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('counts its delay from a video that fails as from one that ends', async () => {
		const video = addVideo({ paused: false })
		scheduleAdvance()

		vi.advanceTimersByTime(5000)
		video.error = { code: 2 }
		video.dispatchEvent(new Event('error'))
		vi.advanceTimersByTime(1999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('moves past a video the browser will not start', async () => {
		addVideo({ paused: true, currentTime: 0, playable: false })
		scheduleAdvance()

		await vi.advanceTimersByTimeAsync(2000)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('leaves a later slide alone when a refusal comes late', async () => {
		let refuse
		const video = addVideo({ paused: true, currentTime: 0 })
		vi.mocked(video.play).mockImplementationOnce(
			() => new Promise((_, reject) => (refuse = reject)),
		)
		scheduleAdvance()

		vi.advanceTimersByTime(2000)
		slideIndex.value = 1
		refuse(new DOMException('', 'AbortError'))
		await vi.advanceTimersByTimeAsync(0)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()
	})

	it('counts its delay once the slide has come in', async () => {
		slides.value[0] = { ...slides.value[0], transition: 'Fade', transitionDuration: '3' }
		scheduleAdvance()

		vi.advanceTimersByTime(4999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('lets a short video finish the entrance before counting', async () => {
		slides.value[0] = { ...slides.value[0], transition: 'Fade', transitionDuration: '4' }
		const video = addVideo({ paused: false })
		scheduleAdvance()

		vi.advanceTimersByTime(500)
		endVideo(video)
		vi.advanceTimersByTime(5499)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('waits only its delay on the slide the show opens on', async () => {
		slides.value[0] = { ...slides.value[0], transition: 'Fade', transitionDuration: '3' }
		scheduleAdvance(false)

		vi.advanceTimersByTime(2000)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 2 } })
	})

	it('counts a Magic Move from the slide before', async () => {
		slides.value = [
			{ elements: [], transition: 'Magic Move', transitionDuration: '3' },
			{ elements: [], advanceAfter: '2' },
			{ elements: [] },
		] as any
		slideIndex.value = 1
		scheduleAdvance()

		vi.advanceTimersByTime(4999)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 3 } })
	})

	it('waits for unmatched elements to fade in after a Magic Move', async () => {
		slides.value = [
			{
				elements: [],
				transition: 'Magic Move',
				transitionDuration: '3',
				fadeUnmatchedElements: true,
			},
			{ elements: [], advanceAfter: '2' },
			{ elements: [] },
		] as any
		slideIndex.value = 1
		scheduleAdvance()

		vi.advanceTimersByTime(6099)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		await nextTick()
		expect(slideQueryOfLastReplace()).toMatchObject({ query: { slide: 3 } })
	})

	it('stays put once cancelled', async () => {
		const video = addVideo({ paused: false })
		scheduleAdvance()
		cancelAdvance()

		endVideo(video)
		vi.advanceTimersByTime(60_000)
		await nextTick()
		expect(replace).not.toHaveBeenCalled()
	})
})
