<template>
	<!-- Mobile mirrors the search overlay's header exactly (same row, same input classes) —
	     searching and results are one page; tapping the readonly input resumes editing. -->
	<div
		:class="
			isMobile ? '' : 'flex flex-col gap-2.5 border-b border-l-transparent px-3.5 py-3 sm:border-l sm:px-5'
		"
	>
		<!-- A flat h-14, the height every mobile header in the product stands at (see
		     MobileTitleHeader), rather than py-2 around the input: the editor's row above is
		     the same 56px, so dismissing it onto this swaps the row rather than resizing it.
		     Sideways too: a 12px gutter, the icon, then gap-2 plus the forms plugin's 12px on
		     the bare input — the calendar search header's measures, and the editor's. -->
		<div v-if="isMobile" class="flex h-14 items-center gap-2 border-b px-3">
			<Search class="text-ink-gray-5 h-4 w-4 shrink-0" />
			<input
				readonly
				:value="searchQuery"
				:placeholder="__('Search')"
				:aria-label="__('Edit search')"
				class="placeholder-ink-gray-4 w-full cursor-pointer border-none bg-transparent text-base focus:ring-0"
				@mousedown.prevent="openSearch"
			/>
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
			@mousedown.prevent="openSearch"
		>
			<template #prefix>
				<Search class="text-ink-gray-5 size-4" />
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
				class="bg-surface-gray-2 inline-flex items-center gap-1 rounded-4 pl-2 pr-1"
				:class="[isMobile ? 'h-8 text-sm' : 'h-7 text-xs', 'hover:bg-surface-gray-3 cursor-pointer']"
				@click="openSearch"
			>
				<span class="max-w-40 truncate">{{ chip.label }}</span>
				<button
					class="text-ink-gray-5 hover:text-ink-gray-8 rounded-4 p-1"
					:aria-label="__('Remove filter')"
					@click.stop="removeSearchFilter(chip.key)"
				>
					<X class="size-3" />
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
import { Search, X } from 'lucide-vue-next'
import { Button, FormControl } from 'frappe-ui'

import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { mailSearchRoute, useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import { useRootStore } from '@/stores/root'

import type { MailboxData, UserResource } from '@/apps/mail/types'

// The search view's own header: the query (click to edit) and the filters as removable pills.
// It owns the whole search-query surface — every edit here re-runs the search by pushing a new route,
// which is what the results below already read from. Editing any part of it — the query or a pill —
// reopens the palette, which is where a mail search is composed; it reads this route back in.

const route = useRoute()
const router = useRouter()
const user = inject('$user') as UserResource
const { isMobile } = useScreenSize()
const { accountId, mailboxes, mailboxIds } = userStore()
const root = useRootStore()

const showReadingPane = computed(() => !!user.data?.show_reading_pane)

const openSearch = () => (root.paletteOpen = true)

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
	router.push(mailSearchRoute(accountId, query))
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
