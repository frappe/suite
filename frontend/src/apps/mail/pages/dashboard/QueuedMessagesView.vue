<template>
	<DashboardLayout :breadcrumbs="[{ label: __('Queued') }]">
		<div class="flex items-center justify-between">
			<div class="flex items-center space-x-3">
				<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
					<template #prefix><FeatherIcon name="search" class="text-ink-gray-5 w-4" /></template>
				</FormControl>
				<FormControl v-model="sender" :placeholder="__('Sender')" class="w-56">
					<template #prefix><FeatherIcon name="user" class="text-ink-gray-5 w-4" /></template>
				</FormControl>
			</div>
			<div class="flex items-center gap-2">
				<Button :label="__('Retry All')" @click="showRetryAll = true" />
				<Button theme="red" :label="__('Cancel All')" @click="showCancelAll = true" />
			</div>
		</div>
		<ListView
			v-if="messages?.data"
			ref="listView"
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
							<span v-if="column.key === 'recipients'" class="truncate">{{ recipientLabel(row) }}</span>
							<span v-else-if="column.key === 'size'">{{ formatBytes(row.size || 0) }}</span>
							<span v-else-if="column.key === 'next_retry'">{{ fromNow(row.next_retry) }}</span>
							<span v-else-if="column.key === 'created_at'">{{ fromNow(row.created_at) }}</span>
						</ListRowItem>
					</ListRow>
				</template>
				<ListEmptyState v-else />
			</ListRows>
			<ListSelectBanner>
				<template #actions>
					<Button variant="ghost" :label="__('Retry')" @click="showRetrySelected = true" />
					<Button variant="ghost" theme="red" :label="__('Cancel')" @click="showCancelSelected = true" />
				</template>
			</ListSelectBanner>
		</ListView>
		<DashboardListSkeleton v-else :columns="5" />
		<DashboardPager :page="page" :page-length="PAGE_LENGTH" :total="total" @update:page="(p) => (page = p)" />
	</DashboardLayout>
	<Dialog v-model:open="showRetrySelected" v-bind="retrySelectedOptions" />
	<Dialog v-model:open="showCancelSelected" v-bind="cancelSelectedOptions" />
	<Dialog v-model:open="showRetryAll" v-bind="retryAllOptions" />
	<Dialog v-model:open="showCancelAll" v-bind="cancelAllOptions" />
</template>
<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
	Button, Dialog, FormControl, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon, ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListSelectBanner, ListView } from 'frappe-ui/experimental'

import { formatBytes, raiseToast } from '@/apps/mail/utils'
import { fromNow as formatFromNow } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'

type QueueRow = {
	id: string
	sender?: string
	recipients: string[]
	recipient_count: number
	size?: number
	next_retry?: string
	created_at?: string
}

usePageMeta(() => ({ title: __('Queued') }))

const PAGE_LENGTH = 50
const search = ref('')
const sender = ref('')
const page = ref(1)
const showRetrySelected = ref(false)
const showCancelSelected = ref(false)
const showRetryAll = ref(false)
const showCancelAll = ref(false)
const listView = useTemplateRef<{ selections?: Set<string>; toggleAllRows?: () => void }>('listView')

const messages = createResource({
	url: 'suite.mail.api.admin.get_queued_messages',
	auto: true,
	makeParams: () => ({ search: search.value, sender: sender.value, page: page.value, page_length: PAGE_LENGTH }),
	cache: ['mailQueue', search.value, sender.value, page.value],
})

const rows = computed<QueueRow[]>(() => messages.data?.messages || [])
const total = computed(() => messages.data?.total || 0)

watchDebounced(() => [search.value, sender.value], () => ((page.value = 1), messages.reload()), { debounce: 300 })
watch(page, messages.reload)

const selectedIds = () => Array.from(listView.value?.selections || [])
const currentFilter = () => ({ search: search.value, sender: sender.value })

const fromNow = (value?: string) => formatFromNow(value) || '—'
const recipientLabel = (row: QueueRow) => {
	if (!row.recipients.length) return '—'
	const [first, ...rest] = row.recipients
	return rest.length ? `${first} +${rest.length}` : first
}

const LIST_COLUMNS = [
	{ label: __('Sender'), key: 'sender' },
	{ label: __('Recipients'), key: 'recipients' },
	{ label: __('Next Retry'), key: 'next_retry' },
	{ label: __('Received'), key: 'created_at' },
	{ label: __('Size'), key: 'size' },
]

const hasActiveFilters = computed(() => !!search.value || !!sender.value)

const listOptions = computed(() => ({
	showTooltip: false,
	rowHeight: 50,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching messages'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('Queue is empty'),
				description: __('Messages waiting for delivery will appear here.'),
			},
	getRowRoute: (row: QueueRow) => ({ name: 'mail-queued-message', params: { messageId: row.id } }),
}))

const afterAction = (message: string) => {
	messages.reload()
	listView.value?.toggleAllRows?.()
	raiseToast(message)
}

const retrySelected = createResource({
	url: 'suite.mail.api.admin.retry_queued_messages',
	makeParams: () => ({ ids: selectedIds() }),
	onSuccess: () => ((showRetrySelected.value = false), afterAction(__('Messages scheduled for retry.'))),
	onError: (error: { messages?: string[] }) => {
		showRetrySelected.value = false
		raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
	},
})
const cancelSelected = createResource({
	url: 'suite.mail.api.admin.cancel_queued_messages',
	makeParams: () => ({ ids: selectedIds() }),
	onSuccess: () => ((showCancelSelected.value = false), afterAction(__('Messages cancelled.'))),
	onError: (error: { messages?: string[] }) => {
		showCancelSelected.value = false
		raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
	},
})
const retryAll = createResource({
	url: 'suite.mail.api.admin.retry_all_queued_messages',
	makeParams: currentFilter,
	onSuccess: () => ((showRetryAll.value = false), afterAction(__('All matching messages scheduled for retry.'))),
	onError: (error: { messages?: string[] }) => {
		showRetryAll.value = false
		raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
	},
})
const cancelAll = createResource({
	url: 'suite.mail.api.admin.cancel_all_queued_messages',
	makeParams: currentFilter,
	onSuccess: () => ((showCancelAll.value = false), afterAction(__('All matching messages cancelled.'))),
	onError: (error: { messages?: string[] }) => {
		showCancelAll.value = false
		raiseToast(error.messages?.[0] || __('Request failed.'), 'error')
	},
})

const retrySelectedOptions = computed(() => ({
	title: __('Retry Messages'),
	message: __('Schedule the selected messages for immediate delivery?'),
	actions: [{ label: __('Retry'), variant: 'solid', onClick: retrySelected.submit }],
}))
const cancelSelectedOptions = computed(() => ({
	title: __('Cancel Messages'),
	message: __('Cancel (delete) the selected messages? This cannot be undone.'),
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: cancelSelected.submit }],
}))
const retryAllOptions = computed(() => ({
	title: __('Retry All Messages'),
	message: __('Schedule every message matching the current filter for immediate delivery?'),
	actions: [{ label: __('Retry All'), variant: 'solid', onClick: retryAll.submit }],
}))
const cancelAllOptions = computed(() => ({
	title: __('Cancel All Messages'),
	message: __('Cancel (delete) every message matching the current filter? This cannot be undone.'),
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: cancelAll.submit }],
}))
</script>
