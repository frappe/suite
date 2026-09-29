<template>
	<!-- One headline number per check; the pass rate alone carries a bar and a warning tone. -->
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
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

import type { DmarcTotals } from '@/apps/mail/utils/dmarc'
import { RATE_WARN_BELOW, formatRate, share } from '@/apps/mail/utils/reports'

const { totals } = defineProps<{ totals: DmarcTotals }>()

const tiles = computed(() => {
	const { messages, passed, failed, dkim_passed, spf_passed, reports, pass_rate } = totals
	const warn = pass_rate !== null && pass_rate < RATE_WARN_BELOW
	return [
		{
			label: __('Messages'),
			value: messages.toLocaleString(),
			sub: __('{0} reports', [reports.toLocaleString()]),
		},
		{
			label: __('Passed DMARC'),
			value: formatRate(pass_rate),
			sub: failed ? __('{0} failed', [failed.toLocaleString()]) : passed ? __('All passed') : '',
			bar: pass_rate ?? 0,
			warn,
		},
		{
			label: __('Passed DKIM'),
			value: formatRate(share(dkim_passed, messages)),
			sub: __('{0} messages', [dkim_passed.toLocaleString()]),
		},
		{
			label: __('Passed SPF'),
			value: formatRate(share(spf_passed, messages)),
			sub: __('{0} messages', [spf_passed.toLocaleString()]),
		},
		{
			label: __('Failed DMARC'),
			value: failed.toLocaleString(),
			sub: messages ? __('{0} of all messages', [formatRate(share(failed, messages))]) : '',
			warn: warn && failed > 0,
		},
	]
})
</script>
