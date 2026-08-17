<template>
	<div class="h-full" @dblclick="handleDoubleClick">
		<div :style="maskStyle">
			<img
				v-if="imageSrc"
				:class="imageClasses"
				:style="imageStyle"
				:src="getAttachmentUrl(imageSrc)"
			/>
		</div>
		<div
			v-if="showReplaceImageButton"
			class="absolute left-0 top-0 size-full overflow-hidden bg-gray-900 opacity-40 transition-opacity duration-500 ease-in-out"
			:style="gradientOverlayStyles"
		>
			<FileUploader
				:fileTypes="allowedImageFileTypes"
				doctype="Presentation"
				:docname="presentationId"
				private
				@success="replaceTemplateImage"
			>
				<template #default="{ openFileSelector }">
					<div :class="replaceButtonClasses" @click="openFileSelector">
						<LucideReplace class="size-5 stroke-[1.5] text-gray-900" />
					</div>
				</template>
			</FileUploader>
		</div>
	</div>
</template>

<script setup>
import { computed, inject, ref } from 'vue'

import { FileUploader } from 'frappe-ui'

import { presentationId } from '@/apps/slides/stores/presentation'
import { activeElement, activeElementIds } from '@/apps/slides/stores/element'
import { startCrop } from '@/apps/slides/stores/imageCrop'
import { allowedImageFileTypes, defaultBorderColor } from '@/apps/slides/utils/constants'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'
import { getCroppedImageBox } from '@/apps/slides/utils/cropGeometry'
import { useBoxShadow } from '@/apps/slides/composables/useShadow'

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
	transitionStyles: {
		type: Object,
		default: () => ({}),
	},
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const inSlideShowMode = inject('inSlideShowMode', ref(false))

const handleDoubleClick = (e) => {
	if (props.mode != 'editor' || inReadonlyMode.value || inSlideShowMode.value) return

	e.stopPropagation()
	activeElementIds.value = [element.value.id]
	startCrop(element.value)
}

const replaceButtonClasses =
	'absolute inset-[calc(50%-16px)] flex size-8 cursor-pointer items-center justify-center rounded-6 bg-white'

const showReplaceImageButton = computed(() => {
	return (
		props.mode == 'editor' &&
		element.value.useTemplateDimensions &&
		activeElement.value?.id == element.value.id &&
		element.value.src.includes('placeholder') &&
		!element.value.locked
	)
})

const imageSrc = computed(() => {
	if (props.mode == 'thumbnail' && isGifImage.value && !element.value.poster) {
		return ''
	}
	if (props.mode == 'thumbnail' && element.value.poster) {
		return element.value.poster
	}
	return element.value.src
})

const isGifImage = computed(() => {
	return element.value.src?.split('?')[0].toLowerCase().endsWith('.gif')
})

const boxShadow = useBoxShadow(element)

// the mask carries the cosmetics and clips the image
const maskStyle = computed(() => ({
	position: 'relative',
	overflow: 'hidden',
	width: '100%',
	height: element.value.height ? '100%' : 'auto',
	opacity: (element.value.opacity ?? 100) / 100,
	borderRadius: `${element.value.borderRadius}px`,
	borderStyle: element.value.borderStyle || 'none',
	borderColor: element.value.borderColor || defaultBorderColor,
	borderWidth: `${element.value.borderWidth}px`,
	boxShadow: boxShadow.value,
	transform: `scale(${element.value.invertX || 1}, ${element.value.invertY || 1})`,
	...props.transitionStyles,
}))

const imageClasses = computed(() => ({
	'object-cover': !element.value.crop,
}))

const imageStyle = computed(() => {
	// no stored height: legacy path, the image sizes the element
	if (!element.value.height) {
		return { width: '100%', userSelect: 'none' }
	}

	// percentages so the image tracks the frame through live gestures
	const box = getCroppedImageBox(element.value.crop, { width: 100, height: 100 })
	return {
		position: 'absolute',
		left: `${box.left}%`,
		top: `${box.top}%`,
		width: `${box.width}%`,
		height: `${box.height}%`,
		// preflight clamps img to max-width 100%
		maxWidth: 'none',
		userSelect: 'none',
	}
})

const replaceTemplateImage = (file) => {
	element.value.src = file.file_url
	element.value.attachmentName = file.name
}

const gradientOverlayStyles = computed(() => ({
	borderRadius: `${element.value.borderRadius}px`,
}))
</script>
