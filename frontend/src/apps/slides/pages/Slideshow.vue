<template>
	<div
		class="absolute left-0 top-0 h-full w-full overflow-clip bg-black"
		:class="{ 'slideshow-hide-cursor': cursorHidden }"
	>
		<div
			class="flex h-screen w-full items-center justify-center"
			:style="slideContainerStyles"
		>
			<div
				v-if="showSlideshowEndScreen"
				class="flex h-full w-full items-center justify-center bg-black"
				@click="endSlideShow()"
			>
				<SlideshowEndScreen @restartSlideShow="changeSlideInSlideshow(0)" />
			</div>

			<div
				v-else-if="isMagicMoveApplied"
				:style="slideStyles"
				@click="changeSlideInSlideshow(slideIndex + 1)"
			>
				<FadeElementTransition
					:duration="parseFloat(prevSlide?.transitionDuration)"
					:skip="!prevSlide?.fadeUnmatchedElements"
				>
					<SlideElement
						v-for="element in currentSlide?.elements"
						:key="`slideshow-${getElementKey(element)}`"
						mode="slideshow"
						:element="element"
						:data-index="element.id"
						:transitionStyles="transitionStyles"
						:style="getElementTransitionStyles(element)"
						class="forward-transition"
					/>
				</FadeElementTransition>
			</div>

			<div v-else>
				<Transition
					@before-enter="beforeSlideEnter"
					@enter="slideEnter"
					@before-leave="beforeSlideLeave"
					@leave="slideLeave"
				>
					<div
						:key="slideIndex"
						:style="slideStyles"
						@click="changeSlideInSlideshow(slideIndex + 1)"
					>
						<SlideElement
							v-for="element in currentSlide?.elements"
							:key="`slideshow-${getElementKey(element)}`"
							mode="slideshow"
							:element="element"
							:data-index="element.id"
						/>
					</div>
				</Transition>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, onActivated, onDeactivated, ref, watch, provide } from 'vue'
import { toast, useKeyboardShortcut, usePageMeta } from 'frappe-ui'

import SlideElement from '@/apps/slides/components/SlideElement.vue'
import SlideshowEndScreen from '@/apps/slides/components/SlideshowEndScreen.vue'
import FadeElementTransition from '@/apps/slides/components/FadeElementTransition.vue'

import {
	inSlideShowMode,
	showSlideshowEndScreen,
	requestFullscreen,
	exitFullscreen,
	requestWakeLock,
	releaseWakeLock,
	releaseVideoWarmers,
	endSlideShow,
	prefetchNextSlide,
	changeSlideInSlideshow,
	performNextStep,
	performPreviousStep,
} from '@/apps/slides/stores/slideshow'

import {
	applyReverseTransition,
	initPresentationDoc,
	inReadonlyMode,
	pageTitle,
} from '@/apps/slides/stores/presentation'
import { currentSlide, setSlideIndex, slideIndex, slides } from '@/apps/slides/stores/slide'
import { resetFocus } from '@/apps/slides/stores/element'
import { getTransitionKey } from '@/apps/slides/stores/transition'

const props = defineProps({
	presentationId: {
		type: String,
		required: true,
	},
	activeSlideId: {
		type: Number,
		required: true,
	},
})

const transition = ref('none')
const transform = ref('')
const opacity = ref(1)
const windowWidth = ref(window.innerWidth)
const windowHeight = ref(window.innerHeight)

const clipPath = computed(() => {
	if (!inSlideShowMode.value) return 'none'
	const slideHeight = 540 * (windowWidth.value / 960)
	const inset = Math.max(0, (windowHeight.value - slideHeight) / 2)
	return `inset(${inset}px 0px ${inset}px 0px)`
})

const getElementKey = (element) => getTransitionKey(element)

const cursorHidden = ref(true)

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

const slideStyles = computed(() => {
	// scale slide to fit screen width while maintaining 16:9 aspect ratio
	const widthScale = windowWidth.value / 960

	const baseStyles = {
		width: '960px',
		height: '540px',
		overflow: 'hidden',
		backgroundColor: currentSlide.value?.background || '#ffffff',
	}

	if (prevSlide.value?.transition == 'Magic Move') {
		return {
			...baseStyles,
			transform: `scale(${widthScale})`,
			opacity: 1,
			...transitionStyles.value,
		}
	}

	return {
		...baseStyles,
		transform: `${transform.value} scale(${widthScale})`,
		opacity: opacity.value,
		transition: transition.value,
	}
})

const getElementTransitionStyles = (element) => {
	const styles = transitionStyles.value

	// limit transition property in element container to dimensions and position only
	const transitionProperty = styles.transitionProperty == 'all' ? 'left, top, width, height' : ''

	return {
		...styles,
		transitionProperty: transitionProperty,
		'--transition-duration': styles.transitionDuration,
	}
}

const transitionStyles = computed(() => {
	if (applyReverseTransition.value) return {}

	const transitionProperty = prevSlide.value?.transition == 'Magic Move' ? 'all' : ''
	const transitionDuration = prevSlide.value?.transitionDuration

	return {
		transitionProperty: transitionProperty,
		transitionDuration: transitionDuration ? `${transitionDuration}s` : '0s',
		transitionTimingFunction: 'ease-in-out',
	}
})

const transitionMap = computed(() => {
	if (!currentSlide.value) return {}
	return {
		'Slide In': {
			beforeEnter: {
				transform: ['translateX(100%)', 'translateX(-100%)'],
				transition: 'none',
			},
			enter: {
				transform: 'translateX(0)',
				transition: `transform ${currentSlide.value.transitionDuration}s ease-out`,
			},
			beforeLeave: {
				transition: 'none',
			},
			leave: {
				transform: ['translateX(100%)', 'translateX(-100%)'],
				transition: `transform ${currentSlide.value.transitionDuration}s ease-out`,
			},
		},
		Fade: {
			beforeEnter: {
				opacity: 0,
			},
			enter: {
				transition: `opacity ${currentSlide.value.transitionDuration}s`,
			},
			beforeLeave: {},
			leave: {
				transition: `opacity ${currentSlide.value.transitionDuration}s`,
				opacity: 0,
			},
		},
	}
})

