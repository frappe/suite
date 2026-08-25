<template>
	<Select
		:modelValue="modelValue"
		variant="ghost"
		:options="options"
		class="-me-1"
		@update:modelValue="(value) => emit('update:modelValue', value)"
	>
		<template #trigger="{ selectedOption }">
			<span v-if="selectedOption?.value === 'none'" :class="noneLabelClasses">None</span>
			<ArrowheadPreview v-else :head="selectedOption?.value" :mirrored="mirrored" />
			<span :class="chevronClasses" />
		</template>
		<template #item-label="{ item }">
			<span v-if="item.value === 'none'" :class="noneLabelClasses">None</span>
			<ArrowheadPreview v-else :head="item.value" :mirrored="mirrored" />
		</template>
	</Select>
</template>

<script setup>
import { h } from 'vue'
import { Select } from 'frappe-ui'

import { chevronClasses } from '@/apps/slides/utils/constants'
import { MARKER_STYLES, getMarkerShape } from '@/apps/slides/utils/lineMarkers'

defineProps({
	modelValue: { type: String, default: 'none' },
	// start heads point the other way
	mirrored: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const options = MARKER_STYLES.map((value) => ({
	value,
	label: value.charAt(0).toUpperCase() + value.slice(1),
}))

const PREVIEW_WIDTH = 40
const PREVIEW_HEIGHT = 12
const PREVIEW_STROKE = 1.5

const ArrowheadPreview = ({ head, mirrored }) => {
	const shape = getMarkerShape(head, PREVIEW_STROKE)
	const y = PREVIEW_HEIGHT / 2
	const vertexX = PREVIEW_WIDTH - shape.inset
	return h(
		'svg',
		{
			width: PREVIEW_WIDTH,
			height: PREVIEW_HEIGHT,
			viewBox: `0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`,
			class: 'block text-ink-gray-7',
			style: mirrored ? 'transform: scaleX(-1)' : null,
		},
		[
			h('line', {
				x1: 0,
				x2: vertexX,
				y1: y,
				y2: y,
				stroke: 'currentColor',
				'stroke-width': PREVIEW_STROKE,
			}),
			h('path', {
				d: shape.d,
				transform: `translate(${vertexX}, ${y})`,
				fill: shape.filled ? 'currentColor' : 'none',
				stroke: shape.filled ? 'none' : 'currentColor',
				'stroke-width': PREVIEW_STROKE,
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round',
			}),
		],
	)
}

ArrowheadPreview.props = ['head', 'mirrored']

const noneLabelClasses = 'select-none font-text text-base text-ink-gray-7'
</script>
