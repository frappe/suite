<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!message.data">
		<template #default>
			<DashboardDetailHeader :title="data.id || messageId" :meta="[data.sender, queuedAgo]">
				<template #icon><Mail class="h-5 w-5" /></template>
				<template #actions>
					<Button :label="__('Retry Now')" @click="retry.submit()" />
					<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
				</template>
			</DashboardDetailHeader>
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<DashboardCard :title="__('General Information')" :button-label="__('Edit')" @action="showEditMessage = true">
					<InformationField :label="__('Size')" :value="formatBytes(data.size || 0)" />
					<InformationField :label="__('Priority')" :value="String(data.priority ?? '—')" />
					<InformationField :label="__('Envelope ID')" :value="data.env_id" />
					<InformationField :label="__('Next Retry')" :value="formatDate(data.next_retry)" />
					<InformationField :label="__('Next Notification')" :value="formatDate(data.next_notify)" />
					<InformationField :label="__('Received From IP')" :value="data.received_from_ip" />
					<InformationField :label="__('Received Via Port')" :value="String(data.received_via_port ?? '—')" />
					<InformationField :label="__('Received At')" :value="formatDate(data.created_at)" />
					<div class="px-5 py-3.5">
						<p class="text-ink-gray-5 mb-1.5 text-sm">{{ __('Flags') }}</p>
						<div v-if="data.flags.length" class="flex flex-wrap gap-1.5">
							<Badge v-for="flag in data.flags" :key="flag.value" :label="flag.label" theme="gray" />
						</div>
						<span v-else class="text-base">—</span>
					</div>
				</DashboardCard>

				<DashboardCard :title="__('Recipients')">
					<div class="flex flex-col">
						<template v-if="data.recipients.length">
							<div
								v-for="r in data.recipients"
								:key="r.email"
								class="group hover:bg-surface-gray-2 flex cursor-pointer items-center gap-3 border-b px-5 py-3 last:border-b-0"
								@click="editRecipient(r)"
							>
								<div class="min-w-0 flex-1">
									<p class="truncate text-base">{{ r.email }}</p>
									<p class="text-ink-gray-5 mt-0.5 text-xs">{{ recipientSummary(r) }}</p>
								</div>
								<Badge :label="statusLabel(r.status_type)" :theme="statusTheme(r.status_type)" />
								<Button
									variant="ghost"
									theme="red"
									class="invisible group-hover:visible"
									@click.stop="removeRecipient(r.email)"
								>
									<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
								</Button>
							</div>
						</template>
						<div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">{{ __('No recipients.') }}</div>
					</div>
				</DashboardCard>
			</div>
		</template>
	</DashboardLayout>

	<EditQueuedMessageModal
		v-if="message.data"
		v-model="showEditMessage"
		:message-id="messageId"
		:message="data"
		@reload="message.reload()"
	/>
	<EditQueuedRecipientModal
		v-model="showEditRecipient"
		:message-id="messageId"
		:recipient="activeRecipient"
		:options="options"
		@reload="message.reload()"
	/>
	<Dialog v-model:open="showCancel" v-bind="cancelDialogOptions" />
	<Dialog v-model:open="showSource" v-bind="{ title: __('Message Source'), size: '4xl' }">
		<template #default>
			<pre
				v-if="source.data"
				class="bg-surface-gray-2 max-h-[70vh] overflow-auto rounded-4 p-4 text-xs whitespace-pre-wrap"
				>{{ source.data.source }}</pre
			>
			<div v-else class="flex justify-center py-6">
				<LoadingIndicator class="text-ink-gray-5 h-4 w-4" />
			</div>
		</template>
	</Dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
	Badge, Button, Dialog, Dropdown, LoadingIndicator, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import Mail from '~icons/lucide/mail'

import { formatBytes, raiseToast } from '@/apps/mail/utils'
import { formatDateTime, fromNow } from '@/apps/mail/utils/datetime'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'
import EditQueuedRecipientModal from '@/apps/mail/components/Modals/EditQueuedRecipientModal.vue'
import EditQueuedMessageModal from '@/apps/mail/components/Modals/EditQueuedMessageModal.vue'

type Recipient = {
	email: string
	status_type?: string
	retry_count?: number
	next_retry?: string
	[key: string]: unknown
}
type MessageData = {
	id: string
	sender?: string
	size?: number
	priority?: number
	env_id?: string
	flags: { value: string; label: string }[]
	next_retry?: string
	next_notify?: string
	received_from_ip?: string
	received_via_port?: number
	created_at?: string
	recipients: Recipient[]
	has_content: boolean
}

