<template>
	<div class="flex h-full flex-col">
		<header
			class="flex items-center justify-between gap-2 border-b px-3 py-2.5 max-sm:p-0 sm:px-5"
		>
			<MobileTitleHeader
				v-if="isMobile"
				class="min-w-0 flex-1"
				:title="title"
				with-back
				@back="backToList"
			/>
			<!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
			<Breadcrumbs
				v-else
				:items="[
					{ label: __('Outbox'), route: { name: 'mail-outbox', params: { accountId } } },
					...(title ? [{ label: title }] : []),
				]"
				class="-ml-0.5 min-w-0"
			/>
			<!-- All actions live in one menu (sheet on mobile) so the long subject keeps
			the header's width instead of a row of buttons. -->
			<AdaptiveDropdown
				v-if="actions.length"
				:options="actions"
				:title="__('Actions')"
				align="end"
			>
				<Button variant="ghost" :title="__('Actions')" class="shrink-0 max-sm:mr-2">
					<template #icon>
						<EllipsisVertical class="text-ink-gray-5 h-4 w-4" />
					</template>
				</Button>
			</AdaptiveDropdown>
		</header>

		<div v-if="data" class="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
			<!-- Two independent stacks, not a grid: rows in a grid stretch to the tallest
			card, leaving dead space under the shorter one. md, not lg — the page should
			pair up as soon as two cards fit. -->
			<div class="mx-auto flex max-w-5xl flex-col gap-5 md:flex-row md:items-start">
				<div class="flex min-w-0 flex-1 flex-col gap-5">
					<DashboardCard :title="__('Delivery')">
						<!-- Status is the raw JMAP undoStatus, as on the list page; the merged
						delivery state is not shown but still drives the header actions. -->
						<InformationField :label="__('Status')">
							<Badge
								:label="undoStatusLabel(data.undo_status)"
								:theme="undoStatusTheme(data.undo_status)"
							/>
						</InformationField>
						<InformationField
							:label="data.status === 'scheduled' ? __('Scheduled for') : __('Released at')"
							:value="sendAtLabel"
						/>
						<InformationField :label="__('Retries')" :value="String(data.retries ?? '—')" />
						<InformationField :label="__('Next retry')" :value="formatDateTime(data.next_retry)" />
						<InformationField :label="__('Priority')" :value="priorityLabel" />
						<InformationField :label="__('Delivery reports')" :value="String(data.dsn_count)" />
						<InformationField :label="__('Read receipts')" :value="String(data.mdn_count)" />
					</DashboardCard>

					<DashboardCard :title="__('Recipients')">
						<template v-if="data.recipients_status.length">
							<div
								v-for="r in data.recipients_status"
								:key="r.email"
								class="flex items-start gap-3 border-b px-5 py-3 last:border-b-0"
							>
								<div class="min-w-0 flex-1">
									<p class="truncate text-base">{{ r.email }}</p>
									<!-- The server's raw SMTP reply, whatever the outcome. -->
									<p
										v-if="r.smtp_reply || r.reason"
										class="text-ink-gray-6 mt-0.5 text-xs break-words"
									>
										{{ r.smtp_reply || r.reason }}
									</p>
									<p v-if="deliverySummary(r)" class="text-ink-gray-5 mt-0.5 text-xs">
										{{ deliverySummary(r) }}
									</p>
								</div>
							</div>
						</template>
						<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
							{{ __('No recipients.') }}
						</div>
					</DashboardCard>
				</div>

				<div class="flex min-w-0 flex-1 flex-col gap-5">
					<DashboardCard :title="__('Message')">
						<InformationField :label="__('Subject')" :value="subjectLabel(data)" />
						<InformationField :label="__('From')" :value="fromLabel" />
						<InformationField
							v-for="type in ['To', 'Cc', 'Bcc']"
							:key="type"
							:label="__(type)"
							:value="recipientsOfType(type)"
						/>
						<div v-if="data.email_deleted" class="text-ink-gray-5 px-5 py-3.5 text-sm">
							{{
								__(
									'The original message was deleted after scheduling, so only the envelope details remain.',
								)
							}}
						</div>
					</DashboardCard>

					<DashboardCard :title="__('References')">
						<InformationField :label="__('Submission ID')" :value="data.id" />
						<InformationField :label="__('Email ID')" :value="data.email_id" />
						<InformationField :label="__('Thread ID')" :value="data.thread_id" />
						<InformationField :label="__('Identity')" :value="data.identity_email" />
						<InformationField :label="__('Envelope sender')" :value="data.envelope_from" />
						<InformationField
							:label="__('Envelope recipients')"
							:value="data.envelope_recipients.join(', ')"
						/>
					</DashboardCard>
				</div>
			</div>
		</div>
		<!-- Mirrors the settled layout so list → details (and details → replacement) transitions
		without a blank frame. -->
		<div
			v-else
			class="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
			:aria-label="__('Loading')"
			role="status"
		>
			<div class="mx-auto flex max-w-5xl flex-col gap-5 md:flex-row md:items-start">
				<div v-for="stack in 2" :key="stack" class="flex min-w-0 flex-1 flex-col gap-5">
					<div v-for="card in 2" :key="card" class="rounded-4 border">
						<div class="flex h-13 items-center border-b px-4">
							<Skeleton class="h-3.5 w-24 rounded-4" />
						</div>
						<div v-for="row in 5" :key="row" class="flex items-center px-5 py-4">
							<Skeleton class="h-3 w-1/4 rounded-4" />
							<Skeleton
								class="ml-12 h-3 rounded-4"
								:style="{ width: `${20 + ((stack * 5 + card * 7 + row * 13) % 25)}%` }"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<ScheduleSendModal
			v-model="showReschedule"
			:title="__('Reschedule delivery')"
			:initial-value="data?.send_at"
			@confirm="(sendAt: string) => rescheduleMail.submit({ send_at: sendAt })"
		/>
		<Dialog v-model:open="showSendNow" v-bind="sendNowOptions" />
		<Dialog v-model:open="showRetry" v-bind="retryOptions" />
		<Dialog v-model:open="showCancel" v-bind="cancelOptions" />
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { EllipsisVertical } from 'lucide-vue-next'
import {
	Badge,
	Breadcrumbs,
	Button,
	Dialog,
	Skeleton,
	createResource,
	usePageMeta,
} from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime, fromNow } from '@/apps/mail/utils/datetime'
import {
	subjectLabel,
	submissionActions,
	undoStatusLabel,
	undoStatusTheme,
	type RecipientState,
	type SubmissionDetails,
} from '@/apps/mail/utils/submission'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'

