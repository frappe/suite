<template>
	<div ref="slideContainer" class="flex size-full" @dragenter="showOverlay">
		<!-- when mounting place slide directly in the center of the visible container -->
		<!-- 1/2 width of viewport + 1/2 width of offset caused due to thinner navigation panel -->
		<div
			ref="slideRef"
			:style="slideStyles"
			:class="slideClasses"
			@contextmenu.capture="(e) => elementContextMenuRef?.handleContextMenu(e)"
		>
			<ElementContextMenu ref="elementContextMenu">
				<SelectionBox
					ref="selectionBox"
					v-if="!inReadonlyMode"
					:isDragging
					@mousedown="(e) => handleMouseDown(e)"
				/>

				<MarqueeOverlay v-if="!inReadonlyMode" @setIsSelecting="(val) => (isSelecting = val)" />

				<ShapeDrawOverlay v-if="!inReadonlyMode" />

				<CropOverlay v-if="!inReadonlyMode" />

				<SnapGuides :ongoingInteraction="hasOngoingInteraction" :activeGuides="activeGuides" />

				<SlideElement
					v-for="element in currentSlide?.elements"
					:key="`editor-${element.id}`"
					:ref="(comp) => registerElementDiv(element.id, comp?.$el)"
					mode="editor"
					:element
					:data-index="element.id"
					:highlight="highlightElement(element)"
					@mousedown="(e) => handleMouseDown(e, element)"
					@mouseenter="hoveredElementId = element.id"
					@mouseleave="hoveredElementId = null"
				/>
			</ElementContextMenu>

			<OverflowContentOverlay />
		</div>
		<DropTargetOverlay v-show="mediaDragOver" @hideOverlay="hideOverlay" />
	</div>
</template>

<script setup>
import {
	ref,
	computed,
	watch,
	useTemplateRef,
	nextTick,
	onMounted,
	onBeforeUnmount,
	provide,
	onActivated,
	onDeactivated,
	inject,
} from 'vue'
import { useResizeObserver } from '@vueuse/core'

import SnapGuides from '@/apps/slides/components/SnapGuides.vue'
import SelectionBox from '@/apps/slides/components/SelectionBox.vue'
import MarqueeOverlay from '@/apps/slides/components/MarqueeOverlay.vue'
import ShapeDrawOverlay from '@/apps/slides/components/ShapeDrawOverlay.vue'
import CropOverlay from '@/apps/slides/components/CropOverlay.vue'
import SlideElement from '@/apps/slides/components/SlideElement.vue'
import DropTargetOverlay from '@/apps/slides/components/DropTargetOverlay.vue'
import OverflowContentOverlay from '@/apps/slides/components/OverflowContentOverlay.vue'
import ElementContextMenu from '@/apps/slides/components/ElementContextMenu.vue'

import {
	currentSlide,
	slideBounds,
	selectionBounds,
	updateSelectionBounds,
	slideIndex,
} from '@/apps/slides/stores/slide'

import {
	activeElementIds,
	activeElement,
	focusElementId,
	pairElementId,
	dragOccurred,
	addFixedWidthToElement,
	ensureExplicitHeight,
	setEditableState,
	duplicateElements,
	activeElements,
	cropSelectionToFitContent,
	findSlideElement,
	isSelectionLocked,
} from '@/apps/slides/stores/element'

import { interactionOffset, commitInteraction } from '@/apps/slides/stores/interaction'

import { handleCopy, handlePaste } from '@/apps/slides/stores/copyPaste'

import { registerElementDiv, getElementDiv } from '@/apps/slides/stores/elementRegistry'

import { useDragAndDrop } from '@/apps/slides/composables/useDragAndDrop'
import { useResizer } from '@/apps/slides/composables/useResizer'
import { useRotator } from '@/apps/slides/composables/useRotator'
import { useCornerRadius } from '@/apps/slides/composables/useCornerRadius'
import { usePanAndZoom } from '@/apps/slides/composables/usePanAndZoom'
import { useSnapping } from '@/apps/slides/composables/useSnapping'
import { isCmdOrCtrl } from '@/apps/slides/utils/helpers'
import { selectionColor } from '@/apps/slides/utils/constants'
import {
	getResizedBox,
	getResizedLine,
	getResizedTextBox,
	getRotatedBoundingBox,
	getMinSizeForElement,
	isAspectLocked,
} from '@/apps/slides/utils/resize'

const emit = defineEmits(['update:hasOngoingInteraction'])

const inReadonlyMode = inject('inReadonlyMode', ref(false))

