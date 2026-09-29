<template>
	<!-- The advanced filters, in the palette rather than beside it: the query line above stays
	     where it was, and every field here writes the same filters the chips show. It takes the
	     result list's place while it is open — a form and the results it has not run yet are two
	     answers to the same question. -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class="space-y-4 p-4">
			<Switch
				v-if="hasMultipleAccounts"
				v-model="allAccounts"
				:label="__('Search across all accounts')"
				:description="
					__(
						'Look through every account you own — slower, but finds a mail wherever it landed.',
					)
				"
				class="!p-0"
			/>
			<FormControl
				v-if="!allAccounts"
				v-model="filter.inMailbox"
				type="select"
				:label="__('Look In')"
				:options="mailboxOptions"
			/>
			<FormControl v-model="filter.subject" :label="__('Subject')" />
			<ContactCombobox v-model="filter.from" :label="__('From')" />
			<ContactCombobox v-model="filter.to" :label="__('To')" />
			<ContactCombobox v-model="filter.cc" :label="__('Cc')" />
			<ContactCombobox v-model="filter.bcc" :label="__('Bcc')" />
			<div class="flex space-x-4">
				<FormControl
					v-model="filter.after"
					type="date"
					:label="__('From Date')"
					class="w-full"
				/>
				<FormControl
					v-model="filter.before"
					type="date"
					:label="__('To Date')"
					class="w-full"
				/>
			</div>
			<div class="flex space-x-4">
				<FormControl
					v-model="filter.hasAttachment"
					type="select"
					:label="__('Attachments')"
					:options="attachmentOptions"
					class="w-full min-w-0"
				/>
				<FormControl
					v-model="filter.isRead"
					type="select"
					:label="__('Read Status')"
					:options="readStatusOptions"
					class="w-full min-w-0"
				/>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { FormControl, Switch } from 'frappe-ui'

import {
	getAttachmentOptions,
	getReadStatusOptions,
} from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'
import ContactCombobox from '@/apps/mail/components/Controls/ContactCombobox.vue'

const FILTER_KEYS = [
	'inMailbox',
	'subject',
	'from',
	'to',
	'cc',
	'bcc',
	'after',
	'before',
	'hasAttachment',
	'isRead',
] as const

const filters = defineModel<Record<string, string>>('filters', {
	required: true,
})
const allAccounts = defineModel<boolean>('allAccounts', { required: true })
// Told, not re-derived: the search composable already knows, and hands it to whoever mounts this.
defineProps<{ hasMultipleAccounts: boolean }>()

const { mailboxes } = userStore()

const attachmentOptions = getAttachmentOptions()
const readStatusOptions = getReadStatusOptions()

// A field per filter, because a form wants somewhere to put an empty string and the filters the
// palette holds only name the ones that are set. The fields are seeded once, on open — writing the
// trimmed filters back into them would take the space out from under a word being typed.
const filter = reactive<Record<string, string>>({
	...Object.fromEntries(FILTER_KEYS.map((key) => [key, ''])),
	...filters.value,
})

watch(filter, (value) => {
	filters.value = Object.fromEntries(
		Object.entries(value)
			.map(([key, entry]) => [key, entry.trim()])
			.filter(([, entry]) => Boolean(entry)),
	)
})
// A folder belongs to one account, so it cannot survive the widening.
watch(allAccounts, (value) => {
	if (value) filter.inMailbox = ''
})

const mailboxOptions = computed(() =>
	[{ label: __('All folders'), value: '' }].concat(
		mailboxes.data.map((mailbox: { id: string; _name: string }) => ({
			label: mailbox._name,
			value: mailbox.id,
		})),
	),
)
</script>