const { messageId } = defineProps<{ messageId: string }>()
const router = useRouter()

usePageMeta(() => ({ title: __('Queued Message') }))

const showEditMessage = ref(false)
const showEditRecipient = ref(false)
const showCancel = ref(false)
const showSource = ref(false)
const activeRecipient = ref<Recipient | null>(null)

const message = createResource({
	url: 'suite.mail.api.admin.get_queued_message',
	auto: true,
	makeParams: () => ({ message_id: messageId }),
	cache: ['mailQueuedMessage', messageId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('Message not found.'), 'error')
		router.replace({ name: 'mail-queued-messages' })
	},
})

const data = computed(() => message.data as MessageData)

const recipientOptions = createResource({
	url: 'suite.mail.api.admin.get_queue_recipient_options',
	auto: true,
	cache: 'mailQueueRecipientOptions',
})
const options = computed(
	() => recipientOptions.data || { status_types: [], error_types: [], expiry_types: [] },
)

const source = createResource({
	url: 'suite.mail.api.admin.get_queued_message_source',
	makeParams: () => ({ message_id: messageId }),
	onError: (error: { messages?: string[] }) => {
		showSource.value = false
		raiseToast(error.messages?.[0] || __('Failed to load message source.'), 'error')
	},
})

const STATUS_LABELS: Record<string, string> = {
	Scheduled: __('Scheduled'),
	Completed: __('Delivered'),
	TemporaryFailure: __('Temporary Failure'),
	PermanentFailure: __('Permanent Failure'),
}
const formatDate = (value?: string | null) => formatDateTime(value) || '—'
const statusLabel = (type?: string) => STATUS_LABELS[type || ''] || type || __('Scheduled')
const statusTheme = (type?: string) => {
	if (type === 'Completed') return 'green'
	if (type === 'PermanentFailure') return 'red'
	if (type === 'TemporaryFailure') return 'amber'
	return 'gray'
}
const recipientSummary = (r: Recipient) => {
	const parts = [__('Retries: {0}').replace('{0}', String(r.retry_count ?? 0))]
	if (r.next_retry) parts.push(__('Next retry {0}').replace('{0}', fromNow(r.next_retry)))
	return parts.join(' · ')
}

const editRecipient = (r: Recipient) => {
	activeRecipient.value = r
	showEditRecipient.value = true
}

const queuedAgo = computed(() =>
	data.value?.created_at ? __('Queued {0}', [fromNow(data.value.created_at)]) : undefined,
)

const breadcrumbs = computed(() => [
	{ label: __('Queued'), route: '/mail/dashboard/queued' },
	{ label: data.value?.sender || messageId },
])

const retry = createResource({
	url: 'suite.mail.api.admin.retry_queued_messages',
	makeParams: () => ({ ids: [messageId] }),
	onSuccess: () => {
		message.reload()
		raiseToast(__('Message scheduled for retry.'))
	},
})

const removeRecipient = (email: string) =>
	createResource({
		url: 'suite.mail.api.admin.remove_queued_recipient',
		makeParams: () => ({ message_id: messageId, email }),
		onSuccess: () => {
			message.reload()
			raiseToast(__('Delivery to the recipient canceled.'))
		},
		onError: (error: { messages?: string[] }) =>
			raiseToast(error.messages?.[0] || __('Request failed.'), 'error'),
	}).submit()

const cancel = createResource({
	url: 'suite.mail.api.admin.cancel_queued_messages',
	makeParams: () => ({ ids: [messageId] }),
	onSuccess: () => {
		showCancel.value = false
		raiseToast(__('Message cancelled.'))
		router.push({ name: 'mail-queued-messages' })
	},
})

const cancelDialogOptions = computed(() => ({
	title: __('Cancel Message'),
	message: __('Cancel (delete) this queued message? This cannot be undone.'),
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: cancel.submit }],
}))

const dropdownOptions = computed(() => {
	const items: { label: string; icon: string; onClick: () => void }[] = []
	if (data.value?.has_content) {
		items.push({
			label: __('View Source'),
			icon: 'lucide-file-text',
			onClick: () => ((showSource.value = true), source.fetch()),
		})
	}
	items.push({ label: __('Cancel'), icon: 'lucide-trash-2', onClick: () => (showCancel.value = true) })
	return [{ group: '', options: items }]
})
</script>