const applyTransitionStyles = (hook) => {
	const styles = transitionMap.value?.[currentSlide.value.transition]?.[hook]
	if (!styles) return

	let transformVal = styles.transform
	if (transformVal && Array.isArray(transformVal)) {
		transformVal = applyReverseTransition.value ? transformVal[1] : transformVal[0]
	}

	transform.value = transformVal || transform.value
	transition.value = styles.transition || transition.value
	opacity.value = styles.opacity
}

const beforeSlideEnter = (el) => {
	if (!currentSlide.value.transition) return
	applyTransitionStyles('beforeEnter')
}

const slideEnter = (el, done) => {
	if (!currentSlide.value.transition) return done()
	el.offsetWidth
	applyTransitionStyles('enter')
	done()
}

const beforeSlideLeave = (el) => {
	if (!currentSlide.value.transition) return
	applyTransitionStyles('beforeLeave')
}

const slideLeave = (el, done) => {
	if (!currentSlide.value.transition) return done()
	applyTransitionStyles('leave')
	done()
}

const CURSOR_IDLE_DELAY = 3000
let cursorTimer = null

const resetCursorVisibility = () => {
	cursorHidden.value = false
	clearTimeout(cursorTimer)
	cursorTimer = setTimeout(() => {
		cursorHidden.value = true
	}, CURSOR_IDLE_DELAY)
}

const stopCursorTracking = () => {
	clearTimeout(cursorTimer)
	document.removeEventListener('mousemove', resetCursorVisibility)
	cursorHidden.value = true
}

const handleFullScreenChange = () => {
	if (document.fullscreenElement) {
		inSlideShowMode.value = true
		requestWakeLock()
	} else {
		stopCursorTracking()
		if (inSlideShowMode.value) endSlideShow()
	}
}

// the lock is dropped when the tab is hidden
const handleVisibilityChange = () => {
	if (document.visibilityState === 'visible' && inSlideShowMode.value) requestWakeLock()
}

const slideContainerStyles = computed(() => {
	return {
		clipPath: clipPath.value,
		backgroundColor: currentSlide.value?.background || '#ffffff',
	}
})

const initFullscreenMode = async () => {
	// fullscreen is requested on the click that starts the slideshow, so the
	// change event fires before this component is around to hear it
	if (!document.fullscreenElement && !(await requestFullscreen())) {
		toast.error('Could not enter fullscreen mode')
		endSlideShow()
		return
	}

	handleFullScreenChange()
}

const loadPresentation = async () => {
	if (slides.value.length) return
	initPresentationDoc(props.presentationId)
}

const updateWindowSize = () => {
	windowWidth.value = window.innerWidth
	windowHeight.value = window.innerHeight
}

usePageMeta(() => ({ title: pageTitle() }))

onActivated(() => {
	document.title = pageTitle()
	resetFocus()
	loadPresentation()
	initFullscreenMode()
	document.addEventListener('fullscreenchange', handleFullScreenChange)
	document.addEventListener('visibilitychange', handleVisibilityChange)
	document.addEventListener('mousemove', resetCursorVisibility)
	window.addEventListener('resize', updateWindowSize)

	// Initial prefetch of next slide
	setTimeout(() => {
		prefetchNextSlide()
	}, 500)
})

onDeactivated(() => {
	document.removeEventListener('fullscreenchange', handleFullScreenChange)
	document.removeEventListener('visibilitychange', handleVisibilityChange)
	window.removeEventListener('resize', updateWindowSize)
	stopCursorTracking()
	releaseWakeLock()
	releaseVideoWarmers()

	// leaving by any route other than endSlideShow would strand the editor in fullscreen
	if (inSlideShowMode.value) {
		inSlideShowMode.value = false
		exitFullscreen()
	}
})

watch(
	() => props.activeSlideId,
	(index) => {
		setSlideIndex(index)
		// Prefetch next slide when current slide changes
		setTimeout(() => {
			prefetchNextSlide()
		}, 200)
	},
	{ immediate: true },
)

provide('inReadonlyMode', inReadonlyMode)
provide('inSlideShowMode', inSlideShowMode)

useKeyboardShortcut([
	{ combo: 'ArrowRight', description: 'Next step', group: 'Slideshow', handler: performNextStep },
	{ combo: 'ArrowDown', description: 'Next step', group: 'Slideshow', handler: performNextStep },
	{ combo: 'Space', description: 'Next step', group: 'Slideshow', handler: performNextStep },
	{ combo: 'PageDown', description: 'Next step', group: 'Slideshow', handler: performNextStep },
	{ combo: 'ArrowLeft', description: 'Previous step', group: 'Slideshow', handler: performPreviousStep },
	{ combo: 'ArrowUp', description: 'Previous step', group: 'Slideshow', handler: performPreviousStep },
	{ combo: 'PageUp', description: 'Previous step', group: 'Slideshow', handler: performPreviousStep },
	{ combo: 'F5', description: 'Restart', group: 'Slideshow', handler: () => changeSlideInSlideshow(0) },
])
</script>

<style>
/* has to beat the cursor elements set on themselves */
.slideshow-hide-cursor,
.slideshow-hide-cursor * {
	cursor: none !important;
}

.forward-transition .textElement span {
	transition-property: all;
	transition-duration: var(--transition-duration);
	transition-timing-function: ease-in-out;
}
</style>