const slideContainerRef = useTemplateRef('slideContainer')
const slideRef = useTemplateRef('slideRef')
const selectionBoxRef = useTemplateRef('selectionBox')
const elementContextMenuRef = useTemplateRef('elementContextMenu')

const { isDragging, positionDelta, startDragging } = useDragAndDrop()

const { isResizing, pointerDelta, currentResizer, resizeCursor, startResize } = useResizer()

const { isRotating, rotationDelta, startRotate } = useRotator()

const { isRounding, maxRadius, startRound } = useCornerRadius()

const hoveredElementId = ref(null)
const isHovered = computed(() => hoveredElementId.value === activeElement.value?.id)
const setHovered = (id) => (hoveredElementId.value = id)

const hasOngoingInteraction = computed(
	() => isDragging.value || isResizing.value || isRotating.value,
)

const { activeGuides, snapForDrag, snapForResize } = useSnapping(
	selectionBoxRef,
	currentResizer,
	hasOngoingInteraction,
)

// Elements are stored in a fixed 960x540 coordinate space, so the slide keeps
// that authored size and is only scaled down to DISPLAY_WIDTH for display —
// shrinking the authored width instead would shift every existing element.
const SLIDE_WIDTH = 960
const DISPLAY_WIDTH = 900

const { allowPanAndZoom, transform, transformOrigin } = usePanAndZoom(
	slideContainerRef,
	slideRef,
	DISPLAY_WIDTH / SLIDE_WIDTH,
)

const slideClasses = computed(() => {
	const classes = [
		'absolute',
		'h-[540px]',
		'w-[960px]',
		'rounded',
		'border',
		'border-outline-gray-2',
		'shadow-sm',
	]

	const outlineClasses = mediaDragOver.value ? ['outline', 'outline-2'] : []

	// Offsets center the scaled slide (900x506.25), shifted for the side panels
	// (edit: nav + properties; readonly: nav only). Recompute if widths change.
	const positionClasses = inReadonlyMode.value
		? ['left-[calc(50%-354.5px)]', 'top-[calc(50%-253.125px)]']
		: ['left-[calc(50%-482px)]', 'top-[calc(50%-253.125px)]']

	return [...classes, outlineClasses, positionClasses]
})

const isSelecting = ref(false)

const getSlideCursor = () => {
	if (isDragging.value) return 'move'
	if (isSelecting.value) return 'crosshair'
	if (resizeCursor.value) return resizeCursor.value

	return 'default'
}

const highlightElement = (element) => {
	const toHighlight =
		activeElementIds.value.length > 1 && activeElementIds.value.includes(element.id)
	return toHighlight || pairElementId.value == element.id
}

const slideStyles = computed(() => ({
	transformOrigin: transformOrigin.value,
	transform: transform.value,
	backgroundColor: currentSlide.value?.background || '#ffffff',
	outlineColor: selectionColor,
	cursor: getSlideCursor(),
	zIndex: 0,
}))

const mediaDragOver = ref(false)

const showOverlay = (e) => {
	e.preventDefault()
	if (inReadonlyMode.value) return
	mediaDragOver.value = true
}

const hideOverlay = () => {
	mediaDragOver.value = false
}

const triggerSelection = (e, id) => {
	if (!id) return

	if (activeElementIds.value.includes(id)) {
		if (activeElement.value?.type == 'text' && !activeElement.value.locked) {
			focusElementId.value = id
			setEditableState()
		}
		return
	}

	if (isCmdOrCtrl(e) || e.shiftKey) {
		if (activeElementIds.value.length && !!findSlideElement(id)?.locked !== isSelectionLocked.value)
			return
		activeElementIds.value = [...activeElementIds.value, id]
	} else {
		activeElementIds.value = [id]
	}

	focusElementId.value = null
}

const handleMouseUp = (e, id) => {
	pairElementId.value = null

	if (!isDragging.value) triggerSelection(e, id)
}

const triggerDrag = (e, id) => {
	if (id ? findSlideElement(id)?.locked : isSelectionLocked.value) return

	const notEditable = id && focusElementId.value !== id
	const isMultiSelect = activeElementIds.value.length > 1
	const isNotInSelection = id && !activeElementIds.value.includes(id)

	// prevent drag if multiple are selected and id isn't in the selection
	if (isMultiSelect && isNotInSelection) return

	if (notEditable || isMultiSelect) {
		dragOccurred.value = true
		startDragging(e)

		if (id && !isMultiSelect && activeElementIds.value[0] !== id) {
			activeElementIds.value = [id]
			focusElementId.value = null

			// the selection watcher will crop async — too late for the drag
			// anchor below, so fit the bounds to this element now
			cropSelectionToFitContent([id])
		}

		// anchor synchronously: the drag math must never depend on watcher
		// flush order or on a previous gesture's state
		dragStartBounds = {
			left: selectionBounds.left,
			top: selectionBounds.top,
		}
	}
}

