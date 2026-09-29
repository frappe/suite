<template>
	<!-- A short ranked table: who or what sent the mail, how much, and how much of it passed. -->
	<div v-if="rows.length" class="flex max-h-72 flex-col overflow-y-auto">
		<div
			v-for="row in rows"
			:key="row[labelKey]"
			class="flex h-12 shrink-0 items-center gap-3 border-b px-5 text-sm last:border-b-0"
		>
			<span class="min-w-0 flex-1 truncate font-medium">{{ row[labelKey] }}</span>
			<span class="text-ink-gray-5 w-24 shrink-0 text-right tabular-nums">
				{{ __('{0} msgs', [row.messages.toLocaleString()]) }}
			</span>
			<span v-if="row.failed" class="text-ink-gray-5 w-20 shrink-0 text-right tabular-nums">
				{{ __('{0} failed', [row.failed.toLocaleString()]) }}
			</span>
			<span v-else class="w-20 shrink-0" />
			<Badge class="w-14 shrink-0 justify-center" :theme="rateTheme(row.pass_rate)" :label="formatRate(row.pass_rate)" />
		</div>
	</div>
	<div v-else class="text-ink-gray-5 px-5 py-4 text-sm">{{ empty }}</div>
</template>

<script setup lang="ts">
import { Badge } from 'frappe-ui'

import type { DmarcTotals } from '@/apps/mail/utils/dmarc'
import { formatRate, rateTheme } from '@/apps/mail/utils/reports'

type Row = DmarcTotals & Record<string, string | number | null>

defineProps<{ rows: Row[]; labelKey: string; empty: string }>()
</script>
