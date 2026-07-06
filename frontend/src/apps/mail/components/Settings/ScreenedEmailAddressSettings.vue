<template>
	<!-- A single h-full flex column gives the ListView a bounded flex parent so it fills the panel and
	scrolls within itself, instead of taking a small intrinsic height with empty space below. -->
	<div class="flex min-h-0 flex-1 flex-col gap-4">
		<div class="flex items-center justify-between">
			<h1>{{ __('Screened Senders') }}</h1>
			<Button icon-left="lucide-plus" :label="__('New')" @click="showAddModal = true" />
		</div>

		<template v-if="screenedAddresses.data?.length">
			<!-- Search filters the list client-side; the sort control sits on the right. -->
			<div class="flex gap-2">
				<FormControl
					v-model="search"
					type="text"
					variant="outline"
					:placeholder="__('Search screened senders')"
					class="flex-1"
				>
					<template #prefix>
						<FeatherIcon name="search" class="text-ink-gray-5 w-4" />
					</template>
				</FormControl>
				<Dropdown :options="sortOptions">
					<Button variant="outline" :label="sortLabel" icon-right="lucide-chevron-down" />
				</Dropdown>
				<Button
					variant="outline"
					:icon="sortDir === 'asc' ? 'lucide-arrow-up' : 'lucide-arrow-down'"
					:tooltip="sortDir === 'asc' ? __('Ascending') : __('Descending')"
					@click="toggleSortDir"
				/>
			</div>

			<ListView
				v-if="rows.length"
				ref="listView"
				class="min-h-0 flex-1"
				:columns="COLUMNS"
				:rows="rows"
				row-key="email"
			>
				<ListHeader />
				<ListRows />
				<ListSelectBanner>
					<template #actions>
						<Dropdown :options="bulkActionOptions">
							<Button
								variant="ghost"
								:label="__('Change Action')"
								icon-right="lucide-chevron-down"
							/>
						</Dropdown>
						<Button
							variant="ghost"
							theme="red"
							:label="__('Remove')"
							@click="showRemoveModal = true"
						/>
					</template>
				</ListSelectBanner>
			</ListView>
			<div v-else class="text-ink-gray-6 text-sm">
				<p>{{ __('No screened senders match your search.') }}</p>
			</div>
		</template>
		<div v-else class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
			<p class="text-base font-medium">{{ __('No screened senders.') }}</p>
			<p>{{ MESSAGE }}</p>
		</div>

		<AddScreenedSenderModal v-model="showAddModal" />
		<Dialog v-model="showRemoveModal" :options="removeModalOptions" />
	</div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import {
	Button,
	Dialog,
	Dropdown,
	FeatherIcon,
	FormControl,
	ListHeader,
	ListRows,
	ListSelectBanner,
	ListView,
	createResource,
} from 'frappe-ui'

