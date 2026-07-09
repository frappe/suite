<template>
	<!-- A single h-full flex column gives the ListView a bounded flex parent so it fills the panel and
	scrolls within itself, instead of taking a small intrinsic height with empty space below. -->
	<div class="flex min-h-0 flex-1 flex-col gap-4">
		<div class="flex items-center justify-between">
			<h1>{{ __('Push Subscriptions') }}</h1>
			<div class="flex gap-2">
				<Button
					variant="outline"
					icon="lucide-refresh-cw"
					:tooltip="__('Refresh')"
					:loading="pushSubscriptions.loading"
					@click="pushSubscriptions.reload()"
				/>
				<Button icon-left="lucide-plus" :label="__('New')" @click="showAddModal = true" />
			</div>
		</div>

		<template v-if="rows.length">
			<ListView
				ref="listView"
				class="min-h-0 flex-1"
				:columns="COLUMNS"
				:rows="rows"
				row-key="name"
			>
				<ListHeader />
				<ListRows />
				<ListSelectBanner>
					<template #actions>
						<Button
							variant="ghost"
							:label="__('Renew')"
							:loading="renewing"
							@click="renewSelected"
						/>
						<Button
							variant="ghost"
							theme="red"
							:label="__('Delete')"
							@click="showDeleteModal = true"
						/>
					</template>
				</ListSelectBanner>
			</ListView>
		</template>
		<div
			v-else-if="!pushSubscriptions.loading"
			class="text-ink-gray-6 flex flex-col space-y-2 text-sm"
		>
			<p class="text-base font-medium">{{ __('No push subscriptions.') }}</p>
			<p>{{ MESSAGE }}</p>
		</div>

		<AddPushSubscriptionModal v-model="showAddModal" @created="pushSubscriptions.reload()" />
		<Dialog v-model="showDeleteModal" :options="deleteModalOptions" />
	</div>
</template>

<script setup lang="ts">
import { computed, inject, ref, useTemplateRef } from 'vue'
import {
	Button,
	Dialog,
	ListHeader,
	ListRows,
	ListSelectBanner,
	ListView,
	call,
	createResource,
} from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import AddPushSubscriptionModal from '@/apps/mail/components/Modals/AddPushSubscriptionModal.vue'

import type { PushSubscription } from '@/apps/mail/types'

const user = inject('$user')
const dayjs = inject('$dayjs')

const listViewRef = useTemplateRef('listView')
const showAddModal = ref(false)
const showDeleteModal = ref(false)
const renewing = ref(false)

// Push subscriptions are user-scoped (not account-scoped), so they're fetched here rather than from the
// account store. A high limit keeps this a single request — a user has at most a handful of devices.
const pushSubscriptions = createResource({
	url: 'suite.mail.doctype.push_subscription.push_subscription.fetch_push_subscriptions',
	makeParams: () => ({ user: user.data.name, limit: 100 }),
	auto: true,
})

// `types` arrives as a pretty-printed JSON array string; render it as a compact comma-separated list.
const formatTypes = (types: string) => {
	try {
		const parsed = JSON.parse(types)
		return Array.isArray(parsed) && parsed.length ? parsed.join(', ') : '—'
	} catch {
		return '—'
	}
}

const rows = computed(() =>
	(pushSubscriptions.data ?? []).map((sub: PushSubscription) => ({
		name: sub.name,
		user: sub.user,
		id: sub.id,
		device_client_id: sub.device_client_id,
		types: formatTypes(sub.types),
		expires: sub.expires ? dayjs(sub.expires).format('D MMM YYYY, h:mm A') : '—',
	})),
)

const selectedNames = () => Array.from(listViewRef.value?.selections ?? []) as string[]
const selectedRows = () => {
	const names = new Set(selectedNames())
	return (pushSubscriptions.data ?? []).filter((s: PushSubscription) => names.has(s.name))
}

// Renew has no batch endpoint, so renew each selected subscription in turn. A subscription renewal
// extends its `expires` time on the JMAP server.
const renewSelected = async () => {
	const rowsToRenew = selectedRows()
	if (!rowsToRenew.length) return

	renewing.value = true
	try {
		for (const row of rowsToRenew) {
			await call(
				'suite.mail.doctype.push_subscription.push_subscription.renew_push_subscription',
				{ user: row.user, id: row.id },
			)
		}
		raiseToast(__('Selected subscriptions renewed.'))
		listViewRef.value?.toggleAllRows()
	} catch (error) {
		const err = error as { messages?: string[]; message?: string }
		raiseToast(err.messages?.[0] || err.message || __('Failed to renew.'), 'error')
	} finally {
		// Reload after any outcome: a mid-loop failure still leaves earlier subscriptions renewed with
		// updated expiry, so the table must reflect current server state without a manual refresh.
		renewing.value = false
		pushSubscriptions.reload()
	}
}

const deletePushSubscriptions = createResource({
	url: 'suite.mail.doctype.push_subscription.push_subscription.bulk_delete',
	makeParams: () => ({ names: selectedNames() }),
	onSuccess: () => {
		raiseToast(__('Selected subscriptions deleted.'))
		showDeleteModal.value = false
		listViewRef.value?.toggleAllRows()
		pushSubscriptions.reload()
	},
	// Close the confirmation but keep the selection so the user can retry.
	onError: (error) => {
		showDeleteModal.value = false
		raiseToast(error.messages?.[0] || error.message || __('Failed to delete.'), 'error')
	},
})

const deleteModalOptions = computed(() => ({
	title: __('Delete Push Subscriptions'),
	message: __('Are you sure you want to delete the selected push subscriptions?'),
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			theme: 'red',
			onClick: () => deletePushSubscriptions.submit(),
			loading: deletePushSubscriptions.loading,
		},
	],
}))

// `fr` units (numbers) so the columns share the row width instead of overflowing.
const COLUMNS = [
	{ label: __('Device Client ID'), key: 'device_client_id', width: 2 },
	{ label: __('Subscription ID'), key: 'id', width: 2 },
	{ label: __('Types'), key: 'types', width: 2 },
	{ label: __('Expires'), key: 'expires', width: 2 },
]

const MESSAGE = __(
	'Push subscriptions let your devices receive real-time notifications when your mail changes. Create one to register this or another client.',
)
</script>
