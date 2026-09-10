<template>
	<div class="flex min-w-36 flex-col gap-1">
		<span class="text-ink-gray-5 text-sm leading-none">{{ label }}</span>
		<div v-if="percent != null" class="bg-surface-gray-3 h-1 w-full overflow-hidden rounded-full">
			<div class="h-full rounded-full" :class="fillClass" :style="{ width: `${percent}%` }" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { formatBytes, formatGb } from '@/apps/mail/utils'

const GB = 1024 ** 3
const WARN_AT = 80
const FULL_AT = 95

// A list-row storage cell: "1.2 GB of 5 GB" over a thin bar. No bar when usage is unknown or the
// allotment is unlimited (0), since there is nothing to fill against.
const { usedBytes, quotaGb } = defineProps<{ usedBytes?: number | null; quotaGb?: number | null }>()

const percent = computed(() => {
	if (usedBytes == null || !quotaGb) return null
	return Math.min(100, Math.max(0, (usedBytes / (quotaGb * GB)) * 100))
})

const label = computed(() => {
	if (usedBytes == null) return formatGb(quotaGb)
	const used = usedBytes ? formatBytes(usedBytes) : '0 B'
	if (!quotaGb) return __('{0} used', [used])
	return __('{0} of {1}', [used, formatGb(quotaGb)])
})

const fillClass = computed(() => {
	const p = percent.value || 0
	if (p >= FULL_AT) return 'bg-surface-red-5'
	if (p >= WARN_AT) return 'bg-surface-amber-3'
	return 'bg-surface-gray-10'
})
</script>
