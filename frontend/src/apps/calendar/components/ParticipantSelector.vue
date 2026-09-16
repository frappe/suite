<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Avatar, Combobox, FormControl, createResource, toast } from 'frappe-ui'

import { extractNameFromEmail } from '@/apps/calendar/utils/format'
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
		/**
		 * How the matches are offered. `dropdown` is the combobox: a popover over
		 * whatever is beneath the field, which is what a form with rows under it
		 * wants. `inline` puts them in the column below instead, where a screen of
		 * its own has the room and nothing worth covering.
		 */
		variant?: 'dropdown' | 'inline'
	}>(),
	{
		label: () => __('Participants'),
		placeholder: () => __('Enter participants'),
		excludedEmails: () => [],
		variant: 'dropdown',
	},
)

const participants = defineModel<any[]>({ required: true })

const visibleParticipants = computed(() => props.displayParticipants || participants.value)
const normalizedExcludedEmails = computed(() =>
	props.excludedEmails.map((email) => email.toLowerCase()),
)

// True from the keystroke until the search it starts has answered. `mailContacts.loading`
// alone is not that: the request is debounced, so between typing and sending there is a
// window where nothing is in flight and nothing has come back either.
const searchPending = ref(false)

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
	onSuccess: () => (searchPending.value = false),
	onError: () => (searchPending.value = false),
})

const debouncedSearch = useDebounceFn((text: string) => text && mailContacts.reload(text), 300)

const searchText = ref('')

watch(searchText, (text) => {
	searchPending.value = !!text
	debouncedSearch(text)
})

const combobox = ref<{ clear: () => void } | null>(null)
const showSuggestions = ref(false)

// Suggestions only exist for a typed query — with an empty input the popover
// would show stale results from the previous query (or a bare "No results"
// panel), so block reka's focus/arrow-key opens too, not just hide options.
watch(showSuggestions, (open) => {
	if (open && !searchText.value) showSuggestions.value = false
})

// Picking a dropdown option commits it on keydown, so the matching keyup.enter lands here too and
// would re-add the option and clear the input from under the reset below. Typing is the only way
// back to the free-text path, so an input event is what clears this again.
const justSelectedOption = ref(false)

const handleInput = (text: string) => {
	justSelectedOption.value = false
	searchText.value = text
	if (!text) showSuggestions.value = false
}

/** Whether an address is already on the event. */
const isAdded = (email: string) =>
	visibleParticipants.value.some(
		(participant) => participant.email.toLowerCase() === email.toLowerCase(),
	)

// Suggestions exist only for a typed query: with the field empty the list below is
// the participants themselves, and the results of the last query would otherwise
// sit there under an empty input.
//
// Someone already on the event stays in the results, marked. Dropping them would
// answer "is this person coming?" with silence — and worse, searching their exact
// address would report no matches over an offer to add them, which then does
// nothing. An excluded address does go: it cannot be added at all, so it is not a
// result being withheld.
const options = computed<ContactOption[]>(() =>
	searchText.value
		? ((mailContacts?.data as ContactOption[] | undefined) || []).filter(
				(option) => !normalizedExcludedEmails.value.includes(option.email.toLowerCase()),
			)
		: [],
)

/** Whether the list below the field is showing matches rather than participants. */
const isSearching = computed(() => !!searchText.value)

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

