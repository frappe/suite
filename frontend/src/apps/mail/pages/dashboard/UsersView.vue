<template>
	<div class="flex items-center justify-between gap-3">
		<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
			<template #prefix>
				<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
			</template>
		</FormControl>
		<div class="flex items-center gap-3">
			<FormControl
				v-model="roleFilter"
				:placeholder="__('Role')"
				class="w-40"
				type="select"
				:options="ROLE_FILTER_OPTIONS"
			/>
			<FormControl
				v-model="statusFilter"
				:placeholder="__('Status')"
				class="w-40"
				type="select"
				:options="STATUS_FILTER_OPTIONS"
			/>
		</div>
	</div>
	<ListView
		v-if="list.loaded"
		ref="listView"
		class="min-h-0 flex-1 !overflow-y-auto [&>div:first-child]:sticky [&>div:first-child]:top-0 [&>div:first-child]:z-10"
		:columns="LIST_COLUMNS"
		:rows="normalizedMembers"
		:options="listOptions"
		row-key="name"
	>
		<ListHeader />
		<ListRows>
			<template v-if="normalizedMembers.length">
				<ListRow
					v-for="row in normalizedMembers"
					:key="row.name"
					v-slot="{ column, item }"
					:row="row"
					class="hover:!bg-surface-gray-1"
				>
					<ListRowItem :item="item">
						<template v-if="column.key === 'user'">
							<div class="flex items-center space-x-2">
								<Avatar :image="row.user_image" :label="row.full_name" size="lg" />
								<!-- A member row is a contact row: the User's docname is the address. -->
								<ContactOption
									:contact="{ email: row.name, display_name: row.full_name }"
									class="text-sm"
								/>
							</div>
						</template>
						<template v-else-if="column.key === 'role'">
							<Badge
								:label="row.is_admin ? __('Admin') : __('User')"
								:theme="row.is_admin ? 'amber' : 'blue'"
							/>
						</template>
						<template v-else-if="column.key === 'status'">
							<Badge
								:label="row.enabled ? __('Enabled') : __('Disabled')"
								:theme="row.enabled ? 'green' : 'gray'"
							/>
						</template>
						<template v-else-if="column.key === 'quota'">
							<span class="text-ink-gray-5 text-sm">{{ formatQuota(row.quota_gb) }}</span>
						</template>
						<template v-else-if="column.key === 'last_active'">
							<span class="text-ink-gray-5 text-sm">
								{{
									row.last_active
										? fromNow(row.last_active)
										: __('Never')
								}}
							</span>
						</template>
					</ListRowItem>
				</ListRow>
			</template>
			<ListEmptyState v-else />
		</ListRows>
		<ListSelectBanner>
			<template #actions>
				<Button
					variant="ghost"
					:label="__('Enable')"
					@click="showEnableMembers = true"
				/>
				<Button
					variant="ghost"
					:label="__('Disable')"
					@click="showDisableMembers = true"
				/>
				<Button
					variant="ghost"
					theme="red"
					:label="__('Delete')"
					@click="showDeleteMembers = true"
				/>
			</template>
		</ListSelectBanner>
	</ListView>
	<DashboardListSkeleton v-else :columns="6" />
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
	<Dialog v-model:open="showEnableMembers" v-bind="ENABLE_MEMBERS_OPTIONS" />
	<Dialog v-model:open="showDisableMembers" v-bind="DISABLE_MEMBERS_OPTIONS" />
	<Dialog v-model:open="showDeleteMembers" v-bind="DELETE_MEMBERS_OPTIONS" />
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { watchDebounced } from '@vueuse/core'
import {
	Avatar,
	Badge,
	Button,
	Dialog,
	FormControl,
	createResource,
} from 'frappe-ui'
import {
	Icon as FeatherIcon,
	ListEmptyState,
	ListHeader,
	ListRow,
	ListRowItem,
	ListRows,
	ListSelectBanner,
	ListView,
} from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { fromNow } from '@/apps/mail/utils/datetime'
import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import { usePagedList } from '@/apps/mail/utils/pagedList'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'


type MemberRow = {
	name: string
	full_name: string
	user_image?: string
	last_active?: string | null
	is_admin: boolean
	enabled: boolean
	quota_gb?: number | null
}

const search = ref('')
const roleFilter = ref<'all' | 'admin' | 'user'>('all')
// The overview links here with ?status=disabled; the filter follows the query on arrival.
type StatusFilter = 'all' | 'enabled' | 'disabled'
const route = useRoute()
const statusFromQuery = (): StatusFilter =>
	route.query.status === 'disabled' || route.query.status === 'enabled' ? route.query.status : 'all'
const statusFilter = ref<StatusFilter>(statusFromQuery())
watch(() => route.query.status, () => (statusFilter.value = statusFromQuery()))
const showEnableMembers = ref(false)
const showDisableMembers = ref(false)
const showDeleteMembers = ref(false)
const listView = useTemplateRef<{
	selections?: Set<string>
	toggleAllRows?: () => void
}>('listView')

