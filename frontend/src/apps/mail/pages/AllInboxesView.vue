<template>
	<!-- Header -->
	<header class="flex items-center justify-between border-b px-3 py-2.5 sm:px-5">
		<div class="flex items-center space-x-2">
			<Button v-if="isMobile" icon="menu" variant="ghost" @click="openSidebar" />
			<Breadcrumbs :items="[{ label: __('All Inboxes'), route: { name: 'mail-all-inboxes' } }]" />
		</div>
		<HeaderActions @reload-mails="refreshThreads()" />
	</header>

	<div class="relative flex h-[calc(100dvh-3.05rem)]">
		<!-- Loading -->
		<div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
			<div class="text-ink-gray-5 flex items-center space-x-2">
				<LoaderCircle class="h-5 w-5 animate-spin" />
				<span>{{ __('Loading...') }}</span>
			</div>
		</div>

		<template v-else-if="threads.data?.length">
			<div ref="mailSidebar" class="sticky top-16 flex w-full flex-col border-r">
				<!-- Toolbar -->
				<div
					class="relative flex items-center border-b border-l-transparent px-3.5 py-2.5 sm:border-l sm:px-5"
				>
					<Dropdown :options="FILTER_OPTIONS">
						<button
							class="text-ink-gray-8 hover:bg-surface-gray-2 -ml-2 flex min-w-0 items-center gap-1 rounded px-2 py-1"
						>
							<span class="truncate">{{ title }}</span>
							<ChevronDown class="text-ink-gray-5 icon shrink-0" />
						</button>
					</Dropdown>
					<div class="-mr-1.5 ml-auto flex items-center space-x-1.5 sm:space-x-3">
						<Button
							variant="ghost"
							:tooltip="__('Refresh')"
							:disabled="threads.loading || loadingMore"
							@click="refreshThreads()"
						>
							<template #icon>
								<RefreshCw class="icon" />
							</template>
						</Button>
					</div>

					<!-- Loading bar -->
					<div
						v-if="threads.loading"
						class="loading-bar pointer-events-none absolute bottom-[-1px] left-[-1px] right-0 h-0.5 overflow-hidden"
						role="progressbar"
						aria-busy="true"
					>
						<div
							class="loading-bar__fill via-ink-gray-3 absolute inset-y-0 left-0 w-[30%] bg-gradient-to-r from-transparent to-transparent"
						/>
					</div>
				</div>

				<!-- Mail list -->
				<div ref="mailList" class="h-full overflow-y-auto overscroll-contain">
					<div v-for="(group, key) in groupedThreads" :key="key">
						<Tooltip
							v-if="groupMessagesBy !== 'None'"
							:text="
								isLastGroup(key)
									? ''
									: __(collapsedGroups.includes(key) ? 'Expand' : 'Collapse')
							"
						>
							<div
								class="text-ink-gray-6 flex items-center border-b border-l-transparent p-3.5 text-xs-semibold sm:border-l sm:px-5"
								:class="{ 'cursor-pointer': !isLastGroup(key) }"
								@click="toggleGroupCollapse(key)"
							>
								<span class="select-none pt-[2px]">
									{{ getFormattedDate(key, groupMessagesBy === 'Month').toUpperCase() }}
								</span>
								<component
									:is="collapsedGroups.includes(key) ? ChevronRight : ChevronDown"
									v-if="!isLastGroup(key)"
									class="icon ml-auto"
								/>
							</div>
						</Tooltip>
						<template v-if="!collapsedGroups.includes(key)">
							<MailListItem
								v-for="mail in group"
								:key="`${mail.account}:${mail.thread_id}`"
								:mailbox="mail.inbox || ''"
								:account-id="mail.account"
								:account-label="mail.account_name || undefined"
								:mail
								:is-selected="false"
								:selectable="false"
								class="border-l-transparent sm:border-l"
								@set-seen="(seen: boolean) => handleSetSeen(mail, seen)"
								@archive-thread="handleArchive(mail)"
								@trash-thread="handleTrash(mail)"
								@set-flagged="(flagged: boolean) => handleSetFlagged(mail, flagged)"
							/>
						</template>
					</div>
					<!-- Infinite-scroll sentinel: entering the viewport near the list bottom loads the next
					     batch (appended, never refetching loaded rows). Sits after all groups. -->
					<div ref="loadMoreSentinel" class="h-px" />
					<div v-if="loadingMore" class="flex justify-center py-3">
						<LoaderCircle class="text-ink-gray-5 h-4 w-4 animate-spin" />
					</div>
				</div>
			</div>
		</template>

		<!-- No mails -->
		<div v-else class="text-ink-gray-5 flex w-full flex-col items-center justify-center">
			<NoMails class="text-ink-gray-2 mb-2 h-16 w-16" />
			<p>{{ __('You have no mails in any inbox.') }}</p>
			<Button
				class="mt-3"
				variant="ghost"
				:label="__('Refresh')"
				:disabled="threads.loading || loadingMore"
				@click="refreshThreads()"
			>
				<template #prefix>
					<RefreshCw class="icon" />
				</template>
			</Button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import {
	ChevronDown,
	ChevronRight,
	LoaderCircle,
	Mail as MailIcon,
	Mails,
	Paperclip,
	RefreshCw,
	Star,
} from 'lucide-vue-next'
import { Breadcrumbs, Button, Dropdown, Tooltip, call, createResource, usePageMeta } from 'frappe-ui'

