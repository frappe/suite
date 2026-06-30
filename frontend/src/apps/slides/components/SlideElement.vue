<template>
	<div :style="elementStyle">
		<component
			:is="getDynamicComponent(element.type)"
			:key="getElementKey(element)"
			:element="element"
			:mode="mode"
			:elementOffset="elementOffset"
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

import { activeElementIds } from '@/apps/slides/stores/element'

import { slideBounds } from '@/apps/slides/stores/slide'

import { rotationDelta } from '@/apps/slides/composables/useRotator'

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
	highlight: {
		type: Boolean,
		default: false,
	},
	elementOffset: {
		type: Object,
		default: () => ({ left: 0, top: 0 }),
	},
	transitionStyles: {
		type: Object,
		default: () => ({}),
	},
})

const getElementKey = (element) => {
	const id = element.refId || element.id
	return `${props.mode}-${id}`
}

const isActive = computed(() => {
	return activeElementIds.value.includes(element.value.id)
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const elementStyle = computed(() => {
	const offsetLeft = isActive.value ? props.elementOffset.left : 0
	const offsetTop = isActive.value ? props.elementOffset.top : 0
	const offsetWidth = isActive.value ? props.elementOffset.width : 0
	const offsetHeight = isActive.value ? props.elementOffset.height : 0

	let elementWidth = element.value.width
	if (elementWidth) {
		elementWidth = `${elementWidth + offsetWidth}px`
	} else {
		elementWidth = 'auto'
	}

	let elementHeight = element.value.height
	if (element.value.type == 'shape' && ['line'].includes(element.value.shapeType)) {
		elementHeight = `${element.value.strokeWidth}px`
	} else if (elementHeight) {
		elementHeight = `${elementHeight + offsetHeight}px`
	} else {
		elementHeight = 'auto'
	}

	const elementRotation = element.value.rotation || 0

	// only the active editor element tracks the live rotation delta —
	// inactive elements never read it, so they don't re-render per frame
	const rotation =
		isActive.value && isRotatable.value && props.mode == 'editor'
			? elementRotation + rotationDelta.value
			: elementRotation

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
		left: `${element.value.left}px`,
		top: `${element.value.top}px`,
		outline: props.highlight ? `#70B6F092 solid ${2 / slideBounds.scale}px` : 'none',
		boxSizing: 'border-box',
		zIndex: element.value.zIndex,
		transform: transform,
		transformOrigin: getTransformOrigin(),
		minWidth: element.value.type == 'text' ? '2px' : '',
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
		default:
			return TextElement
	}
}
</script>
