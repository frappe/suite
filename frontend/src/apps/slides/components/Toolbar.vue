<template>
	<div
		class="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center justify-center gap-1 rounded-4 bg-surface-elevation-1 p-0.5 shadow-md"
		@wheel="handleScrollBarWheelEvent"
	>
		<Tooltip text="Text" :hover-delay="0.7">
			<div class="cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3" @click="addTextElement(null)">
				<Type class="size-4 stroke-[1.5] text-ink-gray-7" />
			</div>
		</Tooltip>

		<Tooltip text="Media" :hover-delay="0.7">
			<div class="cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3" @click="openFilePicker">
				<ImagePlus class="size-4 stroke-[1.5] text-ink-gray-7" />
			</div>
		</Tooltip>

		<ToolDropdown tooltip="Shapes" :icon="Shapes" :options="shapeTools" />

		<ToolDropdown tooltip="Lines" :icon="Polyline" :options="lineTools" />

		<TableDropdown />

		<input
			ref="filePicker"
			type="file"
			class="hidden"
			:accept="allowedImageFileTypes.concat('video/*').join(',')"
			@change="addMedia"
		/>
	</div>
</template>

<script setup>
import { useTemplateRef } from 'vue'

import { Type, ImagePlus, Shapes } from 'lucide-vue-next'

import { Tooltip } from 'frappe-ui'
import { addTextElement } from '@/apps/slides/stores/element'
import { allowedImageFileTypes } from '@/apps/slides/utils/constants'

import ToolDropdown from '@/apps/slides/components/ToolDropdown.vue'
import Polyline from '@/apps/slides/icons/Polyline.vue'
import TableDropdown from '@/apps/slides/components/TableDropdown.vue'

import { handleScrollBarWheelEvent } from '@/apps/slides/utils/helpers'
import { shapeTools, lineTools } from '@/apps/slides/utils/toolbarTools'
import { handleUploadedMedia } from '@/apps/slides/utils/mediaUploads'

const filePicker = useTemplateRef('filePicker')

const openFilePicker = () => filePicker.value.click()

const addMedia = (e) => {
	const file = e.target.files[0]
	if (file) handleUploadedMedia([file])
	e.target.value = ''
}
</script>
