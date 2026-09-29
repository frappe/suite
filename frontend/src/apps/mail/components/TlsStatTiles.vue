<template>
	<!-- Sessions, how many negotiated TLS, how many did not; the success rate alone carries a bar. -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div v-for="tile in tiles" :key="tile.label" class="flex flex-col gap-1 rounded-4 border p-4">
			<span class="text-ink-gray-5 text-sm">{{ tile.label }}</span>
			<span class="text-ink-gray-9 text-xl font-semibold leading-7">{{ tile.value }}</span>
			<span class="text-xs" :class="tile.warn ? 'text-ink-amber-6' : 'text-ink-gray-5'">{{ tile.sub || ' ' }}</span>
			<div v-if="tile.bar !== undefined" class="bg-surface-gray-3 mt-1 h-1 w-full rounded-full">
				<div
					class="h-1 rounded-full"
					:class="tile.warn ? 'bg-surface-amber-5' : 'bg-surface-gray-7'"
					:style="{ width: `${Math.min(100, Math.max(2, tile.bar))}%` }"
				/>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { RATE_WARN_BELOW, formatRate, share } from '@/apps/mail/utils/reports'
import type { TlsTotals } from '@/apps/mail/utils/tls'

const { totals } = defineProps<{ totals: TlsTotals }>()

const tiles = computed(() => {
	const { sessions, successful, failed, reports, success_rate } = totals
	const warn = success_rate !== null && success_rate < RATE_WARN_BELOW
	return [
		{
			label: __('Sessions'),
			value: sessions.toLocaleString(),
			// A single report has no count of its own; the list page's totals do.
			sub: reports ? __('{0} reports', [reports.toLocaleString()]) : '',
		},
		{
			label: __('Negotiated TLS'),
			value: formatRate(success_rate),
			sub: failed ? __('{0} failed', [failed.toLocaleString()]) : successful ? __('All succeeded') : '',
			bar: success_rate ?? 0,
			warn,
		},
		{
			label: __('Failed Sessions'),
			value: failed.toLocaleString(),
			sub: sessions ? __('{0} of all sessions', [formatRate(share(failed, sessions))]) : '',
			warn: warn && failed > 0,
		},
	]
})
</script>