import { getFormattedDate, raiseOptimisticToast, raiseToast } from '@/apps/mail/utils'
import { useScreenSize, useSidebar } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'

import type { Thread, UserResource } from '@/apps/mail/types'

const { isMobile } = useScreenSize()
const { openSidebar } = useSidebar()

const socket = inject('$socket')
const user = inject('$user') as UserResource
const dayjs = inject('$dayjs')

const store = userStore()

// ── Infinite scroll ─────────────────────────────────────────────────────────────────────────────
// The loaded list (threads.data) is the single source of truth. The reset resource replaces it (from
// the top); the load-more resource appends the next window onto it. Rows are keyed by account +
// thread_id since the same thread_id can recur across accounts in this merged view.
const PAGE_LENGTH = 25
const hasMore = ref(false) // lookahead: the last fetched window returned an extra row, so more exist
const loadingMore = ref(false) // an append fetch is in flight (drives the bottom spinner)
// Bumped on every reset/refresh; an in-flight append captures it and discards its result if it changed
// meanwhile, so a stale window can't land on a freshly reset list.
const epoch = ref(0)
let loadEpoch = 0 // epoch captured when the current append was triggered
// Refresh ("check for new mail") state: merges the newest window into the loaded list, preserving
// scroll — set while such a reload is in flight so its onSuccess prepends instead of replacing.
const refreshMode = ref(false)
let refreshEpoch = 0 // epoch captured when the refresh was triggered (dropped if a reset intervenes)
// The loaded list to merge the fresh window into. Captured at *response* time (in the resource
// transform), not refresh-start, so it reflects any optimistic removals that happened while the
// refresh was in flight — otherwise a thread archived mid-refresh would reappear.
let refreshSnapshot: Thread[] = []

const isLoaded = ref(false)
const filter = ref<string | null>(
	localStorage.getItem(`user:${user.data.name}:filter:all-inboxes`) || null,
)

const mailListRef = useTemplateRef('mailList')

const threadKey = (thread: Thread) => `${thread.account}:${thread.thread_id}`

const scrollListToTop = () => mailListRef.value?.scrollTo({ top: 0 })

