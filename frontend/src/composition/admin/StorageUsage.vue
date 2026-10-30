<!-- Combined user storage with app details in a stock tooltip. Unknown measurements have no percentage. -->
<script setup lang="ts">
import { Progress, Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { formatStorage, storageUsed } from './storageFormat'

const { user, showLimit = true } = defineProps<{
  user: { drive_bytes: number; mail_bytes: number | null; cap_bytes: number | null }
  showLimit?: boolean
}>()

const used = computed(() => storageUsed(user))
const parts = computed(() => [
  { label: __('Drive'), bytes: user.drive_bytes },
  { label: __('Mail'), bytes: user.mail_bytes },
])

const percent = computed(() => {
  const limit = user.cap_bytes
  if (!Number.isFinite(limit) || !limit || limit <= 0 || user.mail_bytes === null) return null
  if (!Number.isFinite(used.value)) return null
  return Math.max(0, Math.min(100, (used.value / limit) * 100))
})
</script>

<template>
  <Tooltip>
    <template #content>
      <div class="min-w-36 space-y-1">
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
      class="w-full min-w-0 space-y-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-outline-gray-3"
    >
      <div class="flex items-baseline justify-between gap-2 text-p-sm">
        <span class="truncate text-ink-gray-8">{{
          user.mail_bytes === null ? __('At least {0}', [formatStorage(used)]) : formatStorage(used)
        }}</span>
        <span v-if="showLimit" class="truncate text-ink-gray-5">
          {{
            user.cap_bytes === null ? __('No limit') : __('of {0}', [formatStorage(user.cap_bytes)])
          }}
        </span>
      </div>
      <div
        v-if="percent !== null"
        role="progressbar"
        :aria-label="__('Storage usage')"
        :aria-valuenow="percent"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuetext="
          __('{0} of {1} used', [formatStorage(used), formatStorage(user.cap_bytes ?? 0)])
        "
      >
        <Progress :value="percent" size="md" aria-hidden="true" />
      </div>
    </div>
  </Tooltip>
</template>
