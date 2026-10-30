<!-- User storage as a combined total or an app breakdown against the same personal cap. Uncapped or unknown measurements have no percentage. -->
<script setup lang="ts">
import { Progress } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { formatStorage, storageUsed } from './storageFormat'

const {
  user,
  showLimit = true,
  breakdown = false,
} = defineProps<{
  user: { drive_bytes: number; mail_bytes: number | null; cap_bytes: number | null }
  /** Off where a separate column already shows the limit. */
  showLimit?: boolean
  breakdown?: boolean
}>()

const used = computed(() => storageUsed(user))
const parts = computed(() => [
  { label: __('Drive'), bytes: user.drive_bytes },
  { label: __('Mail'), bytes: user.mail_bytes },
])

function partPercent(bytes: number | null): number | null {
  const limit = user.cap_bytes
  if (bytes === null || !Number.isFinite(bytes) || !limit || !Number.isFinite(limit) || limit <= 0)
    return null
  return Math.max(0, Math.min(100, (bytes / limit) * 100))
}

const percent = computed(() => {
  const limit = user.cap_bytes
  if (!Number.isFinite(limit) || !limit || limit <= 0 || user.mail_bytes === null) return null
  if (!Number.isFinite(used.value)) return null
  return Math.max(0, Math.min(100, (used.value / limit) * 100))
})
</script>

<template>
  <div v-if="breakdown" class="w-full min-w-0 space-y-2">
    <div v-for="part in parts" :key="part.label" class="space-y-1">
      <div class="flex items-baseline justify-between gap-2 text-p-sm">
        <span class="text-ink-gray-8">{{ part.label }}</span>
        <span class="truncate text-ink-gray-5">
          {{
            part.bytes === null || !Number.isFinite(part.bytes)
              ? __('Unavailable')
              : formatStorage(part.bytes)
          }}
          ·
          {{
            user.cap_bytes === null
              ? __('No limit')
              : partPercent(0) === null
                ? __('Limit unavailable')
                : __('of {0} shared limit', [formatStorage(user.cap_bytes)])
          }}
        </span>
      </div>
      <div
        v-if="partPercent(part.bytes) !== null"
        role="progressbar"
        :aria-label="part.label"
        :aria-valuenow="partPercent(part.bytes) ?? undefined"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuetext="
          __('{0} of {1} shared limit', [
            formatStorage(part.bytes ?? 0),
            formatStorage(user.cap_bytes ?? 0),
          ])
        "
      >
        <Progress :value="partPercent(part.bytes) ?? 0" size="md" aria-hidden="true" />
      </div>
    </div>
  </div>
  <div v-else class="w-full min-w-0 space-y-1.5">
    <div class="flex items-baseline justify-between gap-2 text-p-sm">
      <span class="truncate text-ink-gray-8">{{ formatStorage(used) }}</span>
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
</template>
