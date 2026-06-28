import { ref, computed, nextTick } from 'vue'
import {
	applyReverseTransition,
	isPublicPresentation,
	presentationDoc,
} from '@/apps/slides/stores/presentation'
import { focusedSlide, slideIndex, slides, setSlideIndex } from '@/apps/slides/stores/slide'

import { router } from '@/apps/slides/router'
import { session } from '@/boot/session'

const inSlideShowMode = ref(false)

const startSlideShow = () => {
	router.replace({
		name: 'slides-slideshow',
		params: router.currentRoute.value.params,
		query: { slide: slideIndex.value + 1 },
	})
}

const endSlideShow = () => {
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

const prefetchNextSlide = () => {
	const nextSlideIndex = slideIndex.value + 1
	if (nextSlideIndex >= slides.value.length) return

	const nextSlide = slides.value[nextSlideIndex]
	nextSlide?.elements?.forEach((element) => {
		if (element.type === 'image' && element.src) {
			prefetchAsset(element.src, 'image')
		} else if (element.type === 'video') {
			element.poster && prefetchAsset(element.poster, 'image')
		}
	})
}

const getAssetUrl = (url) => {
	const user = session.user?.sessionUser
	if (presentationDoc.value?.owner === user || user === 'Administrator') {
		return url
	}
	return `/api/method/suite.slides.api.file.get_media_file?src=${encodeURIComponent(url)}&public=${isPublicPresentation.value}`
}

const prefetchAsset = async (src, type) => {
	if (prefetchedAssets.value.has(src)) return
	prefetchedAssets.value.add(src)

	try {
		const url = buildAssetUrl(src, type)

		if (type === 'image') {
			// Use link prefetch for images
			const link = document.createElement('link')
			link.rel = 'preload'
			link.href = getAssetUrl(url)
			link.as = 'image'
			document.head.appendChild(link)
		}
	} catch (error) {
		console.warn('Failed to prefetch asset:', src, error)
	}
}

const buildAssetUrl = (src, type) => {
	if (src.startsWith('/private') || src.startsWith('/assets')) {
		return src
	}

	return `/private${src}`
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
	startSlideShow,
	endSlideShow,
	prefetchNextSlide,
	changeSlideInSlideshow,
	performNextStep,
	performPreviousStep,
}
