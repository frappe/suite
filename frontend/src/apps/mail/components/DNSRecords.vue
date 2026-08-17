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
			:columns="LIST_COLUMNS"
			:rows="records"
			:options="{ selectable: false }"
			row-key="name"
		>
			<ListHeader />
			<ListRows>
				<ListRow v-for="row in records" :key="row.name" :row="row">
					<template #default="{ item }">
						<ListRowItem>
							<Tooltip :text="__('Click to copy')">
								<div
									class="group/copy flex min-w-0 cursor-copy items-center gap-1.5"
									@click="copyToClipBoard(item)"
								>
									<span class="truncate">{{ item }}</span>
									<FeatherIcon
										name="copy"
										class="text-ink-gray-5 invisible h-3.5 w-3.5 shrink-0 group-hover/copy:visible"
									/>
								</div>
							</Tooltip>
						</ListRowItem>
					</template>
				</ListRow>
			</ListRows>
		</ListView>
	</div>
</template>

<script setup lang="ts">
import { Badge, Tooltip } from 'frappe-ui'
import { Icon as FeatherIcon, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { copyToClipBoard } from '@/apps/mail/utils'

const { title, description, records } = defineProps<{
	title: string
	description: string
	records: Record<string, string>[]
	badgeLabel?: string
	badgeTheme?: 'green' | 'red' | 'gray' | 'amber'  | 'blue'
}>()

const LIST_COLUMNS = [
	{ label: __('Type'), key: 'type', width: '12%' },
	{ label: __('Hostname'), key: 'name', width: '24%' },
	{ label: __('TTL (Recommended)'), key: 'ttl', width: '14%' },
	{ label: __('Value'), key: 'value', width: '50%' },
]
</script>
