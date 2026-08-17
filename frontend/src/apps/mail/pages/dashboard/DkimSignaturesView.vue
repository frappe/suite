<template>
	<DashboardLayout :breadcrumbs="[{ label: __('DKIM Signatures') }]">
		<ListView
			v-if="signatures?.data"
			class="flex-1"
			:columns="LIST_COLUMNS"
			:rows="signatures.data"
			:options="LIST_OPTIONS"
			row-key="id"
		>
			<ListHeader />
			<ListRows>
				<template v-if="signatures.data.length">
					<ListRow
						v-for="row in signatures.data"
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
		<DashboardListSkeleton v-else />
	</DashboardLayout>
</template>
<script setup lang="ts">
import { createResource, usePageMeta } from 'frappe-ui'
import { ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { fromNow } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'

usePageMeta(() => ({ title: __('DKIM Signatures') }))

const signatures = createResource({
	url: 'suite.mail.api.admin.get_dkim_signatures',
	auto: true,
	cache: ['mailDkimSignatures'],
})

type DkimRow = { id: string; algorithm?: string; domain?: string; selector?: string; created_at?: string }

const LIST_COLUMNS = [
	{ label: __('Algorithm'), key: 'algorithm' },
	{ label: __('Domain'), key: 'domain' },
	{ label: __('Selector'), key: 'selector' },
	{ label: __('Created At'), key: 'created_at' },
]

const LIST_OPTIONS = {
	selectable: false,
	showTooltip: false,
	emptyState: {
		title: __('No DKIM signatures yet'),
		description: __('DKIM signatures are generated automatically when you add a domain.'),
	},
	getRowRoute: (row: DkimRow) => ({ name: 'mail-dkim-signature', params: { signatureId: row.id } }),
}

const formatCreatedAt = (createdAt?: string) => fromNow(createdAt) || '—'
</script>
