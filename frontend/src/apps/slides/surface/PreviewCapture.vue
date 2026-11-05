<script setup lang="ts">
import { useTemplateRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import SlidePreview from '@/apps/slides/components/SlidePreview.vue'
import { slides } from '@/apps/slides/stores/slide'

import { PREVIEW_HEIGHT, PREVIEW_WIDTH, usePreviewCapture } from './usePreviewCapture'

const props = defineProps<{
  session: DocumentSession
}>()

const frame = useTemplateRef<HTMLElement>('frame')
const { captureAfterPause } = usePreviewCapture({
  node: props.session.nodeId,
  context: props.session.credentials.context,
  target: frame,
})
defineExpose({ captureAfterPause })
</script>

<template>
  <!-- Drawn off screen at full size, so the capture does not depend on the editor's zoom. -->
  <div
    ref="frame"
    aria-hidden="true"
    class="pointer-events-none fixed left-[-10000px] top-0 overflow-hidden"
    :style="{ width: `${PREVIEW_WIDTH}px`, height: `${PREVIEW_HEIGHT}px` }"
  >
    <SlidePreview v-if="slides[0]" :slide="slides[0]" :scale="1" />
  </div>
</template>
