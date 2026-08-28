<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Edit Queued Message'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					loading: updateMessage.loading,
					onClick: updateMessage.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="nextRetry"
					:label="__('Next Retry')"
					type="datetime-local"
					:description="__('The next delivery attempt is scheduled for this time.')"
				/>
				<ErrorMessage
					:message="updateMessage.error && (updateMessage.error?.messages?.[0] || updateMessage.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'

const show = defineModel<boolean>()
const { messageId, message } = defineProps<{ messageId: string; message: { next_retry?: string } }>()
const emit = defineEmits(['reload'])

const nextRetry = ref('')

watch(show, () => {
	if (show.value) {
		nextRetry.value = toLocalInput(message?.next_retry)
		updateMessage.reset()
	}
})

const updateMessage = createResource({
	url: 'suite.mail.api.admin.update_queued_message',
	makeParams: () => ({ message_id: messageId, next_retry: fromLocalInput(nextRetry.value) }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Queued message updated.'))
	},
})
</script>
