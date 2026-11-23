<!-- One load-failure presentation; callers own the translated title and the read to retry. -->
<script setup lang="ts">
import { Button } from 'frappe-ui'
import { ref } from 'vue'

import { translate as __ } from '@/platform/translation'

const {
  title,
  retry,
  retryDisabled = false,
  variant = 'page',
} = defineProps<{
  title: string
  retry: () => Promise<unknown>
  retryDisabled?: boolean
  variant?: 'page' | 'section'
}>()

const retrying = ref(false)
async function onRetry() {
  if (retrying.value) return
  retrying.value = true
  try {
    await retry()
  } catch {
    // The caller's query keeps the failed state visible for another attempt.
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div
    role="alert"
    :class="
      variant === 'page'
        ? 'flex flex-col items-center gap-3 py-12 text-center'
        : 'flex items-center gap-3'
    "
  >
    <div v-if="variant === 'page'" class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
      <span class="lucide-cloud-off size-6" aria-hidden="true" />
    </div>
    <span v-else class="lucide-circle-alert size-4 shrink-0 text-ink-red-4" aria-hidden="true" />
    <p
      :class="
        variant === 'page'
          ? 'text-base-medium text-ink-gray-8'
          : 'min-w-0 flex-1 text-p-sm text-ink-gray-6'
      "
    >
      {{ title }}
    </p>
    <Button
      :size="variant === 'section' ? 'sm' : 'md'"
      :icon-left="variant === 'page' ? 'lucide-refresh-cw' : undefined"
      :label="__('Retry')"
      :loading="retrying"
      :disabled="retryDisabled"
      @click="onRetry"
    />
  </div>
</template>
