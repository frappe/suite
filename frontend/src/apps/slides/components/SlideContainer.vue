<template>
	<div ref="slideContainer" class="flex size-full" @dragenter="showOverlay">
		<!-- when mounting place slide directly in the center of the visible container -->
		<!-- 1/2 width of viewport + 1/2 width of offset caused due to thinner navigation panel -->
		<div ref="slideRef" :style="slideStyles" :class="slideClasses" @contextmenu.prevent>
			<SelectionBox
				ref="selectionBox"
				v-if="!inReadonlyMode"
				:isDragging
				:elementOffset
				@mousedown="(e) => handleMouseDown(e)"
			/>

			<MarqueeOverlay v-if="!inReadonlyMode" @setIsSelecting="(val) => (isSelecting = val)" />

			<ShapeDrawOverlay v-if="!inReadonlyMode" />

			<SnapGuides :ongoingInteraction="hasOngoingInteraction" :activeGuides="activeGuides" />

			<SlideElement
				v-for="element in currentSlide?.elements"
				:key="`editor-${element.id}`"
				:ref="(comp) => registerElementDiv(element.id, comp?.$el)"
				mode="editor"
				:element
				:elementOffset
				:data-index="element.id"
				:highlight="highlightElement(element)"
				@mousedown="(e) => handleMouseDown(e, element)"
			/>
		</div>
		<DropTargetOverlay v-show="mediaDragOver" @hideOverlay="hideOverlay" />
		<OverflowContentOverlay />
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
	reactive,
	onActivated,
	onDeactivated,
	inject,
} from 'vue'
import { useResizeObserver } from '@vueuse/core'

import SnapGuides from '@/apps/slides/components/SnapGuides.vue'
import SelectionBox from '@/apps/slides/components/SelectionBox.vue'
import MarqueeOverlay from '@/apps/slides/components/MarqueeOverlay.vue'
import ShapeDrawOverlay from '@/apps/slides/components/ShapeDrawOverlay.vue'
import SlideElement from '@/apps/slides/components/SlideElement.vue'
import DropTargetOverlay from '@/apps/slides/components/DropTargetOverlay.vue'
import OverflowContentOverlay from '@/apps/slides/components/OverflowContentOverlay.vue'

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
	setEditableState,
	duplicateElements,
	activeElements,
	cropSelectionToFitContent,
} from '@/apps/slides/stores/element'

import { commandHistory } from '@/apps/slides/stores/historyMeta'

import { handleCopy, handlePaste } from '@/apps/slides/stores/copyPaste'

import { registerElementDiv, getElementDiv } from '@/apps/slides/stores/elementRegistry'

import { useDragAndDrop } from '@/apps/slides/composables/useDragAndDrop'
import { useResizer } from '@/apps/slides/composables/useResizer'
import { useRotator } from '@/apps/slides/composables/useRotator'
import { usePanAndZoom } from '@/apps/slides/composables/usePanAndZoom'
import { useSnapping } from '@/apps/slides/composables/useSnapping'
import { editElementCommand, batchCommand } from '@/apps/slides/stores/commands'

import { isCmdOrCtrl } from '@/apps/slides/utils/helpers'
import {
	getResizedBox,
	getResizedLine,
	getResizedTextBox,
	getRotatedBoundingBox,
	getMinSizeForElement,
	isAspectLocked,
} from '@/apps/slides/utils/resize'

const props = defineProps({
	highlight: Boolean,
})

const emit = defineEmits(['update:hasOngoingInteraction'])

const inReadonlyMode = inject('inReadonlyMode', ref(false))

const slideContainerRef = useTemplateRef('slideContainer')
const slideRef = useTemplateRef('slideRef')
const selectionBoxRef = useTemplateRef('selectionBox')

const { isDragging, positionDelta, startDragging } = useDragAndDrop()

const { isResizing, pointerDelta, currentResizer, resizeCursor, startResize } = useResizer()

const { isRotating, rotationDelta, startRotate, resetRotation } = useRotator()

const hasOngoingInteraction = computed(
	() => isDragging.value || isResizing.value || isRotating.value,
)

const { activeGuides, snapForDrag, snapForResize } = useSnapping(
	selectionBoxRef,
	currentResizer,
	hasOngoingInteraction,
)

const { allowPanAndZoom, transform, transformOrigin } = usePanAndZoom(slideContainerRef, slideRef)

