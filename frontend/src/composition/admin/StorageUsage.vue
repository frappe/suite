<!-- Combined user storage with app details in a stock tooltip. Partial measurements show a known lower bound. -->
<script setup lang="ts">
import { Progress, Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { formatStorage, storageUsed } from './storageFormat'

const { user } = defineProps<{
  user: { drive_bytes: number; mail_bytes: number | null; cap_bytes: number | null }
}>()

const used = computed(() => storageUsed(user))
const partial = computed(() => user.mail_bytes === null)
const usageText = computed(() => {
  if (!Number.isFinite(used.value)) return __('Storage usage unavailable')
  const amount = partial.value
    ? __('At least {0}', [formatStorage(used.value)])
    : formatStorage(used.value)
  return Number.isFinite(user.cap_bytes) && user.cap_bytes !== null && user.cap_bytes > 0
    ? __('{0} of {1} used', [amount, formatStorage(user.cap_bytes)])
    : amount
})
const parts = computed(() => [
  { label: __('Drive'), bytes: user.drive_bytes },
  { label: __('Mail'), bytes: user.mail_bytes },
])

const percent = computed(() => {
  const limit = user.cap_bytes
  if (!Number.isFinite(limit) || !limit || limit <= 0) return null
  if (!Number.isFinite(used.value)) return null
  return Math.max(0, Math.min(100, (used.value / limit) * 100))
})
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
      :aria-label="__('Storage usage')"
      class="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-outline-gray-3"
    >
      <div
        v-if="percent !== null"
        role="progressbar"
        :aria-label="__('Storage usage')"
        :aria-valuenow="percent"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuetext="
          partial
            ? `${usageText}. ${__('Partial usage: Mail unavailable; total may be higher.')}`
            : usageText
        "
      >
        <Progress :value="percent" size="sm" aria-hidden="true" />
      </div>
      <span v-else class="text-p-sm text-ink-gray-5">{{
        user.cap_bytes === null ? __('No limit') : __('Usage unavailable')
      }}</span>
    </div>
  </Tooltip>
</template>
