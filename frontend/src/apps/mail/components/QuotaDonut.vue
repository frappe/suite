<template>
	<div class="flex flex-1 items-center justify-center gap-8 p-6">
		<div class="relative shrink-0">
			<svg :width="DONUT_SIZE" :height="DONUT_SIZE" class="-rotate-90">
				<circle
					:cx="DONUT_SIZE / 2"
					:cy="DONUT_SIZE / 2"
					:r="DONUT_RADIUS"
					fill="none"
					stroke="var(--surface-gray-4)"
					:stroke-width="DONUT_STROKE"
				/>
				<circle
					v-if="!quota.unlimited && usedDashArc > 0"
					:cx="DONUT_SIZE / 2"
					:cy="DONUT_SIZE / 2"
					:r="DONUT_RADIUS"
					fill="none"
					stroke="var(--surface-gray-10)"
					:stroke-width="DONUT_STROKE"
					stroke-linecap="round"
					:stroke-dasharray="`${usedDashArc} ${DONUT_CIRCUMFERENCE}`"
				/>
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center text-center">
				<span class="text-md font-semibold">{{ totalQuotaLabel }}</span>
				<span class="text-ink-gray-5 text-xs">
					{{ quota.unlimited ? __('Unlimited') : __('Total Quota') }}
				</span>
			</div>
		</div>
		<div class="space-y-4">
			<div class="flex items-start gap-2">
				<span class="bg-surface-gray-10 mt-1 h-3 w-3 shrink-0 rounded-1" />
				<div>
					<p class="text-sm font-medium">{{ usedLabel }}</p>
					<p class="text-ink-gray-5 text-xs">{{ __('Used') }}</p>
				</div>
			</div>
			<div v-if="!quota.unlimited" class="flex items-start gap-2">
				<span class="bg-surface-gray-4 mt-1 h-3 w-3 shrink-0 rounded-1" />
				<div>
					<p class="text-sm font-medium">{{ availableLabel }}</p>
					<p class="text-ink-gray-5 text-xs">{{ __('Available') }}</p>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { formatBytes } from '@/apps/mail/utils'

import type { QuotaUsage } from '@/apps/mail/types'

const { quota } = defineProps<{ quota: QuotaUsage }>()

// Donut geometry.
const DONUT_SIZE = 140
const DONUT_STROKE = 12
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

// Length of the "used" arc. Guarded against sub-pixel arcs (e.g. a few hundred bytes of a
// multi-GB quota) that a round line cap would otherwise render as a misleading full dot.
const usedDashArc = computed(() => {
	const arc = DONUT_CIRCUMFERENCE * ((quota.used_percentage || 0) / 100)
	return arc >= 1 ? arc : 0
})

const totalQuotaLabel = computed(() => (quota.unlimited ? '∞' : formatBytes(quota.total || 0)))

const usedLabel = computed(() =>
	quota.unlimited
		? formatBytes(quota.used)
		: `${formatBytes(quota.used)} (${quota.used_percentage.toFixed(1)}%)`,
)

const availableLabel = computed(
	() => `${formatBytes(quota.available)} (${quota.available_percentage.toFixed(1)}%)`,
)
</script>
