<template>
	<div class="flex h-full flex-col">
		<header
			class="flex items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5"
		>
			<MobileTitleHeader v-if="isMobile" class="min-w-0 flex-1" :title="__('Outbox')" />
			<!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
			<Breadcrumbs v-else :items="[{ label: __('Outbox') }]" class="-ml-0.5" />
			<HeaderActions @reload-mails="refresh()" />
		</header>

		<OutboxFilters :filters="filters" />

		<div class="flex-1 overflow-y-auto px-3 py-2.5 sm:px-5" @scroll.passive="onScroll">
			<template v-if="!refetching">
				<ListView
					v-if="rows.length"
					class="flex-1"
					:columns="LIST_COLUMNS"
					:rows="rows"
					:options="listOptions"
					row-key="id"
				>
					<ListHeader />
					<ListRows>
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
					</ListRows>
				</ListView>
				<!-- Outside the ListView: its horizontally scrolling body would center this
				within the full (off-screen) table width on narrow viewports. -->
				<div v-else class="flex h-full flex-col items-center justify-center px-4 text-center">
					<div class="text-2xl-medium text-ink-gray-8">{{ emptyState.title }}</div>
					<div class="text-ink-gray-5 mt-1 text-base">{{ emptyState.description }}</div>
				</div>
				<div v-if="loadingMore" class="flex justify-center py-3">
					<LoadingIndicator class="text-ink-gray-5 h-4 w-4" />
				</div>
			</template>
			<DashboardListSkeleton v-else :columns="4" />
		</div>

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
import { useDebounceFn, watchDebounced } from '@vueuse/core'
import { EllipsisVertical, Mail } from 'lucide-vue-next'
import {
	Badge,
	Breadcrumbs,
	Button,
	Dialog,
	LoadingIndicator,
	call,
	createResource,
	usePageMeta,
} from 'frappe-ui'
import { ListHeader, ListRow, ListRowItem, ListRows, ListView } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime, fromNow, utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import {
	activeSubmissionFilterCount,
	deliveryErrorTitle,
	emptySubmissionFilters,
	subjectLabel,
	submissionActions,
	undoStatusLabel,
	undoStatusTheme,
	type Submission,
	type SubmissionFilters,
} from '@/apps/mail/utils/submission'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'
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
const refetching = ref(true)

// The rest of the user-facing Mail UI scrolls instead of paging, so the Outbox does too:
// scrolling near the bottom appends the next page; background refreshes refetch every
// loaded page and swap the rows in place.
const PAGE_LENGTH = 50
const rows = ref<Submission[]>([])
const total = ref(0)
const loadedPages = ref(0)
const loadingMore = ref(false)
const hasMore = computed(() => rows.value.length < total.value)

// Bumped by restart(); an in-flight response from an older cycle must not land on the
// newer query's rows.
let fetchToken = 0

const fetchPage = (page: number) =>
	call('suite.mail.api.scheduled.get_submissions', {
		account: store.accountId,
		undo_status: filters.undoStatus,
		identity_id: filters.identityId || undefined,
		email_id: filters.emailId.trim() || undefined,
		thread_id: filters.threadId.trim() || undefined,
		// The date pickers select local calendar days; sendAt is bounded by the UTC
		// instants that day spans.
		after: filters.after ? utcDayStart(filters.after) : undefined,
		before: filters.before ? utcDayEnd(filters.before) : undefined,
		page,
		page_length: PAGE_LENGTH,
	}) as Promise<{ rows: Submission[]; total: number }>

const onFetchError = (error: { messages?: string[]; message?: string }) =>
	raiseToast(error.messages?.[0] || error.message || __('Request failed.'), 'error')

// Rows can shift between pages while loading (another client schedules or cancels), so
// every merge drops ids already present.
const dedupeById = (merged: Submission[]) => {
	const seen = new Set<string>()
	return merged.filter((row) => !seen.has(row.id) && (seen.add(row.id), true))
}

const restart = async () => {
	const token = ++fetchToken
	refetching.value = true
	try {
		const data = await fetchPage(1)
		if (token !== fetchToken) return
		rows.value = data.rows
		total.value = data.total
		loadedPages.value = 1
	} catch (error) {
		onFetchError(error as { message?: string })
	} finally {
		if (token === fetchToken) refetching.value = false
	}
}

const loadMore = async () => {
	if (loadingMore.value || refetching.value || !hasMore.value) return
	const token = fetchToken
	loadingMore.value = true
	try {
		const data = await fetchPage(loadedPages.value + 1)
		if (token !== fetchToken) return
		rows.value = dedupeById([...rows.value, ...data.rows])
		total.value = data.total
		loadedPages.value += 1
	} catch (error) {
		onFetchError(error as { message?: string })
	} finally {
		loadingMore.value = false
	}
}

/** Background refresh: refetches every loaded page and swaps the rows in place, so the
 * periodic poll, socket events, and post-action reloads never flash the skeleton. */
