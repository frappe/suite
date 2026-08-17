<template>
	<div class="flex h-full flex-col">
		<header
			class="flex items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5"
		>
			<MobileTitleHeader v-if="isMobile" class="min-w-0 flex-1" :title="__('Outbox')" />
			<!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
			<Breadcrumbs v-else :items="[{ label: __('Outbox') }]" class="-ml-0.5" />
			<HeaderActions @reload-mails="submissions.reload()" />
		</header>

		<OutboxFilters :filters="filters" />

		<div class="flex-1 overflow-y-auto px-3 py-2.5 sm:px-5">
			<ListView
				v-if="submissions.data && !refetching"
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
								<span v-if="column.key === 'recipients'" class="truncate">
									{{ recipientLabel(row) }}
								</span>
								<span
									v-else-if="column.key === 'subject'"
									class="truncate"
									:class="{ 'text-ink-gray-5 italic': row.email_deleted }"
								>
									{{ subjectLabel(row) }}
								</span>
								<span v-else-if="column.key === 'send_at'" class="truncate">
									{{ formatDateTime(row.send_at) }}
									<span class="text-ink-gray-5">({{ fromNow(row.send_at) }})</span>
								</span>
								<div
									v-else-if="column.key === 'status'"
									class="flex w-full items-center justify-between gap-2"
								>
									<!-- The failure detail rides on the badge's hover title. -->
									<span :title="deliveryErrorTitle(row) || undefined">
										<Badge
											:label="undoStatusLabel(row.undo_status)"
											:theme="undoStatusTheme(row.undo_status)"
										/>
									</span>
									<div class="flex items-center">
										<Button
											v-if="!row.email_deleted && row.thread_id"
											variant="ghost"
											:title="__('Open email')"
											@click.stop.prevent="openEmail(row)"
										>
											<template #icon>
												<Mail class="text-ink-gray-5 h-4 w-4" />
											</template>
										</Button>
										<AdaptiveDropdown :options="rowOptions(row)" align="end">
											<Button variant="ghost" @click.stop.prevent>
												<template #icon>
													<EllipsisVertical class="text-ink-gray-5 h-4 w-4" />
												</template>
											</Button>
										</AdaptiveDropdown>
									</div>
								</div>
							</ListRowItem>
						</ListRow>
					</template>
					<ListEmptyState v-else />
				</ListRows>
			</ListView>
			<DashboardListSkeleton v-else :columns="4" />
		</div>

		<DashboardPager
			v-if="submissions.data && !refetching"
			class="border-t px-3 sm:px-5"
			:page="page"
			:page-length="PAGE_LENGTH"
			:total="total"
			@update:page="(p: number) => (page = p)"
		/>

		<ScheduleSendModal
			v-model="showReschedule"
			:title="__('Reschedule delivery')"
			:initial-value="selected?.send_at"
			@confirm="(sendAt: string) => rescheduleMail.submit({ send_at: sendAt })"
		/>
		<Dialog v-model:open="showSendNow" v-bind="sendNowOptions" />
		<Dialog v-model:open="showRetry" v-bind="retryOptions" />
		<Dialog v-model:open="showCancel" v-bind="cancelOptions" />
	</div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { watchDebounced } from '@vueuse/core'
import {
	CalendarClock, EllipsisVertical, Mail, RefreshCw, SendHorizontal, X, } from 'lucide-vue-next'
import {
	Badge, Breadcrumbs, Button, Dialog, createResource, usePageMeta } from 'frappe-ui'
