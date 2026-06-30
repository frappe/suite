<template>
	<div>
		<RotateHandle v-if="showRotateHandle" />

		<ResizeHandle
			v-for="resizeHandle in resizeHandles"
			v-show="resizeHandle.isVisible"
			:key="resizeHandle.direction"
			:direction="resizeHandle.direction"
			:currentResizer="currentResizer"
			@startResize="(e) => startResize(e, resizeHandle.direction)"
		/>

		<ResizeIndicator
			v-show="currentResizer"
			:type="elementType"
			:dimensions="dimensions"
			:indicatorStyles="indicatorStyles"
		/>
	</div>
</template>

<script setup>
import { computed, inject } from 'vue'

import ResizeHandle from '@/apps/slides/components/ResizeHandle.vue'
import RotateHandle from '@/apps/slides/components/RotateHandle.vue'
import ResizeIndicator from '@/apps/slides/components/ResizeIndicator.vue'

import { selectionBounds, slideBounds } from '@/apps/slides/stores/slide'

const props = defineProps({
	elementType: {
		type: String,
		required: true,
	},
	dimensions: {
		type: Object,
		default: {},
	},
})

const { currentResizer, startResize } = inject('resizer', {})

const showRotateHandle = computed(() => {
	return !['line', 'text', 'video'].includes(props.elementType)
})

const isResizeHandleVisible = (resizer) => {
	if (!currentResizer.value) return true
	return currentResizer.value === resizer
}

const resizeHandles = computed(() => {
	let directions = []
	if (['rectangle', 'oval'].includes(props.elementType)) {
		directions = [
			'left',
			'right',
			'top',
			'bottom',
			'top-left',
			'top-right',
			'bottom-left',
			'bottom-right',
		]
	} else if (['image', 'video'].includes(props.elementType)) {
		directions = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
	} else if (props.elementType === 'line') {
		directions = ['line-left', 'line-right']
	} else if (props.elementType === 'text') {
		directions = ['text-left', 'text-right']
	} else {
		directions = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
	}

	return directions.map((direction) => ({
		direction,
		isVisible: isResizeHandleVisible(direction),
	}))
})

const getScaledValue = (value) => `${value / slideBounds.scale}px`

const getTextIndicatorPosition = () => {
	const resizer = currentResizer.value
	const offsetX = `${20 / slideBounds.scale + selectionBounds.width}px`
	const offsetY = getScaledValue(12)

	return {
		left: resizer.includes('text-right') ? offsetX : 'auto',
		right: resizer.includes('text-left') ? offsetX : 'auto',
		top: `calc(50% - ${offsetY})`,
	}
}

const getLineIndicatorPosition = () => {
	const offset = getScaledValue(8)

	return {
		left: currentResizer.value === 'line-left' ? offset : 'auto',
		right: currentResizer.value === 'line-right' ? offset : 'auto',
		top: offset,
	}
}

const getMediaIndicatorPosition = () => {
	const resizer = currentResizer.value
	const offset = getScaledValue(8)
	const horizontal = resizer.includes('right') ? { right: offset } : { left: offset }
	const vertical = resizer.includes('bottom') ? { bottom: offset } : { top: offset }

	return { ...horizontal, ...vertical }
}

const getPositionStyles = () => {
	if (props.elementType === 'text') {
		return getTextIndicatorPosition()
	} else if (props.elementType === 'line') {
		return getLineIndicatorPosition()
	}
	return getMediaIndicatorPosition()
}

const indicatorStyles = computed(() => {
	if (!currentResizer.value) return {}

	const positionStyles = getPositionStyles()

	return {
		fontSize: getScaledValue(10),
		borderRadius: getScaledValue(6),
		padding: getScaledValue(4),
		...positionStyles,
	}
})
</script>
