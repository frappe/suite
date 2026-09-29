import { ref, computed, nextTick } from 'vue'
import { applyReverseTransition } from '@/apps/slides/stores/presentation'
import {
	currentSlide,
	focusedSlide,
	slideIndex,
	slides,
	setSlideIndex,
} from '@/apps/slides/stores/slide'

import { router } from '@/apps/slides/router'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'

const inSlideShowMode = ref(false)

const onLoop = ref(false)

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
	if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
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

const startSlideShow = ({ loop = false, fromStart = false } = {}) => {
	onLoop.value = loop
	requestFullscreen()
	router.replace({
		name: 'slides-slideshow',
		params: router.currentRoute.value.params,
		// a loop plays the whole presentation every time round
		query: { slide: fromStart || loop ? 1 : slideIndex.value + 1 },
	})
}

const resetSlideShowState = () => {
	inSlideShowMode.value = false
	onLoop.value = false
}

const endSlideShow = () => {
	exitFullscreen()
	releaseWakeLock()
	releaseVideoWarmers()
	resetSlideShowState()
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

const prevSlide = computed(() => {
	if (slideIndex.value == 0) return null
	return slides.value[slideIndex.value - 1]
})

const isMagicMoveApplied = computed(() => {
	if (applyReverseTransition.value) return false

	return (
		currentSlide.value?.transition == 'Magic Move' ||
		prevSlide.value?.transition == 'Magic Move'
	)
})

// the delay starts once the slide has come in: a Magic Move is the previous
// slide's, the other transitions are the slide's own
const entranceSeconds = () => {
	if (isMagicMoveApplied.value) {
		const previous = prevSlide.value
		if (previous?.transition != 'Magic Move') return 0
		// unmatched elements fade in for 1s after the move and a 0.1s pause
		return (
			(parseFloat(previous.transitionDuration) || 0) + (previous.fadeUnmatchedElements ? 1.1 : 0)
		)
	}
	const { transition, transitionDuration } = currentSlide.value || {}
	if (!transition || transition == 'Magic Move') return 0
	return parseFloat(transitionDuration) || 0
}

// a slide with a delay stays that long after it is done playing: a video that
// ends is watched first, a looping one is background
let advanceTimer = null

// a video that ends early still waits out the entrance
let entranceEnds = 0

const scheduleAdvance = (hasEntrance = true) => {
	entranceEnds = Date.now() + (hasEntrance ? entranceSeconds() : 0) * 1000
	startWait()
}

const startWait = () => {
	cancelAdvance()
	const seconds = parseFloat(currentSlide.value?.advanceAfter)
	if (!(seconds > 0)) return
	const entranceLeft = Math.max(0, entranceEnds - Date.now())
	advanceTimer = setTimeout(advance, seconds * 1000 + entranceLeft)
	document.addEventListener('ended', restartWait, true)
	document.addEventListener('error', restartWait, true)
}

// a video that fails is done playing as much as one that ends; a looping one never held the slide
const restartWait = (event) => {
	if (event.target instanceof HTMLVideoElement && !event.target.loop) startWait()
}

const cancelAdvance = () => {
	clearTimeout(advanceTimer)
	document.removeEventListener('ended', restartWait, true)
	document.removeEventListener('error', restartWait, true)
}

// paused partway counts too: whoever paused it is still watching
const unfinishedVideo = () =>
	[...document.querySelectorAll('video')].find(
		(video) =>
			(!video.paused || video.currentTime > 0) && !video.ended && !video.loop && !video.error,
	)

// a looping video never ends, so starting one would only hold the slide longer
const unstartedVideo = () =>
	[...document.querySelectorAll('video')].find(
		(video) => video.currentTime == 0 && video.paused && !video.loop,
	)

const advance = () => {
	if (unfinishedVideo()) return
	const video = unstartedVideo()
	if (!video) return changeSlideInSlideshow(slideIndex.value + 1)
	// a video the timer starts is watched like the rest, then the wait starts over
	startWait()
	// one the browser refuses to play is skipped rather than waited on
	const index = slideIndex.value
	video.play().catch(() => {
		if (slideIndex.value == index) changeSlideInSlideshow(index + 1)
	})
}

// a single slide stays put, so nothing replays it on its own
const replaySlide = () => {
	for (const video of document.querySelectorAll('video')) {
		video.currentTime = 0
		if (video.autoplay) video.play().catch(() => {})
	}
	scheduleAdvance(false)
}

const changeSlideInSlideshow = (index) => {
	if (index < 0) return
	if (index >= slides.value.length + 1) return endSlideShow()

	applyReverseTransition.value = index < slideIndex.value

	if (onLoop.value && index >= slides.value.length) {
		index = 0
		applyReverseTransition.value = false
		if (slides.value.length == 1) return replaySlide()
	}

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
	resetSlideShowState,
	endSlideShow,
	prefetchNextSlide,
	changeSlideInSlideshow,
	performNextStep,
	performPreviousStep,
	scheduleAdvance,
	cancelAdvance,
	prevSlide,
	isMagicMoveApplied,
}