const { accountId, submissionId } = defineProps<{ accountId: string; submissionId: string }>()

const store = userStore()
const router = useRouter()
const { isMobile } = useScreenSize()

const showReschedule = ref(false)
const showSendNow = ref(false)
const showRetry = ref(false)
const showCancel = ref(false)

// An id change makes the loaded details another submission's answer, so the page drops to
// the skeleton until the server responds — reload() alone would keep showing the previous
// submission's content under the new URL. In-place refreshes (the actions below) keep the
// content in place instead.
const refetching = ref(false)

const submission = createResource({
	url: 'suite.mail.api.scheduled.get_scheduled_mail',
	auto: true,
	makeParams: () => ({ account: accountId, id: submissionId }),
	onSuccess: () => (refetching.value = false),
	onError: (error: { messages?: string[]; message?: string }) => {
		refetching.value = false
		raiseToast(error.messages?.[0] || error.message || __('Submission not found.'), 'error')
		backToList()
	},
})

// Actions that replace the submission land on the successor's id (see below).
watch(
	() => submissionId,
	() => {
		refetching.value = true
		submission.reload()
	},
)

const data = computed<SubmissionDetails | null>(() =>
	refetching.value ? null : submission.data || null,
)

// The subject once known; until then the tab keeps saying "Outbox" (where the user came
// from) and the breadcrumb/mobile header render no second crumb — a placeholder title
// would just flash and be replaced.
const title = computed(() => (data.value ? subjectLabel(data.value) : ''))

usePageMeta(() => ({ title: title.value || __('Outbox') }))

const actions = computed(() => {
	if (!data.value) return []
	return submissionActions(data.value, {
		openEmail,
		sendNow: () => (showSendNow.value = true),
		reschedule: () => (showReschedule.value = true),
		cancelDelivery: () => (showCancel.value = true),
		sendAgain: () => (showRetry.value = true),
		tryAgainNow: () => retryNow.submit(),
		remove: () => dismissMail.submit(),
	})
})

const sendAtLabel = computed(() =>
	data.value?.send_at
		? `${formatDateTime(data.value.send_at)} (${fromNow(data.value.send_at)})`
		: undefined,
)

const fromLabel = computed(() => {
	if (!data.value) return undefined
	const { from_name, from_email, identity_email, envelope_from } = data.value
	const email = from_email || identity_email || envelope_from
	return from_name && email ? `${from_name} <${email}>` : email
})

// The MT-Priority values MailQueue submits with (RFC 6710).
const priorityLabel = computed(() => {
	const labels: Record<number, string> = { 4: __('High'), 0: __('Normal'), [-4]: __('Low') }
	return labels[data.value?.priority ?? 0] || String(data.value?.priority)
})

