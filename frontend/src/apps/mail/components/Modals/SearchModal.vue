<template>
	<component
		:is="isMobile ? SearchMobileLayout : Dialog"
		v-model="show"
		:options="{ size: '2xl', paddingTop: '2%' }"
	>
		<template #body>
			<div class="bg-surface-base">
				<div class="flex items-center border-b px-4 py-2">
					<!-- Mobile trades the decorative magnifier for the way out: search is a
					     full page there, and the tab bar it would otherwise be dismissed from
					     steps aside while the field is focused. Goes through history rather
					     than closing directly, so the button and the back gesture are the same
					     action and neither leaves a spent entry behind.

					     A bare button rather than the styled one, matching the results header's icon
					     exactly — same 20px glyph, no box of its own — so the field starts in the same
					     place in both and nothing shifts as the overlay opens over the page. `-m-2 p-2`
					     buys back a 36px tap target without the padding counting towards layout. -->
					<button
						v-if="isMobile"
						type="button"
						class="-m-2 shrink-0 p-2"
						:aria-label="__('Back')"
						@click="closeSearch"
					>
						<ArrowLeft class="text-ink-gray-5 size-5" />
					</button>
					<Search v-else class="text-ink-gray-5 size-4 shrink-0" />
					<!-- text-lg (16px) on mobile, and not only for legibility: iOS zooms the
					     whole page when a focused input is under 16px, which it then never
					     zooms back out of. -->
					<input
						ref="searchInput"
						v-model="filter.text"
						icon-left="search"
						type="search"
						class="placeholder-ink-gray-4 w-full border-none bg-transparent focus:ring-0"
						:class="isMobile ? 'text-lg' : 'text-base'"
						placeholder="Search"
						@click="showAdvancedFilters = false"
						@input="showAdvancedFilters = false"
						@keyup.enter="openSearchPage"
					/>
					<Button
						variant="ghost"
						:class="{ '-mr-1.5': !isMobile }"
						@click="showAdvancedFilters = !showAdvancedFilters"
					>
						<template #icon>
							<SlidersHorizontal class="text-ink-gray-5" :class="isMobile ? 'size-5' : 'size-4'" />
						</template>
					</Button>
				</div>
				<div
					v-if="!showAdvancedFilters && !opTrigger"
					class="flex flex-wrap items-center gap-1.5 px-4 py-2"
				>
					<span
						v-for="chip in activeFilters"
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
							@click.stop="removeFilter(chip.key)"
						>
							<X :class="isMobile ? 'size-3.5' : 'size-3'" />
						</button>
					</span>
					<Button
						v-for="f in inactiveQuickFilters"
						:key="f.label"
						variant="outline"
						:class="isMobile ? '!h-9 text-sm' : '!h-7 text-xs'"
						@click="applyQuickFilter(f)"
					>
						<span class="flex items-center gap-1">
							<Plus :class="isMobile ? 'size-3.5' : 'size-3'" />
							{{ f.label }}
						</span>
					</Button>
					<Button
						v-if="activeFilters.length"
						variant="ghost"
						:class="isMobile ? 'text-sm' : 'text-xs'"
						:label="__('Clear all')"
						@click="clearFilters()"
					/>
				</div>
				<template v-if="showAdvancedFilters">
					<div class="space-y-4 p-4">
						<Switch
							v-if="hasMultipleAccounts"
							v-model="allAccounts"
							:label="__('Search across all accounts')"
							:description="
								__('Look through every account you own — slower, but finds a mail wherever it landed.')
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
						<ContactCombobox
							v-model="filter.from"
							:label="__('From')"
						/>
						<ContactCombobox
							v-model="filter.to"
							:label="__('To')"
						/>
						<ContactCombobox
							v-model="filter.cc"
							:label="__('Cc')"
						/>
						<ContactCombobox
							v-model="filter.bcc"
							:label="__('Bcc')"
						/>
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
								:options="getAttachmentOptions()"
								class="w-full min-w-0"
							/>
							<FormControl
								v-model="filter.isRead"
								type="select"
								:label="__('Read Status')"
								:options="getReadStatusOptions()"
								class="w-full min-w-0"
							/>
						</div>
					</div>
					<!-- Desktop-only: on mobile filters apply live (the chips row and quick
					     results reflect them as they're set), so the footer buttons are
					     redundant next to the filters toggle and Enter. -->
					<div v-if="!isMobile" class="flex w-full justify-end space-x-4 p-4">
						<Button :label="__('Clear Filters')" class="w-28" @click="clearFilters()" />
						<Button
							:label="__('Search')"
							variant="solid"
							class="w-28"
							@click="openSearchPage"
						/>
					</div>
				</template>
				<div
					v-else-if="opTrigger"
					class="px-2 pb-2"
					:class="{ 'pt-2': !activeFilters.length }"
				>
					<!-- These rows are the one place the search is driven entirely by
					     tapping, so mobile gets the taller row and the larger glyph the
					     rest of the overlay now uses. -->
					<button
						v-for="mb in folderMatches"
						:key="mb.id"
						class="hover:bg-surface-gray-1 flex w-full items-center gap-2 rounded text-left"
						:class="isMobile ? 'gap-2.5 p-2.5' : 'p-2'"
						@click="applyFolder(mb)"
					>
						<Icon
							:name="getIcon(mb)"
							class="shrink-0"
							:class="[isMobile ? 'size-5' : 'size-4', FOLDER_ICON_COLOR_MAP[mb.color]]"
						/>
						<span :class="isMobile ? 'text-base' : 'text-sm'">{{ mb._name }}</span>
					</button>
					<button
						v-for="c in contactMatches"
						:key="c.email"
						class="hover:bg-surface-gray-1 flex w-full items-center gap-2 rounded text-left"
						:class="isMobile ? 'gap-2.5 p-2.5' : 'p-2'"
						@click="applyContact(c)"
					>
						<Avatar :image="c.image" :label="c.name || c.email" size="lg" />
						<div class="min-w-0">
							<div class="truncate" :class="isMobile ? 'text-base' : 'text-sm'">
								{{ c.name || c.email }}
							</div>
							<div
								v-if="c.name && c.name !== c.email"
								class="text-ink-gray-5 truncate"
								:class="isMobile ? 'text-sm' : 'text-xs'"
							>
								{{ c.email }}
							</div>
						</div>
					</button>
					<div
						v-if="!folderMatches.length && !contactMatches.length"
						class="text-ink-gray-5 px-2 py-2"
						:class="isMobile ? 'text-base' : 'text-sm'"
					>
						{{ isContactOp && contactSearch.loading ? __('Loading…') : __('No matches') }}
					</div>
				</div>
				<div v-else-if="results?.data?.[0]?.length" class="px-2 pb-2">
					<div
						v-for="(result, idx) in results.data[0]"
						:key="idx"
						class="hover:bg-surface-gray-1 group flex rounded p-2 hover:cursor-pointer"
						@click="openThread(result)"
					>
						<div class="mr-2 space-y-1 truncate">
							<p class="truncate text-base-semibold" v-html="highlight(result.subject || __('[No subject]'))" />
							<div class="flex items-center gap-1 truncate text-sm">
								<span class="truncate" v-html="highlight(getInterlocutors(result))" />
								<template v-if="allAccounts && result.account_name">
									<span aria-hidden="true" class="text-ink-gray-4">•</span>
									<span class="text-ink-gray-4 shrink-0 text-xs">
										{{ __('in {0}', [result.account_name]) }}
									</span>
								</template>
							</div>
							<!-- The mailbox tags and the date/attachment column are the smallest
							     type in the row; a step up on mobile keeps them legible at arm's
							     length without changing the desktop density. -->
							<div
								v-for="m in result.mailboxes"
								:key="m.mailbox_id"
								class="bg-surface-gray-2 group-hover:bg-surface-gray-3 mr-1.5 inline-flex rounded"
								:class="isMobile ? 'px-1.5 py-1 text-sm' : 'p-1 text-xs'"
							>
								{{ m.mailbox_name }}
							</div>
						</div>
						<div
							class="text-ink-gray-4 ml-auto flex shrink-0 flex-col justify-between"
							:class="isMobile ? 'text-sm' : 'text-xs'"
						>
							<span>{{ getFormattedDate(result.received_at) }}</span>
							<div
								v-if="noOfAttachments(result)"
								class="ml-auto flex items-center space-x-1"
							>
								<Paperclip class="text-ink-gray-4" :class="isMobile ? 'size-4' : 'size-3.5'" />
								<span>{{ noOfAttachments(result) }}</span>
							</div>
						</div>
					</div>
					<div
						v-if="results.data[1] > 5"
						class="text-ink-gray-4 my-2 text-center text-sm"
					>
						{{ __('Showing top 5 results. ') }}
						<a class="cursor-pointer hover:underline" @click="openSearchPage">
							{{ __('View more.') }}
						</a>
					</div>
				</div>
				<div
					v-else-if="!results?.loading && results?.data?.[1] === 0"
					class="text-ink-gray-4 py-4 text-center text-sm"
				>
					{{ __('No results found for the given query.') }}
				</div>
				<div v-else-if="hasQuery" class="text-ink-gray-4 py-4 text-center text-sm">
					{{ __('Searching…') }}
				</div>
			</div>
		</template>
	</component>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { watchDebounced } from '@vueuse/core'
import { ArrowLeft, Paperclip, Plus, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { Avatar, Button, Dialog, FormControl, Switch, createResource } from 'frappe-ui'
import { Icon } from 'frappe-ui/icons'

import { FOLDER_ICON_COLOR_MAP, getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { getFormattedDate, getIcon } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import SearchMobileLayout from '@/apps/mail/components/SearchMobileLayout.vue'
import ContactCombobox from '@/apps/mail/components/ContactCombobox.vue'

import type { MailboxData, Recipient } from '@/apps/mail/types'

const show = defineModel<boolean>()
// Set by the results page when a filter chip is clicked: the filter key to reopen inline on open.
const editFilterKey = defineModel<string>('editFilter', { default: '' })

// Read store.accountId live in makeParams; destructuring would snapshot the
// unwrapped value and miss account switches while this modal stays mounted.
const store = userStore()
const { mailboxes } = store

const route = useRoute()
const { isMobile } = useScreenSize()

const searchInput = useTemplateRef('searchInput')
watch(show, (val) => {
	if (!val) return
	// Re-sync from the URL each time the modal opens so it reflects changes made on the results page
	// (Clear all, removing a filter pill) rather than showing stale state.
	Object.assign(filter, getDefaultFilter())
	// Opened by clicking a filter chip on the results page: reopen that filter as an inline editable token,
	// exactly as clicking the chip inside the modal does.
	if (editFilterKey.value) {
		if (EDITABLE_OP[editFilterKey.value]) editFilterInline(editFilterKey.value)
		editFilterKey.value = ''
	}
	// Fetch on open when a query is already present (e.g. opened from the results page): the watcher
	// only reloads on change, so reopening the same search would otherwise sit on "Searching…" forever.
	if (hasQuery.value) results.reload()
	else results.reset()
	nextTick(() => searchInput.value?.focus())
})

const getDefaultFilter = (reset = false) =>
	Object.fromEntries(
		[
			'text',
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
		].map((key) => [key, reset ? '' : route.query[key] || '']),
	)

const filter = reactive({ ...getDefaultFilter() })
// Reset every filter field but keep the text query — clearing filter chips shouldn't wipe the search.
const clearFilters = () => Object.assign(filter, getDefaultFilter(true), { text: filter.text })
const filteredFilter = computed(() =>
	Object.fromEntries(
		Object.entries(filter)
			.map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
			.filter(([, v]) => Boolean(v)),
	),
)
// A search runs when there's anything to search by — a text query or at least one filter.
const hasQuery = computed(() => Object.keys(filteredFilter.value).length > 0)

// Cross-account search: an opt-in that fans the query out across every account (defaulting off, so a
// search stays scoped to the current account for speed). Persisted, and pre-checked when the search
// page was opened with the flag set, so reopening the dialog reflects the active scope.
const ALL_ACCOUNTS_STORAGE_KEY = 'mail-search-all-accounts'
const hasMultipleAccounts = computed(() => (store.userResource.data?.accounts?.length ?? 0) > 1)
const allAccounts = ref(
	hasMultipleAccounts.value &&
		(route.query.all_accounts != null ||
			localStorage.getItem(ALL_ACCOUNTS_STORAGE_KEY) === 'true'),
)
watch(allAccounts, (val) => {
	localStorage.setItem(ALL_ACCOUNTS_STORAGE_KEY, String(val))
	// "Look In" targets a folder in the current account; it can't carry across accounts, so drop it.
	if (val) filter.inMailbox = ''
	if (hasQuery.value) results.reload()
})

// Exposed as a model so the results page can open the modal straight to the filter form (clicking a
// filter pill or "Add filter").
const showAdvancedFilters = defineModel<boolean>('showAdvanced', { default: false })

const mailboxOptions = computed(() =>
	[{ label: __('All folders'), value: '' }].concat(
		mailboxes.data.map((m: { id: string; _name: string }) => ({
			label: m._name,
			value: m.id,
		})),
	),
)

// Inline operator autocomplete: `in:` lists folders, `from:`/`to:`/`cc:`/`bcc:` list contacts. Picking
// one applies the matching filter and drops the token from the query text.
const CONTACT_OPS = ['from', 'to', 'cc', 'bcc']
const OP_TOKEN = /(?:^|\s)(in|from|to|cc|bcc):(\S*)$/i
const opTrigger = computed(() => {
	const m = String(filter.text || '').match(OP_TOKEN)
	if (!m) return null
	const op = m[1].toLowerCase()
	// `in:` filters by folder, which is account-scoped — meaningless in a cross-account search.
	if (op === 'in' && allAccounts.value) return null
	return { op, partial: m[2] }
})
const isContactOp = computed(() => !!opTrigger.value && CONTACT_OPS.includes(opTrigger.value.op))

const folderMatches = computed<MailboxData[]>(() =>
	opTrigger.value?.op === 'in'
		? (mailboxes.data ?? []).filter((m: MailboxData) =>
				m._name.toLowerCase().includes(opTrigger.value!.partial.toLowerCase()),
			)
		: [],
)

const contactSearch = createResource({
	url: 'suite.mail.api.mail.get_email_suggestions',
	auto: false,
	makeParams: (text: string) => ({
		account: store.accountId,
		// frappe-ui's fetch reuses the previous params object when called with a falsy value (our
		// intended empty query) and feeds it back here as `text`, so guard against a non-string.
		// An empty query returns [] (no default contact list), which also clears stale matches.
		text: typeof text === 'string' ? text : '',
		limit: 5,
	}),
	transform: (data: { email: string; name?: string; user_image?: string }[]) =>
		data.map((o) => {
			const name = o.name || ''
			// Shape serves both consumers: the inline operator dropdown (email/name/image) and the advanced
			// comboboxes (value/label/display_name for frappe-ui's Combobox).
			return { value: o.email, label: name || o.email, email: o.email, name, display_name: name, image: o.user_image }
		}),
})
watchDebounced(
	opTrigger,
	(t) => {
		if (t && CONTACT_OPS.includes(t.op)) contactSearch.fetch(t.partial)
	},
	{ debounce: 200 },
)
const contactMatches = computed(() => {
	if (!isContactOp.value) return []
	const partial = opTrigger.value!.partial
	const matches = contactSearch.data ?? []
	const hasExact = matches.some((c) => c.email.toLowerCase() === partial.toLowerCase())
	// Offer the raw typed value as an option when it isn't already one of the matched contacts.
	return partial && !hasExact
		? [
				...matches,
				{ value: partial, label: partial, email: partial, name: '', display_name: '', image: undefined },
			]
		: matches
})

const applyFolder = (mailbox: MailboxData) => {
	filter.inMailbox = mailbox.id
	stripToken()
}
const applyContact = (contact: { email: string }) => {
	if (opTrigger.value) (filter as Record<string, string>)[opTrigger.value.op] = contact.email
	stripToken()
}
const stripToken = () => {
	filter.text = String(filter.text || '')
		.replace(OP_TOKEN, '')
		.trim()
	nextTick(() => searchInput.value?.focus())
}

// Quick-filter chips for filters not yet applied. Operator chips (`op`) drop a token into the input and
// focus it so the folder/contact dropdown takes over; action chips (`apply`) set a filter directly.
// `key` is the filter field each one populates, used to hide a chip once that filter is active.
type QuickFilter = { label: string; key: string; op?: string; apply?: () => void }
const QUICK_FILTERS = computed<QuickFilter[]>(() =>
	[
		{ label: __('Folder'), key: 'inMailbox', op: 'in' },
		{ label: __('From'), key: 'from', op: 'from' },
		{ label: __('To'), key: 'to', op: 'to' },
		{ label: __('With attachments'), key: 'hasAttachment', apply: () => (filter.hasAttachment = 'true') },
		{ label: __('Unread'), key: 'isRead', apply: () => (filter.isRead = 'false') },
		// `in:` (folder) is account-scoped, so it's dropped from a cross-account search.
	].filter((f) => f.op !== 'in' || !allAccounts.value),
)
// Drop chips whose filter is already applied (shown instead as an active pill).
const inactiveQuickFilters = computed(() =>
	QUICK_FILTERS.value.filter((f) => !filteredFilter.value[f.key]),
)
const applyQuickFilter = (f: QuickFilter) => {
	if (f.apply) f.apply()
	else if (f.op) insertOperator(f.op)
}
const insertOperator = (op: string, value = '') => {
	// Append the operator to any existing query (space-separated) rather than replacing it.
	const current = String(filter.text || '')
	const prefix = current && !current.endsWith(' ') ? `${current} ` : current
	const valueStart = `${prefix}${op}:`.length
	filter.text = `${prefix}${op}:${value}`
	nextTick(() => {
		const el = searchInput.value as HTMLInputElement | null
		el?.focus()
		// Select the value so it's ready to replace when reopening an existing filter for editing.
		el?.setSelectionRange(valueStart, el.value.length)
	})
}

// Filters that have an inline operator form can be "reopened" for editing: clicking the pill clears it and
// drops it back into the query as an editable token (e.g. `from:bob@x.com`), which reopens the dropdown.
const EDITABLE_OP: Record<string, string> = { inMailbox: 'in', from: 'from', to: 'to', cc: 'cc', bcc: 'bcc' }
const editFilterInline = (key: string) => {
	const op = EDITABLE_OP[key]
	if (!op) return
	// `inMailbox` stores a folder id; seed the token with its name so `in:` matches it again.
	const value =
		key === 'inMailbox'
			? optionLabel(mailboxOptions.value, String(filter.inMailbox || ''))
			: String((filter as Record<string, string>)[key] || '')
	filter[key] = ''
	insertOperator(op, value)
}
// Two-state chips (attachment/read) flip between their values on click — With ↔ Without Attachments,
// Read ↔ Unread — instead of reopening as an editable token.
const TOGGLEABLE_FILTER_KEYS = ['hasAttachment', 'isRead']
const isToggleableChip = (key: string) => TOGGLEABLE_FILTER_KEYS.includes(key)
const isClickableChip = (key: string) => !!EDITABLE_OP[key] || isToggleableChip(key)
const toggleFilter = (key: string) => {
	filter[key] = filter[key] === 'true' ? 'false' : 'true'
}
// Route a chip click to toggling (attachment/read) or editing (operator chips).
const handleChipClick = (key: string) => {
	if (isToggleableChip(key)) return toggleFilter(key)
	if (EDITABLE_OP[key]) return editFilterInline(key)
}

// Active advanced filters as removable chips, shown under the search box (collapsed view) so a single
// filter can be cleared without opening the whole panel.
const FILTER_LABELS: Record<string, string> = {
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

const activeFilters = computed(() =>
	Object.entries(filteredFilter.value)
		.filter(([key]) => key !== 'text')
		.map(([key, value]) => {
			// hasAttachment/isRead values ("Without Attachments", "Unread") are self-descriptive, so show
			// them on their own — the rest get a "Field: value" label.
			if (key === 'hasAttachment') return { key, label: optionLabel(getAttachmentOptions(), value) }
			if (key === 'isRead') return { key, label: optionLabel(getReadStatusOptions(), value) }
			const display = key === 'inMailbox' ? optionLabel(mailboxOptions.value, value) : value
			return { key, label: `${FILTER_LABELS[key]}: ${display}` }
		}),
)

const removeFilter = (key: string) => {
	filter[key] = ''
}

const results = createResource({
	url: 'suite.mail.api.mail.search_mails',
	makeParams: () => ({
		account: store.accountId,
		filter: filteredFilter.value,
		all_accounts: allAccounts.value,
	}),
})

// The query the results page reads to reproduce this search: the trimmed filters plus, when on, the
// cross-account flag (kept out of `filter` so it never becomes a JMAP search condition on the server).
const searchQuery = computed(() => ({
	...filteredFilter.value,
	...(allAccounts.value ? { all_accounts: '1' } : {}),
}))

const noOfAttachments = (result) =>
	result.attachments?.filter((m) => m.filename && m.disposition === 'attachment').length || 0

// Highlight the matched query term in the results. Escape the text first (so any markup in the content
// is neutralized), then wrap matches in <mark> — the only HTML we inject — for safe v-html.
const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
	)
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const highlight = (text?: string) => {
	const escaped = escapeHtml(text ?? '')
	const term = String(filter.text || '').trim()
	if (!term) return escaped
	return escaped.replace(
		new RegExp(`(${escapeRegExp(escapeHtml(term))})`, 'gi'),
		'<mark class="bg-surface-yellow-5 text-ink-gray-8">$1</mark>',
	)
}

// Reload whenever any filter changes (text, chips, quick filters, Clear all) — debounced so typing and
// rapid chip edits coalesce. `filteredFilter` recomputes to a fresh object on every change, so the watch
// fires for all of them. A search needs text; with none, reset so the empty/hint state shows.
watchDebounced(
	filteredFilter,
	() => {
		if (hasQuery.value) results.reload()
		else results.reset()
	},
	{ debounce: 250 },
)

// Pops the entry SearchMobileLayout pushed when it opened, so its popstate handler does
// the closing — the same path the system back gesture takes.
const closeSearch = () => history.back()

const openSearchPage = () => {
	router.push({
		name: 'mail-mailbox',
		params: { accountId: store.accountId, mailbox: 'search' },
		query: searchQuery.value,
	})
	show.value = false
}

const router = useRouter()

// Open the result in its own account (tagged by the server) — for a cross-account search that may
// differ from the active account; the mailbox route's guard switches to it.
const openThread = (result: { account: string; thread_id: string }) => {
	router.push({
		name: 'mail-mail',
		params: { accountId: result.account, mailbox: 'search', threadID: result.thread_id },
		query: searchQuery.value,
	})
	show.value = false
}

const getInterlocutors = (result: {
	from_name?: string
	from_email: string
	recipients?: Recipient[]
}) => {
	const sender = result.from_name || result.from_email
	if (!result.recipients?.length) return sender

	const seen = new Set<string>()
	const recipients = result.recipients
		.filter((r) => r.email !== result.from_email && !seen.has(r.email) && seen.add(r.email))
		.map((r) => r.display_name || r.email)
		.join(', ')

	return `${sender}, ${recipients}`
}
</script>