const DRAG_START_THRESHOLD = 4

const watchForDragIntent = (downEvent, id) => {
	const cancelDragIntent = () => {
		window.removeEventListener('mousemove', detectDrag)
		window.removeEventListener('mouseup', cancelDragIntent)
	}

	const detectDrag = (moveEvent) => {
		// button already released (e.g. mouseup outside the window)
		if (!moveEvent.buttons) return cancelDragIntent()

		const dx = moveEvent.clientX - downEvent.clientX
		const dy = moveEvent.clientY - downEvent.clientY
		if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) return

		cancelDragIntent()

		// pass the original mousedown event so the drag measures
		// from the press position and no movement is lost
		triggerDrag(downEvent, id)
	}

	window.addEventListener('mousemove', detectDrag)
	window.addEventListener('mouseup', cancelDragIntent)
}

const duplicateAndDrag = (e, id) => {
	if (isSelectionLocked.value) return

	duplicateElements(e, activeElements.value, slideIndex.value, false).then(() => {
		watchForDragIntent(e, id)
	})
}

const handleMouseDown = (e, element) => {
	if (inReadonlyMode.value || e.button == 2) return
	const id = element?.id

	e.stopPropagation()
	e.preventDefault()

	dragOccurred.value = false

	if (e.altKey) return duplicateAndDrag(e, id)

	// start dragging once the pointer moves past a small threshold
	watchForDragIntent(e, id)

	// if mouseup happens before the threshold is crossed
	// then consider it a selection instead of dragging
	window.addEventListener('mouseup', () => handleMouseUp(e, id), { once: true })
}

const scale = computed(() => {
	const matrix = transform.value?.match(/matrix\((.+)\)/)
	if (!matrix) return 1
	return parseFloat(matrix[1].split(', ')[0])
})

const activeDiv = computed(() => {
	if (activeElementIds.value.length != 1) return null
	return getElementDiv(activeElementIds.value[0])
})

useResizeObserver(activeDiv, (entries) => {
	if (!activeElement.value) return

	const entry = entries[0]
	const { width, height } = entry.contentRect

	// fires on any size change: resize gestures, and property updates like
	// font size / line height / letter spacing. every element type is
	// layout-anchored — left/top derive from element state, so no
	// forced-layout read is needed
	updateSelectionBounds({
		width: width,
		height: height,
		left: activeElement.value.left + interactionOffset.left,
		top: activeElement.value.top + interactionOffset.top,
	})
})

const togglePanZoom = () => {
	allowPanAndZoom.value = !allowPanAndZoom.value
}

// selection bounds at drag start — captured synchronously in triggerDrag
let dragStartBounds = null

const snapRotatedPosition = (target, rotation) => {
	const boundingBox = getRotatedBoundingBox(target, rotation)
	const snapped = snapForDrag(boundingBox)
	return {
		left: target.left + (snapped.left - boundingBox.left),
		top: target.top + (snapped.top - boundingBox.top),
	}
}

const handlePositionChange = (total) => {
	if (!dragStartBounds) return

	const target = {
		left: dragStartBounds.left + total.left / slideBounds.scale,
		top: dragStartBounds.top + total.top / slideBounds.scale,
		width: selectionBounds.width,
		height: selectionBounds.height,
	}
	const rotation = activeElement.value?.rotation
	const desired = rotation ? snapRotatedPosition(target, rotation) : snapForDrag(target)

	interactionOffset.left = desired.left - dragStartBounds.left
	interactionOffset.top = desired.top - dragStartBounds.top
	updateSelectionBounds({ left: desired.left, top: desired.top })
}

// the element's box + type when the resize began, captured synchronously like dragStartBounds
let resizeStartBounds = null

const startElementResize = (e, resizer) => {
	ensureExplicitHeight(activeElement.value)

	resizeStartBounds = {
		left: selectionBounds.left,
		top: selectionBounds.top,
		width: selectionBounds.width,
		height: selectionBounds.height,
		rotation: activeElement.value?.rotation || 0,
		type: activeElement.value?.type,
	}

	startResize(e, resizer)
}

