<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('OAuth Clients') }]"
		:button-label="__('Add OAuth Client')"
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
			v-if="clients?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="clients.data"
			:options="listOptions"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="clients.data.length">
					<ListRow
						v-for="row in clients.data"
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
	<AddOAuthClientModal v-model="showAdd" @reload="clients.reload()" />
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
import AddOAuthClientModal from '@/apps/mail/components/Modals/AddOAuthClientModal.vue'

usePageMeta(() => ({ title: __('OAuth Clients') }))

const showAdd = ref(false)
const search = ref('')

const clients = createResource({
	url: 'suite.mail.api.admin.get_oauth_clients',
	auto: true,
	makeParams: () => ({ search: search.value }),
	cache: ['mailOAuthClients', search.value],
})

watchDebounced(() => search.value, clients.reload, { debounce: 300 })

type ClientRow = { id: string; client_id: string; description?: string; created_at?: string }

const LIST_COLUMNS = [
	{ label: __('Client ID'), key: 'client_id' },
	{ label: __('Description'), key: 'description' },
	{ label: __('Created At'), key: 'created_at' },
]

const hasActiveFilters = computed(() => !!search.value)

const listOptions = computed(() => ({
	selectable: false,
	showTooltip: false,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching OAuth clients'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No OAuth clients yet'),
				description: __('OAuth clients let external apps authenticate with your mail server.'),
				button: {
					label: __('Add OAuth Client'),
					variant: 'solid',
					onClick: () => (showAdd.value = true),
				},
			},
	getRowRoute: (row: ClientRow) => ({ name: 'mail-oauth-client', params: { clientId: row.id } }),
}))

const formatCreatedAt = (createdAt?: string) => fromNow(createdAt) || '—'
</script>
