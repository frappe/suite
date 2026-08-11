<template>
	<div
		ref="captureRef"
		class="pointer-events-none fixed left-[-10000px] top-0 h-[540px] w-[960px] overflow-hidden"
	>
		<div class="h-[540px] w-[960px] overflow-hidden">
			<SlidePreview v-if="slide" :slide="slide" :scale="1" />
		</div>
	</div>
</template>

<script setup>
import { toRef, useTemplateRef } from 'vue'

import SlidePreview from '@/apps/slides/components/SlidePreview.vue'

import { useThumbnailCapture } from '@/apps/slides/composables/useThumbnailCapture'

const props = defineProps({
	slide: {
		type: Object,
		default: null,
	},
	disableCapture: {
		type: Boolean,
		default: false,
	},
})

const captureRef = useTemplateRef('captureRef')

const thumbnailCaptureControls = useThumbnailCapture(captureRef, toRef(props, 'disableCapture'))

defineExpose(thumbnailCaptureControls)
</script>
