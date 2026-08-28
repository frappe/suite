<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Recipient'),
			size: '3xl',
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateRecipient.loading,
					onClick: updateRecipient.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-6">
				<!-- Recipient -->
				<section class="space-y-3">
					<h3 class="text-ink-gray-7 text-sm font-semibold">{{ __('Recipient') }}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormControl v-model="form.email" :label="__('Email')" type="email" />
						<FormControl v-model="form.orcpt" :label="__('Original Recipient')" />
					</div>
				</section>

				<!-- Status -->
				<section class="space-y-3">
					<h3 class="text-ink-gray-7 text-sm font-semibold">{{ __('Status') }}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormControl v-model="form.status_type" :label="__('Status')" type="select" :options="statusOptions" />
						<FormControl
							v-if="isFailure"
							v-model="form.error_type"
							:label="__('Error Type')"
							type="select"
							:options="errorOptions"
						/>
					</div>
					<template v-if="isFailure">
						<FormControl v-model="form.error_message" :label="__('Error Message')" type="textarea" />
						<FormControl v-model="form.smtp_command" :label="__('SMTP Command')" />
					</template>
				</section>

				<!-- Server Response -->
				<section v-if="hasResponse" class="space-y-3">
					<h3 class="text-ink-gray-7 text-sm font-semibold">{{ __('Server Response') }}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormControl v-model="form.hostname" :label="__('Hostname')" />
						<FormControl v-model="form.response_code" :label="__('Response Code')" type="number" />
						<FormControl v-model="form.enhanced_code" :label="__('Enhanced Code')" placeholder="4.7.1" />
						<FormControl v-model="form.message" :label="__('Message')" />
					</div>
				</section>

				<!-- Delivery -->
				<section class="space-y-3">
					<h3 class="text-ink-gray-7 text-sm font-semibold">{{ __('Delivery') }}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormControl v-model="form.next_retry" :label="__('Next Retry')" type="datetime-local" />
						<FormControl v-model="form.retry_count" :label="__('Retry Count')" type="number" />
						<FormControl v-model="form.next_notification" :label="__('Next Notification')" type="datetime-local" />
						<FormControl v-model="form.notify_count" :label="__('Notify Count')" type="number" />
					</div>
				</section>

				<!-- Expiry -->
				<section class="space-y-3">
					<h3 class="text-ink-gray-7 text-sm font-semibold">{{ __('Expiry') }}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormControl v-model="form.expiry_type" :label="__('Expiry')" type="select" :options="expiryOptions" />
						<FormControl
							v-if="form.expiry_type === 'Ttl'"
							v-model="form.expires_at"
							:label="__('Expires At')"
							type="datetime-local"
						/>
						<FormControl
							v-else-if="form.expiry_type === 'Attempts'"
							v-model="form.expires_attempts"
							:label="__('Max Attempts')"
							type="number"
						/>
					</div>
				</section>

				<ErrorMessage
					:message="updateRecipient.error && (updateRecipient.error?.messages?.[0] || updateRecipient.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'

type Option = { value: string; label: string }
type Recipient = {
	email: string
	orcpt?: string
	status_type?: string
	error_type?: string
	error_message?: string
	smtp_command?: string
	hostname?: string
	response_code?: number
	enhanced_code?: string
	message?: string
	next_retry?: string
	retry_count?: number
	next_notification?: string
	notify_count?: number
	expiry_type?: string
	expires_at?: string
	expires_attempts?: number
}

const show = defineModel<boolean>()
const { messageId, recipient, options } = defineProps<{
	messageId: string
	recipient: Recipient | null
	options: { status_types: Option[]; error_types: Option[]; expiry_types: Option[] }
}>()
const emit = defineEmits(['reload'])

const blank = () => ({
	email: '',
	orcpt: '',
	status_type: 'Scheduled',
	error_type: '',
	error_message: '',
	smtp_command: '',
	hostname: '',
	response_code: '',
	enhanced_code: '',
	message: '',
	next_retry: '',
	retry_count: '',
	next_notification: '',
	notify_count: '',
	expiry_type: 'Ttl',
	expires_at: '',
	expires_attempts: '',
})
const form = reactive<Record<string, string>>(blank())

const toLocal = toLocalInput
const str = (value: unknown) => (value === null || value === undefined ? '' : String(value))

const statusOptions = computed(() => options.status_types)
const errorOptions = computed(() => options.error_types)
const expiryOptions = computed(() => options.expiry_types)
const isFailure = computed(() => ['TemporaryFailure', 'PermanentFailure'].includes(form.status_type))
const hasResponse = computed(() => form.status_type && form.status_type !== 'Scheduled')

watch(show, () => {
	if (show.value && recipient) {
		Object.assign(form, blank(), {
			email: recipient.email || '',
			orcpt: recipient.orcpt || '',
			status_type: recipient.status_type || 'Scheduled',
			error_type: recipient.error_type || '',
			error_message: recipient.error_message || '',
			smtp_command: recipient.smtp_command || '',
			hostname: recipient.hostname || '',
			response_code: str(recipient.response_code),
			enhanced_code: recipient.enhanced_code || '',
			message: recipient.message || '',
			next_retry: toLocal(recipient.next_retry),
			retry_count: str(recipient.retry_count),
			next_notification: toLocal(recipient.next_notification),
			notify_count: str(recipient.notify_count),
			expiry_type: recipient.expiry_type || 'Ttl',
			expires_at: toLocal(recipient.expires_at),
			expires_attempts: str(recipient.expires_attempts),
		})
		updateRecipient.reset()
	}
})

const updateRecipient = createResource({
	url: 'suite.mail.api.admin.update_queued_recipient',
	makeParams: () => ({
		message_id: messageId,
		email: recipient?.email,
		new_email: form.email.trim(),
		orcpt: form.orcpt.trim(),
		status_type: form.status_type,
		error_type: isFailure.value ? form.error_type : '',
		error_message: isFailure.value ? form.error_message : '',
		smtp_command: isFailure.value ? form.smtp_command : '',
		hostname: hasResponse.value ? form.hostname.trim() : '',
		response_code: hasResponse.value ? form.response_code : '',
		enhanced_code: hasResponse.value ? form.enhanced_code.trim() : '',
		message: hasResponse.value ? form.message.trim() : '',
		next_retry: fromLocalInput(form.next_retry),
		retry_count: form.retry_count,
		next_notification: fromLocalInput(form.next_notification),
		notify_count: form.notify_count,
		expiry_type: form.expiry_type,
		expires_at: form.expiry_type === 'Ttl' ? fromLocalInput(form.expires_at) : '',
		expires_attempts: form.expiry_type === 'Attempts' ? form.expires_attempts : '',
	}),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Recipient updated.'))
	},
})
</script>
