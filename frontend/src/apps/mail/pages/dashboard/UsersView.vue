<template>
	<div class="flex items-center space-x-3">
		<FormControl v-model="search" :placeholder="__('Search')" class="w-80">
			<template #prefix>
				<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
			</template>
		</FormControl>
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
	<ListView
		v-if="normalizedMembers"
		ref="listView"
		class="flex-1"
		:columns="LIST_COLUMNS"
		:rows="normalizedMembers"
		:options="LIST_OPTIONS"
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
					class="hover:bg-surface-gray-1 cursor-pointer rounded"
				>
					<ListRowItem :item="item">
						<template v-if="column.key === 'user'">
							<div class="flex items-center space-x-2">
								<Avatar :image="row.user_image" :label="row.full_name" size="lg" />
								<div class="text-sm">
									<p class="font-medium">{{ row.full_name }}</p>
									<p class="text-ink-gray-5 mt-0.5">{{ row.name }}</p>
								</div>
							</div>
						</template>
						<template v-else-if="column.key === 'role'">
							<Badge
								:label="row.is_admin ? __('Admin') : __('User')"
								:theme="row.is_admin ? 'orange' : 'blue'"
							/>
						</template>
						<template v-else-if="column.key === 'status'">
							<Badge
								:label="row.enabled ? __('Enabled') : __('Disabled')"
								:theme="row.enabled ? 'green' : 'gray'"
							/>
						</template>
						<template v-else-if="column.key === 'last_active'">
							<span class="text-ink-gray-5 text-sm">
								{{
									row.last_active && dayjs
										? dayjs(row.last_active).fromNow()
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
	<Dialog v-model="showEnableMembers" :options="ENABLE_MEMBERS_OPTIONS" />
	<Dialog v-model="showDisableMembers" :options="DISABLE_MEMBERS_OPTIONS" />
	<Dialog v-model="showDeleteMembers" :options="DELETE_MEMBERS_OPTIONS" />
</template>

<script setup lang="ts">
import { computed, inject, ref, useTemplateRef, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
	Avatar,
	Badge,
	Button,
	Dialog,
	FeatherIcon,
	FormControl,
	ListEmptyState,
	ListHeader,
	ListRow,
	ListRowItem,
	ListRows,
	ListSelectBanner,
	ListView,
	createResource,
} from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

type DayjsFn = (value?: string | Date | null) => { fromNow: () => string }
type MemberRow = {
	name: string
	full_name: string
	user_image?: string
	last_active?: string | null
	is_admin: boolean
	enabled: boolean
}

const dayjs = inject<DayjsFn>('$dayjs')

const search = ref('')
const roleFilter = ref<'all' | 'admin' | 'user'>('all')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const showEnableMembers = ref(false)
const showDisableMembers = ref(false)
const showDeleteMembers = ref(false)
const listView = useTemplateRef<{
	selections?: Set<string>
	toggleAllRows?: () => void
}>('listView')

const members = createResource({
	url: 'suite.mail.api.admin.get_members',
	makeParams: () => {
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
	},
	auto: true,
	cache: ['mailMembers', search.value, roleFilter.value, statusFilter.value],
})

const normalizedMembers = computed<MemberRow[]>(() => {
	const map = new Map<string, MemberRow>()

	for (const row of (members.data || []) as MemberRow[]) {
		if (!map.has(row.name)) map.set(row.name, row)
	}

	return Array.from(map.values())
})

watchDebounced(() => search.value, members.reload, { debounce: 300 })
watch(() => roleFilter.value, members.reload)
watch(() => statusFilter.value, members.reload)

const reloadMembers = () => members.reload()
defineExpose({ reloadMembers })

const LIST_COLUMNS = [
	{ label: __('User'), key: 'user' },
	{ label: __('Role'), key: 'role' },
	{ label: __('Status'), key: 'status' },
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

const LIST_OPTIONS = {
	showTooltip: false,
	rowHeight: 50,
	emptyState: { description: __('No members found.') },
}

const enableMembers = createResource({
	url: 'suite.mail.api.admin.enable_members',
	makeParams: () => ({ names: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		members.reload()
		showEnableMembers.value = false
		raiseToast(__('Members enabled.'))
		listView.value?.toggleAllRows?.()
	},
	onError: (error: { messages?: string[] }) => {
		showEnableMembers.value = false
		raiseToast(error.messages?.[0] || __('Failed to enable members.'), 'error')
	},
})

const ENABLE_MEMBERS_OPTIONS = {
	title: __('Enable Members'),
	message: __(
		'Are you sure you want to enable the selected members? They will be able to log in again.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: enableMembers.submit }],
}

const disableMembers = createResource({
	url: 'suite.mail.api.admin.disable_members',
	makeParams: () => ({ names: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		members.reload()
		showDisableMembers.value = false
		raiseToast(__('Members disabled.'))
		listView.value?.toggleAllRows?.()
	},
	onError: (error: { messages?: string[] }) => {
		showDisableMembers.value = false
		raiseToast(error.messages?.[0] || __('Failed to disable members.'), 'error')
	},
})

const DISABLE_MEMBERS_OPTIONS = {
	title: __('Disable Members'),
	message: __(
		'Are you sure you want to disable the selected members? They will no longer be able to log in.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: disableMembers.submit }],
}

const deleteMembers = createResource({
	url: 'suite.mail.api.admin.delete_members',
	makeParams: () => ({ names: Array.from(listView.value?.selections || []) }),
	onSuccess: () => {
		members.reload()
		showDeleteMembers.value = false
		raiseToast(__('Members deleted.'))
		listView.value?.toggleAllRows?.()
	},
	onError: (error: { messages?: string[] }) => {
		showDeleteMembers.value = false
		raiseToast(error.messages?.[0] || __('Failed to delete members.'), 'error')
	},
})

const DELETE_MEMBERS_OPTIONS = {
	title: __('Delete Members'),
	message: __(
		'Are you sure you want to delete the selected members? This action cannot be undone.',
	),
	actions: [{ label: __('Confirm'), variant: 'solid', onClick: deleteMembers.submit }],
}
</script>
