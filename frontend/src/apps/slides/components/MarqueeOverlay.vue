<template>
	<div v-if="isDrawing" :style="marqueeStyles"></div>
</template>
<script setup>
import { computed, inject, onMounted, onBeforeUnmount } from 'vue'

import { currentSlide, slideBounds } from '@/apps/slides/stores/slide'
import {
	activeElementIds,
	setActiveElements,
	getElementPosition,
	resetFocus,
	isWithinOverlappingBounds,
	pendingShapeType,
} from '@/apps/slides/stores/element'
import { getElementDiv } from '@/apps/slides/stores/elementRegistry'
import { useDrawRect } from '@/apps/slides/composables/useDrawRect'
import { selectionColor } from '@/apps/slides/utils/constants'

const slideDiv = inject('slideDiv')
const slideContainerDiv = inject('slideContainerDiv')

const emit = defineEmits(['setIsSelecting'])

const SELECTION_START_THRESHOLD = 4

const { isDrawing, drawRect, startDrawing, cancelDrawing } = useDrawRect()

const marqueeStyles = computed(() => ({
	position: 'absolute',
	backgroundColor: `${selectionColor}25`,
	width: `${drawRect.width}px`,
	height: `${drawRect.height}px`,
	left: `${drawRect.left}px`,
	top: `${drawRect.top}px`,
	boxSizing: 'border-box',
	zIndex: 9999,
	pointerEvents: 'none',
}))

const getRotatedRectCorners = (center, halfWidth, halfHeight, rotation) => {
	const radians = (rotation * Math.PI) / 180
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	const cornerAt = (x, y) => ({
		x: center.x + x * cos - y * sin,
		y: center.y + x * sin + y * cos,
	})

	return [
		cornerAt(-halfWidth, -halfHeight),
		cornerAt(halfWidth, -halfHeight),
		cornerAt(halfWidth, halfHeight),
		cornerAt(-halfWidth, halfHeight),
	]
}

const getRectCorners = (bounds) => [
	{ x: bounds.left, y: bounds.top },
	{ x: bounds.right, y: bounds.top },
	{ x: bounds.right, y: bounds.bottom },
	{ x: bounds.left, y: bounds.bottom },
]

const getProjectedSpan = (corners, axis) => {
	const distances = corners.map((corner) => corner.x * axis.x + corner.y * axis.y)
	return { min: Math.min(...distances), max: Math.max(...distances) }
}

const spansOverlap = (a, b) => a.min <= b.max && b.min <= a.max

const rectsOverlap = (cornersA, cornersB, axes) =>
	axes.every((axis) =>
		spansOverlap(getProjectedSpan(cornersA, axis), getProjectedSpan(cornersB, axis)),
	)

// a rotated element's bounding box is mostly empty space, so test the marquee
// against the element's actual rotated rectangle instead.
const isRotatedElementWithinMarquee = (element, marqueeBounds) => {
	const div = getElementDiv(element.id)
	if (!div) return false

	// the rotated rect shares its centre with the axis-aligned bounding box
	const boundingBox = getElementPosition(element.id)
	const center = {
		x: (boundingBox.left + boundingBox.right) / 2,
		y: (boundingBox.top + boundingBox.bottom) / 2,
	}

	const elementCorners = getRotatedRectCorners(
		center,
		div.offsetWidth / 2,
		div.offsetHeight / 2,
		element.rotation,
	)
	const marqueeCorners = getRectCorners(marqueeBounds)

	// the marquee's edges run along x/y; the element's run along its rotated axes
	const radians = (element.rotation * Math.PI) / 180
	const elementAxis = { x: Math.cos(radians), y: Math.sin(radians) }
	const axes = [
		{ x: 1, y: 0 },
		{ x: 0, y: 1 },
		elementAxis,
		{ x: -elementAxis.y, y: elementAxis.x },
	]

	return rectsOverlap(elementCorners, marqueeCorners, axes)
}

// an elbow's box is mostly empty space too, so test its segments instead
const isElbowWithinMarquee = (element, marqueeBounds) => {
	const points = element.points.map((point) => ({
		x: element.left + point.x,
		y: element.top + point.y,
	}))
	return points.slice(1).some((point, i) => {
		const previous = points[i]
		return isWithinOverlappingBounds(marqueeBounds, {
			left: Math.min(previous.x, point.x),
			right: Math.max(previous.x, point.x),
			top: Math.min(previous.y, point.y),
			bottom: Math.max(previous.y, point.y),
		})
	})
}

const isElementWithinMarquee = (element, marqueeBounds) => {
	if (element.points) return isElbowWithinMarquee(element, marqueeBounds)
	if (element.rotation) return isRotatedElementWithinMarquee(element, marqueeBounds)
	return isWithinOverlappingBounds(marqueeBounds, getElementPosition(element.id))
}

const getElementsWithinMarquee = (rect) => {
	const marqueeBounds = {
		left: rect.left,
		top: rect.top,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
	}

	return currentSlide.value.elements
		.filter((element) => !element.locked)
		.filter((element) => isElementWithinMarquee(element, marqueeBounds))
		.map((element) => element.id)
}

const initSelection = (e) => {
	activeElementIds.value = []
	emit('setIsSelecting', true)
	startDrawing(e, (finalRect) => {
		emit('setIsSelecting', false)
		const selectedElements = getElementsWithinMarquee(finalRect)
		if (selectedElements.length) setActiveElements(selectedElements)
	})
}

let cancelSelectionIntent = null

const watchForSelectionIntent = (downEvent) => {
	const detectSelection = (moveEvent) => {
		// button already released (e.g. mouseup outside the window)
		if (!moveEvent.buttons) return cancelSelectionIntent?.()

		const dx = moveEvent.clientX - downEvent.clientX
		const dy = moveEvent.clientY - downEvent.clientY
		if (Math.hypot(dx, dy) < SELECTION_START_THRESHOLD) return

		cancelSelectionIntent?.()

		// anchor the marquee at the press position
		initSelection(downEvent)
	}

	const deselectOnRelease = (upEvent) => {
		cancelSelectionIntent?.()
		selectSlide(upEvent)
	}

	cancelSelectionIntent = () => {
		document.removeEventListener('mousemove', detectSelection)
		document.removeEventListener('mouseup', deselectOnRelease)
		cancelSelectionIntent = null
	}

	document.addEventListener('mousemove', detectSelection)
	document.addEventListener('mouseup', deselectOnRelease)
}

const handleMouseDown = (e) => {
	if (pendingShapeType.value) return
	const onBlankSurface =
		[slideDiv.value, slideContainerDiv.value].includes(e.target) ||
		e.target?.matches?.('[data-slide-surface]')
	if (!onBlankSurface) return

	watchForSelectionIntent(e)
}

const selectSlide = (e) => {
	e.preventDefault()
	e.stopPropagation()
	resetFocus()
}

onMounted(() => {
	document.addEventListener('mousedown', handleMouseDown)
})

onBeforeUnmount(() => {
	cancelSelectionIntent?.()
	document.removeEventListener('mousedown', handleMouseDown)
	cancelDrawing()
})
</script>