const setOffsetFromBox = (box) => {
	interactionOffset.left = box.left - resizeStartBounds.left
	interactionOffset.top = box.top - resizeStartBounds.top
	interactionOffset.width = box.width - resizeStartBounds.width
	interactionOffset.height = box.height - resizeStartBounds.height

	updateSelectionBounds({ left: box.left, top: box.top, width: box.width, height: box.height })
}

const resizeBox = (cursorMovement) => {
	const box = getResizedBox(resizeStartBounds, currentResizer.value, cursorMovement)
	if (!box) return

	const axes = isAspectLocked(resizeStartBounds.type) ? ['x'] : ['x', 'y']
	// resize runs in the element's rotated local frame; the snap engine works on
	// screen-axis-aligned boxes, so snapping a rotated resize isn't supported yet
	const snappedBox = resizeStartBounds.rotation ? box : snapForResize(box, { axes })
	setOffsetFromBox(snappedBox)
}

const resizeLine = (cursorMovement) => {
	const box = getResizedLine(resizeStartBounds, currentResizer.value, cursorMovement)

	setOffsetFromBox(box)
	rotationDelta.value = box.rotation - resizeStartBounds.rotation
}

const setOffsetFromTextBox = (box) => {
	interactionOffset.width = box.width - resizeStartBounds.width
	interactionOffset.left = box.left - resizeStartBounds.left
}

const resizeText = (cursorMovement) => {
	if (!activeElement.value.width) addFixedWidthToElement()

	const box = getResizedTextBox(resizeStartBounds, currentResizer.value, cursorMovement)
	const snappedBox = snapForResize(box, { axes: ['x'] })

	const minWidth = getMinSizeForElement(resizeStartBounds.type).width
	if (snappedBox.width < minWidth) {
		if (currentResizer.value === 'text-left') {
			snappedBox.left = snappedBox.left + snappedBox.width - minWidth
		}
		snappedBox.width = minWidth
	}

	setOffsetFromTextBox(snappedBox)
}

const handleResize = () => {
	if (!resizeStartBounds) return

	const cursorMovement = {
		x: pointerDelta.value.x / slideBounds.scale,
		y: pointerDelta.value.y / slideBounds.scale,
	}
	const handle = currentResizer.value
	if (handle === 'text-left' || handle === 'text-right') return resizeText(cursorMovement)
	if (handle === 'line-left' || handle === 'line-right') return resizeLine(cursorMovement)
	resizeBox(cursorMovement)
}

const updateSlideBounds = () => {
	const slideRect = slideRef.value.getBoundingClientRect()

	slideBounds.width = slideRect.width
	slideBounds.height = slideRect.height
	slideBounds.left = slideRect.left
	slideBounds.top = slideRect.top
	slideBounds.scale = scale.value
}

const handleSlideTransform = () => {
	// wait for the new transform to render before updating dimensions
	nextTick(() => {
		updateSlideBounds()
	})
}

watch(
	() => activeElementIds.value,
	(newVal, oldVal) => {
		selectionBoxRef.value?.handleSelectionChange(newVal, oldVal)
	},
)

watch(
	() => transform.value,
	() => {
		if (!transform.value) return
		handleSlideTransform()
	},
)

watch(
	() => positionDelta.value,
	(total) => {
		handlePositionChange(total)
	},
)

watch(
	() => pointerDelta.value,
	() => handleResize(),
)

const initSlideAndListeners = () => {
	if (!slideRef.value) return

	updateSlideBounds()

	document.addEventListener('copy', handleCopy)
	document.addEventListener('paste', handlePaste)
	window.addEventListener('resize', updateSlideBounds)
}

const clearListeners = () => {
	document.removeEventListener('copy', handleCopy)
	document.removeEventListener('paste', handlePaste)
	window.removeEventListener('resize', updateSlideBounds)
}

onMounted(() => initSlideAndListeners())

onActivated(() => initSlideAndListeners())

onDeactivated(() => clearListeners())

onBeforeUnmount(() => clearListeners())

provide('slideDiv', slideRef)
provide('slideContainerDiv', slideContainerRef)
provide('resizer', {
	currentResizer,
	startResize: startElementResize,
})
provide('rotator', {
	startRotate,
})
provide('cornerRadius', {
	startRound,
	maxRadius,
	isRounding,
	isHovered,
	setHovered,
})

defineExpose({
	togglePanZoom,
})

const applyInteractionOffsets = () => {
	pairElementId.value = null
	requestAnimationFrame(() => {
		commitInteraction()
	})
}

watch(
	() => hasOngoingInteraction.value,
	(newVal, oldVal) => {
		if (oldVal && !newVal) applyInteractionOffsets()
		emit('update:hasOngoingInteraction', newVal)
	},
)
</script>
