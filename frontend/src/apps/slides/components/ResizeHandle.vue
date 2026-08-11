<template>
	<div :style="resizerStyles" @mousedown="$emit('startResize', $event)"></div>
</template>
<script setup>
import { computed } from 'vue'

import { slideBounds } from '@/apps/slides/stores/slide'
import { getHandleBaseStyles } from '@/apps/slides/utils/constants'

const props = defineProps({
	direction: {
		type: String,
		required: true,
	},
	currentResizer: {
		type: String,
		default: null,
	},
})

const emit = defineEmits(['startResize'])

const scaledPx = (value) => `${value / slideBounds.scale}px`

const EDGE_THICKNESS = 7
const EDGE_LENGTH = 18

const getWidthResizerStyles = () => {
	const resizer = props.direction

	const offset = `-${scaledPx(EDGE_THICKNESS / 2)}`
	return {
		...getHandleBaseStyles(slideBounds.scale),
		borderRadius: '9999px',
		cursor: 'ew-resize',
		left: resizer.includes('left') ? offset : 'auto',
		right: resizer.includes('right') ? offset : 'auto',
		top: `calc(50% - ${scaledPx(EDGE_LENGTH / 2)})`,
		width: scaledPx(EDGE_THICKNESS),
		height: scaledPx(EDGE_LENGTH),
	}
}

const getHeightResizerStyles = () => {
	const resizer = props.direction

	const offset = `-${scaledPx(EDGE_THICKNESS / 2)}`
	return {
		...getHandleBaseStyles(slideBounds.scale),
		borderRadius: '9999px',
		cursor: 'ns-resize',
		left: `calc(50% - ${scaledPx(EDGE_LENGTH / 2)})`,
		top: resizer.includes('top') ? offset : 'auto',
		bottom: resizer.includes('bottom') ? offset : 'auto',
		width: scaledPx(EDGE_LENGTH),
		height: scaledPx(EDGE_THICKNESS),
	}
}

const getDimensionResizerStyles = () => {
	const resizer = props.direction
	const cursorStyles = {
		'top-left': 'nwse-resize',
		'top-right': 'nesw-resize',
		'bottom-left': 'nesw-resize',
		'bottom-right': 'nwse-resize',
	}
	const size = props.currentResizer ? 11 : 9
	const offset = `-${scaledPx(size / 2)}`
	return {
		...getHandleBaseStyles(slideBounds.scale),
		borderRadius: '9999px',
		top: resizer.includes('top') ? offset : 'auto',
		bottom: resizer.includes('bottom') ? offset : 'auto',
		left: resizer.includes('left') ? offset : 'auto',
		right: resizer.includes('right') ? offset : 'auto',
		width: scaledPx(size),
		height: scaledPx(size),
		cursor: cursorStyles[resizer],
	}
}

const getLineResizerStyles = () => {
	const resizer = props.direction

	const size = props.currentResizer ? 11 : 9
	const offset = `-${scaledPx(size / 2)}`
	return {
		...getHandleBaseStyles(slideBounds.scale),
		borderRadius: '9999px',
		cursor: 'ew-resize',
		left: resizer === 'line-left' ? offset : 'auto',
		right: resizer === 'line-right' ? offset : 'auto',
		top: `calc(50% - ${scaledPx(size / 2)})`,
		width: scaledPx(size),
		height: scaledPx(size),
	}
}

const resizerStyles = computed(() => {
	switch (props.direction) {
		case 'text-left':
		case 'text-right':
		case 'left':
		case 'right':
			return getWidthResizerStyles()
		case 'top':
		case 'bottom':
			return getHeightResizerStyles()
		case 'top-left':
		case 'top-right':
		case 'bottom-left':
		case 'bottom-right':
			return getDimensionResizerStyles()
		case 'line-left':
		case 'line-right':
			return getLineResizerStyles()
		default:
			return {}
	}
})
</script>
