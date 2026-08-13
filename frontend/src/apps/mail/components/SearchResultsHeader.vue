<template>
	<!-- Mobile mirrors the search overlay's header exactly (same row, same input classes) —
	     searching and results are one page; tapping the readonly input resumes editing. -->
	<div
		:class="
			isMobile ? '' : 'flex flex-col gap-2.5 border-b border-l-transparent px-3.5 py-3 sm:border-l sm:px-5'
		"
	>
		<div v-if="isMobile" class="flex items-center border-b px-4 py-2">
			<Search class="text-ink-gray-5 size-5 shrink-0" />
			<input
				readonly
				:value="searchQuery"
				:placeholder="__('Search')"
				:aria-label="__('Edit search')"
				class="placeholder-ink-gray-4 w-full cursor-pointer border-none bg-transparent text-lg focus:ring-0"
				@mousedown.prevent="openSearch()"
			/>
			<Button variant="ghost" :aria-label="__('Filters')" @click="openSearch(true)">
				<template #icon>
					<SlidersHorizontal class="text-ink-gray-5 size-5" />
				</template>
			</Button>
		</div>
		<FormControl
			v-else
			type="text"
			size="sm"
			class="w-full cursor-pointer [&_input]:cursor-pointer"
			:class="{ 'max-w-2xl': !showReadingPane }"
			:model-value="searchQuery"
			:placeholder="__('Search')"
			:aria-label="__('Edit search')"
			readonly
			variant="outline"
			@mousedown.prevent="openSearch()"
		>
			<template #prefix>
				<Search class="text-ink-gray-5 size-4" />
			</template>
			<template #suffix>
				<button
					class="text-ink-gray-5 hover:text-ink-gray-8 -m-1 flex p-1"
					:aria-label="__('Filters')"
					@mousedown.stop.prevent="openSearch(true)"
				>
					<SlidersHorizontal class="size-4" />
				</button>
			</template>
		</FormControl>
		<div
			v-if="searchFilterChips.length"
			class="flex flex-wrap items-center gap-1.5"
			:class="{ 'px-4 py-2': isMobile }"
		>
			<span
				v-for="chip in searchFilterChips"
				:key="chip.key"
				class="bg-surface-gray-2 inline-flex items-center gap-1 rounded pl-2 pr-1"
				:class="[
					isMobile ? 'h-9 text-sm' : 'h-7 text-xs',
					{ 'hover:bg-surface-gray-3 cursor-pointer': isClickableChip(chip.key) },
				]"
				@click="isClickableChip(chip.key) && handleChipClick(chip.key)"
			>
				<span class="max-w-40 truncate">{{ chip.label }}</span>
				<button
					class="text-ink-gray-5 hover:text-ink-gray-8 rounded"
					:class="isMobile ? '-mr-1 p-2' : 'p-1'"
					:aria-label="__('Remove filter')"
					@click.stop="removeSearchFilter(chip.key)"
				>
					<X :class="isMobile ? 'size-3.5' : 'size-3'" />
				</button>
			</span>

			<Button
				variant="ghost"
				:class="isMobile ? 'text-sm' : 'text-xs'"
				:label="__('Clear all')"
				@click="clearSearch"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { Button, FormControl } from 'frappe-ui'

import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'

import type { MailboxData, UserResource } from '@/apps/mail/types'

// The search view's own header: the query (click to edit) and the advanced filters as removable pills.
// It owns the whole search-query surface — every edit here re-runs the search by pushing a new route,
// which is what the results below already read from. Labels mirror the search dialog's.
//
// The modal itself belongs to HeaderActions, so its three pieces of state are models rather than local:
// this header opens the modal, HeaderActions renders it.
const showSearch = defineModel<boolean>('showSearch', { required: true })
const showAdvanced = defineModel<boolean>('showAdvanced', { required: true })
// Set when a filter chip is clicked; the modal reopens that filter inline for editing.
const editFilter = defineModel<string>('editFilter', { required: true })

const route = useRoute()
const router = useRouter()
const user = inject('$user') as UserResource
const { isMobile } = useScreenSize()
const { accountId, mailboxes, mailboxIds } = userStore()

