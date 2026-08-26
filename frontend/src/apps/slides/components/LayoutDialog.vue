<template>
	<Dialog v-model:open="showLayoutDialog" size="4xl" title="Select a layout">
		<div class="no-scrollbar grid max-h-[32rem] grid-cols-3 gap-6 overflow-y-auto">
			<div
				v-for="layout in layouts"
				:key="layout.idx"
				class="aspect-video cursor-pointer overflow-hidden rounded-6 border border-outline-gray-1 hover:border-outline-gray-2"
				:style="getThumbnailCardStyles(layout.thumbnail)"
				@click="insertSlideWithLayout(layout)"
			>
				<SlidePreview
					v-if="layout.thumbnail == ''"
					:slide="layout"
					:scale="LAYOUT_PREVIEW_SCALE"
				/>
			</div>
		</div>
	</Dialog>
</template>

<script setup>
import { computed } from 'vue'
import { Dialog } from 'frappe-ui'

import SlidePreview from '@/apps/slides/components/SlidePreview.vue'
import { presentationTheme, templateList } from '@/apps/slides/stores/presentation'
import { getThumbnailCardStyles } from '@/apps/slides/utils/helpers'

// card width: 4xl dialog (896) - px-6 (48) - two gap-6 (48), divided by 3
const LAYOUT_PREVIEW_SCALE = 800 / 3 / 960

const emit = defineEmits(['insert'])

const layouts = computed(() => {
	const template = templateList.value?.find((t) => t.name === presentationTheme.value)
	return template?.layouts || []
})

const showLayoutDialog = defineModel('open', { required: true })

const insertSlideWithLayout = (layout) => {
	showLayoutDialog.value = false
	emit('insert', layout)
}
</script>
