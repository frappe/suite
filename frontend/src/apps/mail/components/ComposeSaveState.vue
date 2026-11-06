<template>
  <span class="flex items-center gap-1" role="status" aria-live="polite">
    <!-- Two pieces that wrap apart, so a cramped bar breaks the line rather than losing the end of
         it: where the text is is half the news. -->
    <span
      v-if="label"
      class="text-p-sm flex flex-wrap gap-x-1"
      :class="isFailing ? 'text-ink-red-5' : 'text-ink-gray-5'"
      :aria-hidden="isFailing ? undefined : 'true'"
      :title="detail"
    >
      <span class="whitespace-nowrap">{{ isKept ? `${label} ·` : label }}</span>
      <span v-if="isKept" class="whitespace-nowrap">{{ __('Kept on this device') }}</span>
    </span>
    <Button
      v-if="canRetry"
      variant="ghost"
      size="sm"
      class="shrink-0"
      :label="state.isRetrying ? __('Retrying…') : __('Retry')"
      :disabled="state.isRetrying"
      @click="emit('retry')"
    />
  </span>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import type { SaveFailure, SaveStatus } from '@/apps/mail/composables/draftSaver'

const { state } = defineProps<{
  state: {
    status: SaveStatus
    failure?: SaveFailure
    isCopyKept: boolean
    isRetrying: boolean
    isUploading: boolean
  }
}>()
const emit = defineEmits(['retry'])

const isFailing = computed(() => state.status === 'failed' || state.status === 'gone')
const canRetry = computed(() => state.status === 'failed')

const isKept = computed(() => isFailing.value && state.isCopyKept)
const label = computed(() => {
  if (isFailing.value)
    return state.status === 'failed' && state.failure?.kind === 'offline'
      ? __('Offline')
      : __('Not saved')
  if (state.isUploading) return __('Uploading…')
  if (state.status === 'saving') return __('Saving…')
  if (state.status === 'saved') return __('Saved')
  return ''
})
// The server's own words for a refusal, for anyone wanting to know why.
const detail = computed(() =>
  state.failure?.kind === 'refused' ? state.failure.message : undefined,
)
</script>
