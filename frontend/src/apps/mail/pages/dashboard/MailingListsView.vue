<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('Mailing Lists') }]"
		:button-label="__('Add Mailing List')"
		:button-action="() => (showAdd = true)"
	>
		<div class="flex items-center space-x-3">
			<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
				<template #prefix>
					<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
				</template>
			</FormControl>
		</div>
		<ListView
			v-if="lists?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="lists.data"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="lists.data.length">
					<ListRow
						v-for="row in lists.data"
						:key="row.id"
						v-slot="{ item }"
						:row="row"
						class="hover:!bg-surface-gray-1"
					>
						<ListRowItem :item="item" />
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
		</ListView>
		<DashboardListSkeleton v-else :columns="3" />
	</DashboardLayout>
	<AddMailingListModal v-model="showAdd" @reload="lists.reload()" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import AddMailingListModal from '@/apps/mail/components/Modals/AddMailingListModal.vue'

usePageMeta(() => ({ title: __('Mailing Lists') }))

const showAdd = ref(false)
const search = ref('')

const lists = createResource({
	url: 'suite.mail.api.admin.get_mailing_lists',
	auto: true,
	makeParams: () => ({ search: search.value }),
	cache: ['mailMailingLists', search.value],
})

watchDebounced(() => search.value, lists.reload, { debounce: 300 })

type ListRowType = { id: string; email?: string; description?: string; recipient_count?: number }

const LIST_COLUMNS = [
	{ label: __('Email'), key: 'email' },
	{ label: __('Description'), key: 'description' },
	{ label: __('Recipients'), key: 'recipient_count' },
]

const hasActiveFilters = computed(() => !!search.value)

const listOptions = computed(() => ({
	selectable: false,
	showTooltip: false,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching mailing lists'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No mailing lists yet'),
				description: __('Create a mailing list to broadcast mail to many recipients at once.'),
				button: {
					label: __('Add Mailing List'),
					variant: 'solid',
					onClick: () => (showAdd.value = true),
				},
			},
	getRowRoute: (row: ListRowType) => ({ name: 'mail-mailing-list', params: { listId: row.id } }),
}))
</script>