// Called when a first-window fetch resolves. Two modes:
// - refresh: keep the loaded rows, prepend only threads not already loaded (new mail), and hold the
//   scroll position (re-anchored by the height the prepended rows added).
// - reset: reveal the fresh first window and scroll to top (filter change, initial load, …).
const onResetSuccess = () => {
	if (refreshMode.value) {
		refreshMode.value = false
		// A reset (filter change) raced in and bumped the epoch — drop this stale merge.
		if (refreshEpoch !== epoch.value) return
		// Anchor to the current scroll before merging. The window replaced `data` a beat ago but the DOM
		// hasn't re-rendered yet, so these still reflect the loaded list the reader is looking at.
		const el = mailListRef.value
		const prevTop = el?.scrollTop ?? 0
		const prevHeight = el?.scrollHeight ?? 0
		const freshWindow = threads.data ?? []
		const existing = new Set(refreshSnapshot.map(threadKey))
		const fresh = freshWindow.filter((t: Thread) => !existing.has(threadKey(t)))
		threads.data = [...fresh, ...refreshSnapshot]
		// Keep the reader where they were: shift scroll by the height the prepended rows added. If they
		// were already at the top, leave them there so the new mail is visible.
		nextTick(() => {
			if (el && prevTop > 0) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
		})
		return
	}

	scrollListToTop()
}

// Reset resource: always the first window, over-fetching one row (PAGE_LENGTH + 1) to detect whether
// more exist without a total.
const threads = createResource({
	url: 'suite.mail.api.mail.get_all_inbox_threads',
	makeParams: () => ({
		limit: PAGE_LENGTH + 1,
		start: 0,
		filter_by: filter.value,
	}),
	transform: (rows: Thread[]) => {
		// In refresh mode, snapshot the live loaded list now — before this window replaces it — so the
		// merge in onResetSuccess reflects any optimistic removals made during the fetch.
		if (refreshMode.value) refreshSnapshot = threads.data ?? []
		hasMore.value = rows.length > PAGE_LENGTH
		return rows.slice(0, PAGE_LENGTH)
	},
	onSuccess: () => {
		onResetSuccess()
		isLoaded.value = true
	},
	auto: true,
})

// Appends the next window onto the loaded list, deduped by account + thread_id. `start = data.length`
// stays correct across optimistic removals (the server list shifts left by the same rows we dropped);
// the only skew is new mail inserted at the front, which the dedupe absorbs and the next reset reconciles.
const appendThreads = (rows: Thread[]) => {
	loadingMore.value = false
	// Discard a stale window that resolved after a reset/refresh began.
	if (loadEpoch !== epoch.value) return
	const seen = new Set((threads.data ?? []).map(threadKey))
	const fresh = rows.slice(0, PAGE_LENGTH).filter((t) => !seen.has(threadKey(t)))
	// Stop auto-loading if the window added nothing new (offset stuck behind heavy front-inserted mail,
	// or the server's fetch depth cap reached); the next reset reconciles. Guards a tight reload loop
	// while the sentinel stays in view.
	hasMore.value = rows.length > PAGE_LENGTH && fresh.length > 0
	threads.data = [...(threads.data ?? []), ...fresh]
}

const loadMoreThreads = createResource({
	url: 'suite.mail.api.mail.get_all_inbox_threads',
	makeParams: () => ({
		limit: PAGE_LENGTH + 1,
		start: threads.data?.length ?? 0,
		filter_by: filter.value,
	}),
	onSuccess: (rows: Thread[]) => appendThreads(rows),
	onError: () => (loadingMore.value = false),
})

const loadMore = () => {
	if (!hasMore.value || loadingMore.value || threads.loading) return
	loadingMore.value = true
	loadEpoch = epoch.value
	loadMoreThreads.reload()
}

const loadMoreSentinel = useTemplateRef('loadMoreSentinel')
useIntersectionObserver(
	loadMoreSentinel,
	([entry]) => {
		if (entry?.isIntersecting) loadMore()
	},
	{ root: mailListRef },
)

const isLoading = computed(() => !isLoaded.value && threads.loading)

// After an action, refresh the sidebar counts: the active account's per-mailbox counts, which via the
// store's mailboxes.onSuccess hook also refreshes the unified All Inboxes badge.
const refreshCounts = () => store.mailboxes.reload()