const recipientsOfType = (type: string) =>
	data.value?.recipients
		.filter((r) => r.type === type)
		.map((r) => (r.display_name ? `${r.display_name} <${r.email}>` : r.email))
		.join(', ') || undefined

// The DeliveryStatus enums, spelled out for the reader.
const DELIVERED_LABELS: Record<string, string> = {
	queued: __('Queued'),
	yes: __('Yes'),
	no: __('No'),
	unknown: __('Unknown'),
}

const deliverySummary = (r: RecipientState) => {
	const parts = []
	if (r.delivered) parts.push(__('Delivered: {0}', [DELIVERED_LABELS[r.delivered] || r.delivered]))
	if (r.displayed)
		parts.push(__('Displayed: {0}', [DELIVERED_LABELS[r.displayed] || r.displayed]))
	if (r.retries) parts.push(__('Retries: {0}', [String(r.retries)]))
	if (r.next_retry) parts.push(__('Next retry {0}', [fromNow(r.next_retry)]))
	return parts.join(' · ')
}

// A held message sits in Sent until delivery, so its thread opens there.
const openEmail = () => {
	if (!data.value?.thread_id || !store.mailboxIds.sent) return
	router.push({
		name: 'mail-mail',
		params: {
			accountId,
			mailbox: store.mailboxIds.sent,
			threadID: data.value.thread_id,
		},
	})
}

const backToList = () => router.replace({ name: 'mail-outbox', params: { accountId } })

/** Follow an action that replaced this submission to its successor's page. */
const followReplacement = (id: string) =>
	router.replace({ name: 'mail-submission', params: { accountId, submissionId: id } })

const onActionError = (error: { messages?: string[]; message?: string }) => {
	showSendNow.value = false
	showRetry.value = false
	showCancel.value = false
	raiseToast(error.messages?.[0] || error.message || __('Request failed.'), 'error')
	submission.reload()
}

const rescheduleMail = createResource({
	url: 'suite.mail.api.scheduled.reschedule_mail',
	makeParams: ({ send_at }: { send_at: string }) => ({
		account: accountId,
		id: submissionId,
		send_at,
	}),
	onSuccess: (result: { id: string; send_at: string }) => {
		raiseToast(__('Delivery rescheduled to {0}.', [formatDateTime(result.send_at)]))
		followReplacement(result.id)
	},
	onError: onActionError,
})

const sendNow = createResource({
	url: 'suite.mail.api.scheduled.send_scheduled_mail_now',
	makeParams: () => ({ account: accountId, id: submissionId }),
	onSuccess: (result: { id: string }) => {
		showSendNow.value = false
		raiseToast(__('Message sent.'))
		followReplacement(result.id)
	},
	onError: onActionError,
})

const retryMail = createResource({
	url: 'suite.mail.api.scheduled.retry_failed_mail',
	makeParams: () => ({ account: accountId, id: submissionId }),
	onSuccess: (result: { id: string }) => {
		showRetry.value = false
		raiseToast(__('Message sent.'))
		followReplacement(result.id)
	},
	onError: onActionError,
})

const retryNow = createResource({
	url: 'suite.mail.api.scheduled.retry_delivery_now',
	makeParams: () => ({ account: accountId, id: submissionId }),
	onSuccess: () => {
		raiseToast(__('Delivery attempt scheduled.'))
		submission.reload()
	},
	onError: onActionError,
})

const dismissMail = createResource({
	url: 'suite.mail.api.scheduled.dismiss_failed_mail',
	makeParams: () => ({ account: accountId, id: submissionId }),
	onSuccess: backToList,
	onError: onActionError,
})

const cancelSchedule = createResource({
	url: 'suite.mail.api.scheduled.cancel_scheduled_mail',
	makeParams: () => ({ account: accountId, id: submissionId }),
	onSuccess: (result: { id?: string }) => {
		showCancel.value = false
		raiseToast(
			result.id
				? __('Delivery cancelled. The message is back in your drafts.')
				: __('Delivery cancelled.'),
			'success',
		)
		backToList()
	},
	onError: onActionError,
})

const sendNowOptions = computed(() => ({
	title: __('Send Now'),
	message: __('Deliver this email immediately instead of at the scheduled time?'),
	actions: [
		{ label: __('Send'), variant: 'solid', loading: sendNow.loading, onClick: sendNow.submit },
	],
}))

const retryOptions = computed(() => ({
	title: __('Send Again'),
	message:
		data.value?.status === 'failed'
			? __('The delivery failed. Try to send this email again now?')
			: __('Send this email again now?'),
	actions: [
		{ label: __('Send'), variant: 'solid', loading: retryMail.loading, onClick: retryMail.submit },
	],
}))

const cancelOptions = computed(() => ({
	title: __('Cancel Delivery'),
	message: data.value?.email_deleted
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
