<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('Domains') }]"
		:button-label="__('Add Domain')"
		:button-action="() => (showAddDomain = true)"
	>
		<div class="flex items-center justify-between gap-3">
			<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
				<template #prefix>
					<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
				</template>
			</FormControl>
			<div class="flex items-center gap-3">
				<FormControl
					v-model="status"
					:placeholder="__('Status')"
					class="w-40"
					type="select"
					:options="STATUS_OPTIONS"
				/>
			</div>
		</div>
		<ListView
			v-if="domains?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="domains.data"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="domains.data.length">
					<ListRow
						v-for="row in domains.data"
						:key="row.id"
						v-slot="{ column, item }"
						:row="row"
						class="hover:!bg-surface-gray-1"
					>
						<ListRowItem :item="item">
							<Badge
								v-if="column.key === 'is_enabled'"
								:theme="item ? 'green' : 'gray'"
								:label="item ? __('Enabled') : __('Disabled')"
							/>
							<span v-else-if="column.key === 'created_at'">{{
								formatCreatedAt(item)
							}}</span>
						</ListRowItem>
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
		</ListView>
		<DashboardListSkeleton v-else />
	</DashboardLayout>
	<AddDomainModal v-model="showAddDomain" @reload-domains="domains.reload()" />
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
	Badge, FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon, ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { fromNow } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import AddDomainModal from '@/apps/mail/components/Modals/AddDomainModal.vue'

usePageMeta(() => ({ title: __('Domains') }))

const showAddDomain = ref(false)
const search = ref('')
const status = ref<'All' | 'Enabled' | 'Disabled'>('All')

const domains = createResource({
	url: 'suite.mail.api.admin.get_domains',
	auto: true,
	makeParams: () => ({
		txt: search.value,
		...(status.value !== 'All' ? { is_enabled: status.value === 'Enabled' } : {}),
	}),
	cache: ['mailDomains', search.value, status.value],
})

watchDebounced(() => search.value, domains.reload, { debounce: 300 })
watch(() => status.value, domains.reload)

type DomainRow = {
	id: string
	name: string
	description?: string
	is_enabled: boolean
	created_at?: string
}

const LIST_COLUMNS = [
	{ label: __('Domain'), key: 'name' },
	{ label: __('Description'), key: 'description' },
	{ label: __('Status'), key: 'is_enabled' },
	{ label: __('Created At'), key: 'created_at' },
]

// The empty state depends on why the list is empty: a filtered search that found
// nothing should not present the first-run "add your first domain" pitch.
const hasActiveFilters = computed(() => !!search.value || status.value !== 'All')

const listOptions = computed(() => ({
	selectable: false,
	showTooltip: false,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching domains'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No domains yet'),
				description: __('Add a domain to send and receive mail with your own addresses.'),
				button: {
					label: __('Add Domain'),
					variant: 'solid',
					onClick: () => (showAddDomain.value = true),
				},
			},
	getRowRoute: (row: DomainRow) => ({ name: 'mail-domain', params: { domainId: row.id } }),
}))

const formatCreatedAt = (createdAt?: string) => fromNow(createdAt) || '—'

const STATUS_OPTIONS = [
	{ label: __('All'), value: 'All' },
	{ label: __('Enabled'), value: 'Enabled' },
	{ label: __('Disabled'), value: 'Disabled' },
]
</script>
