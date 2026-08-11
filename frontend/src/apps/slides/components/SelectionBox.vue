<template>
	<div v-if="activeElementIds.length && !inCropMode" data-selection-box :style="boxStyles">
		<SelectionControls
			v-if="showControls"
			:elementType="activeElement?.shapeType || activeElement?.type"
			:dimensions="selectionBounds"
			:style="{ pointerEvents: 'auto' }"
		/>

		<LockBadge v-if="isSelectionLocked" :rotation="selectionRotation" />
	</div>
</template>
<script setup>
import { computed } from 'vue'

import SelectionControls from '@/apps/slides/components/SelectionControls.vue'
import LockBadge from '@/apps/slides/components/LockBadge.vue'

import { slideBounds, selectionBounds } from '@/apps/slides/stores/slide'
import { interactionOffset } from '@/apps/slides/stores/interaction'
import { inCropMode } from '@/apps/slides/stores/imageCrop'
import { rotationDelta } from '@/apps/slides/stores/interaction'
import {
	activeElementIds,
	focusElementId,
	activeElement,
	cropSelectionToFitContent,
	isSelectionLocked,
} from '@/apps/slides/stores/element'
import { selectionColor, lockColor } from '@/apps/slides/utils/constants'

const props = defineProps({
	isDragging: {
		type: Boolean,
		default: false,
	},
})

const showControls = computed(() => {
	return (
		activeElementIds.value.length == 1 &&
		!focusElementId.value &&
		!props.isDragging &&
		!isSelectionLocked.value
	)
})

const outline = computed(() => {
	if (activeElementIds.value.length != 1) return 'none'

	// a locked line keeps its outline; without handles it would have no affordance left
	if (isSelectionLocked.value) return `${lockColor} dashed ${1.5 / slideBounds.scale}px`

	if (activeElement.value?.shapeType == 'line') return 'none'
	return `${selectionColor} solid ${1.5 / slideBounds.scale}px`
})

const isRotatable = computed(() => {
	return ['shape', 'image'].includes(activeElement.value?.type)
})

const selectionRotation = computed(() => {
	if (activeElementIds.value.length != 1 || !isRotatable.value) return 0
	return (activeElement.value.rotation || 0) + rotationDelta.value
})

const boxStyles = computed(() => {
	const offsetLeft = interactionOffset.left
	const offsetTop = interactionOffset.top

	// selectionBounds track the live position; rendering subtracts the
	// transient offset and reapplies it as a transform so moving the box
	// never triggers layout (matches SlideElement)
	const offsetTransform =
		offsetLeft || offsetTop ? `translate(${offsetLeft}px, ${offsetTop}px)` : ''
	const rotateTransform = selectionRotation.value ? `rotate(${selectionRotation.value}deg)` : ''

	return {
		position: 'absolute',
		backgroundColor: activeElementIds.value.length == 1 ? '' : `${selectionColor}25`,
		outline: outline.value,
		// straddle the edge instead of sitting outside it, so snap guides line up
		outlineOffset: `-${0.75 / slideBounds.scale}px`,
		width: `${selectionBounds.width}px`,
		height: `${selectionBounds.height}px`,
		left: `${selectionBounds.left - offsetLeft}px`,
		top: `${selectionBounds.top - offsetTop}px`,
		boxSizing: 'border-box',
		zIndex: 9999,
		pointerEvents: activeElementIds.value.length == 1 ? 'none' : 'auto',
		transform: [offsetTransform, rotateTransform].filter(Boolean).join(' '),
		transformOrigin: 'center center',
	}
})

const handleSelectionChange = (elementIds) => {
	if (!elementIds.length) return
	cropSelectionToFitContent(elementIds)
}

defineExpose({
	handleSelectionChange,
})
</script>
