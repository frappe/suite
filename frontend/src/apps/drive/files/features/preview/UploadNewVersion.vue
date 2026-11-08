<template>
  <input
    ref="input"
    data-slot="upload-new-version-input"
    type="file"
    class="hidden"
    @change="take"
  />
  <Badge v-if="status" :label="status" theme="gray" variant="subtle" class="shrink-0" />
</template>

<script setup lang="ts">
import { Badge } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { confirm, toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { isActive, reconnectingStatus, uploadQueue, type UploadEntry } from '../uploads/queue'

/**
 * Replaces the file's bytes from the browser (spec §6.8). A browser replace
 * keeps no old version, so the user confirms first. The caller's menu calls
 * `pick()`; this shows a badge while the upload runs.
 */
const props = defineProps<{ node: string; parent: string; title: string }>()
const emit = defineEmits<{ replaced: [] }>()
const input = ref<HTMLInputElement>()
const entry = ref<UploadEntry | null>(null)
const uploading = computed(() => !!entry.value && isActive(entry.value))
/**
 * What the badge says. A cancelled replace shows none, but stays watched:
 * Retry in the tracker still finishes it here.
 */
const status = computed(() => {
  if (!uploading.value || !entry.value) return null
  if (entry.value.state !== 'reconnecting') return __('Uploading new version…')
  return reconnectingStatus(entry.value)
})

function pick() {
  if (uploading.value) return
  input.value!.value = ''
  input.value!.click()
}

async function take() {
  const file = input.value?.files?.[0]
  if (!file) return
  const agreed = await confirm({
    title: __('Upload new version?'),
    message: __('This replaces {0}. The current file is not kept.', [props.title]),
    confirmLabel: __('Replace'),
  })
  if (!agreed) return
  entry.value = uploadQueue().replaceFile(
    { node: props.node, parent: props.parent, title: props.title },
    { file },
  )
}

watch(
  () => entry.value?.state,
  (state) => {
    if (state === 'done') {
      toast.success(__('New version uploaded'))
      emit('replaced')
      entry.value = null
    } else if (state === 'failed' || state === 'held') {
      toast.error(entry.value?.error ?? __('The new version could not be uploaded.'))
      entry.value = null
    }
  },
)
defineExpose({ pick })
</script>
