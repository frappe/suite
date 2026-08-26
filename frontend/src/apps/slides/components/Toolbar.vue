<template>
	<div
		class="absolute bottom-10 left-1/2 z-10 flex h-12 -translate-x-1/2 items-center justify-center gap-1 rounded-6 bg-surface-base px-2 shadow-xl"
		@wheel="handleScrollBarWheelEvent"
	>
		<Tooltip text="Text" :hover-delay="0.7">
			<div class="cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3" @click="addTextElement(null)">
				<Type class="size-4.5 stroke-[1.5] text-ink-gray-7" />
			</div>
		</Tooltip>

		<Tooltip text="Media" :hover-delay="0.7">
			<FileUploader
				:fileTypes="allowedImageFileTypes.concat(['video/*'])"
				doctype="Presentation"
				:docname="presentationId"
				private
				@success="(file) => handleUploadSuccess(file)"
			>
				<template #default="{ openFileSelector }">
					<div class="cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3" @click="openFileSelector">
						<ImagePlus class="size-4.5 stroke-[1.5] text-ink-gray-7" />
					</div>
				</template>
			</FileUploader>
		</Tooltip>

		<ShapesDropdown />

		<TableDropdown />
	</div>
</template>

<script setup>
import { ref } from 'vue'

import { Type, ImagePlus } from 'lucide-vue-next'

import { Tooltip, FileUploader, toast } from 'frappe-ui'
import { presentationId } from '@/apps/slides/stores/presentation'
import { addTextElement, addMediaElement } from '@/apps/slides/stores/element'
import { allowedImageFileTypes } from '@/apps/slides/utils/constants'

import ShapesDropdown from '@/apps/slides/components/ShapesDropdown.vue'
import TableDropdown from '@/apps/slides/components/TableDropdown.vue'

import { handleScrollBarWheelEvent } from '@/apps/slides/utils/helpers'

const handleUploadSuccess = (file) => {
	const imageTypes = allowedImageFileTypes.map((type) => type.split('/')[1].toUpperCase())
	const fileType = imageTypes.includes(file.file_type) ? 'image' : 'video'

	const toastProps = {
		loading: file.file_name ? `Uploading: ${file.file_name}` : 'Uploading...',
		success: (data) => (file.file_name ? `Uploaded: ${file.file_name}` : 'Uploaded'),
		error: (data) => 'Upload failed. Please try again.',
	}

	toast.promise(addMediaElement(file, fileType), toastProps)
}
</script>
