<script setup lang="ts">
import { computed } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Combobox, createResource, toast } from 'frappe-ui'

import EventParticipantList from '@/apps/calendar/components/EventParticipantList.vue'

const props = withDefaults(
	defineProps<{
		account?: string
		label?: string
		placeholder?: string
		displayParticipants?: any[]
		excludedEmails?: string[]
	}>(),
	{
		label: () => __('Participants'),
		placeholder: () => __('Enter participants'),
		excludedEmails: () => [],
	},
)

const participants = defineModel<any[]>({ required: true })

const visibleParticipants = computed(() => props.displayParticipants || participants.value)
const normalizedExcludedEmails = computed(() =>
	props.excludedEmails.map((email) => email.toLowerCase()),
)

const mailContacts = createResource({
	url: 'suite.mail.api.contacts.get_contacts',
	makeParams: (text: string) => ({
		account: props.account,
		filter: { operator: 'OR', conditions: [{ text }, { email: text }] },
	}),
	transform: (data: any[]) => data.map((contact) => contact.email),
})

const debouncedSearch = useDebounceFn((text: string) => text && mailContacts.reload(text), 300)

const addParticipant = (email: string) => {
	const value = email?.trim()
	if (!value) return
	if (!/^\S+@\S+\.\S+$/.test(value)) {
		toast.error(__('Invalid email address'))
		return
	}

	const normalizedEmail = value.toLowerCase()
	if (normalizedExcludedEmails.value.includes(normalizedEmail)) return
	if (visibleParticipants.value.some((participant) => participant.email.toLowerCase() === normalizedEmail))
		return

	participants.value = [
		...participants.value,
		{ email: value, participation_status: 'NEEDS-ACTION', expect_reply: true, isNew: true },
	]
}

const handleParticipantEnter = (e: Event) => {
	const input = e.target as HTMLInputElement
	input.value
		.split(',')
		.map((email) => email.trim())
		.filter(Boolean)
		.forEach(addParticipant)
	input.value = ''
}

const removeParticipant = (email: string) => {
	participants.value = participants.value.filter((participant) => participant.email !== email)
}
</script>

<template>
	<div class="space-y-4">
		<div>
			<h3 class="text-base-medium mb-2 text-ink-gray-8">{{ label }}</h3>
			<Combobox
				class="w-full"
				:options="mailContacts?.data || []"
				:placeholder="placeholder"
				@input="debouncedSearch($event)"
				@keyup.enter="handleParticipantEnter($event)"
			/>
		</div>
		<div class="max-h-[32rem] space-y-4 overflow-y-auto">
			<EventParticipantList
				:participants="visibleParticipants"
				@remove-participant="removeParticipant"
			/>
		</div>
	</div>
</template>