const showReadingPane = computed(() => !!user.data?.show_reading_pane)

// Open the search modal — to the filter form when `advanced` (clicking a pill / "Add filter"), or to the
// plain search input otherwise (clicking the query).
const openSearch = (advanced = false) => {
	showAdvanced.value = advanced
	showSearch.value = true
}

// Filter chips whose value can be edited inline in the modal (operator-backed: folder + contacts). The
// rest (subject/dates) have no inline form, so their chips only remove — matching the modal, where only
// these keys are clickable.
const EDITABLE_FILTER_KEYS = ['inMailbox', 'from', 'to', 'cc', 'bcc']
const isEditableChip = (key: string) => EDITABLE_FILTER_KEYS.includes(key)
// Two-state chips (attachment/read) flip between their values on click — With ↔ Without Attachments,
// Read ↔ Unread — instead of opening the modal.
const TOGGLEABLE_FILTER_KEYS = ['hasAttachment', 'isRead']
const isToggleableChip = (key: string) => TOGGLEABLE_FILTER_KEYS.includes(key)
const isClickableChip = (key: string) => isEditableChip(key) || isToggleableChip(key)

// Route a chip click to editing (operator chips) or toggling (attachment/read chips); non-clickable
// chips only expose the remove button.
const handleChipClick = (key: string) => {
	if (isToggleableChip(key)) return toggleSearchFilter(key)
	if (isEditableChip(key)) return editSearchFilter(key)
}

// Clicking an editable chip opens the modal (plain search view) with that filter dropped back into the
// query as an editable token — the same effect as clicking the chip inside the modal.
const editSearchFilter = (key: string) => {
	showAdvanced.value = false
	editFilter.value = key
	showSearch.value = true
}

// Re-run the search with the chip's value flipped between its two states ('true' ⇄ 'false').
const toggleSearchFilter = (key: string) => {
	const query = { ...route.query } as Record<string, string>
	query[key] = query[key] === 'true' ? 'false' : 'true'
	searchWith(query)
}

const SEARCH_FILTER_LABELS: Record<string, string> = {
	inMailbox: __('In'),
	subject: __('Subject'),
	from: __('From'),
	to: __('To'),
	cc: __('Cc'),
	bcc: __('Bcc'),
	after: __('After'),
	before: __('Before'),
}
const optionLabel = (options: { label: string; value: string }[], value: string) =>
	options.find((o) => o.value === value)?.label ?? value

const searchQuery = computed(() => (route.query.text as string) || '')

const searchFilterChips = computed(() => {
	const query = route.query
	const chips: { key: string; label: string }[] = []
	for (const key of Object.keys(SEARCH_FILTER_LABELS)) {
		const value = query[key]
		if (!value) continue
		const display =
			key === 'inMailbox'
				? (mailboxes.data?.find((m: MailboxData) => m.id === value)?._name ?? String(value))
				: String(value)
		chips.push({ key, label: `${SEARCH_FILTER_LABELS[key]}: ${display}` })
	}
	// Attachment/read values ("Without Attachments", "Unread") are self-descriptive — show them on their own.
	if (query.hasAttachment)
		chips.push({
			key: 'hasAttachment',
			label: optionLabel(getAttachmentOptions(), String(query.hasAttachment)),
		})
	if (query.isRead)
		chips.push({ key: 'isRead', label: optionLabel(getReadStatusOptions(), String(query.isRead)) })
	return chips
})

// Re-run the search with one filter (or all filters) dropped. When nothing is left to search, leave the
// search view for the Inbox.
const searchWith = (query: Record<string, string>) => {
	if (!Object.keys(query).length) return exitSearch()
	router.push({ name: 'mail-mailbox', params: { accountId, mailbox: 'search' }, query })
}
const removeSearchFilter = (key: string) => {
	const query = { ...route.query } as Record<string, string>
	delete query[key]
	searchWith(query)
}
const clearSearch = () => searchWith(searchQuery.value ? { text: searchQuery.value } : {})

const exitSearch = () =>
	router.push({ name: 'mail-mailbox', params: { accountId, mailbox: mailboxIds.inbox } })
</script>