// Picking a match adds it and empties the field, which puts the list back to the
// participants — the one just added among them, which is the confirmation.
const selectSuggestion = (option: ContactOption) => {
	addParticipant(option.email, option)
	searchText.value = ''
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

// Enter takes whatever has been typed, so an address with no match is still
// addable — several at once when they are separated by commas. The dropdown hands
// over its own input, whose value the combobox owns; the inline field is the ref.
const handleParticipantEnter = (e?: Event) => {
	if (justSelectedOption.value) return

	const input = e?.target as HTMLInputElement | undefined
	const text = input ? input.value : searchText.value
	text
		.split(',')
		.map((email) => email.trim())
		.filter(Boolean)
		.forEach((email) => addParticipant(email))

	if (input) input.value = ''
	searchText.value = ''
}

const removeParticipant = (email: string) => {
	participants.value = participants.value.filter((participant) => participant.email !== email)
}
</script>

<template>
	<!-- The field is a block of its own, so it stands further off the list than the
	     rows stand off each other: 16px above, 12px between. A single step throughout
	     had the first row reading as part of the field rather than as the first of
	     what the field adds to. -->
	<div class="space-y-4">
		<div>
			<h3 v-if="label" class="text-base-medium mb-2 text-ink-gray-8">{{ label }}</h3>
			<Combobox
				v-if="variant === 'dropdown'"
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
			<!-- Inline: a field, not a select. On a screen of its own there is nothing
			     worth covering with a popover, and a chevron there would say the
			     addresses are a fixed list to pick from rather than something typed. -->
			<FormControl
				v-else
				v-model="searchText"
				type="text"
				:placeholder="placeholder"
				autocomplete="off"
				@keyup.enter="handleParticipantEnter()"
			/>
		</div>
		<!-- 12px between rows, the same step the field keeps above them: the column
		     reads as one rhythm from the input down, where a tighter gap between the
		     rows than above them made the first row look attached to the field.

		     One column, two things in it: while there is a query the list is what
		     matches it, and the rest of the time it is who is coming. The matches
		     replace the participants rather than covering them — the field is being
		     used to add someone, and the list of who is already here is the one thing
		     on screen that is not the answer to that.

		     No height of its own: every host already scrolls what this is in — the
		     event form's rail and the phone's form page scroll their column, and
		     Meet's schedule dialog grows and scrolls with its overlay — and a list
		     capped inside one of those scrolled twice: it stopped at its own cap with
		     the column's spare room blank beneath it, and read as cut off. -->
		<div class="space-y-3">
			<template v-if="variant === 'inline' && isSearching">
				<!-- The same row as a participant's, because the two take turns in this
				     column: same `lg` avatar, same 8px gap, same two lines in the same
				     sizes, and no padding of its own — a row that inset itself made the
				     names step sideways the moment a query was typed. The hover fill is
				     the only thing added, and it hugs that same box. -->
				<button
					v-for="option in options"
					:key="option.value"
					type="button"
					:disabled="isAdded(option.email)"
					class="flex w-full items-center gap-2 rounded-4 text-left enabled:hover:bg-surface-gray-2 disabled:cursor-default"
					@click="selectSuggestion(option)"
				>
					<Avatar :image="option.user_image" :label="option.description || option.label" size="lg" />
					<span class="flex min-w-0 flex-1 flex-col space-y-0.5">
						<span class="truncate text-sm-medium text-ink-gray-8">
							{{ extractNameFromEmail(option.description || option.label) }}
						</span>
						<span class="truncate text-p-sm text-ink-gray-5">{{ option.label }}</span>
					</span>
					<!-- Says why the row does nothing when pressed, rather than leaving a
					     dead click to be discovered. -->
					<span v-if="isAdded(option.email)" class="shrink-0 text-p-sm text-ink-gray-5">
						{{ __('Added') }}
					</span>
				</button>
				<!-- One line for the two states with nothing to list, so the column is never
				     blank while a query is out: an address with no match is still addable, so
				     that case says what Enter is for rather than reporting a dead end — but
				     only once the search has actually come back and found nothing. -->
				<p v-if="!options.length" class="px-2 py-1.5 text-p-sm text-ink-gray-5">
					{{
						searchPending
							? __('Loading...')
							: __('No matches. Press Enter to add this address.')
					}}
				</p>
			</template>
			<EventParticipantList
				v-else
				:participants="visibleParticipants"
				@remove-participant="removeParticipant"
			/>
		</div>
	</div>
</template>
