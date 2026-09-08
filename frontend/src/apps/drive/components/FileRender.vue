<template>
  <div
    v-if="error"
    class="max-w-[450px] h-fit self-center p-10 border border-outline-gray-2 bg-surface-base rounded-4 text-2xl-medium text-center shadow-xl flex flex-col justify-center items-center gap-4"
  >
    <LucideAlertCircle class="size-8 text-ink-gray-8" />
    <span class="text-ink-gray-9">Cannot open file</span>
    <span class="text-base text-center text-ink-gray-7">
      {{ error }}
    </span>
    <Button class="w-full" variant="solid" @click="download"> Download </Button>
  </div>
  <component :is="previewComponent" v-else :preview-entity="previewEntity" />
</template>
<script setup>
import { Button } from 'frappe-ui'
import { computed, defineAsyncComponent } from 'vue'

const MSOfficePreview = defineAsyncComponent(() => import('@/apps/drive/components/FileTypePreview/MSOfficePreview.vue'))
const ImagePreview = defineAsyncComponent(() => import('@/apps/drive/components/FileTypePreview/ImagePreview.vue'))
const PDFPreview = defineAsyncComponent(() => import('./FileTypePreview/PDFPreview.vue'))
const VideoPreview = defineAsyncComponent(() => import('./FileTypePreview/VideoPreview.vue'))
const TextPreview = defineAsyncComponent(() => import('./FileTypePreview/TextPreview.vue'))
const AudioPreview = defineAsyncComponent(() => import('@/apps/drive/components/FileTypePreview/AudioPreview.vue'))
import LucideAlertCircle from '~icons/lucide/alert-circle'
import { previewFileType, previewUnavailableReason } from '@/apps/drive/utils/filePreview'

const props = defineProps({
  previewEntity: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: Boolean,
    required: false,
    default: true,
  },
})

const error = computed(() => previewUnavailableReason(props.previewEntity, Object.keys(RENDERS)))

const download = () => {
  window.location.href = `/api/method/suite.drive.api.files.get_file_content?entity_name=${props.previewEntity.name}&trigger_download=1`
}

const RENDERS = {
  PDF: PDFPreview,
  Image: ImagePreview,
  Video: VideoPreview,
  Audio: AudioPreview,
  Document: MSOfficePreview,
  Spreadsheet: MSOfficePreview,
  Presentation: MSOfficePreview,
  Text: TextPreview,
  Code: TextPreview,
}

const previewComponent = computed(() => RENDERS[previewFileType(props.previewEntity)])
</script>
