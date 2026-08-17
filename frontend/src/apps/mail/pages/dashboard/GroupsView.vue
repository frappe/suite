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
			v-if="groups?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="groups.data"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="groups.data.length">
					<ListRow
						v-for="row in groups.data"
						:key="row.id"
						v-slot="{ column, item }"
						:row="row"
						class="hover:!bg-surface-gray-1"
					>
						<ListRowItem :item="item">
							<span v-if="column.key === 'created_at'">{{ formatCreatedAt(item) }}</span>
						</ListRowItem>
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
		</ListView>
		<DashboardListSkeleton v-else :columns="3" />
	</DashboardLayout>
	<AddGroupModal v-model="showAddGroup" @reload="groups.reload()" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { fromNow } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import AddGroupModal from '@/apps/mail/components/Modals/AddGroupModal.vue'

usePageMeta(() => ({ title: __('Groups') }))

const showAddGroup = ref(false)
const search = ref('')

const groups = createResource({
	url: 'suite.mail.api.admin.get_groups',
	auto: true,
	makeParams: () => ({ search: search.value }),
	cache: ['mailGroups', search.value],
})

watchDebounced(() => search.value, groups.reload, { debounce: 300 })

type GroupRow = { id: string; name: string; email?: string; description?: string; created_at?: string }

const LIST_COLUMNS = [
	{ label: __('Email'), key: 'email' },
	{ label: __('Description'), key: 'description' },
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
