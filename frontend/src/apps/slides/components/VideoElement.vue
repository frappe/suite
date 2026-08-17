<template>
	<div v-if="mode == 'thumbnail'" class="h-full">
		<img
			v-if="thumbnailSrc"
			class="object-cover"
			:style="videoStyles"
			:src="getAttachmentUrl(thumbnailSrc)"
		/>
	</div>
	<div
		v-else
		class="h-full"
		:class="{ 'cursor-pointer': inViewerMode }"
		@click="handleVideoClick"
		@mouseenter="handleMouseEnter"
		@mousemove="revealControls"
		@mouseleave="handleMouseLeave"
	>
		<video
			ref="videoElement"
			:style="videoStyles"
			:autoplay="inSlideShowMode ? element.autoplay : false"
			:loop="element.loop"
			:playbackRate="element.playbackRate"
			@timeupdate="updateProgress"
			@loadedmetadata="updateDuration"
			@play="handlePlay"
			@pause="handlePause"
			@ended="handleEnded"
			preload="auto"
			:poster="getAttachmentUrl(element.poster)"
		>
			<source :src="getAttachmentUrl(element.src)" />
		</video>
		<div
			v-if="!inViewerMode"
			ref="overlay"
			class="overlay absolute left-0 top-0 size-full cursor-default overflow-hidden transition-opacity duration-500 ease-in-out"
			:style="editorOverlayStyles"
		>
			<template v-if="isActive">
				<div :class="toggleButtonClasses">
					<component
						size="16"
						:is="isPlaying ? Pause : Play"
						class="stroke-[1.5] ps-[0.5px] text-white"
					/>
				</div>
				<div ref="progressBar" :class="progressBarClasses" @click.stop="seekTimestamp">
					<div :class="getBarClasses('duration')"></div>
					<div :class="getBarClasses('current')" :style="{ width: `${progress}%` }"></div>
				</div>
			</template>
		</div>
		<div
			v-else
			class="pointer-events-none absolute left-0 top-0 size-full overflow-hidden"
			:style="{ borderRadius: `${element.borderRadius || 0}px` }"
		>
			<div v-if="persistControls && !isPlaying" :class="toggleButtonClasses">
				<Play size="16" class="stroke-[1.5] ps-[0.5px] text-white" />
			</div>
			<div
				ref="progressBar"
				:class="`${progressBarClasses} bg-black-overlay-300 transition-opacity duration-200 ease-in-out`"
				:style="progressBarStyles"
				@mouseenter="cancelHide"
				@click.stop="seekTimestamp"
			>
				<div :class="getBarClasses('duration')"></div>
				<div :class="getBarClasses('current')" :style="{ width: `${progress}%` }"></div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, computed, useTemplateRef, inject, onBeforeUnmount } from 'vue'

import { Play, Pause } from 'lucide-vue-next'

import { activeElementIds } from '@/apps/slides/stores/element'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'
import { useBoxShadow } from '@/apps/slides/composables/useShadow'
import { defaultBorderColor } from '@/apps/slides/utils/constants'

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
	transitionStyles: {
		type: Object,
		default: () => ({}),
	},
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const inSlideShowMode = inject('inSlideShowMode', ref(false))

const el = useTemplateRef('videoElement')
const overlay = useTemplateRef('overlay')

const toggleButtonClasses =
	'absolute inset-[calc(50%-16px)] flex size-8 cursor-pointer items-center justify-center rounded-6 bg-white-overlay-200 opacity-95'

const getBarClasses = (type) => {
	const commonClasses = 'bg-white-overlay-900 h-full absolute left-0 top-0'
	if (type == 'current') {
		return `${commonClasses} opacity-80 transition-width duration-100 ease-linear`
	}
	return `${commonClasses} opacity-30 w-full`
}

const progressBarClasses = computed(() => {
	const baseClasses = 'absolute w-full left-0 cursor-pointer h-2'
	return `${baseClasses} ${inViewerMode.value ? 'bottom-0' : 'bottom-[10px]'}`
})

const progressBarStyles = computed(() => ({
	opacity: controlsVisible.value ? 1 : 0,
	pointerEvents: controlsVisible.value ? 'auto' : 'none',
}))

