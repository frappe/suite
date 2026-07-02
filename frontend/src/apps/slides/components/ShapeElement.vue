<template>
	<div :style="wrapperStyles" @dblclick="handleDoubleClick">
		<svg :style="shapeStyles">
			<defs v-if="hasMarkers || shadow.hasShadow">
				<filter
					v-if="shadow.hasShadow"
					:id="shadowFilterId"
					filterUnits="userSpaceOnUse"
					x="-1000"
					y="-1000"
					width="3000"
					height="3000"
					color-interpolation-filters="sRGB"
				>
					<feDropShadow
						:dx="shadow.offsetX"
						:dy="shadow.offsetY"
						:stdDeviation="shadow.stdDeviation"
						:flood-color="shadow.color"
						:flood-opacity="shadow.opacity"
					/>
				</filter>

				<marker
					v-if="element.markerStart"
					:id="markerStartId"
					viewBox="0 0 10 10"
					markerWidth="6"
					markerHeight="6"
					refX="2"
					refY="5"
					orient="auto"
				>
					<path d="M10,0 L0,5 L10,10 Z" :fill="element.strokeColor" stroke="none" />
				</marker>
				<marker
					v-if="element.markerEnd"
					:id="markerEndId"
					viewBox="0 0 10 10"
					markerWidth="6"
					markerHeight="6"
					refX="8"
					refY="5"
					orient="auto"
				>
					<path d="M0,0 L10,5 L0,10 Z" :fill="element.strokeColor" stroke="none" />
				</marker>
			</defs>

			<rect
				v-if="element.shapeType == 'rectangle'"
				:x="element.strokeWidth / 2"
				:y="element.strokeWidth / 2"
				:width="`calc(100% - ${element.strokeWidth}px)`"
				:height="`calc(100% - ${element.strokeWidth}px)`"
				:fill="element.fillColor"
				:stroke="element.strokeColor"
				:stroke-width="`${element.strokeWidth}px`"
				:rx="element.borderRadius"
				:ry="element.borderRadius"
				:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
			/>

			<ellipse
				v-else-if="element.shapeType == 'oval'"
				cx="50%"
				cy="50%"
				:rx="'calc(50% - ' + element.strokeWidth / 2 + 'px)'"
				:ry="'calc(50% - ' + element.strokeWidth / 2 + 'px)'"
				:fill="element.fillColor"
				:stroke="element.strokeColor"
				:stroke-width="`${element.strokeWidth}px`"
				:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
			/>

			<polygon
				v-else-if="isPolygon"
				:points="polygonPoints"
				:fill="element.fillColor"
				:stroke="element.strokeColor"
				:stroke-width="`${element.strokeWidth}px`"
				:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
			/>

			<g v-else-if="element.shapeType == 'line'">
				<line
					v-if="element.strokeWidth < 10"
					:x1="0"
					:x2="'100%'"
					:y1="element.strokeWidth / 2"
					:y2="element.strokeWidth / 2"
					stroke="transparent"
					stroke-width="16"
				/>
				<line
					:x1="0"
					:x2="'100%'"
					:y1="element.strokeWidth / 2"
					:y2="element.strokeWidth / 2"
					:stroke="`${element.strokeColor}`"
					:stroke-width="`${element.strokeWidth}px`"
					:marker-start="element.markerStart ? `url(#${markerStartId})` : null"
					:marker-end="element.markerEnd ? `url(#${markerEndId})` : null"
					:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
				/>
			</g>
		</svg>

		<div
			v-if="canHaveText && (isEditable || hasText)"
			:style="textOverlayStyles"
			@mousedown.stop
		>
			<TextElement v-model:element="element" :embedded="true" :mode="mode" />
		</div>
	</div>
</template>

<script setup>
import { computed, inject, ref } from 'vue'

import TextElement from '@/apps/slides/components/TextElement.vue'
import { useSVGShadow } from '@/apps/slides/composables/useSVGShadow'
import { focusElementId, activeElementIds, dragOccurred } from '@/apps/slides/stores/element'

