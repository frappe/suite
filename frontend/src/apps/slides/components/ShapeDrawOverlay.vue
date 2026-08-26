<template>
	<div
		v-if="pendingShapeType"
		:style="overlayStyles"
		@mousedown.prevent="handleMouseDown"
		@mousemove="handleMouseMove"
	/>

	<svg v-if="isDrawing && isLine" :style="linePreviewStyles">
		<polyline
			:points="previewPoints"
			fill="none"
			:stroke="`${selectionColor}92`"
			:stroke-width="2 / slideBounds.scale"
		/>
	</svg>
	<div v-else-if="isDrawing" :style="previewStyles" />
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'

import {
	pendingShapeType,
	pendingShapePreset,
	addShapeElement,
	getShapeDefaults,
} from '@/apps/slides/stores/element'
import { slideBounds } from '@/apps/slides/stores/slide'
import { bindPreview, getBindableAt, getTargetBox } from '@/apps/slides/stores/interaction'
import { useDrawRect } from '@/apps/slides/composables/useDrawRect'
import { selectionColor } from '@/apps/slides/utils/constants'
import { snapToNearest45 } from '@/apps/slides/utils/resize'
import {
	getConnectorEndpoints,
	getLineBox,
	routeConnector,
	snapToPort,
} from '@/apps/slides/utils/connectors'

const { isDrawing, isShiftLocked, drawRect, startPoint, endPoint, startDrawing, cancelDrawing } =
	useDrawRect()

const overlayStyles = {
	position: 'absolute',
	inset: '0',
	cursor: 'crosshair',
	zIndex: 10000,
}

const MIN_SIZE = 10
const PORT_SNAP_RADIUS = 14

const isConnector = computed(() => pendingShapeType.value === 'connector')
const isLine = computed(() => pendingShapeType.value === 'line' || isConnector.value)

const hoverBind = ref(null)
let startBind = null

const toSlideCoords = (e) => ({
	x: (e.clientX - slideBounds.left) / slideBounds.scale,
	y: (e.clientY - slideBounds.top) / slideBounds.scale,
})

// ⌘ bypasses binding; a drag never binds both ends to one element
const findBind = (e) => {
	if (e.metaKey || e.ctrlKey) return null
	const point = toSlideCoords(e)
	const target = getBindableAt(point, [startBind?.elementId])
	if (!target) return null
	const anchor = snapToPort(target.box, point, PORT_SNAP_RADIUS / slideBounds.scale) || 'auto'
	return { elementId: target.elementId, anchor }
}

const handleMouseMove = (e) => {
	if (isConnector.value) hoverBind.value = findBind(e)
}

watch(hoverBind, (bind) => {
	if (isConnector.value) bindPreview.value = bind
})

watch(pendingShapeType, (type) => {
	startBind = null
	hoverBind.value = null
	bindPreview.value = null
	if (!type) pendingShapePreset.value = {}
})

const routeDrawn = (start, end, strokeWidth) => {
	const route = pendingShapePreset.value.route ?? 'straight'
	const connector = { route, start: startBind, end: hoverBind.value }
	const boxFor = (bind) => bind && getTargetBox(bind.elementId)
	const line = { ...getLineBox(start, end, strokeWidth), strokeWidth, connector }
	const box = routeConnector(line, boxFor(connector.start), boxFor(connector.end))
	return { box, connector }
}

const activeEndPoint = computed(() =>
	isShiftLocked.value && isLine.value ? snapToNearest45(startPoint, endPoint) : endPoint,
)

const previewBorderRadius = computed(() => {
	if (pendingShapeType.value === 'oval') return '50%'
	return '0'
})

const PREVIEW_CLIP_PATHS = {
	diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
	triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
	pentagon: 'polygon(50% 0%, 100% 38%, 81% 100%, 19% 100%, 0% 38%)',
}

const previewClipPath = computed(() => PREVIEW_CLIP_PATHS[pendingShapeType.value] ?? null)

