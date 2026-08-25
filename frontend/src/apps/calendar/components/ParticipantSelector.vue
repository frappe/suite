<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Avatar, Combobox, createResource, toast } from 'frappe-ui'

import EventParticipantList from '@/apps/calendar/components/EventParticipantList.vue'

interface ContactSuggestion {
	name?: string | null
	email: string
	user_image?: string | null
}

interface ContactOption extends ContactSuggestion {
	label: string
	value: string
	description?: string
}

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
	url: 'suite.mail.api.mail.get_email_suggestions',
	makeParams: (text: string) => ({
		account: props.account,
		text,
	}),
	transform: (data: ContactSuggestion[]): ContactOption[] =>
		data.map((contact) => ({
			...contact,
			label: contact.email,
			value: contact.email,
			description: contact.name || undefined,
		})),
})

const debouncedSearch = useDebounceFn((text: string) => text && mailContacts.reload(text), 300)

const combobox = ref<{ clear: () => void } | null>(null)

const searchText = ref('')
const showSuggestions = ref(false)

// Suggestions only exist for a typed query — with an empty input the popover
// would show stale results from the previous query (or a bare "No results"
// panel), so block reka's focus/arrow-key opens too, not just hide options.
watch(showSuggestions, (open) => {
	if (open && !searchText.value) showSuggestions.value = false
})

const options = computed(() => (searchText.value ? mailContacts?.data || [] : []))

// Picking a dropdown option commits it on keydown, so the matching keyup.enter lands here too and
// would re-add the option and clear the input from under the reset below. Typing is the only way
// back to the free-text path, so an input event is what clears this again.
const justSelectedOption = ref(false)

const handleInput = (text: string) => {
	justSelectedOption.value = false
	searchText.value = text
	if (!text) showSuggestions.value = false
	debouncedSearch(text)
}

const addParticipant = (email: string, contact?: ContactSuggestion) => {
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
		{
			email: value,
			_name: contact?.name,
			user_image: contact?.user_image,
			participation_status: 'NEEDS-ACTION',
			expect_reply: true,
			isNew: true,
		},
	]
}

// Picking a contact commits it as the Combobox's selected value — add it and clear the control so the
// input clears for the next participant, rather than sitting there showing the one just added.
// The clear waits a tick: this handler fires mid-commit, and the Combobox writes the option's label
// into its input right after we return, which would undo a synchronous clear.
const handleParticipantSelect = async (email: string | null) => {
	if (!email) return
	justSelectedOption.value = true
	const contact = (mailContacts.data as ContactOption[] | undefined)?.find(
		(option) => option.email.toLowerCase() === email.toLowerCase(),
	)
	addParticipant(email, contact)
	await nextTick()
	combobox.value?.clear()
}

const handleParticipantEnter = (e: Event) => {
	if (justSelectedOption.value) return

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
			<h3 v-if="label" class="text-base-medium mb-2 text-ink-gray-8">{{ label }}</h3>
			<Combobox
				ref="combobox"
				v-model:open="showSuggestions"
				class="w-full"
				:options="options"
				:filterable="false"
				:placeholder="placeholder"
				@update:query="handleInput($event)"
				@update:model-value="handleParticipantSelect($event)"
				@keyup.enter="handleParticipantEnter($event)"
			>
				<template #item-prefix="{ item }">
					<Avatar :image="item.user_image" :label="item.description || item.label" size="md" />
				</template>
			</Combobox>
		</div>
		<div class="max-h-[32rem] space-y-4 overflow-y-auto">
			<EventParticipantList
				:participants="visibleParticipants"
				@remove-participant="removeParticipant"
			/>
		</div>
	</div>
</template>
