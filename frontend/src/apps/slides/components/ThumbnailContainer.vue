<template>
	<div :class="getThumbnailClasses()" :style="getThumbnailStyles(slide)">
		<SlidePreview :slide="slide" :scale="scale" />
		<div
			class="absolute inset-0 flex w-full justify-between p-2"
			:style="getGradientOverlayStyles(slide)"
		>
			<div class="text-[10px] font-medium">{{ slideNumber }}</div>
			<TransitionIcon v-if="slide.transition != 'None'" class="h-3 opacity-80" />
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue'

import { focusedSlide, slides } from '@/apps/slides/stores/slide'
import { presentationDoc } from '@/apps/slides/stores/presentation'
import { recentlyRestored } from '@/apps/slides/stores/historyMeta'

import SlidePreview from '@/apps/slides/components/SlidePreview.vue'
import TransitionIcon from '@/apps/slides/icons/TransitionIcon.vue'

import { isBackgroundColorDark } from '@/apps/slides/utils/color'
import { selectionColor } from '@/apps/slides/utils/constants'

const props = defineProps({
	slide: { type: Object, required: true },
	isActive: { type: Boolean, default: false },
	scale: { type: Number, default: 160 / 960 },
	height: { type: Number, default: 90 },
})

const getGradientOverlayStyles = (slide) => {
	const hasDarkBg = isBackgroundColorDark(slide.background)
	const textColor = hasDarkBg ? '#ffffff' : '#00000090'
	const background = hasDarkBg
		? 'linear-gradient(140deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0) 20%, rgba(0, 0, 0, 0) 100%)'
		: 'linear-gradient(140deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0) 20%, rgba(0, 0, 0, 0) 100%)'

	return {
		background,
		color: textColor,
	}
}

// a composite's slides keep the idx of the reference they came from, so the count
// restarts at every reference; number them by position instead
const slideNumber = computed(() =>
	presentationDoc.value?.is_composite ? slides.value.indexOf(props.slide) + 1 : props.slide.idx,
)

const isFocused = computed(() => focusedSlide.value == slides.value.indexOf(props.slide))
const usesSelectionRing = computed(() => (props.isActive && recentlyRestored.value) || isFocused.value)

const getThumbnailClasses = () => {
	const baseClasses = [
		'relative',
		'first:mt-0',
		'my-8',
		'cursor-pointer',
		'border',
		'border-outline-gray-1',
		'rounded-6',
		'transition-transform',
		'duration-400',
		'ease-in-out',
		'overflow-hidden',
		'select-none',
	]

	const isActive = props.isActive

	let outlineClasses = []
	if (isActive && recentlyRestored.value) {
		outlineClasses.push('ring-[3px]', 'scale-[1.02]')
	} else if (isFocused.value) {
		outlineClasses.push('ring-[3px]')
	} else if (isActive) {
		outlineClasses.push(
			'ring-[color:var(--surface-gray-8)] dark:ring-[color:var(--surface-gray-5)]',
			'ring-[3px]',
		)
	} else {
		outlineClasses.push('ring-transparent', 'hover:border-outline-gray-2')
	}

	return [...baseClasses, ...outlineClasses].join(' ')
}

const getThumbnailStyles = (s) => {
	return {
		backgroundColor: s.background || '#ffffff',
		height: `${props.height}px`,
		...(usesSelectionRing.value ? { '--tw-ring-color': `color-mix(in srgb, ${selectionColor} 60%, transparent)` } : {}),
	}
}
</script>
