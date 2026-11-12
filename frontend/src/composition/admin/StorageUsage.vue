<!-- Combined user storage with app details in a stock tooltip. Partial measurements show a known lower bound. -->
<script setup lang="ts">
import { Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { formatStorage, storageUsed } from './storageFormat'

const { user } = defineProps<{
  user: { drive_bytes: number; mail_bytes: number | null; cap_bytes: number | null }
}>()

const used = computed(() => storageUsed(user))
const partial = computed(() => user.mail_bytes === null)
const amount = computed(() => {
  if (!Number.isFinite(used.value)) return __('Storage usage unavailable')
  return formatStorage(used.value)
})
const usageText = computed(() => {
  if (!Number.isFinite(used.value)) return __('Storage usage unavailable')
  const measured = partial.value ? __('At least {0}', [amount.value]) : amount.value
  return Number.isFinite(user.cap_bytes) && user.cap_bytes !== null && user.cap_bytes > 0
    ? __('{0} of {1} used', [measured, formatStorage(user.cap_bytes)])
    : measured
})
const parts = computed(() => [
  { label: __('Drive'), bytes: user.drive_bytes },
  { label: __('Mail'), bytes: user.mail_bytes },
])

const validLimit = computed(
  () => user.cap_bytes !== null && Number.isFinite(user.cap_bytes) && user.cap_bytes > 0,
)
</script>

<template>
  <Tooltip>
    <template #content>
      <div class="min-w-36 space-y-1">
        <p>{{ usageText }}</p>
        <p v-if="partial">{{ __('Partial usage: Mail unavailable; total may be higher.') }}</p>
        <p v-if="user.cap_bytes === null">{{ __('No limit') }}</p>
        <div v-for="part in parts" :key="part.label" class="flex justify-between gap-6">
          <span>{{ part.label }}</span>
          <span>{{
            part.bytes === null || !Number.isFinite(part.bytes)
              ? __('Unavailable')
              : formatStorage(part.bytes)
          }}</span>
        </div>
      </div>
    </template>
    <div
      tabindex="0"
      :aria-label="
        partial
          ? __('Storage usage: Mail usage unavailable; total may be higher')
          : __('Storage usage')
      "
      class="w-full min-w-0 space-y-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-outline-gray-3"
    >
      <span class="inline-flex items-center gap-1 text-p-sm tabular-nums">
        <span class="font-medium text-ink-gray-8">{{ amount }}</span>
        <span v-if="user.cap_bytes !== null" class="text-ink-gray-5">{{
          validLimit ? __(' / {0}', [formatStorage(user.cap_bytes)]) : __(' / Limit unavailable')
        }}</span>
        <span
          v-if="partial"
          class="lucide-info ml-1 size-3.5 shrink-0 text-ink-gray-5"
          aria-hidden="true"
        />
      </span>
    </div>
  </Tooltip>
</template>
