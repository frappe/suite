<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('Roles') }]"
		:button-label="__('Add Role')"
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
			v-if="roles?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="roles.data"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="roles.data.length">
					<ListRow
						v-for="row in roles.data"
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
	<AddRoleModal v-model="showAdd" @reload="roles.reload()" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import AddRoleModal from '@/apps/mail/components/Modals/AddRoleModal.vue'

usePageMeta(() => ({ title: __('Roles') }))

const showAdd = ref(false)
const search = ref('')

const roles = createResource({
	url: 'suite.mail.api.admin.get_roles_list',
	auto: true,
	makeParams: () => ({ search: search.value }),
	cache: ['mailRoles', search.value],
})

watchDebounced(() => search.value, roles.reload, { debounce: 300 })

type RoleRow = { id: string; description: string; enabled_count: number; disabled_count: number }

const LIST_COLUMNS = [
	{ label: __('Description'), key: 'description' },
	{ label: __('Enabled Permissions'), key: 'enabled_count' },
	{ label: __('Disabled Permissions'), key: 'disabled_count' },
]

const hasActiveFilters = computed(() => !!search.value)

const listOptions = computed(() => ({
	selectable: false,
	showTooltip: false,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching roles'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No roles yet'),
				description: __('Roles control which permissions members have.'),
				button: {
					label: __('Add Role'),
					variant: 'solid',
					onClick: () => (showAdd.value = true),
				},
			},
	getRowRoute: (row: RoleRow) => ({ name: 'mail-role', params: { roleId: row.id } }),
}))
</script>
