<template>
	<div
		ref="overlay"
		class="absolute left-0 top-0 size-full opacity-10"
		:style="{ backgroundColor: selectionColor }"
		@dragleave.prevent="handleDragLeave"
		@dragover.prevent
		@drop="handleMediaDrop"
	></div>
</template>

<script setup>
import { ref, useTemplateRef, nextTick } from 'vue'

import { handleUploadedMedia } from '@/apps/slides/utils/mediaUploads'
import { inCropMode } from '@/apps/slides/stores/imageCrop'
import { currentSlide } from '@/apps/slides/stores/slide'
import { selectionColor } from '@/apps/slides/utils/constants'

const emit = defineEmits(['hideOverlay'])

const overlayRef = useTemplateRef('overlay')

const handleDragLeave = (e) => {
	e.preventDefault()
	emit('hideOverlay')
}

const getTargetElement = (e) => {
	const target = document.elementFromPoint(e.clientX, e.clientY).closest('[data-index]')

	if (!target) return null

	const elementId = target.getAttribute('data-index')
	const element = currentSlide.value.elements.find((el) => el.id == elementId)

	if (element && !element.locked && ['image', 'video'].includes(element.type)) {
		return element
	}
}

const handleMediaDrop = async (e) => {
	e.preventDefault()
	emit('hideOverlay')

	// a drop would steal the selection from the crop session mid-interaction
	if (inCropMode.value) return

	nextTick(() => {
		const targetElement = getTargetElement(e)
		handleUploadedMedia(e.dataTransfer.files, targetElement)
	})
}
</script>
