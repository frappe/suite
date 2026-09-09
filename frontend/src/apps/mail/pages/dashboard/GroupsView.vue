<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('Groups') }]"
		:button-label="__('Add Group')"
		:button-action="() => (showAddGroup = true)"
	>
		<div class="flex items-center space-x-3">
			<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
				<template #prefix>
					<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
				</template>
			</FormControl>
		</div>
		<ListView
			v-if="list.loaded"
			class="min-h-0 flex-1 !overflow-y-auto [&>div:first-child]:sticky [&>div:first-child]:top-0 [&>div:first-child]:z-10"
			:columns="LIST_COLUMNS"
			:rows="list.rows"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="list.rows.length">
					<ListRow
						v-for="row in list.rows"
						:key="row.id"
						v-slot="{ column, item }"
						:row="row"
						class="hover:!bg-surface-gray-1"
					>
						<ListRowItem :item="item">
							<span v-if="column.key === 'created_at'">{{ formatCreatedAt(item) }}</span>
							<span v-else-if="column.key === 'quota_gb'" class="text-ink-gray-5 text-sm">
								{{ item == null ? '—' : __('{0} GB', [String(item)]) }}
							</span>
						</ListRowItem>
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
		</ListView>
		<DashboardListSkeleton v-else :columns="4" />
		<DashboardPager
			v-if="list.loaded && list.total"
			:count="list.rows.length"
			:total="list.total"
			:page-length="list.pageLength"
			:has-more="list.hasMore"
			:loading="list.loading"
			@update:page-length="list.setPageLength"
			@load-more="list.loadMore"
		/>
	</DashboardLayout>
	<AddGroupModal v-model="showAddGroup" @reload="list.reload()" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { appPageMeta } from '@/utils/documentTitle'
import { watchDebounced } from '@vueuse/core'
import { FormControl, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { fromNow } from '@/apps/mail/utils/datetime'
import { usePagedList } from '@/apps/mail/utils/pagedList'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import AddGroupModal from '@/apps/mail/components/Modals/AddGroupModal.vue'

usePageMeta(() => appPageMeta(__('Groups'), 'Mail'))

const showAddGroup = ref(false)
useAddOnArrival(showAddGroup)
const search = ref('')

const list = usePagedList<GroupRow>('suite.mail.api.admin.get_groups', () => ({ search: search.value }))

watchDebounced(() => search.value, list.reload, { debounce: 300 })

type GroupRow = {
	id: string
	name: string
	email?: string
	description?: string
	quota_gb?: number | null
	created_at?: string
}

const LIST_COLUMNS = [
	{ label: __('Email'), key: 'email' },
	{ label: __('Description'), key: 'description' },
	{ label: __('Quota'), key: 'quota_gb' },
	{ label: __('Created At'), key: 'created_at' },
]

const hasActiveFilters = computed(() => !!search.value)

const listOptions = computed(() => ({
	selectable: false,
	showTooltip: false,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching groups'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No groups yet'),
				description: __('Create a group to give a team a shared address and mailbox.'),
				button: {
					label: __('Add Group'),
					variant: 'solid',
					onClick: () => (showAddGroup.value = true),
				},
			},
	getRowRoute: (row: GroupRow) => ({ name: 'mail-group', params: { groupId: row.id } }),
}))

const formatCreatedAt = (createdAt?: string) => fromNow(createdAt) || '—'
</script>
