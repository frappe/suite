<template>
	<Tooltip :text="label" :hover-delay="0.3">
		<div class="flex h-6 w-32 items-center">
			<div class="bg-surface-gray-3 h-1.5 w-full overflow-hidden rounded-full">
				<div class="h-full rounded-full" :class="fillClass" :style="{ width: `${percent ?? 0}%` }" />
			</div>
		</div>
	</Tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Tooltip } from 'frappe-ui'

import { formatBytes, formatGb } from '@/apps/mail/utils'

const GB = 1024 ** 3
const WARN_AT = 80
const FULL_AT = 95

// A list-row storage cell: only the bar shows; the figures ("1.2 GB of 5 GB") sit in the tooltip.
// The bar stays empty when usage is unknown or the allotment is unlimited (0).
const { usedBytes, quotaGb } = defineProps<{ usedBytes?: number | null; quotaGb?: number | null }>()

const percent = computed(() => {
	if (usedBytes == null || !quotaGb) return null
	return Math.min(100, Math.max(0, (usedBytes / (quotaGb * GB)) * 100))
})

const label = computed(() => {
	if (usedBytes == null) return quotaGb == null ? __('Storage unknown') : __('{0} allotted', [formatGb(quotaGb)])
	const used = usedBytes ? formatBytes(usedBytes) : '0 B'
	if (!quotaGb) return __('{0} used, unlimited', [used])
	return __('{0} of {1} ({2}%)', [used, formatGb(quotaGb), (percent.value ?? 0).toFixed(1)])
})

const fillClass = computed(() => {
	const p = percent.value || 0
	if (p >= FULL_AT) return 'bg-surface-red-5'
	if (p >= WARN_AT) return 'bg-surface-amber-3'
	return 'bg-surface-gray-10'
})
</script>
