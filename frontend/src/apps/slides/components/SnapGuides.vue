<template>
	<div v-for="(style, name) in guideStyles" :key="name" :style="style"></div>
</template>

<script setup>
import { computed } from 'vue'

import { slideBounds, selectionBounds, guideVisibilityMap } from '@/apps/slides/stores/slide'
import { pairElementId } from '@/apps/slides/stores/element'
import { getElementDiv } from '@/apps/slides/stores/elementRegistry'
import { guideColor } from '@/apps/slides/utils/constants'

const props = defineProps({
	// { x: { source, line } | null, y: { source, line } | null } from useSnapping
	activeGuides: {
		type: Object,
		default: () => ({ x: null, y: null }),
	},
	ongoingInteraction: {
		type: Boolean,
		default: false,
	},
})

const GUIDE_COLOR = `${guideColor}80`
const EDGE_GUIDE_COLOR = guideColor
const commonStyles = { position: 'absolute', zIndex: 9999 }

// a constant 1px on screen, like every other stroke on the canvas
const guideThickness = () => 1 / (slideBounds.scale || 1)

const getScaledValue = (value, axis) => {
	if (axis == 'X') return (value - slideBounds.left) / slideBounds.scale
	return (value - slideBounds.top) / slideBounds.scale
}

// paired element measured once per pairing (it can't move mid-gesture)
const pairedBounds = computed(() => {
	const div = getElementDiv(pairElementId.value)
	if (!div) return null

	const rect = div.getBoundingClientRect()
	const left = getScaledValue(rect.left, 'X')
	const top = getScaledValue(rect.top, 'Y')
	const right = getScaledValue(rect.right, 'X')
	const bottom = getScaledValue(rect.bottom, 'Y')

	return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
})

// the selection's edges in slide units
const selectionEdges = computed(() => ({
	left: selectionBounds.left,
	right: selectionBounds.left + selectionBounds.width,
	top: selectionBounds.top,
	bottom: selectionBounds.top + selectionBounds.height,
}))

// solid center line through the slide (drag-to-center snap, or hovering a control)
const getVerticalCenterStyle = () => {
	const snapped = props.ongoingInteraction && props.activeGuides?.x?.source === 'slide'
	if (!snapped && !guideVisibilityMap.centerY) return null

	const thickness = guideThickness()
	return {
		...commonStyles,
		backgroundColor: GUIDE_COLOR,
		width: `${thickness}px`,
		height: '100%',
		left: `calc(50% - ${thickness / 2}px)`,
		top: '0',
	}
}

const getHorizontalCenterStyle = () => {
	const snapped = props.ongoingInteraction && props.activeGuides?.y?.source === 'slide'
	if (!snapped && !guideVisibilityMap.centerX) return null

	const thickness = guideThickness()
	return {
		...commonStyles,
		backgroundColor: GUIDE_COLOR,
		width: '100%',
		height: `${thickness}px`,
		left: '0',
		top: `calc(50% - ${thickness / 2}px)`,
	}
}

// dashed line aligning the selection to a neighbour's edge/center; the line
// sits on the neighbour's feature and spans the union of both elements
const getVerticalElementStyle = () => {
	const guide = props.activeGuides?.x
	if (!props.ongoingInteraction || guide?.source !== 'element' || !pairedBounds.value) return null

	const neighbour = pairedBounds.value
	const selection = selectionEdges.value

	// the dashed line spans from the topmost to the bottommost of the two elements
	const top = Math.min(selection.top, neighbour.top)
	const bottom = Math.max(selection.bottom, neighbour.bottom)

	const thickness = guideThickness()
	return {
		...commonStyles,
		borderColor: GUIDE_COLOR,
		borderStyle: 'dashed',
		borderWidth: `0 0 0 ${thickness}px`,
		left: `${neighbour[guide.line] - thickness / 2}px`,
		top: `${top}px`,
		height: `${bottom - top}px`,
	}
}

const getHorizontalElementStyle = () => {
	const guide = props.activeGuides?.y
	if (!props.ongoingInteraction || guide?.source !== 'element' || !pairedBounds.value) return null

	const neighbour = pairedBounds.value
	const selection = selectionEdges.value

	// the dashed line spans from the leftmost to the rightmost of the two elements
	const left = Math.min(selection.left, neighbour.left)
	const right = Math.max(selection.right, neighbour.right)

	const thickness = guideThickness()
	return {
		...commonStyles,
		borderColor: GUIDE_COLOR,
		borderStyle: 'dashed',
		borderWidth: `${thickness}px 0 0 0`,
		top: `${neighbour[guide.line] - thickness / 2}px`,
		left: `${left}px`,
		width: `${right - left}px`,
	}
}

// slide-edge guides shown while hovering alignment controls
const getEdgeStyle = (direction) => {
	if (!guideVisibilityMap[direction]) return null

	const isVertical = ['leftEdge', 'rightEdge'].includes(direction)
	const thickness = `${2 / (slideBounds.scale || 1)}px`
	return {
		...commonStyles,
		backgroundColor: EDGE_GUIDE_COLOR,
		width: isVertical ? thickness : '100%',
		height: isVertical ? '100%' : thickness,
		left: direction == 'leftEdge' ? '0.2px' : direction == 'rightEdge' ? 'auto' : '0',
		right: direction == 'rightEdge' ? '0.2px' : 'auto',
		top: direction == 'topEdge' ? '0.2px' : direction == 'bottomEdge' ? 'auto' : '0',
		bottom: direction == 'bottomEdge' ? '0.2px' : 'auto',
	}
}

const guideStyles = computed(() => {
	const guides = {
		centerVertical: getVerticalCenterStyle(),
		centerHorizontal: getHorizontalCenterStyle(),
		elementVertical: getVerticalElementStyle(),
		elementHorizontal: getHorizontalElementStyle(),
		leftEdge: getEdgeStyle('leftEdge'),
		rightEdge: getEdgeStyle('rightEdge'),
		topEdge: getEdgeStyle('topEdge'),
		bottomEdge: getEdgeStyle('bottomEdge'),
	}

	// only keep visible guides so the v-for renders nothing when idle
	return Object.fromEntries(Object.entries(guides).filter(([, style]) => style))
})
</script>
