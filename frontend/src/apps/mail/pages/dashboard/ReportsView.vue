<template>
	<DashboardLayout :breadcrumbs="[{ label: title }]">
		<div v-if="supportsSearch" class="flex items-center space-x-3">
			<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
				<template #prefix><FeatherIcon name="search" class="text-ink-gray-5 w-4" /></template>
			</FormControl>
		</div>
		<ListView
			v-if="reports?.data"
			ref="listView"
			class="flex-1"
			:columns="columns"
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
							<span v-if="['received_at', 'created_at', 'deliver_at'].includes(column.key)">
								{{ fromNow(item) }}
							</span>
						</ListRowItem>
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
			<ListSelectBanner>
				<template #actions>
					<Button variant="ghost" theme="red" :label="__('Delete')" @click="showDelete = true" />
				</template>
			</ListSelectBanner>
		</ListView>
		<DashboardListSkeleton v-else :columns="3" />
		<DashboardPager :page="page" :page-length="PAGE_LENGTH" :total="total" @update:page="(p) => (page = p)" />
	</DashboardLayout>
	<Dialog v-model:open="showDelete" v-bind="deleteOptions" />
</template>
<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
	Button, Dialog, FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon, ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListSelectBanner, ListView } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { fromNow as formatFromNow } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'

type ReportRow = { id: string; [key: string]: string | undefined }

const { kind, direction } = defineProps<{ kind: string; direction: string }>()

const PAGE_LENGTH = 50
const search = ref('')
const page = ref(1)
const showDelete = ref(false)
const listView = useTemplateRef<{ selections?: Set<string>; toggleAllRows?: () => void }>('listView')

const KIND_LABELS: Record<string, string> = { dmarc: 'DMARC', tls: 'TLS', arf: 'ARF' }
// Only DMARC reports are searchable: a free-text match on the received ones, a domain match on ours.
const supportsSearch = computed(() => kind === 'dmarc')
const title = computed(() => {
	const dir = direction === 'inbound' ? __('Inbound') : __('Outbound')
	return `${dir} ${KIND_LABELS[kind] || kind} ${__('Reports')}`
})

usePageMeta(() => ({ title: title.value }))

const reports = createResource({
	url: 'suite.mail.api.admin.get_reports',
	auto: true,
	makeParams: () => ({ kind, direction, search: search.value, page: page.value, page_length: PAGE_LENGTH }),
	cache: ['mailReports', kind, direction, search.value, page.value],
})

const rows = computed<ReportRow[]>(() => reports.data?.reports || [])
const total = computed(() => reports.data?.total || 0)

watchDebounced(() => search.value, () => ((page.value = 1), reports.reload()), { debounce: 300 })
watch(page, reports.reload)
// Re-fetch when navigating between report kinds (same component, different props).
watch(() => [kind, direction], () => ((page.value = 1), (search.value = ''), reports.reload()))

const fromNow = (value?: string) => formatFromNow(value) || '—'

const columns = computed(() =>
	direction === 'inbound'
		? [
				{ label: __('From'), key: 'from' },
				{ label: __('Subject'), key: 'subject' },
				{ label: __('Received At'), key: 'received_at' },
			]
		: [
				{ label: __('Domain'), key: 'domain' },
				{ label: __('Created At'), key: 'created_at' },
				{ label: __('Deliver At'), key: 'deliver_at' },
			],
)

const hasActiveFilters = computed(() => !!search.value)

const listOptions = computed(() => ({
	showTooltip: false,
	rowHeight: 50,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching reports'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No reports yet'),
				description: __('Reports received for your domains will appear here.'),
			},
	getRowRoute: (row: ReportRow) => ({ name: 'mail-report', params: { direction, kind, reportId: row.id } }),
}))

const deleteReports = createResource({
	url: 'suite.mail.api.admin.delete_reports',
	makeParams: () => ({ kind, direction, ids: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		showDelete.value = false
		reports.reload()
		listView.value?.toggleAllRows?.()
		raiseToast(__('Reports deleted.'))
	},
	onError: (error: { messages?: string[] }) => {
		showDelete.value = false
		raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
	},
})

const deleteOptions = computed(() => ({
	title: __('Delete Reports'),
	message: __('Delete the selected reports? This cannot be undone.'),
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteReports.submit }],
}))
</script>
