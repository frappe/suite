<template>
	<div class="overflow-y-auto rounded-4 border text-sm sm:max-h-96 sm:w-96 sm:border-0">
		<div class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3">
			<template v-for="field in fields" :key="field.label">
				<!-- Label and value share one paragraph style, so their first-line boxes —
				     and therefore baselines — align by construction, no nudges. Color alone
				     separates them. -->
				<span class="text-ink-gray-4 text-p-sm whitespace-nowrap">
					{{ field.label }}
				</span>
				<span class="text-ink-gray-7 text-p-sm break-words">{{ field.value }}</span>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import { getGroupedRecipients } from '@/apps/mail/utils'

import type { Mail } from '@/apps/mail/types'

const dayjs = inject('$dayjs')

const { mail } = defineProps<{ mail: Mail }>()

const recipients = computed(() => getGroupedRecipients(mail.recipients, true, true))

// Lowercase, no colons — the labels describe, the values speak.
const fields = computed(() =>
	[
		{ label: __('from'), value: sender.value },
		{ label: __('to'), value: recipients.value.to },
		{ label: __('cc'), value: recipients.value.cc },
		{ label: __('bcc'), value: recipients.value.bcc },
		// Shown only when a reply would go somewhere other than the sender — when it
		// merely restates From, it is noise and stays out.
		{ label: __('reply to'), value: divertedReplyTo.value },
		{ label: __('subject'), value: mail.subject },
		{ label: __('date'), value: formattedDate.value },
	].filter((field) => field.value),
)

// The same shape the recipient rows use: name with the address alongside.
const sender = computed(() =>
	mail.from_name ? `${mail.from_name} <${mail.from_email}>` : mail.from_email,
)

const divertedReplyTo = computed(() => {
	const diverted = mail.reply_to
		.map((rt) => rt.email)
		.filter((email) => email.toLowerCase() !== mail.from_email.toLowerCase())
	return diverted.join(', ')
})


const formattedDate = computed(() =>
	dayjs(mail.received_at).format('ddd, MMM D, YYYY · h:mm A'),
)
</script>