let refreshSeq = 0
let appliedRefreshSeq = 0
const refresh = async () => {
	const token = fetchToken
	// Refreshes can overlap (poll + socket + post-action); a response may only apply if
	// it's newer than the last one applied — comparing against the latest *started*
	// instead would let a newer refresh that failed suppress an older success.
	// seq is taken in the same synchronous block that starts the fetches (the depth
	// retry below re-enters and takes a fresh one), so seq order is fetch-start order:
	// an applied snapshot is only ever replaced by one whose fetches began later.
	const seq = ++refreshSeq
	const pages = Math.max(loadedPages.value, 1)
	try {
		const results = await Promise.all(Array.from({ length: pages }, (_, i) => fetchPage(i + 1)))
		if (token !== fetchToken || seq <= appliedRefreshSeq) return
		// loadMore appended a page while this refetch was in flight — applying the
		// shallower snapshot would drop it, so refetch at the new depth instead.
		if (Math.max(loadedPages.value, 1) !== pages) return refresh()
		appliedRefreshSeq = seq
		rows.value = dedupeById(results.flatMap((data) => data.rows))
		total.value = results[results.length - 1].total
		loadedPages.value = pages
	} catch (error) {
		onFetchError(error as { message?: string })
	}
}

const onScroll = useDebounceFn((e: Event) => {
	const { scrollTop, scrollHeight, clientHeight } = e.target as HTMLElement
	if (scrollTop + clientHeight >= scrollHeight - 100) loadMore()
}, 200)

restart()

watch(
	() => store.accountId,
	() => store.accountId && restart(),
)

// The id filters are typed; the rest change atomically.
watchDebounced(() => [filters.emailId, filters.threadId], restart, { debounce: 300 })
watch(() => [filters.undoStatus, filters.identityId, filters.after, filters.before], restart)

// Kept current the way mailboxes are — a periodic poll (holds release, retries advance, and
// other clients schedule/cancel without any local signal) plus the new-mail socket (an undo
// or schedule cancel publishes it).
const reloadInterval = ref<ReturnType<typeof setInterval>>()
const onNewMail = () => refresh()

onMounted(() => {
	reloadInterval.value = setInterval(onNewMail, 30000)
	socket.on('new_mail_created', onNewMail)
})

onUnmounted(() => {
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	socket.off('new_mail_created', onNewMail)
})

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

const listOptions = {
	showTooltip: false,
	selectable: false,
	rowHeight: 50,
	// The row opens the submission's details page; the message itself is behind the
	// explicit Open-email button instead.
	getRowRoute: (row: Submission) => ({
		name: 'mail-submission',
		params: { accountId: store.accountId, submissionId: row.id },
	}),
}

const emptyState = computed(() =>
	hasActiveFilters.value
		? { title: __('No matching submissions'), description: __('Try adjusting the filters.') }
		: EMPTY_STATES[filters.undoStatus],
)

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
	// Every handler targets this row: `selected` must be set before dialogs read it
	// and before the resources build their params.
	const act = (fn: () => void) => () => {
		selected.value = row
		fn()
	}

	// No openEmail here — the list row keeps its explicit Open-email button.
	return submissionActions(row, {
		sendNow: act(() => (showSendNow.value = true)),
		reschedule: act(() => (showReschedule.value = true)),
		cancelDelivery: act(() => (showCancel.value = true)),
		sendAgain: act(() => (showRetry.value = true)),
		tryAgainNow: act(() => retryNow.submit()),
		remove: act(() => dismissMail.submit()),
	})
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
	refresh()
}

const rescheduleMail = createResource({
	url: 'suite.mail.api.scheduled.reschedule_mail',
	makeParams: ({ send_at }: { send_at: string }) => ({
		account: store.accountId,
		id: selected.value?.id,
		send_at,
	}),
	onSuccess: (data: { send_at: string }) => {
		refresh()
		raiseToast(__('Delivery rescheduled to {0}.', [formatDateTime(data.send_at)]))
	},
	onError: onActionError,
})

const sendNow = createResource({
	url: 'suite.mail.api.scheduled.send_scheduled_mail_now',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => {
		showSendNow.value = false
		refresh()
		raiseToast(__('Message sent.'))
	},
	onError: onActionError,
})

const retryMail = createResource({
	url: 'suite.mail.api.scheduled.retry_failed_mail',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => {
		showRetry.value = false
		refresh()
		raiseToast(__('Message sent.'))
	},
	onError: onActionError,
})

const retryNow = createResource({
	url: 'suite.mail.api.scheduled.retry_delivery_now',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => {
		refresh()
		raiseToast(__('Delivery attempt scheduled.'))
	},
	onError: onActionError,
})

const dismissMail = createResource({
	url: 'suite.mail.api.scheduled.dismiss_failed_mail',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: () => refresh(),
	onError: onActionError,
})

const cancelSchedule = createResource({
	url: 'suite.mail.api.scheduled.cancel_scheduled_mail',
	makeParams: () => ({ account: store.accountId, id: selected.value?.id }),
	onSuccess: (data: { id?: string }) => {
		showCancel.value = false
		refresh()
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
