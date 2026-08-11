<template>
	<ContextMenu :options="contextMenuOptions">
		<!-- the trigger has to cover the slide, or a blank-canvas right-click never reaches it -->
		<div data-slide-surface class="absolute inset-0">
			<slot />
		</div>
	</ContextMenu>
</template>

<script setup>
import { ref, inject } from 'vue'
import { ContextMenu } from 'frappe-ui'

import {
	activeElements,
	focusElementId,
	setActiveElements,
	selectAllElements,
	resetFocus,
	duplicateElements,
	deleteElements,
	flipElements,
	isSelectionLocked,
	hasLockedElements,
	hasUnlockedElements,
	toggleLock,
	lockAll,
	unlockAll,
} from '@/apps/slides/stores/element'

import { alignElement, arrangeElements } from '@/apps/slides/stores/placement'
import { inCropMode, startCrop } from '@/apps/slides/stores/imageCrop'
import { currentSlide, slideIndex } from '@/apps/slides/stores/slide'
import { buildSlideContextOptions } from '@/apps/slides/utils/slideMenu'

import BringToFront from '@/apps/slides/icons/BringToFront.vue'
import SendToBack from '@/apps/slides/icons/SendToBack.vue'
import Forward from '@/apps/slides/icons/Forward.vue'
import Backward from '@/apps/slides/icons/Backward.vue'
import AlignLeft from '@/apps/slides/icons/AlignLeft.vue'
import AlignCenter from '@/apps/slides/icons/AlignCenter.vue'
import AlignRight from '@/apps/slides/icons/AlignRight.vue'
import AlignTop from '@/apps/slides/icons/AlignTop.vue'
import AlignCenterVertical from '@/apps/slides/icons/AlignCenterVertical.vue'
import AlignBottom from '@/apps/slides/icons/AlignBottom.vue'
import FlipHorizontal from '@/apps/slides/icons/FlipHorizontal.vue'
import FlipVertical from '@/apps/slides/icons/FlipVertical.vue'

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const openLayoutDialog = inject('openLayoutDialog', () => {})

const contextMenuOptions = ref([])

// the underlying trigger opens the menu unless the event is defaultPrevented
const handleContextMenu = (e) => {
	if (e.target?.isContentEditable) return e.stopPropagation()

	if (inReadonlyMode.value || inCropMode.value) return e.preventDefault()

	const elementNode = e.target?.closest?.('[data-index]')
	if (elementNode) {
		const element = currentSlide.value?.elements.find(
			(el) => String(el.id) === elementNode.dataset.index,
		)
		if (!element || focusElementId.value == element.id) return e.preventDefault()
		setActiveElements([element.id])
		contextMenuOptions.value = buildElementContextOptions()
	} else if (e.target?.closest?.('[data-selection-box]')) {
		contextMenuOptions.value = buildElementContextOptions()
	} else {
		resetFocus()
		contextMenuOptions.value = buildBlankSlideOptions()
	}
}

const buildBlankSlideOptions = () => {
	const slideOptions = [
		{ label: 'Select all', icon: 'lucide-box-select', onClick: () => selectAllElements() },
		{
			label: 'Lock all',
			icon: 'lucide-lock',
			condition: () => hasUnlockedElements.value,
			onClick: () => lockAll(),
		},
		{
			label: 'Unlock all',
			icon: 'lucide-lock-open',
			condition: () => hasLockedElements.value,
			onClick: () => unlockAll(),
		},
	]

	return [
		{ group: '', options: slideOptions },
		{
			group: '',
			options: buildSlideContextOptions({ index: slideIndex.value, openLayoutDialog }),
		},
	]
}

const buildElementContextOptions = () => {
	const canCrop = activeElements.value.length == 1 && activeElements.value[0].type == 'image'

	const orderOptions = [
		{ label: 'Bring to front', icon: BringToFront, onClick: () => arrangeElements('front') },
		{ label: 'Bring forward', icon: Forward, onClick: () => arrangeElements('forward') },
		{ label: 'Send backward', icon: Backward, onClick: () => arrangeElements('backward') },
		{ label: 'Send to back', icon: SendToBack, onClick: () => arrangeElements('back') },
	]

	const alignOptions = [
		{ label: 'Left', icon: AlignLeft, onClick: () => alignElement('left') },
		{ label: 'Center', icon: AlignCenter, onClick: () => alignElement('horizontalCenter') },
		{ label: 'Right', icon: AlignRight, onClick: () => alignElement('right') },
		{ label: 'Top', icon: AlignTop, onClick: () => alignElement('top') },
		{ label: 'Middle', icon: AlignCenterVertical, onClick: () => alignElement('verticalCenter') },
		{ label: 'Bottom', icon: AlignBottom, onClick: () => alignElement('bottom') },
	]

	const clipboardOptions = [
		{ label: 'Copy', icon: 'lucide-copy', onClick: () => document.execCommand('copy') },
		{
			label: 'Duplicate',
			icon: 'lucide-copy-plus',
			onClick: () => duplicateElements(null, activeElements.value),
		},
	]

	const transformOptions = []
	if (!isSelectionLocked.value) {
		if (canCrop) {
			transformOptions.push({
				label: 'Crop',
				icon: 'lucide-crop',
				onClick: () => startCrop(activeElements.value[0]),
			})
		}

		transformOptions.push(
			{ label: 'Flip horizontal', icon: FlipHorizontal, onClick: () => flipElements('horizontal') },
			{ label: 'Flip vertical', icon: FlipVertical, onClick: () => flipElements('vertical') },
			{ label: 'Order', icon: BringToFront, submenu: orderOptions },
			{ label: 'Align', icon: AlignLeft, submenu: alignOptions },
		)
	}

	const objectOptions = [
		isSelectionLocked.value
			? { label: 'Unlock', icon: 'lucide-lock-open', onClick: () => toggleLock() }
			: { label: 'Lock', icon: 'lucide-lock', onClick: () => toggleLock() },
	]

	if (!isSelectionLocked.value) {
		objectOptions.push({
			label: 'Delete',
			icon: 'lucide-trash-2',
			theme: 'red',
			onClick: () => deleteElements(),
		})
	}

	return [
		{ group: '', options: clipboardOptions },
		{ group: '', options: transformOptions },
		{ group: '', options: objectOptions },
	]
}

defineExpose({ handleContextMenu })
</script>
