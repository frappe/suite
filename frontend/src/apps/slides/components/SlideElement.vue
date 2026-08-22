<template>
	<div :style="elementStyle">
		<component
			:is="getDynamicComponent(element.type)"
			:key="getElementKey(element)"
			:element="element"
			:mode="mode"
			:transitionStyles="transitionStyles"
		/>
	</div>
</template>

<script setup>
import { computed } from 'vue'

import TextElement from '@/apps/slides/components/TextElement.vue'
import ImageElement from '@/apps/slides/components/ImageElement.vue'
import VideoElement from '@/apps/slides/components/VideoElement.vue'
import ShapeElement from '@/apps/slides/components/ShapeElement.vue'
import TableElement from '@/apps/slides/components/TableElement.vue'

import { activeElementIds } from '@/apps/slides/stores/element'

import { getTransitionKey } from '@/apps/slides/stores/transition'
import { slideBounds } from '@/apps/slides/stores/slide'
import { interactionOffset, followerGeometry, rotationDelta } from '@/apps/slides/stores/interaction'
import { selectionColor } from '@/apps/slides/utils/constants'

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
	highlight: {
		type: Boolean,
		default: false,
	},
	transitionStyles: {
		type: Object,
		default: () => ({}),
	},
})

const getElementKey = (element) => `${props.mode}-${getTransitionKey(element)}`

const isActive = computed(() => {
	return activeElementIds.value.includes(element.value.id)
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const follower = computed(() =>
	props.mode == 'editor' ? followerGeometry.value[element.value.id] : undefined,
)

const elementStyle = computed(() => {
	const isActiveInEditor = isActive.value && props.mode == 'editor' && !follower.value
	const offsetLeft = isActiveInEditor ? interactionOffset.left : 0
	const offsetTop = isActiveInEditor ? interactionOffset.top : 0
	const offsetWidth = isActiveInEditor ? interactionOffset.width : 0
	const offsetHeight = isActiveInEditor ? interactionOffset.height : 0
	const box = follower.value ?? element.value

	// a straight elbow route has a zero extent, which is a size, not a missing one
	let elementWidth = box.width
	if (elementWidth != null) {
		elementWidth = `${elementWidth + offsetWidth}px`
	} else {
		elementWidth = 'auto'
	}

	let elementHeight = box.height
	if (element.value.type == 'shape' && element.value.shapeType == 'line' && !box.points) {
		elementHeight = `${element.value.strokeWidth}px`
	} else if (elementHeight != null) {
		elementHeight = `${elementHeight + offsetHeight}px`
	} else {
		elementHeight = 'auto'
	}

	const elementRotation = box.rotation || 0

	// only the active editor element tracks the live rotation delta —
	// inactive elements never read it, so they don't re-render per frame
	const rotation =
		isActiveInEditor && isRotatable.value ? elementRotation + rotationDelta.value : elementRotation

	// the transient gesture offset rides on the transform (compositor-only,
	// no layout) while left/top hold the committed position; it must come
	// first so it shifts the element in slide axes, before rotation/centering
	const offsetTransform =
		offsetLeft || offsetTop ? `translate(${offsetLeft}px, ${offsetTop}px)` : ''

	const transform = [offsetTransform, getTransform(rotation)].filter(Boolean).join(' ')

	return {
		position: 'absolute',
		width: elementWidth,
		height: elementHeight,
		left: `${box.left}px`,
		top: `${box.top}px`,
		outline: props.highlight
			? `${selectionColor}92 ${element.value.locked ? 'dashed' : 'solid'} ${1.5 / slideBounds.scale}px`
			: 'none',
		outlineOffset: `-${0.75 / slideBounds.scale}px`,
		boxSizing: 'border-box',
		zIndex: element.value.zIndex,
		transform: transform,
		transformOrigin: getTransformOrigin(),
		minWidth: element.value.type == 'text' ? '2px' : '',
		// an elbow's box is mostly empty, so only its path takes the pointer
		pointerEvents: element.value.points ? 'none' : '',
	}
})

const isRotatable = computed(() => {
	return ['shape', 'image'].includes(element.value.type)
})

const getTransform = (rotation) => {
	if (element.value.type == 'text') {
		const t = element.value.transform
		return t && t !== 'none' ? t : ''
	}
	if (!isRotatable.value) return ''
	return `rotate(${rotation}deg)`
}

const getTransformOrigin = () => {
	if (element.value.type == 'text') return element.value.transformOrigin
	if (!isRotatable.value) return ''
	return 'center center'
}

const getDynamicComponent = (type) => {
	switch (type) {
		case 'image':
			return ImageElement
		case 'video':
			return VideoElement
		case 'shape':
			return ShapeElement
		case 'table':
			return TableElement
		default:
			return TextElement
	}
}
</script>