const editorOverlayStyles = computed(() => ({
	background: `radial-gradient(circle at center, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.1) 5%, rgba(0, 0, 0, 0) 100%),
        linear-gradient(to top, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.1) 15%, rgba(0, 0, 0, 0) 100%)`,
	opacity: isActive.value ? 1 : 0,
	borderRadius: `${element.value.borderRadius}px`,
}))

const isPlaying = ref(false)
const hoverOver = ref(false)
const hoverRevealed = ref(false)

const boxShadow = useBoxShadow(element)

const videoStyles = computed(() => {
	return {
		width: '100%',
		// an explicit frame stays fixed, so the video must fit it, not overflow it
		height: element.value.height ? '100%' : 'auto',
		objectFit: 'cover',
		opacity: (element.value.opacity ?? 100) / 100,
		borderRadius: `${element.value.borderRadius}px`,
		borderStyle: element.value.borderStyle || 'none',
		borderColor: element.value.borderColor || defaultBorderColor,
		borderWidth: `${element.value.borderWidth}px`,
		boxShadow: boxShadow.value,
		transform: `scale(${element.value.invertX || 1}, ${element.value.invertY || 1})`,
		...props.transitionStyles,
	}
})

const thumbnailSrc = computed(() => {
	if (props.mode != 'thumbnail') return ''
	return element.value.poster || ''
})

const isActive = computed(() => activeElementIds.value.includes(element.value.id))

const inViewerMode = computed(() => inReadonlyMode.value || inSlideShowMode.value)

const isPlayable = computed(() => inViewerMode.value || isActive.value)

// the shared view has no other play affordance
const persistControls = computed(() => inReadonlyMode.value && !inSlideShowMode.value)

const controlsVisible = computed(() => {
	if (!inViewerMode.value) return false
	if (!persistControls.value) return !isPlaying.value && hoverRevealed.value
	return !isPlaying.value || hoverRevealed.value
})

const controlsHideDelay = 1000
let hideTimeout = null

const revealControls = () => {
	clearTimeout(hideTimeout)
	if (!inViewerMode.value) return
	if (isPlaying.value && !persistControls.value) return
	hoverRevealed.value = true
	hideTimeout = setTimeout(() => (hoverRevealed.value = false), controlsHideDelay)
}

const cancelHide = () => clearTimeout(hideTimeout)

const hideControls = () => {
	clearTimeout(hideTimeout)
	hoverRevealed.value = false
}

onBeforeUnmount(() => clearTimeout(hideTimeout))

const togglePlaying = () => {
	const video = el.value
	if (video.paused) {
		video.play()
	} else {
		video.pause()
	}
}

const handleVideoClick = (e) => {
	if (!isPlayable.value) return
	// in the editor only the play button toggles, the backdrop selects
	if (!inViewerMode.value && e.target === overlay.value) return
	e.stopPropagation()
	togglePlaying()
}

const duration = ref(0)
const progress = ref(0)

const updateProgress = () => {
	const video = el.value
	if (!video || !duration.value) return
	progress.value = Math.round((video.currentTime / duration.value) * 100)
}

const updateDuration = () => {
	const video = el.value
	if (!video || !video.duration) return
	duration.value = video.duration
}

const progressBarRef = useTemplateRef('progressBar')

const seekTimestamp = (e) => {
	const progressBarRect = progressBarRef.value.getBoundingClientRect()
	const percentage = (e.clientX - progressBarRect.left) / progressBarRect.width
	const seekTo = Number(percentage.toFixed(2)) * duration.value
	const video = el.value
	video.currentTime = seekTo
}

const handlePlay = () => {
	isPlaying.value = true
	hideControls()
}

const handlePause = () => {
	isPlaying.value = false
	if (hoverOver.value) revealControls()
}

const handleEnded = () => {
	progress.value = 0
	handlePause()
}

const handleMouseEnter = () => {
	hoverOver.value = true
	revealControls()
}

const handleMouseLeave = () => {
	hoverOver.value = false
	hideControls()
}
</script>