const previewPoints = computed(() => {
	let points = [startPoint, activeEndPoint.value]
	if (isConnector.value) {
		const { box } = routeDrawn(startPoint, activeEndPoint.value, 1)
		const { start, end } = getConnectorEndpoints({ ...box, strokeWidth: 1 })
		points = box.points
			? box.points.map((p) => ({ x: box.left + p.x, y: box.top + p.y }))
			: [start, end]
	}
	return points.map((p) => `${p.x},${p.y}`).join(' ')
})

const linePreviewStyles = {
	position: 'absolute',
	inset: '0',
	width: '100%',
	height: '100%',
	overflow: 'visible',
	zIndex: 10001,
	pointerEvents: 'none',
}

const previewStyles = computed(() => {
	const { left, top, width, height } = drawRect

	return {
		position: 'absolute',
		left: `${left}px`,
		top: `${top}px`,
		width: `${width}px`,
		height: `${height}px`,
		backgroundColor: `${selectionColor}25`,
		borderRadius: previewBorderRadius.value,
		clipPath: previewClipPath.value,
		boxSizing: 'border-box',
		zIndex: 10001,
		pointerEvents: 'none',
	}
})

const getLineBounds = (start, end) => ({ x1: start.x, y1: start.y, x2: end.x, y2: end.y })

const isLineLongEnough = (start, end) =>
	Math.hypot(end.x - start.x, end.y - start.y) >= MIN_SIZE

const isRectBigEnough = (rect) =>
	rect.width >= MIN_SIZE && rect.height >= MIN_SIZE

// a click (or a drag too small to mean anything) drops the default size centred on the cursor
const getDefaultBounds = (point) => {
	const { width, height } = getShapeDefaults(pendingShapeType.value)
	if (isLine.value) {
		return { x1: point.x - width / 2, y1: point.y, x2: point.x + width / 2, y2: point.y }
	}
	return { left: point.x - width / 2, top: point.y - height / 2, width, height }
}

// a click on a shape is not a connector; a drag between two shapes always is
const addConnector = (start, end) => {
	const { strokeWidth } = getShapeDefaults('connector')
	const { box, connector } = routeDrawn(start, end, strokeWidth)
	const isBound = connector.start && connector.end
	if (!isBound && !isLineLongEnough(start, end)) return
	const elbow = box.points ? { points: box.points, height: box.height } : {}
	addShapeElement('connector', box, { ...presetOverrides(), connector, ...elbow })
}

const presetOverrides = () => {
	const { route, ...overrides } = pendingShapePreset.value
	return overrides
}

const handleMouseDown = (e) => {
	startBind = null
	if (isConnector.value) startBind = findBind(e)
	hoverBind.value = null

	startDrawing(e, (rect, start, end) => {
		if (isShiftLocked.value && isLine.value) end = snapToNearest45(start, end)

		if (isConnector.value) {
			addConnector(start, end)
			pendingShapeType.value = null
			return
		}

		const drawnAsLine = isLine.value
		const isBigEnough = drawnAsLine ? isLineLongEnough(start, end) : isRectBigEnough(rect)
		const drawnBounds = drawnAsLine ? getLineBounds(start, end) : rect

		addShapeElement(
			pendingShapeType.value,
			isBigEnough ? drawnBounds : getDefaultBounds(start),
			presetOverrides(),
		)
		pendingShapeType.value = null
	})
}

const handleKeyDown = (e) => {
	if (e.key === 'Shift' && isDrawing.value) {
		isShiftLocked.value = true
	}
	if (e.key === 'Escape' && pendingShapeType.value) {
		cancelDrawing()
		pendingShapeType.value = null
	}
}

const handleKeyUp = (e) => {
	if (e.key === 'Shift') isShiftLocked.value = false
}

onMounted(() => {
	document.addEventListener('keydown', handleKeyDown)
	document.addEventListener('keyup', handleKeyUp)
})

onBeforeUnmount(() => {
	document.removeEventListener('keydown', handleKeyDown)
	document.removeEventListener('keyup', handleKeyUp)
	cancelDrawing()
})
</script>