const slideClasses = computed(() => {
	const classes = ['absolute', 'h-[540px]', 'w-[960px]', 'shadow-2xl', 'shadow-gray-400']

	const outlineClasses =
		props.highlight || mediaDragOver.value ? ['outline', 'outline-2', 'outline-blue-400'] : []

	const positionClasses = inReadonlyMode.value
		? ['left-[calc(50%-384.5px)]', 'top-[calc(50%-270px)]']
		: ['left-[calc(50%-512px)]', 'top-[calc(50%-270px)]']

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
	if (id) {
		if (!activeElementIds.value.includes(id)) {
			if (isCmdOrCtrl(e) || e.shiftKey) {
				activeElementIds.value = [...activeElementIds.value, id]
			} else activeElementIds.value = [id]
			focusElementId.value = null
		} else if (activeElement.value?.type == 'text') {
			focusElementId.value = id

			setEditableState()
		}
	}
}

const handleMouseUp = (e, id) => {
	pairElementId.value = null

	if (!isDragging.value) triggerSelection(e, id)
}

const triggerDrag = (e, id) => {
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
	duplicateElements(e, activeElements.value, slideIndex.value, false).then(() => {
		watchForDragIntent(e, id)
	})
}

const handleMouseDown = (e, element) => {
	if (inReadonlyMode.value) return
	const id = element?.id

	e.stopPropagation()
	e.preventDefault()

	dragOccurred.value = false

	if (e.altKey || e.ctrlKey) return duplicateAndDrag(e, id)

	// start dragging once the pointer moves past a small threshold
	watchForDragIntent(e, id)

	// if mouseup happens before the threshold is crossed
	// then consider it a selection instead of dragging
	e.target.addEventListener('mouseup', () => handleMouseUp(e, id), { once: true })
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
		left: activeElement.value.left + elementOffset.left,
		top: activeElement.value.top + elementOffset.top,
	})
})

const togglePanZoom = () => {
	allowPanAndZoom.value = !allowPanAndZoom.value
}

const elementOffset = reactive({
	left: 0,
	top: 0,
	width: 0,
	height: 0,
})

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

	elementOffset.left = desired.left - dragStartBounds.left
	elementOffset.top = desired.top - dragStartBounds.top
	updateSelectionBounds({ left: desired.left, top: desired.top })
}

// the element's box + type when the resize began, captured synchronously like dragStartBounds
let resizeStartBounds = null

const startElementResize = (e, resizer) => {
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
	elementOffset.left = box.left - resizeStartBounds.left
	elementOffset.top = box.top - resizeStartBounds.top
	elementOffset.width = box.width - resizeStartBounds.width
	elementOffset.height = box.height - resizeStartBounds.height

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
	elementOffset.width = box.width - resizeStartBounds.width
	elementOffset.left = box.left - resizeStartBounds.left
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

defineExpose({
	togglePanZoom,
})

const getInteractionCommands = () => {
	const commands = []

	activeElementIds.value.forEach((id) => {
		const element = currentSlide.value.elements.find((el) => el.id === id)
		if (!element) return

		const createCommand = (property, oldValue, newValue) => {
			if (newValue == oldValue) return null
			return editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [id],
				property,
				oldValue,
				newValue,
			})
		}

		const offsetKeys = ['left', 'top', 'width', 'height']

		offsetKeys.forEach((key) => {
			if (elementOffset[key]) {
				const oldValue = element[key]
				const newValue = element[key] + elementOffset[key]

				const command = createCommand(key, oldValue, newValue)

				if (command) commands.push(command)
			}
		})

		if (rotationDelta.value && ['shape', 'image'].includes(element.type)) {
			const oldValue = element.rotation || 0
			const newValue = oldValue + rotationDelta.value
			const command = createCommand('rotation', oldValue, newValue)

			if (command) commands.push(command)
		}
	})

	return commands
}

const applyInteractionOffsets = () => {
	pairElementId.value = null
	requestAnimationFrame(() => {
		const commands = getInteractionCommands()

		commandHistory.execute(
			batchCommand({
				slideId: currentSlide.value.clientId,
				elementIds: activeElementIds.value,
				commands,
			}),
		)

		elementOffset.left = 0
		elementOffset.top = 0
		elementOffset.width = 0
		elementOffset.height = 0
		resetRotation()
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