const list = usePagedList<MemberRow>('suite.mail.api.admin.get_members', () => {
	const params: { search: string; is_admin?: boolean; is_enabled?: boolean } = {
		search: search.value,
	}

	if (roleFilter.value !== 'all') {
		params.is_admin = roleFilter.value === 'admin'
	}

	if (statusFilter.value !== 'all') {
		params.is_enabled = statusFilter.value === 'enabled'
	}

	return params
})

const normalizedMembers = computed<MemberRow[]>(() => {
	const map = new Map<string, MemberRow>()

	for (const row of list.rows) {
		if (!map.has(row.name)) map.set(row.name, row)
	}

	return Array.from(map.values())
})

watchDebounced(() => search.value, list.reload, { debounce: 300 })
watch(() => roleFilter.value, list.reload)
watch(() => statusFilter.value, list.reload)

// The ListView keeps its selection across reloads, so after "select all" on 100 rows and a
// switch to 20 the banner still claimed 100. Names that are no longer listed leave the set;
// Load More only adds rows, so it keeps the selection intact.
watch(
	() => list.rows,
	(rows) => {
		const selections = listView.value?.selections
		if (!selections?.size) return
		const shown = new Set(rows.map((row) => row.name))
		for (const name of Array.from(selections)) {
			if (!shown.has(name)) selections.delete(name)
		}
	},
)

const reloadMembers = () => list.reload()
defineExpose({ reloadMembers })

// The allotment only; usage would cost a cluster call per row and lives on the account page.
const formatQuota = (gb?: number | null) => (gb == null ? '—' : __('{0} GB', [String(gb)]))

const LIST_COLUMNS = [
	{ label: __('User'), key: 'user' },
	{ label: __('Role'), key: 'role' },
	{ label: __('Status'), key: 'status' },
	{ label: __('Quota'), key: 'quota' },
	{ label: __('Last Active'), key: 'last_active' },
]

const ROLE_FILTER_OPTIONS = [
	{ label: __('All'), value: 'all' },
	{ label: __('Admin'), value: 'admin' },
	{ label: __('User'), value: 'user' },
]

const STATUS_FILTER_OPTIONS = [
	{ label: __('All'), value: 'all' },
	{ label: __('Enabled'), value: 'enabled' },
	{ label: __('Disabled'), value: 'disabled' },
]

const hasActiveFilters = computed(
	() => !!search.value || roleFilter.value !== 'all' || statusFilter.value !== 'all',
)

const listOptions = computed(() => ({
	showTooltip: false,
	rowHeight: 50,
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching accounts'),
				description: __('Try adjusting your search or filters.'),
			}
		: {
				title: __('No accounts found'),
				description: __('Invite people to give them a mailbox on your domains.'),
			},
	getRowRoute: (row: MemberRow) => ({
		name: 'mail-account',
		params: { accountId: row.name },
	}),
}))

const enableMembers = createResource({
	url: 'suite.mail.api.admin.enable_members',
	makeParams: () => ({ names: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		list.reload()
		showEnableMembers.value = false
		raiseToast(__('Accounts enabled.'))
		listView.value?.toggleAllRows?.()
	},
	onError: (error: { messages?: string[] }) => {
		showEnableMembers.value = false
		raiseToast(error.messages?.[0] || __('Failed to enable accounts.'), 'error')
	},
})

const ENABLE_MEMBERS_OPTIONS = {
	title: __('Enable Accounts'),
	message: __(
		'Are you sure you want to enable the selected accounts? They will be able to log in again.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: enableMembers.submit }],
}

const disableMembers = createResource({
	url: 'suite.mail.api.admin.disable_members',
	makeParams: () => ({ names: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		list.reload()
		showDisableMembers.value = false
		raiseToast(__('Accounts disabled.'))
		listView.value?.toggleAllRows?.()
	},
	onError: (error: { messages?: string[] }) => {
		showDisableMembers.value = false
		raiseToast(error.messages?.[0] || __('Failed to disable accounts.'), 'error')
	},
})

const DISABLE_MEMBERS_OPTIONS = {
	title: __('Disable Accounts'),
	message: __(
		'Are you sure you want to disable the selected accounts? They will no longer be able to log in.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: disableMembers.submit }],
}

const deleteMembers = createResource({
	url: 'suite.mail.api.admin.delete_members',
	makeParams: () => ({ names: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		list.reload()
		showDeleteMembers.value = false
		raiseToast(__('Accounts deleted.'))
		listView.value?.toggleAllRows?.()
	},
	onError: (error: { messages?: string[] }) => {
		showDeleteMembers.value = false
		raiseToast(error.messages?.[0] || __('Failed to delete accounts.'), 'error')
	},
})

const DELETE_MEMBERS_OPTIONS = {
	title: __('Delete Accounts'),
	message: __(
		'Are you sure you want to delete the selected accounts? This action cannot be undone.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteMembers.submit }],
}
</script>
