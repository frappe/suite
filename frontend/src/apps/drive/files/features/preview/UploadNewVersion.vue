<template>
  <input ref="input" data-slot="upload-new-version-input" type="file" class="hidden" @change="take" />
  <Badge v-if="uploading" label="Uploading new version…" theme="gray" variant="subtle" class="shrink-0" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Badge } from 'frappe-ui'

import { confirm, toast } from '@/platform/feedback'

import { uploadQueue, type UploadEntry } from '../uploads/queue'

/**
 * Replaces the file's bytes from the browser (spec §6.8). A browser replace
 * keeps no old version, so the user confirms first. The caller's menu calls
 * `pick()`; this shows a badge while the upload runs.
 */
const props = defineProps<{ node: string; parent: string; title: string }>()
const emit = defineEmits<{ replaced: [] }>()
const input = ref<HTMLInputElement>()
const entry = ref<UploadEntry | null>(null)
const uploading = computed(() => !!entry.value && ['queued', 'checking', 'uploading', 'held'].includes(entry.value.state))

function pick() {
  if (uploading.value) return
  input.value!.value = ''
  input.value!.click()
}

async function take() {
  const file = input.value?.files?.[0]
  if (!file) return
  const agreed = await confirm({
    title: 'Upload new version?',
    message: `This replaces ${props.title}. The current file is not kept.`,
    confirmLabel: 'Replace',
  })
  if (!agreed) return
  entry.value = uploadQueue().replaceFile({ node: props.node, parent: props.parent, title: props.title }, { file })
}

watch(
  () => entry.value?.state,
  (state) => {
    if (state === 'done') {
      toast.success('New version uploaded')
      emit('replaced')
      entry.value = null
    } else if (state === 'failed' || state === 'held') {
      toast.error(entry.value?.error ?? 'The new version could not be uploaded.')
      entry.value = null
    }
  },
)
defineExpose({ pick })
</script>
