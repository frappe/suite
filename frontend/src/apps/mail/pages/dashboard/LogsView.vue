<template>
	<DashboardLayout :breadcrumbs="[{ label: __('Logs') }]">
		<div class="flex items-center justify-between gap-3">
			<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
				<template #prefix><FeatherIcon name="search" class="text-ink-gray-5 w-4" /></template>
			</FormControl>
			<Button :label="__('Refresh')" @click="logs.reload()">
				<template #prefix><FeatherIcon name="refresh-cw" class="h-4 w-4" /></template>
			</Button>
		</div>
		<ListView
			v-if="logs?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="rows"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="rows.length">
					<ListRow
						v-for="row in rows"
						:key="row.id"
						v-slot="{ column, item }"
						:row="row"
						class="hover:!bg-surface-gray-1"
					>
						<ListRowItem :item="item">
							<span v-if="column.key === 'timestamp'">{{ formatDate(row.timestamp) }}</span>
							<Badge
								v-else-if="column.key === 'level'"
								:label="row.level_label || '—'"
								:theme="levelTheme(row.level)"
							/>
							<span v-else-if="column.key === 'event'">{{ row.event_label || row.event || '—' }}</span>
							<code
								v-else-if="column.key === 'details'"
								class="text-ink-gray-6 block w-full truncate font-mono text-xs"
							>
								{{ row.details || '—' }}
							</code>
						</ListRowItem>
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
		</ListView>
		<DashboardListSkeleton v-else />
		<DashboardPager
			:page="page"
			:page-length="PAGE_LENGTH"
			:total="total"
			:has-next-page="Boolean(nextAnchor)"
			@update:page="goToPage"
		/>
	</DashboardLayout>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
	Badge, Button, FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon, ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { formatDateTime } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'

type LogRow = {
	id: string
	timestamp?: string
	level?: string
	level_label?: string
	event?: string
	event_label?: string
	details?: string
}

usePageMeta(() => ({ title: __('Logs') }))

const PAGE_LENGTH = 100
const search = ref('')
const page = ref(1)
// The log store pages by cursor only, so each visited page remembers the id it starts after
// (`undefined` for the first page) and pages are walked one step at a time.
const anchors = ref<(string | undefined)[]>([undefined])

const logs = createResource({
	url: 'suite.mail.api.admin.get_logs',
	auto: true,
	makeParams: () => ({
		search: search.value,
		anchor: anchors.value[page.value - 1],
		page_length: PAGE_LENGTH,
	}),
})

const rows = computed<LogRow[]>(() => logs.data?.logs || [])
const total = computed(() => logs.data?.total || 0)
const nextAnchor = computed<string | null>(() => logs.data?.next_anchor ?? null)

const resetPaging = () => {
	page.value = 1
	anchors.value = [undefined]
}

const goToPage = (next: number) => {
	if (next > page.value) {
		if (!nextAnchor.value) return
		anchors.value[next - 1] = nextAnchor.value
	}
	page.value = next
}

watchDebounced(() => search.value, () => (resetPaging(), logs.reload()), { debounce: 300 })
watch(page, logs.reload)

const formatDate = (value?: string) => formatDateTime(value, 'MMM D, h:mm:ss A') || '—'

// Mirrors the colours the server's TracingLevel enum assigns to each level.
const LEVEL_THEMES: Record<string, string> = {
	error: 'red',
	warn: 'amber',
	info: 'green',
	debug: 'blue',
	trace: 'violet',
}
const levelTheme = (level?: string) => LEVEL_THEMES[(level || '').toLowerCase()] || 'gray'

const LIST_COLUMNS = [
	{ label: __('Timestamp'), key: 'timestamp', width: '11rem' },
	{ label: __('Level'), key: 'level', width: '7rem' },
	{ label: __('Event'), key: 'event', width: '18rem' },
	{ label: __('Details'), key: 'details', width: 2 },
]

const hasActiveFilters = computed(() => !!search.value)

const listOptions = computed(() => ({
	selectable: false,
	showTooltip: false,
	rowHeight: 44,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching log entries'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No log entries'),
				description: __('Server events will appear here as they happen.'),
			},
	getRowRoute: (row: LogRow) => ({ name: 'mail-log', params: { logId: row.id } }),
}))
</script>
