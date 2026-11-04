<template>
  <Tooltip :text="label" :hover-delay="300">
    <div class="flex min-w-0 flex-1 flex-col items-start gap-1">
      <span class="text-p-sm text-ink-gray-6">{{ label }}</span>
      <div
        v-if="percent !== null"
        class="bg-surface-gray-3 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          class="bg-surface-gray-10 h-full rounded-full"
          :style="{ width: `${percent ?? 0}%` }"
        />
      </div>
    </div>
  </Tooltip>
</template>

<script setup lang="ts">
import { Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { formatBytes, formatGb } from '@/apps/mail/utils'

const GB = 1024 ** 3

// Keep usage readable for unlimited accounts; a percentage bar requires a known limit.
const { usedBytes, quotaGb } = defineProps<{ usedBytes?: number | null; quotaGb?: number | null }>()

const percent = computed(() => {
  if (usedBytes == null || !quotaGb) return null
  return Math.min(100, Math.max(0, (usedBytes / (quotaGb * GB)) * 100))
})

const label = computed(() => {
  if (usedBytes == null)
    return quotaGb == null ? __('Storage unknown') : __('{0} allotted', [formatGb(quotaGb)])
  const used = usedBytes ? formatBytes(usedBytes) : '0 B'
  if (!quotaGb) return __('{0} used, unlimited', [used])
  return __('{0} of {1} ({2}%)', [used, formatGb(quotaGb), (percent.value ?? 0).toFixed(1)])
})
</script>