import { getFormattedDate, raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'
import AddScreenedSenderModal from '@/apps/mail/components/Modals/AddScreenedSenderModal.vue'

import type { ScreenedAddress, ScreeningAction } from '@/apps/mail/types'

const store = userStore()
const { screenedAddresses } = store

const search = ref('')
const listViewRef = useTemplateRef('listView')
const showAddModal = ref(false)
const showRemoveModal = ref(false)

const ACTION_LABELS: Partial<Record<ScreeningAction, string>> = {
	Accepted: __('Accept'),
	Reject: __('Block'),
	Spam: __('Move to Junk'),
}

// Sort by when a rule was added ('creation'), last changed ('modified'), or alphabetically ('email').
// Defaults to most-recently modified, matching the backend's default order.
type SortField = 'modified' | 'creation' | 'email'
const SORT_LABELS: Record<SortField, string> = {
	modified: __('Last Modified'),
	creation: __('Created'),
	email: __('Email'),
}
const sortField = ref<SortField>('modified')
const sortDir = ref<'asc' | 'desc'>('desc')

const sortLabel = computed(() => __('Sort: {0}', [SORT_LABELS[sortField.value]]))
const sortOptions = computed(() =>
	(Object.keys(SORT_LABELS) as SortField[]).map((field) => ({
		label: SORT_LABELS[field],
		onClick: () => (sortField.value = field),
	})),
)
const toggleSortDir = () => (sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc')

// Filter by the search term, then sort by the chosen field/direction, before mapping to display rows.
// Sorting on the raw values (not the translated action label or formatted date) keeps the order correct.
const rows = computed(() => {
	const query = search.value.trim().toLowerCase()
	const dir = sortDir.value === 'asc' ? 1 : -1

	return (screenedAddresses.data ?? [])
		.filter((a: ScreenedAddress) => !query || a.email.toLowerCase().includes(query))
		.slice()
		.sort((a: ScreenedAddress, b: ScreenedAddress) => {
			const field = sortField.value
			// ISO timestamps sort correctly as plain strings, so one localeCompare covers all fields.
			return a[field].localeCompare(b[field]) * dir
		})
		.map((a: ScreenedAddress) => ({
			email: a.email,
			action: ACTION_LABELS[a.action] ?? a.action,
			modified: getFormattedDate(a.modified),
		}))
})

const selectedEmails = () => Array.from(listViewRef.value?.selections ?? []) as string[]

// Bulk edit: `screen_email_addresses` upserts the action for every selected address and rebuilds the
// sieve script only once, so switching many senders between Block/Junk/Accept is a single request.
const editScreenedAddresses = createResource({
	url: 'suite.mail.api.mail.screen_email_addresses',
	makeParams: ({ action }: { action: ScreeningAction }) => ({
		account: store.accountId,
		emails: selectedEmails(),
		action,
	}),
	onSuccess: () => {
		raiseToast(__('Action updated.'))
		listViewRef.value?.toggleAllRows()
		screenedAddresses.reload()
	},
	// Keep the selection on failure so the user can retry the same rows.
	onError: (error) => raiseToast(error.message || __('Failed to update action.'), 'error'),
})

const bulkActionOptions = (['Accepted', 'Reject', 'Spam'] as ScreeningAction[]).map((action) => ({
	label: ACTION_LABELS[action] ?? action,
	onClick: () => editScreenedAddresses.submit({ action }),
}))

// Bulk delete: deletes the selected records and rebuilds the sieve script once (the backend deletes the
// rows in a single query and regenerates the script a single time afterwards).
const unscreenEmailAddresses = createResource({
	url: 'suite.mail.api.mail.unscreen_email_addresses',
	makeParams: () => ({ account: store.accountId, emails: selectedEmails() }),
	onSuccess: () => {
		raiseToast(__('Senders removed.'))
		showRemoveModal.value = false
		listViewRef.value?.toggleAllRows()
		screenedAddresses.reload()
	},
	// Close the confirmation and keep the selection so the user can retry.
	onError: (error) => {
		showRemoveModal.value = false
		raiseToast(error.message || __('Failed to remove senders.'), 'error')
	},
})

const removeModalOptions = computed(() => ({
	title: __('Remove Screened Senders'),
	message: __('Are you sure you want to remove the selected senders from your screened list?'),
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			onClick: () => unscreenEmailAddresses.submit(),
			loading: unscreenEmailAddresses.loading,
		},
	],
}))

// `fr` units (numbers) so the columns share the row width instead of overflowing (percentages plus the
// checkbox column would exceed 100% and add a horizontal scrollbar).
const COLUMNS = [
	{ label: __('Email or Domain'), key: 'email', width: 3 },
	{ label: __('Action'), key: 'action', width: 1 },
	{ label: __('Last Modified'), key: 'modified', width: 1 },
]

const MESSAGE = __(
	'Screen specific senders — or a whole domain (e.g. @example.com) — to either reject their messages or send them straight to Spam.',
)
</script>
