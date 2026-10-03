<template>
	<Dialog v-model:open="open" :title="__('Edit history for {0}', [cellRef])" size="sm">
		<template #default>
			<div v-if="loading" class="sn-ch-empty">{{ __('Loading…') }}</div>
			<div v-else-if="error" class="sn-ch-empty sn-ch-error">{{ error }}</div>
			<div v-else-if="!entries.length" class="sn-ch-empty">
				{{ __('No edits recorded for this cell yet.') }}
			</div>
			<ul v-else class="sn-ch-list">
				<li v-for="entry in entries" :key="entry.version" class="sn-ch-item">
					<div class="sn-ch-meta">
						<span class="sn-ch-time">{{ formatDriveDateTime(entry.timestamp) }}</span>
						<span class="sn-ch-user">{{ shortUser(entry.user) }}</span>
					</div>
					<div class="sn-ch-change">
						<span class="sn-ch-before">{{ displayValue(entry.before) }}</span>
						<span class="sn-ch-arrow lucide-arrow-right" aria-hidden="true" />
						<span class="sn-ch-after">{{ displayValue(entry.after) }}</span>
					</div>
				</li>
			</ul>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Dialog } from 'frappe-ui'

import { formatDriveDateTime } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

/** One change to the cell, as `services/versions.js` shapes an op-log row. */
export interface CellHistoryEntry {
	version: string
	/** RFC 3339 in UTC, the form every Suite API publishes a stamp in. */
	timestamp: string | null
	user: string | null
	before: unknown
	after: unknown
}

withDefaults(
	defineProps<{
		cellRef?: string
		entries?: readonly CellHistoryEntry[]
		loading?: boolean
		error?: string
	}>(),
	{ cellRef: '', entries: () => [], loading: false, error: '' },
)

const open = defineModel<boolean>({ default: false })

function shortUser(user: string | null): string {
	if (!user) return ''
	return user.includes('@') ? user.split('@')[0] : user
}

function displayValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return __('(empty)')
	return String(value)
}
</script>

<style scoped>
.sn-ch-list { list-style: none; padding: 0; margin: 0; max-height: 360px; overflow-y: auto; }
.sn-ch-item {
	padding: 10px 0;
	border-bottom: 1px solid var(--outline-gray-2);
}
.sn-ch-item:last-child { border-bottom: 0; }
.sn-ch-meta {
	display: flex; justify-content: space-between;
	font-size: 12px; color: var(--ink-gray-5); margin-bottom: 4px;
}
.sn-ch-change {
	display: flex; align-items: center; gap: 8px;
	font-size: 13px; color: var(--ink-gray-8);
}
.sn-ch-before, .sn-ch-after {
	max-width: 40%;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	padding: 2px 6px; border-radius: 4px;
	background: var(--surface-gray-2);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.sn-ch-after  { background: var(--surface-gray-3); }
.sn-ch-arrow  { color: var(--ink-gray-5); width: 12px; height: 12px; flex: none; }
.sn-ch-empty  { padding: 24px 8px; text-align: center; color: var(--ink-gray-5); font-size: 13px; }
.sn-ch-error  { color: var(--ink-red-5); }
</style>
