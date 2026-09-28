<template>
	<div
		ref="container"
		data-recipient-input
		class="relative flex min-h-7 w-full flex-1 cursor-text flex-wrap items-center gap-2 rounded-4 transition-colors"
		:class="{ 'ring-outline-gray-3 ring-2': isDragOver && !isDragging }"
		@keydown.capture="handleContainerKeydown"
		@dragover.prevent="isDragOver = true"
		@dragleave="isDragOver = false"
		@drop.prevent="handleDrop"
		@click="handleClick"
	>
		<!-- Not selectable on mobile: keyboard selection is a desktop gesture, and leaving it on
		     meant a tap that was aimed at the field picked out a chip instead. A tap on a chip
		     there opens the menu below — the phone's answer to the drag between fields, which
		     touch never fires the events for. -->
		<button
			v-for="(v, i) in displayedRecipients"
			ref="tags"
			:key="v.email"
			class="bg-surface-gray-2 flex min-h-7 items-center space-x-1.5 rounded-4 px-2 text-base focus:outline-none"
			:class="{
				'ring-outline-gray-3 ring-2': focusedTagIndex === i,
			}"
			:tabindex="isMobile ? -1 : undefined"
			:draggable="!isMobile"
			@click="handleTagClick($event, i)"
			@focus="!isMobile && (focusedTagIndex = i)"
			@blur="focusedTagIndex = -1"
			@keydown.delete.stop="removeValueAt(i)"
			@dragstart="handleDragStart($event, v)"
			@dragend="handleDragEnd"
		>
			<Avatar :image="v.image" :label="v.display_name || v.email" size="xs" />
			<!-- Capped on mobile whether or not the field is focused: a name too long for the
			     row wraps the chip onto two lines otherwise, which reads as a broken box. -->
			<span :class="{ 'max-w-40 truncate': isMobile }">
				{{ v.display_name || v.email }}
			</span>
			<!-- Desktop only: on a phone the chip itself is the trigger, and Remove is in the
			     sheet that opens — a second, smaller target for the same act beside it. -->
			<X v-if="!isMobile" class="icon" @click.stop="removeValue(v.email)" />
		</button>
		<span v-if="hiddenCount" class="text-ink-gray-6 text-sm">+{{ hiddenCount }}</span>
		<!-- Taken out of flow while the collapsed row is showing on mobile: the chips fill the
		     line, so an input that is only ever 2px wide still wraps to a second one — a row
		     twice as tall for a caret nobody is typing into. Parked rather than hidden, because
		     a tap on the row focuses this input and display:none can't take focus; the class is
		     gone by the time that matters, focus being what drops it. -->
		<Combobox
			v-model="input"
			v-model:open="showSuggestions"
			v-model:query="searchText"
			placeholder=""
			variant="ghost"
			:options
			:open-on-click="false"
			class="recipient-combobox border-none !bg-inherit !ring-0"
			:class="{ 'is-parked': isMobile && !isFocused }"
			inputmode="email"
			enterkeyhint="done"
			autocapitalize="none"
			autocorrect="off"
			spellcheck="false"
			@keydown.enter.capture="handleInlineEnter"
			@keydown.delete.capture.stop="handleDelete($event.target.value)"
			@paste="handlePaste"
			@focusin="isSearchFocused = true"
			@focusout="handleFieldBlur"
			@update:selected-option="nextTick(setFocus)"
		>
			<template #suffix> <span /> </template>
			<template #item-prefix="{ item, query }">
				<Avatar
					:image="item.image"
					:label="item.display_name || item.email || query"
					size="lg"
				/>
			</template>
			<template #item-label="{ item }">
				<ContactOption :contact="item" />
			</template>
			<template #item-create="{ query }"> {{ query }} </template>
		</Combobox>

		<!--
		  Suggestions in flow, full width, rather than in the Combobox's floating panel — the phone
		  form Gmail's compose uses. A panel on a phone is a small card over a field the keyboard is
		  already crowding; a list that owns the width below the field is easier to hit and can't be
		  clipped by anything.

		  Teleported to a target the parent provides, because the list has to escape this input's
		  column (it sits to the right of the field's label) to reach both edges of the page. The
		  Combobox stays for the chips and the typing; only its popover is suppressed.
		-->
		<Teleport v-if="suggestionsTo" :to="suggestionsTo">
			<ul v-if="inlineSuggestions.length" ref="suggestionList">
				<li v-for="option in inlineSuggestions" :key="option.email">
					<!-- The press must not move focus: the list is only rendered while the field has it,
					     so letting the input blur unmounts the row from under the finger and the click
					     lands on nothing. Selection happens on the click that follows. -->
					<button
						class="hover:bg-surface-gray-2 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
						@mousedown.prevent
						@click="pickSuggestion(option)"
					>
						<Avatar :image="option.image" :label="option.display_name || option.email" size="lg" />
						<ContactOption :contact="option" />
					</button>
				</li>
			</ul>
		</Teleport>

		<!-- Trigger-less: the chips are the trigger, and the one that was tapped is both what the
		     menu is about and what it hangs off, so it needs no title to say whose it is. Mobile
		     only — a desktop chip is dragged from field to field instead.

		     It takes no focus on open: the caret stays where it was, which keeps the row from
		     reflowing (an unfocused row collapses to one line) out from under the chip the menu
		     is anchored to. -->
		<Popover
			v-if="isMobile"
			v-model:open="isMenuOpen"
			trigger="manual"
			:reference="menuAnchor"
			:auto-focus="false"
			align="start"
		>
			<div class="min-w-52 max-w-72 p-1">
				<!-- Who this is about, the way a contact reads in every picker: the address is what
				     the chip cannot say — it shows the display name when there is one, truncated at
				     160px — and it is the disambiguator between two people of the same name. -->
				<div v-if="menuRecipient" class="flex items-center gap-2.5 px-2.5 py-2.5">
					<Avatar
						:image="menuRecipient.image"
						:label="menuRecipient.display_name || menuRecipient.email"
						size="xl"
					/>
					<ContactOption :contact="menuRecipient" size="md" />
				</div>
				<div class="mx-2.5 mb-1 border-t" />
				<button
					v-for="item in menuOptions"
					:key="item.label"
					class="active:bg-surface-gray-2 flex w-full items-center rounded-6 px-2.5 py-2 text-base"
					:class="item.theme === 'red' ? 'text-ink-red-6' : 'text-ink-gray-8'"
					@click="runMenuOption(item)"
				>
					{{ item.label }}
				</button>
			</div>
		</Popover>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { onClickOutside, useDebounceFn, useResizeObserver } from '@vueuse/core'
import { X } from 'lucide-vue-next'
import { Avatar, Combobox, Popover, createResource } from 'frappe-ui'

import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import { type DraftRecipient } from '@/apps/mail/types'
import { isEmail } from '@/apps/mail/utils'
import { RECIPIENT_FIELDS, type RecipientField } from '@/apps/mail/utils/recipientFields'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'

const emit = defineEmits<{
	showCcBcc: []
	/** Re-address someone. The draft owns all three lists, so the move itself belongs to it. */
	move: [recipient: DraftRecipient, from: RecipientField, to: RecipientField]
}>()

/**
 * Where to render the suggestion list, when it should be in flow rather than in the Combobox's
 * floating panel. Set by the mobile composer, which wants the full-width Gmail-style list; left
 * unset on desktop, where the panel is the right shape and the popover behaviour is kept.
 */
const { field, suggestionsTo = null } = defineProps<{
	/** Which of the draft's recipient lists this is, so a move can name where it came from. */
	field: RecipientField
	suggestionsTo?: HTMLElement | null
}>()

const selectedRecipients = defineModel<DraftRecipient[]>({ default: () => [] })

const { isMobile } = useScreenSize()
const store = userStore()

const containerRef = useTemplateRef('container')
const tagsRef = useTemplateRef('tags')
const suggestionListRef = useTemplateRef('suggestionList')

const input = ref('')
const focusedTagIndex = ref(-1)
const isClicked = ref(false)
const isSearchFocused = ref(false)

const isFocused = computed(() => isClicked.value || isSearchFocused.value)

/**
 * Collapsed, the row is one line: a chip for every recipient that fits, and a count for the
 * rest. How many fit is a measurement rather than a number we can know up front — a chip is
 * as wide as its name, from "Amy" up to the 160px truncation — so the full set is rendered
 * for a frame, measured, and then cut to the ones that stayed on the first line. Both renders
 * flush before the browser paints, so the long version is never seen.
 */
const isCollapsed = computed(() => isMobile.value && !isFocused.value)
const visibleCount = ref(Number.POSITIVE_INFINITY)
const isMeasuring = ref(false)

const displayedRecipients = computed(() => {
	const all = selectedRecipients.value ?? []
	if (!isCollapsed.value || isMeasuring.value) return all
	return all.slice(0, Math.max(1, visibleCount.value))
})

const hiddenCount = computed(
	() => (selectedRecipients.value?.length ?? 0) - displayedRecipients.value.length,
)

/** `gap-2` between chips, and what "+12" needs beside them. */
const CHIP_GAP = 8
const COUNTER_WIDTH = 28

const measureFit = async () => {
	if (!isCollapsed.value || isMeasuring.value) return

	const all = selectedRecipients.value ?? []
	if (all.length < 2) {
		visibleCount.value = all.length
		return
	}

	isMeasuring.value = true
	await nextTick()

	const available = containerRef.value?.clientWidth ?? 0
	const chips = tagsRef.value ?? []

	let used = 0
	let fit = 0
	for (const chip of chips) {
		const next = used + (fit ? CHIP_GAP : 0) + chip.offsetWidth
		// The first chip stays whatever it costs — a row with no chip at all says less than
		// one that is too wide.
		if (fit && next > available) break
		used = next
		fit++
	}
	// Give the counter its place back off the last chip that fits.
	while (fit > 1 && fit < chips.length && used + CHIP_GAP + COUNTER_WIDTH > available) {
		used -= CHIP_GAP + chips[--fit].offsetWidth
	}

	visibleCount.value = fit
	isMeasuring.value = false
}

watch([() => selectedRecipients.value?.map((r) => r.email).join(), isCollapsed], measureFit, {
	flush: 'post',
})

// Width only: the measuring pass itself makes the container taller for a frame, and
// re-measuring on that would never settle.
let measuredWidth = 0
useResizeObserver(containerRef, ([entry]) => {
	const { width } = entry.contentRect
	if (width === measuredWidth) return
	measuredWidth = width
	measureFit()
})

// The teleported suggestion list is part of this field, however far from it in the DOM —
// without the exemption, tapping a suggestion counts as a click outside and closes the
// list that the tap was aimed at.
onClickOutside(containerRef, () => (isClicked.value = false), { ignore: [suggestionListRef] })

const selectedEmails = computed(() => selectedRecipients.value.map((v) => v.email))

const searchText = ref('')
const showSuggestions = ref(false)

const fetchSuggestions = useDebounceFn((text: string) => {
	if (text) mailContacts.reload(text)
}, 200)

// The query is bound rather than merely observed, so picking a suggestion from the inline
// list can clear the typed text — that path never touches the Combobox's own model, which
// is what normally syncs the input back down after a selection.
watch(searchText, (text) => {
	if (!text) showSuggestions.value = false
	fetchSuggestions(text)
})

// Suggestions only exist for a typed query — with an empty input the popover
// would show stale results from the previous query (or a bare "No results"
// panel), so block reka's focus/arrow-key opens too, not just hide options.
//
// With an inline list the popover is suppressed outright: the same suggestions would otherwise
// appear twice, once floating over the list showing them in flow.
watch(showSuggestions, (open) => {
	if (open && (!searchText.value || suggestionsTo)) showSuggestions.value = false
})

/**
 * A typed address that is nobody's contact is still a recipient — the Combobox has a
 * synthetic row for exactly this, but that row lives in the popover the inline list
 * replaces, so the list carries its own. Suppressed once a suggestion says the same thing,
 * which would otherwise be the same address twice.
 */
const typedRecipient = computed<DraftRecipient | null>(() => {
	const email = searchText.value.trim()
	if (!isEmail(email)) return null
	if (selectedEmails.value.some((v) => v.toLowerCase() === email.toLowerCase())) return null
	return { email }
})

/**
 * Real contacts only — the Combobox's own custom rows aren't ones. Capped at five: the list
 * sits in flow above the keyboard, and more than that just pushes the message body off the
 * screen.
 */
const inlineSuggestions = computed(() => {
	if (!suggestionsTo || !isFocused.value) return []

	const contacts = options.value.filter((o) => 'email' in o) as DraftRecipient[]
	const typed = typedRecipient.value
	const isSuggested = contacts.some(
		(c) => c.email.toLowerCase() === typed?.email.toLowerCase(),
	)

	return (typed && !isSuggested ? [typed, ...contacts] : contacts).slice(0, 5)
})

const commitTyped = () => {
	const typed = typedRecipient.value
	if (!typed) return false

	selectedRecipients.value.push(typed)
	searchText.value = ''
	input.value = ''
	return true
}

// Return — and the phone keyboard's Go / Done / Search, which is the same keydown — commits
// what has been typed. The Combobox's own Enter handling belongs to the popover, which the
// inline list replaces, so nothing else would.
const handleInlineEnter = (e: KeyboardEvent) => {
	if (!suggestionsTo || !typedRecipient.value) return
	e.preventDefault()
	e.stopPropagation()
	commitTyped()
	nextTick(setFocus)
}

// Leaving the field commits it too: dismissing the keyboard and tapping elsewhere never
// send a key at all, and a typed address left behind as loose text reads as lost. Inline
// mode only — on desktop the blur is usually a click into the popover, which is about to
// add its own recipient.
const handleFieldBlur = () => {
	isSearchFocused.value = false
	if (suggestionsTo) commitTyped()
}

const pickSuggestion = (option: DraftRecipient) => {
	selectedRecipients.value.push(option)
	searchText.value = ''
	input.value = ''
	nextTick(setFocus)
}

const handleDelete = (currentValue: string) => {
	if (!currentValue && selectedRecipients.value.length) tagsRef.value?.at(-1)?.focus()
}

const handlePaste = (e: ClipboardEvent) => {
	e.preventDefault()
	const pastedText = e.clipboardData?.getData('text') || ''
	if (pastedText) addValues(pastedText)
	input.value = ''
}

const setFocus = () => containerRef.value?.querySelector('input')?.focus()
const handleClick = () => {
	isClicked.value = true
	// Synchronously, inside the gesture: iOS only raises the keyboard for a focus() that the
	// tap itself caused. The nextTick pass is for the input that isn't rendered yet.
	setFocus()
	nextTick(setFocus)
}
defineExpose({ setFocus })

const handleContainerKeydown = (e: KeyboardEvent) => {
	const inputEl = containerRef.value?.querySelector('input') as HTMLInputElement | null
	const isInputFocused = document.activeElement === inputEl
	const isAtInputStart = inputEl?.selectionStart === 0 && inputEl?.selectionEnd === 0

	if (e.key === 'ArrowLeft') {
		if (isInputFocused && isAtInputStart && selectedRecipients.value.length) {
			e.preventDefault()
			tagsRef.value?.at(-1)?.focus()
		} else if (focusedTagIndex.value > 0) {
			e.preventDefault()
			tagsRef.value?.[focusedTagIndex.value - 1]?.focus()
		}
	}

	if (e.key === 'ArrowRight' && focusedTagIndex.value >= 0) {
		e.preventDefault()
		const nextIndex = focusedTagIndex.value + 1
		const target = tagsRef.value?.[nextIndex] ?? inputEl
		target?.focus()
	}
}

const handleTagClick = (e: MouseEvent, i: number) => {
	e.stopPropagation()
	// Kept off the container on mobile too: a tap meant for a chip's menu must not also focus the
	// field, which would expand the row and move the chip the menu is about to hang off.
	if (isMobile.value) return openMenu(displayedRecipients.value[i], e.currentTarget as Element)
	focusedTagIndex.value = i
}

/**
 * The chip's menu: where else this person could be addressed, and the way to take them off the
 * mail. It stands in for the drag between fields, which a phone cannot perform — touch fires no
 * drag events at all — and reaches chips the drag never could: a collapsed row shows only the
 * names that fit on its line, and tapping the row to see the rest is what focuses it.
 */
const menuRecipient = ref<DraftRecipient | null>(null)
const isMenuOpen = ref(false)
/** The chip the open menu hangs off — the one that was tapped. */
const menuAnchor = ref<Element | undefined>()

const openMenu = (recipient?: DraftRecipient, anchor?: Element) => {
	if (!recipient) return

	menuRecipient.value = recipient
	menuAnchor.value = anchor
	isMenuOpen.value = true
}

const runMenuOption = (item: { onClick?: () => void }) => {
	isMenuOpen.value = false
	item.onClick?.()
}

const FIELD_LABELS: Record<RecipientField, string> = {
	to: __('To'),
	cc: __('Cc'),
	bcc: __('Bcc'),
}

const menuOptions = computed(() => {
	const recipient = menuRecipient.value
	if (!recipient) return []

	return [
		...RECIPIENT_FIELDS.filter((target) => target !== field).map((target) => ({
			label: __('Move to {0}', [FIELD_LABELS[target]]),
			onClick: () => {
				// Cc and Bcc are behind a toggle on both composers: moving someone into a field that
				// isn't on screen would read as losing them.
				if (target !== 'to') emit('showCcBcc')
				emit('move', recipient, field, target)
			},
		})),
		{
			label: __('Remove'),
			theme: 'red',
			onClick: () => removeValue(recipient.email),
		},
	]
})

const removeValueAt = (i: number) => {
	selectedRecipients.value.splice(i, 1)
	nextTick(() => {
		if (!tagsRef.value?.length) setFocus()
		else tagsRef.value[Math.min(i, tagsRef.value.length - 1)]?.focus()
	})
}

watch(input, (val) => addValues(val))

const addValues = (values: string) => {
	if (!values) return

	const validValues = values
		.split(/[\n,]+/)
		.map((v) => v.trim())
		.filter((v) => isEmail(v) && !selectedEmails.value.includes(v))
	if (!validValues.length) return

	validValues.forEach(addValue)
	input.value = ''
}

const addValue = (value: string) => {
	const contact = mailContacts.data?.find((c) => c.email === value)
	if (contact) selectedRecipients.value.push(contact)
	else selectedRecipients.value.push({ email: value })
}

const removeValue = (value: string) =>
	(selectedRecipients.value = selectedRecipients.value.filter((v) => v.email !== value))

const isDragging = ref(false)
const isDragOver = ref(false)

// The drag carries the field it started in as well as the person, so the drop is one move the
// draft performs rather than an add here and a remove over there — the two halves used to be
// kept in step by a flag shared between every instance of this component.
const handleDragStart = (e: DragEvent, recipient: DraftRecipient) => {
	emit('showCcBcc')
	isDragging.value = true
	e.dataTransfer?.setData('recipient', JSON.stringify({ recipient, from: field }))
}

const handleDragEnd = () => {
	isDragging.value = false
	isDragOver.value = false
}

const handleDrop = (e: DragEvent) => {
	isDragOver.value = false
	const data = e.dataTransfer?.getData('recipient')
	if (!data) return

	const { recipient, from } = JSON.parse(data) as {
		recipient: DraftRecipient
		from: RecipientField
	}
	emit('move', recipient, from, field)
}

const mailContacts = createResource({
	url: 'suite.mail.api.mail.get_email_suggestions',
	auto: false,
	makeParams: (text: string) => ({
		account: store.accountId,
		text,
	}),
	transform: (data) =>
		data.map((option) => ({
			label: option.name || option.email,
			value: option.email,
			email: option.email,
			display_name: option.name,
			image: option.user_image,
		})),
})

const options = computed(() => {
	if (!searchText.value) return []
	return [
		...(mailContacts.data?.filter((option) => !selectedEmails.value.includes(option.email)) || []),
		{
			type: 'custom',
			slot: 'create',
			condition: () => !mailContacts?.data?.length,
			onClick: ({ query }: { query: string }) => addValues(query),
		},
	]
})
</script>

<style>
/* The trigger takes what is left of the chips' line, down to a floor of 6rem — below that
   it wraps to a line of its own and grows to the full width, which is the room a long
   address needs. The input inside keeps frappe-ui's own `flex-1` and fills it, which puts
   the caret directly after the last chip either way. Sizing the input to its text instead
   (`field-sizing: content`) is what clipped the last glyph: the box ends exactly where the
   text does, and an input scrolls whatever is past its edge out of view. */
[data-recipient-input] .recipient-combobox:not(.is-parked) {
	flex: 1 1 6rem;
	min-width: 0;
}

/* Out of flow, so the collapsed row is exactly the height of its chips, but still in the
   DOM and focusable. Written out rather than `sr-only`, whose `absolute` loses to the
   `relative` in frappe-ui's own trigger classes — leaving the input in flow at 1px wide,
   clipping the query to a sliver beside the chips. */
[data-recipient-input] .recipient-combobox.is-parked {
	position: absolute !important;
	inset: 0 auto auto 0;
	height: 1px;
	width: 1px;
	overflow: hidden;
	opacity: 0;
}

/* The recipient field is an inline, box-less editor. frappe-ui v2's Combobox trigger
   adds a border + focus-within ring; force them off (the variant/class overrides don't
   beat its focus-within rule). */
[data-recipient-input] .recipient-combobox,
[data-recipient-input] [data-slot='trigger'],
[data-recipient-input] [data-slot='trigger']:focus-within {
	border-color: transparent !important;
	background-color: transparent !important;
	box-shadow: none !important;
	outline: none !important;
}

body:has(.recipient-combobox[data-state='open']) [data-slot='content'][data-selection] {
	@apply min-w-80;
}
</style>
