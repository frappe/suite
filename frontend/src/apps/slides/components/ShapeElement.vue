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
					v-if="startMarker"
					:id="markerStartId"
					:markerWidth="markerSize"
					:markerHeight="markerSize"
					markerUnits="userSpaceOnUse"
					orient="auto-start-reverse"
					overflow="visible"
				>
					<path v-bind="markerPathAttrs(startMarker)" />
				</marker>
				<marker
					v-if="endMarker"
					:id="markerEndId"
					:markerWidth="markerSize"
					:markerHeight="markerSize"
					markerUnits="userSpaceOnUse"
					orient="auto"
					overflow="visible"
				>
					<path v-bind="markerPathAttrs(endMarker)" />
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
				:stroke-dasharray="strokeDashArray"
				:stroke-linecap="strokeLineCap"
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
				:stroke-dasharray="strokeDashArray"
				:stroke-linecap="strokeLineCap"
				:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
			/>

			<polygon
				v-else-if="isPolygon"
				:points="polygonPoints"
				:fill="element.fillColor"
				:stroke="element.strokeColor"
				:stroke-width="`${element.strokeWidth}px`"
				:stroke-dasharray="strokeDashArray"
				:stroke-linecap="strokeLineCap"
				:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
			/>

			<g v-else-if="elbowPath" pointer-events="auto">
				<path
					v-if="element.strokeWidth < 10"
					:d="elbowPath"
					fill="none"
					stroke="transparent"
					stroke-width="16"
				/>
				<path
					:d="elbowPath"
					fill="none"
					:stroke="`${element.strokeColor}`"
					:stroke-width="`${element.strokeWidth}px`"
					:stroke-dasharray="strokeDashArray"
					:stroke-linecap="strokeLineCap"
					stroke-linejoin="round"
					:marker-start="startMarker ? `url(#${markerStartId})` : null"
					:marker-end="endMarker ? `url(#${markerEndId})` : null"
					:filter="shadow.hasShadow ? `url(#${shadowFilterId})` : null"
				/>
			</g>

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
					:x1="lineSpan.x1"
					:x2="lineSpan.x2"
					:y1="element.strokeWidth / 2"
					:y2="element.strokeWidth / 2"
					:stroke="`${element.strokeColor}`"
					:stroke-width="`${element.strokeWidth}px`"
					:stroke-dasharray="strokeDashArray"
					:stroke-linecap="strokeLineCap"
					:marker-start="startMarker ? `url(#${markerStartId})` : null"
					:marker-end="endMarker ? `url(#${markerEndId})` : null"
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
import { getPolygonVertices, isPolygonShape } from '@/apps/slides/utils/shapeGeometry'
import { useSvgShadow } from '@/apps/slides/composables/useShadow'
import { focusElementId, activeElementIds, dragOccurred } from '@/apps/slides/stores/element'
import {
	interactionOffset,
	followerGeometry,
	pendingPoints,
} from '@/apps/slides/stores/interaction'
import { normalizeMarker, getMarkerShape, getMarkerSize } from '@/apps/slides/utils/lineMarkers'
import { getElbowPathData } from '@/apps/slides/utils/connectors'

const props = defineProps({
	transitionStyles: {
		type: Object,
		default: () => ({}),
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

const isPolygon = computed(() => isPolygonShape(element.value?.shapeType))

const polygonPoints = computed(() => {
	if (!isPolygon.value) return ''

	const isActiveInEditor = isActive.value && props.mode == 'editor'
	const offsetWidth = isActiveInEditor ? interactionOffset.width : 0
	const offsetHeight = isActiveInEditor ? interactionOffset.height : 0
	const width = (element.value?.width ?? 0) + offsetWidth
	const height = (element.value?.height ?? 0) + offsetHeight
	const strokeInset = (element.value?.strokeWidth ?? 0) / 2

	return getPolygonVertices(element.value.shapeType, width, height, strokeInset)
		.map((v) => `${v.x},${v.y}`)
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
	if (
		inSlideShowMode.value ||
		inReadonlyMode.value ||
		!canHaveText.value ||
		isEditable.value ||
		element.value.locked
	)
		return
	activeElementIds.value = [element.value.id]
	focusElementId.value = element.value.id
}

const startMarker = computed(() =>
	isLine.value ? getMarkerShape(normalizeMarker(element.value?.markerStart), element.value?.strokeWidth) : null,
)
const endMarker = computed(() =>
	isLine.value ? getMarkerShape(normalizeMarker(element.value?.markerEnd), element.value?.strokeWidth) : null,
)
const hasMarkers = computed(() => !!(startMarker.value || endMarker.value))

const markerSize = computed(() => getMarkerSize(element.value?.strokeWidth ?? 0))

const markerPathAttrs = (marker) => ({
	d: marker.d,
	fill: marker.filled ? element.value.strokeColor : 'none',
	stroke: marker.filled ? 'none' : element.value.strokeColor,
	'stroke-width': element.value.strokeWidth,
	'stroke-linecap': 'round',
	'stroke-linejoin': 'round',
})

const follower = computed(() =>
	props.mode == 'editor' ? followerGeometry.value[element.value?.id] : undefined,
)

// the stroke stops short of a head, but the two ends never cross
const lineSpan = computed(() => {
	const isActiveInEditor = isActive.value && props.mode == 'editor'
	const length =
		follower.value?.width ??
		(element.value?.width ?? 0) + (isActiveInEditor ? interactionOffset.width : 0)
	const startInset = Math.min(startMarker.value?.inset ?? 0, length / 2)
	const endInset = Math.min(endMarker.value?.inset ?? 0, length / 2)
	return { x1: startInset, x2: length - endInset }
})

// live points while following a target or being end-dragged, stored ones otherwise
const elbowPath = computed(() => {
	if (!isLine.value) return ''
	const isActiveInEditor = isActive.value && props.mode == 'editor'
	const points =
		follower.value?.points ??
		(isActiveInEditor ? pendingPoints.value : null) ??
		element.value?.points
	if (!points) return ''
	return getElbowPathData(points, startMarker.value?.inset ?? 0, endMarker.value?.inset ?? 0)
})

const markerStartId = computed(() => `line-marker-start-${element.value?.id || ''}`)
const markerEndId = computed(() => `line-marker-end-${element.value?.id || ''}`)

const shadowFilterId = computed(() => `shape-shadow-${element.value?.id || ''}`)
const shadow = useSvgShadow(element)

const strokeDashArray = computed(() => {
	const w = element.value?.strokeWidth || 0
	const style = element.value?.strokeStyle
	if (style === 'dashed') return `${w * 3} ${w * 2}`
	if (style === 'dotted') return `${w} ${w * 1.5}`
	return null
})

const strokeLineCap = computed(() => (element.value?.strokeStyle === 'dotted' ? 'round' : null))

const shapeStyles = computed(() => {
	const styles = {
		width: '100%',
		height: '100%',
		opacity: (element.value?.opacity ?? 100) / 100,
		overflow: hasMarkers.value || shadow.value.hasShadow || isLine.value ? 'visible' : '',
		transform: element.value?.points
			? ''
			: `scale(${element.value?.invertX || 1}, ${element.value?.invertY || 1})`,
	}
	return {
		...styles,
		...props.transitionStyles,
	}
})
</script>
