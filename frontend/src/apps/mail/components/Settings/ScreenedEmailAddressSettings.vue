<template>
	<AppSettingsHeader :title="__('Screener')" />
	<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-[4.4rem] pb-8 pt-6 max-sm:px-4 max-sm:pt-4">
		<!-- The Screener's master switch, so this tab shows both the switch and the rules. Saves
		     immediately (no Save button here) — same JMAP Account flag the Account tab edits. -->
		<SettingsRow
			class="shrink-0 !py-0"
			:title="__('Screen New Senders')"
			:description="
				__(
					'Emails from new senders go to the Screener instead of your Inbox. Only accepted senders reach your Inbox.',
				)
			"
		>
			<Switch v-model="screeningEnabled" :disabled="setScreening.loading" />
		</SettingsRow>

		<template v-if="screenedAddresses.data?.length">
			<div class="flex shrink-0 items-center justify-between">
				<h2 class="text-base-semibold text-ink-gray-8">{{ __('Screened Senders') }}</h2>
				<Button icon-left="lucide-plus" :label="__('New')" @click="showAddModal = true" />
			</div>
			<div class="flex shrink-0 gap-2">
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
				<!-- Segmented sort control: field picker + direction toggle share a seam
					(-ml-px collapses the doubled border). -->
				<div class="flex">
					<AdaptiveDropdown :options="sortOptions" :title="__('Sort By')">
						<Button
							variant="outline"
							:label="sortLabel"
							icon-right="lucide-chevron-down"
							class="!rounded-r-none"
						/>
					</AdaptiveDropdown>
					<Button
						variant="outline"
						:icon="sortDir === 'asc' ? 'lucide-arrow-up' : 'lucide-arrow-down'"
						:tooltip="sortDir === 'asc' ? __('Ascending') : __('Descending')"
						class="-ml-px !rounded-l-none"
						@click="toggleSortDir"
					/>
				</div>
			</div>

			<div v-if="rows.length" class="relative min-h-0 flex-1">
				<div
					class="absolute inset-0 flex min-h-0 flex-col overflow-hidden [&>div]:h-full [&>div]:min-h-0"
				>
					<ListView
						ref="listView"
						class="h-full min-h-0"
						:columns="COLUMNS"
						:rows="rows"
						row-key="email"
					>
						<ListHeader />
						<ListRows />
						<!-- Default-slot override: drops the banner's built-in "Select all"
						     (redundant next to the header's master checkbox) and, on mobile,
						     its min-w-[596px], which is wider than the screen. -->
						<ListSelectBanner class="max-sm:!min-w-0">
							<template #default="{ selections, unselectAll }">
								<span class="text-ink-gray-9 shrink-0">
									{{ __('{0} selected', [String(selections.size)]) }}
								</span>
								<div class="ml-auto flex items-center gap-1">
									<AdaptiveDropdown :options="bulkActionOptions" :title="__('Change Action')">
										<Button
											variant="ghost"
											:label="__('Change Action')"
											icon-right="lucide-chevron-down"
										/>
									</AdaptiveDropdown>
									<Button
										variant="ghost"
										theme="red"
										:label="__('Remove')"
										@click="showRemoveModal = true"
									/>
									<Button icon="lucide-x" variant="ghost" @click="unselectAll" />
								</div>
							</template>
						</ListSelectBanner>
					</ListView>
				</div>
			</div>
			<div v-else class="text-ink-gray-6 text-sm">
				<p>{{ __('No screened senders match your search.') }}</p>
			</div>
		</template>
		<div v-else class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
			<p class="text-base font-medium">{{ __('No screened senders.') }}</p>
			<p>{{ MESSAGE }}</p>
			<Button
				icon-left="lucide-plus"
				:label="__('New')"
				class="w-fit"
				@click="showAddModal = true"
			/>
		</div>

		<AddScreenedSenderModal v-model="showAddModal" />
		<Dialog v-model:open="showRemoveModal" v-bind="removeModalOptions" />
		<Dialog v-model:open="showMoveToInbox" v-bind="moveToInboxOptions" />
	</div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import {
	Button, Dialog, FormControl, SettingsRow, Switch, createResource } from 'frappe-ui'
import { Icon as FeatherIcon, ListHeader, ListRows, ListSelectBanner, ListView } from 'frappe-ui/experimental'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'

import { getFormattedDate, raiseToast } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'
import { userStore } from '@/apps/mail/stores/user'
import AddScreenedSenderModal from '@/apps/mail/components/Modals/AddScreenedSenderModal.vue'

import type { MailboxData, ScreenedAddress, ScreeningAction } from '@/apps/mail/types'

const store = userStore()
const { screenedAddresses, mailboxes, mailboxIds } = store

const search = ref('')
const listViewRef = useTemplateRef('listView')
const showAddModal = ref(false)
const showRemoveModal = ref(false)

// Read the flag from the shared user data (not a document draft) so the sidebar pin and the
// Screener view react to a toggle here without a reload — mirroring the ScreenerView turn-off flow.
const activeAccount = computed(() =>
	store.userResource?.data?.accounts?.find((a) => a.id === store.accountId),
)

const setScreening = createResource({
	url: 'frappe.client.set_value',
	makeParams: ({ value }: { value: boolean }) => ({
		doctype: 'JMAP Account',
		name: activeAccount.value?.jmap_account,
		fieldname: 'enable_screening',
		value: value ? 1 : 0,
	}),
})

const screeningEnabled = computed({
	get: () => !!activeAccount.value?.enable_screening,
	set: (val: boolean) => toggleScreening(val),
})

const toggleScreening = async (val: boolean) => {
	const account = activeAccount.value
	if (!account) return
	// Read the count before the reload below refreshes the data from the server.
	const waiting =
		mailboxes.data?.find((m: MailboxData) => m.id === mailboxIds.screener)?.total_threads ?? 0
	account.enable_screening = val
	try {
		await setScreening.submit({ value: val })
		// Enabling screening creates the Screening folder server-side; reload so it shows up.
		mailboxes.reload()
		raiseToast(val ? __('Screener turned on.') : __('Screener turned off.'))
		// Turning screening off leaves the already-screened mail in the Screening folder — offer to
		// move it to the inbox (only worth asking when there's something there).
		if (!val && waiting > 0) showMoveToInbox.value = true
	} catch (error) {
		account.enable_screening = !val
		raiseToast((error as Error).message || __('Could not update the Screener.'), 'error')
	}
}

const showMoveToInbox = ref(false)

const moveScreeningToInbox = createResource({
	url: 'suite.mail.api.mail.move_screening_mails_to_inbox',
	makeParams: () => ({ account: store.accountId }),
	onSuccess: () => {
		raiseToast(__('Unscreened messages moved to Inbox.'))
		showMoveToInbox.value = false
		mailboxes.reload()
	},
})

const moveToInboxOptions = computed(() => ({
	title: __('Move unscreened messages?'),
	message: __('Screening is off. Move the messages currently in the Screener to your Inbox?'),
	actions: [
		{
			label: __('Move to Inbox'),
			variant: 'solid',
			onClick: () => moveScreeningToInbox.submit(),
			loading: moveScreeningToInbox.loading,
		},
	],
}))

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

const sortLabel = computed(() => SORT_LABELS[sortField.value])
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
			// `modified` is a naive system-zone DB timestamp; move it into the user's zone
			// before the Today/Yesterday labels are applied. Blank (optimistic rows) stays blank.
			modified: a.modified ? getFormattedDate(formatSystemDateTime(a.modified, 'YYYY-MM-DDTHH:mm:ss')) : '',
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
