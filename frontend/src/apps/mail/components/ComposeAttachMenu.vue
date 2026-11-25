<template>
  <!-- One Attach button, in every composer: a file from this device, or one already in Drive. The
       trigger is the caller's, so each composer keeps its own button size. On a phone the two
       choices come up as a sheet, like every other Mail menu there. -->
  <AdaptiveDropdown :options="options" :title="__('Attach')">
    <slot />
  </AdaptiveDropdown>
  <input ref="fileInput" type="file" class="hidden" multiple @change="onFilesSelected" />
</template>
<script setup lang="ts">
import { HardDrive, MonitorUp } from 'lucide-vue-next'
import { useTemplateRef } from 'vue'

import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import { translate as __ } from '@/platform/translation'

const emit = defineEmits<{
  selectFiles: [files: File[]]
  attachFromDrive: []
}>()

const fileInput = useTemplateRef('fileInput')

// The chooser is opened from inside the item's own click (the sheet row's on a phone, the menu
// item's elsewhere; both call onClick synchronously), so the browser still counts it as the user's
// doing and shows it.
const options = [
  {
    label: __('Upload from computer'),
    icon: MonitorUp,
    onClick: () => fileInput.value?.click(),
  },
  {
    label: __('Attach from Drive'),
    icon: HardDrive,
    onClick: () => emit('attachFromDrive'),
  },
]

const onFilesSelected = (e: Event) => {
  const input = e.target
  if (!(input instanceof HTMLInputElement)) return

  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) emit('selectFiles', files)
}
</script>