const props = defineProps({
	transitionStyles: {
		type: Object,
		default: () => ({}),
	},
	elementOffset: {
		type: Object,
		default: () => ({ left: 0, top: 0 }),
	},
	mode: {
		type: String,
		default: 'editor',
	},
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const inSlideShowMode = inject('inSlideShowMode', ref(false))

const wrapperStyles = {
	position: 'relative',
	width: '100%',
	height: '100%',
}

const isLine = computed(() => element.value?.shapeType === 'line')

const POLYGON_SIDES = { diamond: 4, triangle: 3, pentagon: 5 }
const isPolygon = computed(() => element.value?.shapeType in POLYGON_SIDES)

const polygonPoints = computed(() => {
	const sides = POLYGON_SIDES[element.value?.shapeType]
	if (!sides) return ''

	const offsetWidth = isActive.value ? (props.elementOffset.width ?? 0) : 0
	const offsetHeight = isActive.value ? (props.elementOffset.height ?? 0) : 0
	const width = (element.value?.width ?? 0) + offsetWidth
	const height = (element.value?.height ?? 0) + offsetHeight
	const strokeInset = (element.value?.strokeWidth ?? 0) / 2

	// Unit-circle vertices evenly spaced, starting from the top (-π/2)
	const unitVertices = Array.from({ length: sides }, (_, k) => {
		const angle = -Math.PI / 2 + (k * 2 * Math.PI) / sides
		return { x: Math.cos(angle), y: Math.sin(angle) }
	})

	const xMin = Math.min(...unitVertices.map((v) => v.x))
	const xMax = Math.max(...unitVertices.map((v) => v.x))
	const yMin = Math.min(...unitVertices.map((v) => v.y))
	const yMax = Math.max(...unitVertices.map((v) => v.y))

	const scaleX = (x) => strokeInset + ((x - xMin) / (xMax - xMin)) * (width - 2 * strokeInset)
	const scaleY = (y) => strokeInset + ((y - yMin) / (yMax - yMin)) * (height - 2 * strokeInset)

	return unitVertices
		.map((v) => `${scaleX(v.x)},${scaleY(v.y)}`)
		.join(' ')
})

const canHaveText = computed(() => !isLine.value)
const hasText = computed(() => !!element.value?.content)
const isActive = computed(() => activeElementIds.value.includes(element.value?.id))
const isEditable = computed(() => focusElementId.value === element.value?.id)

const TEXT_OVERLAY_BASE = {
	position: 'absolute',
	inset: '0',
	display: 'flex',
	flexDirection: 'column',
	justifyContent: 'center',
	overflow: 'hidden',
	padding: '8px',
	boxSizing: 'border-box',
}

const textOverlayStyles = computed(() => ({
	...TEXT_OVERLAY_BASE,
	pointerEvents: isEditable.value ? 'all' : 'none',
}))

const handleDoubleClick = (e) => {
	e.stopPropagation()
	// don't enter edit mode when the gesture was a drag
	if (dragOccurred.value) return
	if (inSlideShowMode.value || inReadonlyMode.value || !canHaveText.value || isEditable.value)
		return
	activeElementIds.value = [element.value.id]
	focusElementId.value = element.value.id
}

const hasMarkers = computed(
	() => isLine.value && !!(element.value?.markerStart || element.value?.markerEnd),
)

const markerStartId = computed(() => `line-marker-start-${element.value?.id || ''}`)
const markerEndId = computed(() => `line-marker-end-${element.value?.id || ''}`)

const shadowFilterId = computed(() => `shape-shadow-${element.value?.id || ''}`)
const shadow = useSVGShadow(element)

const shapeStyles = computed(() => {
	const styles = {
		width: '100%',
		height: '100%',
		opacity: (element.value?.opacity || 100) / 100,
		overflow: hasMarkers.value || shadow.value.hasShadow || isLine.value ? 'visible' : '',
	}
	return {
		...styles,
		...props.transitionStyles,
	}
})
</script>
