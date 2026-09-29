<template>
	<!-- A category with zero records renders nothing: an empty table with a
	     "Required" badge would read as missing setup data. -->
	<div v-if="records.length" class="space-y-4 border-t p-4">
		<div class="space-y-2">
			<h3 class="flex items-center font-medium">
				{{ title }}
				<Badge v-if="badgeLabel" :theme="badgeTheme" :label="badgeLabel" class="ml-2" />
			</h3>
			<p class="text-ink-gray-5 text-sm">{{ description }}</p>
		</div>
		<ListView
			class="max-w-full flex-1"
			:columns="columns"
			:rows="rows"
			:options="{ selectable: false, showTooltip: false }"
			row-key="key"
		>
			<ListHeader />
			<ListRows>
				<ListRow v-for="row in rows" :key="row.key" v-slot="{ column, item }" :row="row">
					<ListRowItem :item="item">
						<Badge
							v-if="column.key === 'is_verified'"
							:theme="item ? 'green' : 'gray'"
							:label="item ? __('Verified') : __('Not verified')"
						/>
						<span v-else-if="item === null || item === undefined" class="text-ink-gray-5">—</span>
						<Tooltip v-else :text="__('Click to copy')">
							<div
								class="group/copy flex min-w-0 cursor-copy items-center gap-1.5"
								@click="copyToClipBoard(String(item))"
							>
								<span class="truncate">{{ item }}</span>
								<FeatherIcon
									name="copy"
									class="text-ink-gray-5 invisible h-3.5 w-3.5 shrink-0 group-hover/copy:visible"
								/>
							</div>
						</Tooltip>
					</ListRowItem>
				</ListRow>
			</ListRows>
		</ListView>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Tooltip } from 'frappe-ui'
import { Icon as FeatherIcon, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { copyToClipBoard } from '@/apps/mail/utils'

// One record as Suite Cloud's Mail Domain holds it: the host is relative to the domain and the
// SRV fields stay apart from the value, so the page reads like the record table on Suite Cloud.
type DNSRecord = Record<string, string | number | boolean | null | undefined>

const { title, description, records } = defineProps<{
	title: string
	description: string
	records: DNSRecord[]
	badgeLabel?: string
	badgeTheme?: 'green' | 'red' | 'gray' | 'amber' | 'blue'
}>()

const rows = computed(() =>
	records.map((record, index) => ({ ...record, key: `${record.type}-${record.fqdn}-${index}` })),
)

// Priority belongs to MX and SRV records and weight and port to SRV alone, so a table of TXT
// records (SPF, DKIM, DMARC) leaves those columns out instead of showing a column of dashes.
const columns = computed(() => {
	const types = new Set(records.map((record) => record.type))
	const hasPriority = types.has('MX') || types.has('SRV')
	const hasSrv = types.has('SRV')
	return [
		{ label: __('Type'), key: 'type', width: '8%' },
		{ label: __('Host'), key: 'host', width: '18%' },
		{ label: __('Value'), key: 'value' },
		...(hasPriority ? [{ label: __('Priority'), key: 'priority', width: '8%' }] : []),
		...(hasSrv ? [{ label: __('Weight'), key: 'weight', width: '8%' }] : []),
		...(hasSrv ? [{ label: __('Port'), key: 'port', width: '8%' }] : []),
		{ label: __('TTL'), key: 'ttl', width: '8%' },
		{ label: __('Status'), key: 'is_verified', width: '12%' },
	]
})
</script>
