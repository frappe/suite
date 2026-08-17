<template>
	<div :class="getThumbnailClasses()" :style="getThumbnailStyles(slide)">
		<SlidePreview :slide="slide" :scale="scale" />
		<div
			class="absolute inset-0 flex w-full justify-between rounded-1 p-2"
			:style="getGradientOverlayStyles(slide)"
		>
			<div class="text-[10px] font-medium">{{ slide.idx }}</div>
			<TransitionIcon v-if="slide.transition != 'None'" class="h-3 opacity-80" />
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue'

import { focusedSlide, slides } from '@/apps/slides/stores/slide'
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
		'rounded',
		'transition-transform',
		'duration-400',
		'ease-in-out',
		'overflow-hidden',
		'select-none',
	]

	const isActive = props.isActive

	let outlineClasses = []
	if (isActive && recentlyRestored.value) {
		outlineClasses.push('ring-2', 'ring-offset-2', 'scale-[1.02]')
	} else if (isFocused.value) {
		outlineClasses.push('ring-2', 'ring-offset-2')
	} else if (isActive) {
		outlineClasses.push(
			'ring-[color:var(--surface-gray-8)] dark:ring-[color:var(--surface-gray-9)]',
			'ring-2',
			'ring-offset-2',
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
		'--tw-ring-offset-color': 'var(--surface-base)',
		...(usesSelectionRing.value ? { '--tw-ring-color': selectionColor } : {}),
	}
}
</script>
