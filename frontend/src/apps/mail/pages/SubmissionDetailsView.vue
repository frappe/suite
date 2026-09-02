<template>
	<div class="flex h-full flex-col">
		<header class="flex items-center border-b px-3 py-2.5 max-sm:p-0 sm:px-5">
			<!-- The subject heads the page itself, so the mobile bar names where back leads. -->
			<MobileTitleHeader
				v-if="isMobile"
				class="min-w-0 flex-1"
				:title="__('Outbox')"
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
		</header>

		<!-- One narrow column read top to bottom: where the send stands and what can be done
		about it, its history, then the facts. max-sm:pb-20 keeps the last section clear of
		the tab bar and compose button, as the lists do. -->
		<div v-if="data" class="flex-1 overflow-y-auto px-3 py-4 max-sm:pb-20 sm:px-5 sm:py-6">
			<div class="mx-auto flex max-w-2xl flex-col gap-7">
				<div class="flex flex-col gap-2.5">
					<h1 class="text-ink-gray-9 text-2xl">{{ title }}</h1>
					<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
						<span class="text-ink-gray-9 flex items-center gap-2 font-medium">
							<span
								class="h-2 w-2 rounded-full bg-current"
								:class="themeInkClass(statusTheme(data.status))"
							/>
							{{ statusLabel(data.status) }}
						</span>
						<span class="text-ink-gray-4 max-sm:hidden">·</span>
						<span class="text-ink-gray-6 max-sm:basis-full">{{ summary }}</span>
					</div>
					<!-- The state's first action leads; the rest stay visible but quiet. -->
					<div v-if="actions.length" class="flex flex-wrap gap-2 pt-1">
						<Button
							v-for="(action, index) in actions"
							:key="action.label"
							:variant="index ? 'ghost' : 'subtle'"
							:theme="action.theme || 'gray'"
							:label="action.label"
							@click="action.onClick"
						>
							<template #prefix><component :is="action.icon" class="h-4 w-4" /></template>
						</Button>
					</div>
				</div>

				<LedgerSection :title="__('Activity')">
					<SubmissionActivity :entries="activity" />
				</LedgerSection>

				<LedgerSection
					:title="__('Message')"
					:note="
						data.email_deleted
							? __(
									'The original message was deleted after scheduling, so only the envelope details remain.',
								)
							: undefined
					"
				>
					<template #action>
						<button
							v-if="canOpenEmail"
							class="text-ink-gray-6 hover:text-ink-gray-8 flex items-center gap-1 text-sm"
							@click="openEmail"
						>
							{{ __('Open email') }}
							<ArrowUpRight class="h-3.5 w-3.5" />
						</button>
					</template>
					<div>
						<LedgerRow :label="__('From')" :value="fromLabel" />
						<LedgerRow :label="__('To')" :value="recipientsOfType('To')" />
						<LedgerRow v-if="recipientsOfType('Cc')" :label="__('Cc')" :value="recipientsOfType('Cc')" />
						<LedgerRow v-if="recipientsOfType('Bcc')" :label="__('Bcc')" :value="recipientsOfType('Bcc')" />
						<LedgerRow :label="__('Subject')" :value="subjectLabel(data)" />
					</div>
				</LedgerSection>

				<LedgerSection :title="__('Envelope')">
					<div>
						<LedgerRow :label="__('Sender')" :value="data.envelope_from" />
						<LedgerRow :label="__('Recipients')" :value="data.envelope_recipients.join(', ')" />
						<LedgerRow :label="__('Priority')" :value="priorityLabel(data.priority)" />
						<LedgerRow :label="__('Reports')" :value="reportsLabel" />
					</div>
				</LedgerSection>

				<LedgerSection :title="__('Identifiers')">
					<p class="text-ink-gray-6 font-mono text-sm break-all">{{ identifiers }}</p>
				</LedgerSection>
			</div>
		</div>
		<!-- Mirrors the settled layout so list → details (and details → replacement) transitions
		without a blank frame. -->
		<div
			v-else
			class="flex-1 overflow-y-auto px-3 py-4 max-sm:pb-20 sm:px-5 sm:py-6"
			:aria-label="__('Loading')"
			role="status"
		>
			<div class="mx-auto flex max-w-2xl flex-col gap-7">
				<div class="flex flex-col gap-3">
					<Skeleton class="h-5 w-2/3 rounded-4" />
					<Skeleton class="h-3.5 w-1/2 rounded-4" />
					<div class="flex gap-2 pt-1">
						<Skeleton class="h-7 w-24 rounded-4" />
						<Skeleton class="h-7 w-28 rounded-4" />
					</div>
				</div>
				<div v-for="section in 3" :key="section" class="flex flex-col gap-3">
					<Skeleton class="h-3 w-16 rounded-4" />
					<div v-for="row in 3" :key="row" class="flex items-center gap-4 py-1.5">
						<Skeleton class="h-3 w-20 shrink-0 rounded-4 sm:w-36" />
						<Skeleton
							class="h-3 rounded-4"
							:style="{ width: `${25 + ((section * 7 + row * 13) % 30)}%` }"
						/>
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
import { appPageMeta } from '@/utils/documentTitle'
import { useRouter } from 'vue-router'
import { ArrowUpRight } from 'lucide-vue-next'
import { Breadcrumbs, Button, Dialog, Skeleton, createResource, usePageMeta } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import {
	priorityLabel,
	statusLabel,
	statusTheme,
	subjectLabel,
	submissionActions,
	type SubmissionDetails,
} from '@/apps/mail/utils/submission'
import {
	activityEntries,
	statusSummary,
	themeInkClass,
} from '@/apps/mail/utils/submissionActivity'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import LedgerRow from '@/apps/mail/components/LedgerRow.vue'
import LedgerSection from '@/apps/mail/components/LedgerSection.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import ScheduleSendModal from '@/apps/mail/components/Modals/ScheduleSendModal.vue'
import SubmissionActivity from '@/apps/mail/components/SubmissionActivity.vue'

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
// from) and the breadcrumb renders no second crumb — a placeholder title would just flash
// and be replaced.
const title = computed(() => (data.value ? subjectLabel(data.value) : ''))

