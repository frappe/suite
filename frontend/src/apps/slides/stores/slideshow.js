import { ref, computed, nextTick } from 'vue'
import { applyReverseTransition } from '@/apps/slides/stores/presentation'
import { focusedSlide, slideIndex, slides, setSlideIndex } from '@/apps/slides/stores/slide'

import { router } from '@/apps/slides/router'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'

const inSlideShowMode = ref(false)

// the click's user activation expires before the slideshow route finishes
// loading, so fullscreen has to be requested here and not on the other side
let pendingFullscreen = null

const requestFullscreen = () => {
	if (pendingFullscreen) return pendingFullscreen

	const el = document.documentElement
	if (!el.requestFullscreen) return Promise.resolve(false)

	// a second request would consume the already-spent activation and reject
	pendingFullscreen = el
		.requestFullscreen()
		.then(() => true)
		.catch(() => false)
		.finally(() => (pendingFullscreen = null))

	return pendingFullscreen
}

const exitFullscreen = () => {
	if (document.fullscreenElement) document.exitFullscreen()
}

let wakeLock = null
let pendingWakeLock = null

const requestWakeLock = () => {
	if (pendingWakeLock) return pendingWakeLock
	if (wakeLock && !wakeLock.released) return Promise.resolve()
	if (!navigator.wakeLock) return Promise.resolve()

	pendingWakeLock = navigator.wakeLock
		.request('screen')
		.then((lock) => {
			wakeLock = lock
			if (!inSlideShowMode.value) releaseWakeLock()
		})
		.catch((error) => console.warn('Could not keep the screen awake:', error))
		.finally(() => (pendingWakeLock = null))

	return pendingWakeLock
}

const releaseWakeLock = () => {
	wakeLock?.release().catch(() => {})
	wakeLock = null
}

const startSlideShow = () => {
	requestFullscreen()
	router.replace({
		name: 'slides-slideshow',
		params: router.currentRoute.value.params,
		query: { slide: slideIndex.value + 1 },
	})
}

const endSlideShow = () => {
	exitFullscreen()
	releaseWakeLock()
	releaseVideoWarmers()
	inSlideShowMode.value = false
	focusedSlide.value = null
	const slide =
		slideIndex.value == slides.value.length ? slides.value.length : slideIndex.value + 1
	setSlideIndex(slide)
	router.replace({
		name: 'slides-editor',
		params: router.currentRoute.value.params,
		query: { slide: slide },
	})
}

const showSlideshowEndScreen = computed(() => {
	return slideIndex.value >= slides.value.length
})

const prefetchedAssets = ref(new Set())

// warm-ups exist only during a slideshow: the timers behind the call sites can
// fire after it ended
const prefetchNextSlide = () => {
	if (!inSlideShowMode.value) return
	const nextSlideIndex = slideIndex.value + 1
	if (nextSlideIndex >= slides.value.length) return
	// a warm-up must not compete with a video the audience is watching
	const currentHasVideo = slides.value[slideIndex.value]?.elements?.some(
		(element) => element.type === 'video',
	)

	const nextSlide = slides.value[nextSlideIndex]
	nextSlide?.elements?.forEach((element) => {
		if (element.type === 'image' && element.src) {
			prefetchAsset(element.src, 'image')
		} else if (element.type === 'video') {
			element.poster && prefetchAsset(element.poster, 'image')
			element.src && !currentHasVideo && warmVideo(element.src, nextSlideIndex)
		}
	})
	releaseVideoWarmers(nextSlideIndex)
}

// buffers the opening of the next slide's video under the url its element uses
const videoWarmers = new Map()

const warmVideo = (src, forSlideIndex) => {
	const warmer = videoWarmers.get(src)
	if (warmer) {
		// the same video on the next slide too keeps its warmer
		warmer.forSlideIndex = forSlideIndex
		return
	}
	const video = document.createElement('video')
	video.preload = 'auto'
	video.muted = true
	video.src = getAttachmentUrl(src)
	video.load()
	videoWarmers.set(src, { video, forSlideIndex })
}

// the current slide's rendered element does its own loading
const releaseVideoWarmers = (keepSlideIndex = null) => {
	for (const [src, { video, forSlideIndex }] of videoWarmers) {
		if (forSlideIndex === keepSlideIndex) continue
		video.removeAttribute('src')
		video.load()
		videoWarmers.delete(src)
	}
}

const prefetchAsset = async (src, type) => {
	if (prefetchedAssets.value.has(src)) return
	prefetchedAssets.value.add(src)

	try {
		if (type === 'image') {
			// Use link prefetch for images
			const link = document.createElement('link')
			link.rel = 'preload'
			link.href = getAttachmentUrl(src)
			link.as = 'image'
			document.head.appendChild(link)
		}
	} catch (error) {
		console.warn('Failed to prefetch asset:', src, error)
	}
}

const performPreviousStep = () => {
	const videoEl = document.querySelector('video')
	if (videoEl && videoEl.currentTime > 0) {
		videoEl.currentTime = 0
		videoEl.pause()
		return
	}
	changeSlideInSlideshow(slideIndex.value - 1)
}

const performNextStep = () => {
	const videoEls = document.querySelectorAll('video')

	for (const videoEl of videoEls) {
		if (videoEl && videoEl.currentTime == 0 && videoEl.paused) {
			videoEl.play()
			return
		}
	}
	changeSlideInSlideshow(slideIndex.value + 1)
}

const changeSlideInSlideshow = (index) => {
	if (index < 0) return
	if (index >= slides.value.length + 1) return endSlideShow()

	applyReverseTransition.value = index < slideIndex.value

	nextTick(() => {
		router.replace({
			name: 'slides-slideshow',
			params: router.currentRoute.value.params,
			query: { slide: index + 1 },
		})

		// Prefetch next slide assets after navigation
		setTimeout(() => {
			prefetchNextSlide()
		}, 100)
	})
}

export {
	inSlideShowMode,
	showSlideshowEndScreen,
	requestFullscreen,
	exitFullscreen,
	requestWakeLock,
	releaseWakeLock,
	releaseVideoWarmers,
	startSlideShow,
	endSlideShow,
	prefetchNextSlide,
	changeSlideInSlideshow,
	performNextStep,
	performPreviousStep,
}
