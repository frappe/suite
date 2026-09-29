<!--
  Takes the place of settings groups whose module failed to load. Retry loads
  every group again.
-->
<template>
  <div class="flex items-center gap-3" role="alert">
    <span class="lucide-circle-alert size-4 shrink-0 text-ink-red-4" aria-hidden="true" />
    <span class="min-w-0 flex-1 text-p-sm text-ink-gray-6">{{ __('Some settings could not load.') }}</span>
    <Button size="sm" :loading="retrying" @click="onRetry">{{ __('Retry') }}</Button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

const props = defineProps<{ retry: () => Promise<void> }>()

const retrying = ref(false)

async function onRetry() {
  retrying.value = true
  try {
    await props.retry()
  } finally {
    retrying.value = false
  }
}
</script>