usePageMeta(() => appPageMeta(title.value || __('Outbox'), 'Mail'))

const summary = computed(() => (data.value ? statusSummary(data.value) : ''))
const activity = computed(() => (data.value ? activityEntries(data.value) : []))

// Opening the email is a link by the message, not one of the state's actions.
const actions = computed(() => {
	if (!data.value) return []
	return submissionActions(data.value, {
		sendNow: () => (showSendNow.value = true),
		reschedule: () => (showReschedule.value = true),
		cancelDelivery: () => (showCancel.value = true),
		sendAgain: () => (showRetry.value = true),
		tryAgainNow: () => retryNow.submit(),
		remove: () => dismissMail.submit(),
	})
})

const canOpenEmail = computed(
	() => !!data.value?.thread_id && !data.value.email_deleted && !!store.mailboxIds.sent,
)

const fromLabel = computed(() => {
	if (!data.value) return undefined
	const { from_name, from_email, identity_email, envelope_from } = data.value
	const email = from_email || identity_email || envelope_from
	return from_name && email ? `${from_name} <${email}>` : email
})

const recipientsOfType = (type: string) =>
	data.value?.recipients
		.filter((r) => r.type === type)
		.map((r) => (r.display_name ? `${r.display_name} <${r.email}>` : r.email))
		.join(', ') || undefined

const reportsLabel = computed(() =>
	data.value
		? __('{0} delivery reports, {1} read receipts', [
				String(data.value.dsn_count),
				String(data.value.mdn_count),
			])
		: undefined,
)

const identifiers = computed(() => {
	if (!data.value) return ''
	const { id, email_id, thread_id, identity_email } = data.value
	return [
		__('submission {0}', [id]),
		email_id && __('email {0}', [email_id]),
		thread_id && __('thread {0}', [thread_id]),
		identity_email && __('identity {0}', [identity_email]),
	]
		.filter(Boolean)
		.join(' · ')
})

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
