<template>
	<div v-if="report" class="text-ink-gray-6 mb-3 rounded border p-2.5 px-4">
		<div class="flex items-start gap-3">
			<component
				:is="statusIcon"
				class="mt-0.5 h-4.5 w-4.5 shrink-0 stroke-1.5"
				:class="statusIconClass"
			/>
			<div class="min-w-0 flex-1">
				<span class="text-ink-gray-8 block font-medium">{{ title }}</span>
				<div
					v-for="(recipient, idx) in report.recipients"
					:key="`${recipient.email}-${idx}`"
					class="mt-1.5"
				>
					<p>{{ recipientLine(recipient) }}</p>
					<template v-if="serverResponse(recipient)">
						<p class="mt-1.5">{{ __('The response from the remote server was:') }}</p>
						<pre
							class="bg-surface-gray-1 text-ink-gray-7 mt-1.5 overflow-x-auto whitespace-pre-wrap rounded p-2 font-mono text-xs"
							>{{ serverResponse(recipient) }}</pre
						>
					</template>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { CircleAlert, CircleCheck, Clock } from 'lucide-vue-next'
import { createResource } from 'frappe-ui'

import {
	overallDsnAction,
	serverResponse,
	type DeliveryStatusReport,
	type DsnRecipient,
} from '@/apps/mail/utils/deliveryStatus'

const { blobId, account } = defineProps<{ blobId: string; account: string }>()

// Tells the thread whether the card took over from the raw MAILER-DAEMON body — false when the
// part yields no recipients (or can't be fetched), so the original text comes back as fallback.
const emit = defineEmits<{ loaded: [rendered: boolean] }>()

const dayjs = inject('$dayjs') as any

const details = createResource({
	url: 'suite.mail.api.mail.get_delivery_status',
	params: { account, blob_id: blobId },
	auto: true,
	onSuccess: (data: DeliveryStatusReport) => emit('loaded', !!data?.recipients?.length),
	onError: () => emit('loaded', false),
})

const report = computed<DeliveryStatusReport | null>(() =>
	details.data?.recipients?.length ? details.data : null,
)

const action = computed(() => overallDsnAction(report.value?.recipients || []))

const title = computed(() => {
	if (action.value === 'failed') return __('Message not delivered')
	if (action.value === 'delayed') return __('Message delivery delayed')
	if (action.value === 'delivered') return __('Message delivered')
	return __('Delivery status')
})

const statusIcon = computed(() => {
	if (action.value === 'failed') return CircleAlert
	if (action.value === 'delayed') return Clock
	return CircleCheck
})

const statusIconClass = computed(() => {
	if (action.value === 'failed') return 'text-ink-red-4'
	if (action.value === 'delayed') return 'text-ink-amber-3'
	return 'text-ink-gray-6'
})

const recipientLine = (recipient: DsnRecipient) => {
	if (recipient.action === 'failed')
		return __("Your message couldn't be delivered to {0}.", [recipient.email])
	if (recipient.action === 'delayed') {
		if (recipient.will_retry_until)
			return __('Delivery to {0} has been delayed. The server will keep trying until {1}.', [
				recipient.email,
				dayjs?.(recipient.will_retry_until).format?.('MMM D, YYYY, h:mm A') ||
					recipient.will_retry_until,
			])
		return __('Delivery to {0} has been delayed. The server will keep trying.', [
			recipient.email,
		])
	}
	if (recipient.action === 'delivered')
		return __('Your message was delivered to {0}.', [recipient.email])
	return __('Delivery status for {0}: {1}', [recipient.email, recipient.action])
}
</script>