// Reset-to-top: refetch only the first window, replacing the loaded list and scrolling to the top (via
// onResetSuccess). Bumping `epoch` discards any append/refresh still in flight. Used on filter change.
const resetThreads = () => {
	refreshMode.value = false
	epoch.value++
	// A reset replaces the list with a fresh first window, so any prior collapse no longer maps to what's
	// shown — clear it (else a group collapsed under one filter stays collapsed and hides its threads).
	collapsedGroups.value = []
	threads.reload()
	refreshCounts()
}

// Check for new mail without losing the reader's place: refetch the newest window and prepend only the
// threads not already loaded (see onResetSuccess), keeping scroll position and the loaded rows. Used by
// the Refresh button, the periodic poll, and the new-mail socket.
const refreshThreads = (reloadCounts = true) => {
	if (threads.loading || loadingMore.value) return
	refreshMode.value = true
	// Bump the epoch so an append still in flight is discarded (appendThreads checks it) instead of
	// landing after the merge and clobbering it. A new append can't start mid-refresh (loadMore bails
	// while the resource is loading), so this fully closes the refresh/append race.
	epoch.value++
	refreshEpoch = epoch.value
	threads.reload()
	if (reloadCounts) refreshCounts()
}

// Date grouping with collapsible headers (mirroring the per-mailbox view). The last group never
// collapses — it's where infinite scroll appends, so hiding it would swallow newly loaded rows.
const groupMessagesBy = computed(() => user.data.group_messages_by)

const groupedThreads = computed<Record<string, Thread[]>>(() =>
	(threads.data ?? []).reduce((groups: Record<string, Thread[]>, thread: Thread) => {
		const date = dayjs(thread.received_at).format(
			groupMessagesBy.value === 'Day' ? 'YYYY-MM-DD' : 'YYYY-MM',
		)
		if (!groups[date]) groups[date] = []
		groups[date].push(thread)
		return groups
	}, {}),
)

const isLastGroup = (key: string) => Object.keys(groupedThreads.value).at(-1) === key

const collapsedGroups = ref<string[]>([])

const toggleGroupCollapse = (key: string) => {
	if (isLastGroup(key)) return
	if (collapsedGroups.value.includes(key))
		collapsedGroups.value = collapsedGroups.value.filter((d) => d !== key)
	else collapsedGroups.value.push(key)
}

watch(groupMessagesBy, () => (collapsedGroups.value = []))

// Per-item actions — each row carries its own account + that account's mailbox ids, so actions target
// the correct JMAP account without touching the active-account state.
const messageIds = (thread: Thread) => (thread.messages ?? []).map((m) => m.id)

// Optimistically drop the row. Its server row leaves the current view too, so the append offset
// (data.length) stays aligned. If the list empties while more remain, reset to top (the sentinel
// unmounts with an empty list and couldn't otherwise re-trigger a load). Returns a restore closure
// that re-inserts the row at its original index (or falls back to resetThreads if we had to reset).
const removeFromList = (thread: Thread) => {
	const index = threads.data?.findIndex((t: Thread) => threadKey(t) === threadKey(thread)) ?? -1
	threads.data = threads.data?.filter((t: Thread) => threadKey(t) !== threadKey(thread))
	if (!threads.data?.length && hasMore.value) {
		resetThreads()
		return () => resetThreads()
	}
	return () => threads.data?.splice(index, 0, thread)
}