import { ListEmptyState, ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime, fromNow, utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import {
	activeSubmissionFilterCount,
	deliveryErrorTitle,
	emptySubmissionFilters,
	subjectLabel,
	undoStatusLabel,
	undoStatusTheme,
	type Submission,
	type SubmissionFilters,
} from '@/apps/mail/utils/submission'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import OutboxFilters from '@/apps/mail/components/OutboxFilters.vue'
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'

usePageMeta(() => ({ title: __('Outbox') }))

const store = userStore()
const router = useRouter()
const socket = inject('$socket') as {
	on: (event: string, handler: () => void) => void
	off: (event: string, handler: () => void) => void
}
const { isMobile } = useScreenSize()

const selected = ref<Submission | null>(null)
const showReschedule = ref(false)
const showSendNow = ref(false)
const showRetry = ref(false)
const showCancel = ref(false)

const filters = reactive(emptySubmissionFilters())
// The status tabs always narrow the list; only the optional filters make an empty result
// mean "no matches" rather than "nothing with this status".
const hasActiveFilters = computed(() => activeSubmissionFilterCount(filters) > 0)

// A filter or account change makes the current rows a different query's answer, so the list
// waits on the skeleton until the server responds — unlike the background refreshes below,
// which keep the rows in place. Without this, switching tabs while the previous result was
// empty flashes the (wrong) empty state before the response arrives.
const refetching = ref(false)

const PAGE_LENGTH = 50
const page = ref(1)

const submissions = createResource({
	url: 'suite.mail.api.scheduled.get_submissions',
	auto: true,
	makeParams: () => ({
		account: store.accountId,
		undo_status: filters.undoStatus,
		identity_id: filters.identityId || undefined,
		email_id: filters.emailId.trim() || undefined,
		thread_id: filters.threadId.trim() || undefined,
		// The date pickers select local calendar days; sendAt is bounded by the UTC
		// instants that day spans.
		after: filters.after ? utcDayStart(filters.after) : undefined,
		before: filters.before ? utcDayEnd(filters.before) : undefined,
		page: page.value,
		page_length: PAGE_LENGTH,
	}),
	onSuccess: () => (refetching.value = false),
	onError: (error: { message?: string }) => {
		refetching.value = false
		raiseToast(error.message || __('Request failed.'), 'error')
	},
})

const applyFilters = () => {
	refetching.value = true
	submissions.reload()
}

// A filter change restarts from the first page; when the page actually moves, its own
// watcher does the refetch (avoiding a double request).
const applyFiltersFromStart = () => {
	if (page.value !== 1) page.value = 1
	else applyFilters()
}

watch(page, applyFilters)
watch(
	() => store.accountId,
	() => store.accountId && applyFiltersFromStart(),
)

// The id filters are typed; the rest change atomically.
watchDebounced(() => [filters.emailId, filters.threadId], applyFiltersFromStart, { debounce: 300 })
watch(
	() => [filters.undoStatus, filters.identityId, filters.after, filters.before],
	applyFiltersFromStart,
)

// Kept current the way mailboxes are — a periodic poll (holds release, retries advance, and
// other clients schedule/cancel without any local signal) plus the new-mail socket (an undo
// or schedule cancel publishes it). reload() keeps the previous rows while fetching, so the
// list never flickers back to the skeleton.
const reloadInterval = ref<ReturnType<typeof setInterval>>()
const onNewMail = () => submissions.reload()

onMounted(() => {
	reloadInterval.value = setInterval(onNewMail, 30000)
	socket.on('new_mail_created', onNewMail)
})

onUnmounted(() => {
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	socket.off('new_mail_created', onNewMail)
})

const rows = computed<Submission[]>(() => submissions.data?.rows || [])
const total = computed<number>(() => submissions.data?.total || 0)

const recipientLabel = (row: Submission) => {
	const emails = [
		...row.recipients.filter((r) => r.type === 'To'),
		...row.recipients.filter((r) => r.type !== 'To'),
	].map((r) => r.display_name || r.email)
	if (!emails.length) return '—'

	const [first, ...rest] = emails
	return rest.length ? `${first} +${rest.length}` : first
}

const LIST_COLUMNS = [
	{ label: __('To'), key: 'recipients' },
	{ label: __('Subject'), key: 'subject' },
	{ label: __('Send at'), key: 'send_at' },
	{ label: __('Status'), key: 'status' },
]

// What an empty result means depends on the status tab being viewed.
const EMPTY_STATES: Record<SubmissionFilters['undoStatus'], { title: string; description: string }> =
	{
		pending: {
			title: __('No pending submissions'),
			description: __('Scheduled emails and deliveries still in flight will wait here.'),
		},
		final: {
			title: __('No final submissions'),
			description: __('Concluded deliveries — delivered, sent, or failed — will appear here.'),
		},
		canceled: {
			title: __('No cancelled submissions'),
			description: __('Deliveries you cancel will appear here.'),
		},
	}

const listOptions = computed(() => ({
	showTooltip: false,
	selectable: false,
	rowHeight: 50,
	// The row opens the submission's details page; the message itself is behind the
	// explicit Open-email button instead.
	getRowRoute: (row: Submission) => ({
		name: 'mail-submission',
		params: { accountId: store.accountId, submissionId: row.id },
	}),
	emptyState: hasActiveFilters.value
		? {
				title: __('No matching submissions'),
				description: __('Try adjusting the filters.'),
			}
		: EMPTY_STATES[filters.undoStatus],
}))

// A held message sits in Sent until delivery, so its thread opens there.
const openEmail = (row: Submission) => {
	if (!row.thread_id || !store.mailboxIds.sent) return
	router.push({
		name: 'mail-mail',
		params: {
			accountId: store.accountId,
			mailbox: store.mailboxIds.sent,
			threadID: row.thread_id,
		},
	})
}

const rowOptions = (row: Submission) => {
	const open = (dialog?: { value: boolean }, submit?: { submit: () => void }) => () => {
		selected.value = row
		if (dialog) dialog.value = true
		submit?.submit()
	}

	if (row.status === 'failed') {
		const retry = { label: __('Send again'), icon: RefreshCw, onClick: open(showRetry) }
		const dismiss = { label: __('Remove'), icon: X, onClick: open(undefined, dismissMail) }
		// A deleted message can't be resubmitted — dropping the failed record is all that's left.
		return row.email_deleted ? [dismiss] : [retry, dismiss]
	}

	const cancel = { label: __('Cancel delivery'), icon: X, theme: 'red', onClick: open(showCancel) }

	if (row.status === 'retrying' || row.status === 'queued') {
		const retry = { label: __('Try again now'), icon: RefreshCw, onClick: open(undefined, retryNow) }
		// A released delivery stays cancellable for as long as its submission is pending.
		return row.undo_status === 'pending' ? [retry, cancel] : [retry]
	}

	if (row.status === 'scheduled') {
		// A deleted message can't be resubmitted (send now / reschedule recreate the
		// submission from it) — cancelling the pending delivery is all that's left.
		if (row.email_deleted) return [cancel]

		return [
			{ label: __('Send now'), icon: SendHorizontal, onClick: open(showSendNow) },
			{ label: __('Reschedule'), icon: CalendarClock, onClick: open(showReschedule) },
			cancel,
		]
	}

	// Concluded (sent/delivered/read) or cancelled rows: resubmit and/or drop the record.
	const remove = { label: __('Remove'), icon: X, onClick: open(undefined, dismissMail) }
	if (row.status === 'cancelled' || row.email_deleted) return [remove]

	return [{ label: __('Send again'), icon: RefreshCw, onClick: open(showRetry) }, remove]
}

const openDrafts = () => {
	if (!store.mailboxIds.drafts) return
	router.push({
		name: 'mail-mailbox',
		params: { accountId: store.accountId, mailbox: store.mailboxIds.drafts },
	})
}

const onActionError = (error: { messages?: string[]; message?: string }) => {
	showSendNow.value = false
	showRetry.value = false
	showCancel.value = false
	raiseToast(error.messages?.[0] || error.message || __('Request failed.'), 'error')
	// The action may have failed because the email already went out; reflect the
	// reconciled state either way.
	submissions.reload()
}

const rescheduleMail = createResource({
	url: 'suite.mail.api.scheduled.reschedule_mail',
	makeParams: ({ send_at }: { send_at: string }) => ({
		account: store.accountId,
		id: selected.value?.id,
		send_at,
	}),
	onSuccess: (data: { send_at: string }) => {
		submissions.reload()
		raiseToast(__('Delivery rescheduled to {0}.', [formatDateTime(data.send_at)]))
	},
	onError: onActionError,
})

const sendNow = createResource({
	url: 'suite.mail.api.scheduled.send_scheduled_mail_now',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => {
		showSendNow.value = false
		submissions.reload()
		raiseToast(__('Message sent.'))
	},
	onError: onActionError,
})

const retryMail = createResource({
	url: 'suite.mail.api.scheduled.retry_failed_mail',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => {
		showRetry.value = false
		submissions.reload()
		raiseToast(__('Message sent.'))
	},
	onError: onActionError,
})

const retryNow = createResource({
	url: 'suite.mail.api.scheduled.retry_delivery_now',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => {
		submissions.reload()
		raiseToast(__('Delivery attempt scheduled.'))
	},
	onError: onActionError,
})

const dismissMail = createResource({
	url: 'suite.mail.api.scheduled.dismiss_failed_mail',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => submissions.reload(),
	onError: onActionError,
})

const cancelSchedule = createResource({
	url: 'suite.mail.api.scheduled.cancel_scheduled_mail',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: (data: { id?: string }) => {
		showCancel.value = false
		submissions.reload()
		// No message was moved when the email had been deleted — don't point at Drafts.
		if (!data.id) return raiseToast(__('Delivery cancelled.'), 'success')
		raiseToast(
			__('Delivery cancelled. The message is back in your drafts.'),
			'success',
			store.mailboxIds.drafts
				? { label: __('Open Drafts'), onClick: openDrafts }
				: undefined,
		)
	},
	onError: onActionError,
})

const sendNowOptions = computed(() => ({
	title: __('Send Now'),
	message: __('Deliver this email immediately instead of at the scheduled time?'),
	actions: [
		{
			label: __('Send'),
			variant: 'solid',
			loading: sendNow.loading,
			onClick: sendNow.submit,
		},
	],
}))

const retryOptions = computed(() => ({
	title: __('Send Again'),
	message:
		selected.value?.status === 'failed'
			? __('The delivery failed. Try to send this email again now?')
			: __('Send this email again now?'),
	actions: [
		{
			label: __('Send'),
			variant: 'solid',
			loading: retryMail.loading,
			onClick: retryMail.submit,
		},
	],
}))

const cancelOptions = computed(() => ({
	title: __('Cancel Delivery'),
	message: selected.value?.email_deleted
		? __('Cancel the scheduled delivery?')
		: __('Cancel the scheduled delivery and move the message back to Drafts?'),
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			theme: 'red',
			loading: cancelSchedule.loading,
			onClick: cancelSchedule.submit,
		},
	],
}))
</script>
