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

import { storagePercent, storageUsageLabel } from '@/apps/mail/utils'

// Keep usage readable for unlimited accounts; a percentage bar requires a known limit.
const { usedBytes, quotaGb } = defineProps<{ usedBytes?: number | null; quotaGb?: number | null }>()

const percent = computed(() => storagePercent(usedBytes, quotaGb))
const label = computed(() => storageUsageLabel(usedBytes, quotaGb))
</script>