// Each action is a stateless one-shot `call()` rather than a shared createResource: rows act on
// different accounts/threads and can be fired in rapid succession, so every invocation must be a
// fully independent request. A shared resource carries a single reactive state slot (and one abort
// controller); call() has no shared state, so concurrent row actions can never clobber one another.
const handleSetSeen = (thread: Thread, seen: boolean) => {
	if (thread.seen === (seen ? 1 : 0)) return
	const applySeen = (value: 0 | 1) => {
		thread.seen = value
		thread.messages?.forEach((m) => (m.seen = value))
	}
	applySeen(seen ? 1 : 0)
	call('suite.mail.api.mail.set_mails_seen', {
		account: thread.account,
		ids: messageIds(thread),
		seen,
	})
		.then(refreshCounts)
		.catch((error) => {
			applySeen(seen ? 0 : 1) // revert the optimistic update
			raiseToast(error?.messages?.[0] || error?.message, 'error')
		})
}

const handleSetFlagged = (thread: Thread, flagged: boolean) => {
	thread.flagged = flagged ? 1 : 0
	call('suite.mail.api.mail.set_flagged', {
		account: thread.account,
		ids: [thread.id],
		flagged,
	}).catch((error) => {
		thread.flagged = flagged ? 0 : 1 // revert the optimistic update
		raiseToast(error?.messages?.[0] || error?.message, 'error')
	})
}

// The row is already dropped optimistically by the caller, so move on the server directly. On success just
// refresh counts (the row and its server row are both gone, so the append offset stays aligned and scroll is
// preserved). On failure, restore the row in place via the passed closure; rethrow so the toast reports the error.
const moveThreadOut = (thread: Thread, mailbox: string, restore: () => void) =>
	call('suite.mail.api.mail.move_mails', {
		account: thread.account,
		ids: messageIds(thread),
		mailbox,
		clear_junk: true,
	}).then(refreshCounts, (error) => {
		restore()
		throw error
	})

const handleArchive = (thread: Thread) => {
	if (!thread.archive) return raiseToast(__('No Archive folder for this account.'), 'error')
	const restore = removeFromList(thread)
	raiseOptimisticToast(moveThreadOut(thread, thread.archive!, restore), __('Thread archived.'))
}

const handleTrash = (thread: Thread) => {
	if (!thread.trash) return raiseToast(__('No Trash folder for this account.'), 'error')
	const restore = removeFromList(thread)
	raiseOptimisticToast(moveThreadOut(thread, thread.trash!, restore), __('Thread moved to Trash.'))
}

// Filter
const FILTER_OPTIONS = [
	{ label: __('All'), icon: Mails, onClick: () => setFilter(null) },
	{ label: __('Unread'), icon: MailIcon, onClick: () => setFilter('unread') },
	{ label: __('Starred'), icon: Star, onClick: () => setFilter('starred') },
	{ label: __('Has attachments'), icon: Paperclip, onClick: () => setFilter('has_attachments') },
]

const setFilter = (value: string | null) => {
	filter.value = value
	localStorage.setItem(`user:${user.data.name}:filter:all-inboxes`, value ?? '')
	resetThreads()
}

const title = computed(() => {
	switch (filter.value) {
		case 'unread':
			return __('Unread Mails')
		case 'starred':
			return __('Starred Mails')
		case 'has_attachments':
			return __('With Attachments')
		default:
			return __('All Mails')
	}
})

const unreadPrefix = computed(() =>
	store.allInboxesUnread.data ? `(${store.allInboxesUnread.data})` : '',
)

usePageMeta(() => ({ title: `${unreadPrefix.value} ${__('All Inboxes')}` }))

// Keep the merged list fresh: poll periodically and react to new-mail push events (which can arrive
// for any account). Both merge the newest window at the top, preserving scroll.
const reloadInterval = ref<ReturnType<typeof setInterval>>()
const onNewMail = () => refreshThreads()

onMounted(() => {
	reloadInterval.value = setInterval(onNewMail, 30000)
	socket.on('new_mail_created', onNewMail)
})

onUnmounted(() => {
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	socket.off('new_mail_created', onNewMail)
})
</script>

<style scoped>
.loading-bar__fill {
	animation: loading-bar-slide 1.2s linear infinite;
}

@keyframes loading-bar-slide {
	0% {
		transform: translateX(-100%);
	}
	100% {
		transform: translateX(333%);
	}
}
</style>
