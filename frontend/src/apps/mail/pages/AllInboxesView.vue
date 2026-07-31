<template>
	<!-- Mobile title header — no thread count since the merged view has no total.
	     The toolbar below carries the bottom border, matching the mailbox structure. -->
	<MobileTitleHeader v-if="isMobile" with-menu :title="__('All Inboxes')" />

	<!-- Header -->
	<!-- hidden on mobile: the tab bar's morphing Mail tab carries the folder name, and
	     the header's actions live in the bar/FAB. Hidden (not v-if) so HeaderActions'
	     modals stay mounted for the views' v-model bindings. -->
	<header class="hidden items-center justify-between border-b px-3 py-2.5 sm:flex sm:px-5">
		<div class="flex items-center space-x-2">
			<!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
			<Breadcrumbs
				:items="[{ label: __('All Inboxes'), route: { name: 'mail-all-inboxes' } }]"
				class="-ml-0.5"
			/>
		</div>
		<HeaderActions @reload-mails="refreshThreads()" />
	</header>

	<div class="relative flex h-[calc(100dvh-3.05rem)] max-sm:min-h-0 max-sm:flex-1 max-sm:!h-auto">
		<!-- Loading -->
		<div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
			<div class="text-ink-gray-5 flex items-center space-x-2">
				<LoaderCircle class="h-5 w-5 animate-spin" />
				<span>{{ __('Loading...') }}</span>
			</div>
		</div>

		<template v-else-if="threads.data?.length">
			<ThreadPane
				:thread-open="!!threadID"
				@touch-start="onThreadTouchStart"
				@touch-end="onThreadTouchEnd"
			>
				<template #list>
					<!-- Toolbar — mobile mirrors the mailbox one (h-12, semibold selector in a
					     bottom sheet, no refresh: pull the tab or reopen instead). -->
					<div v-if="isMobile" class="relative flex h-12 items-center border-b px-4">
						<AdaptiveDropdown :options="FILTER_OPTIONS" :title="__('Filter')">
							<button class="flex min-w-0 items-center gap-1.5 text-base !font-medium">
								<span class="truncate">{{ title }}</span>
								<ChevronDown class="text-ink-gray-5 h-4 w-4 shrink-0" />
							</button>
						</AdaptiveDropdown>

						<!-- Loading bar -->
						<LoadingBar v-if="threads.loading" />
					</div>
					<div
						v-else
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
								:disabled="isFetching"
								@click="refreshThreads()"
							>
								<template #icon>
									<RefreshCw class="icon" />
								</template>
							</Button>
						</div>

						<!-- Loading bar -->
						<LoadingBar v-if="threads.loading" />
					</div>

					<!-- Mail list -->
					<div ref="mailList" class="h-full overflow-y-auto overscroll-contain max-sm:pb-20">
						<div v-for="(rows, key) in groupedRows" :key="key">
							<MailGroupHeader
								v-if="groupMessagesBy !== 'None' && !isMobile"
								:date-key="key"
								:monthly="groupMessagesBy === 'Month'"
								:collapsed="collapsedGroups.includes(key)"
								:collapsible="!isLastGroup(key)"
								:focused="focusedRowKey === `group:${key}`"
								@toggle="toggleGroupCollapse(key)"
							/>
							<template v-if="isMobile || !collapsedGroups.includes(key)">
								<!-- A stack row stands in for a run of look-alike threads; when expanded, its
								     members follow it as ordinary (indented) rows — the same model as the
								     mailbox list. No delete handler: Delete only shows once every member is
								     already in Trash, which the merged inbox list can't reach. -->
								<template v-for="row in rows" :key="row.key">
									<StackListItem
										v-if="row.type === 'stack'"
										:threads="row.threads"
										:expanded="row.expanded"
										:is-selected="false"
										:selectable="false"
										:hide-avatar="!isMobile"
										:account-label="shortAccountLabel(row.threads[0].account_name)"
										:class="rowClasses(row)"
										:data-row-key="row.key"
										@toggle="toggleStack(row)"
										@set-seen="(seen: boolean) => stackSetSeen(row.threads, seen)"
										@archive-threads="stackArchive(row.threads)"
										@trash-threads="stackTrash(row.threads)"
									/>
									<MailListItem
										v-else
										:mailbox="row.thread.inbox || ''"
										:account-id="row.thread.account"
										:account-label="shortAccountLabel(row.thread.account_name)"
										:mail="row.thread"
										:is-selected="false"
										:selectable="false"
										thread-route-name="mail-all-inboxes-mail"
										:hide-avatar="!isMobile"
										:hide-sender="row.inStack"
										:class="rowClasses(row)"
										:data-row-key="row.key"
										@set-seen="(seen: boolean) => handleSetSeen(row.thread, seen)"
										@archive-thread="handleArchive(row.thread)"
										@trash-thread="handleTrash(row.thread)"
										@set-flagged="(flagged: boolean) => handleSetFlagged(row.thread, flagged)"
									/>
								</template>
							</template>
						</div>
						<!-- Infinite-scroll sentinel: entering the viewport near the list bottom loads the next
						     batch (appended, never refetching loaded rows). Sits after all groups. -->
						<div ref="loadMoreSentinel" class="h-px" />
						<div v-if="loadingMore" class="flex justify-center py-3">
							<LoaderCircle class="text-ink-gray-5 h-4 w-4 animate-spin" />
						</div>
					</div>
				</template>

				<!-- Rendered with no thread open too so its own "Select an email" placeholder
				     fills the pane, as in MailboxView. A deep link whose row isn't in the
				     loaded window stays gated: the pane's action handlers act on the row.
				     The owning account scopes the pane (folder menus, reply identities) —
				     opening a cross-account thread does NOT switch the active account.
				     set-seen passes `seen` as `silent` too: the pane only marks read silently
				     (on open), while its explicit action is Mark as Unread — as in MailboxView. -->
				<MailThread
					ref="mailThread"
					v-if="openRow || !threadID"
					:slide="threadSlide"
					@slide-done="threadSlide = ''"
					:account="openRow?.account"
					:mailbox="openRow?.inbox || ''"
					:thread-i-d="threadID"
					:threads="threadIDs"
					:can-go-next="canGoNext"
					:messages="openRow?.messages"
					@reload-mails="reloadPaneThread()"
					@set-seen="(seen: boolean) => handleSetSeen(openRow!, seen, seen)"
					@set-flagged="
						(ids: string[], flagged: boolean) =>
							handleSetFlagged(openRow!, flagged, ids)
					"
					@move-thread="(mailboxId: string) => moveOpenThread(mailboxId)"
					@delete-thread="handleTrash(openRow!)"
					@archive-thread="handleArchive(openRow!)"
					@sync-unseen="handleSyncUnseen"
					@add-thread-to-mailbox="handleAddToMailbox"
					@remove-thread-from-mailbox="handleRemoveFromMailbox"
					@set-spam-status="handleSetSpamStatus"
					@move-mail="handleMailMove"
					@mark-mail-spam="handleMailSpam"
					@delete-mail="handleMailDelete"
					@prev-thread="stepOpenThread(-1)"
					@next-thread="stepOpenThread(1)"
				/>
			</ThreadPane>
		</template>

		<!-- No mails -->
		<div v-else class="text-ink-gray-5 flex w-full flex-col items-center justify-center">
			<NoMails class="text-ink-gray-2 mb-2 h-16 w-16" />
			<p>{{ __('You have no mails in any inbox.') }}</p>
			<Button
				class="mt-3"
				variant="ghost"
				:label="__('Refresh')"
				:disabled="isFetching"
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
import { computed, inject, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { Breadcrumbs, Button, Dropdown, call, createResource, usePageMeta } from 'frappe-ui'

import {
	isMac,
	raiseOptimisticToast,
	raiseToast,
	shouldIgnoreKeypress,
} from '@/apps/mail/utils'
import {
	hasCursor,
	isNavigationKey,
	navigationOffset,
	stepFromKey,
	useGPrefix,
} from '@/apps/mail/utils/listNavigation'
import { useStoredFilter } from '@/apps/mail/utils/listFilter'
import { useAccountScope } from '@/apps/mail/utils/accountScope'
import { useUndo, useScreenSize, useSwipeNav } from '@/apps/mail/utils/composables'
import { useListRows } from '@/apps/mail/composables/useListRows'
import { useMailRemoval } from '@/apps/mail/composables/useMailRemoval'
import {
	PAGE_LENGTH,
	usePaginatedThreads,
} from '@/apps/mail/composables/usePaginatedThreads'
import { userStore } from '@/apps/mail/stores/user'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import LoadingBar from '@/apps/mail/components/LoadingBar.vue'
import MailGroupHeader from '@/apps/mail/components/MailGroupHeader.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import StackListItem from '@/apps/mail/components/StackListItem.vue'
import ThreadPane from '@/apps/mail/components/ThreadPane.vue'

import type { Mail, Mailbox, MailboxData, Thread, UserResource } from '@/apps/mail/types'

const { isMobile } = useScreenSize()

// The `mail-all-inboxes-mail` route also carries the open thread's owning accountId and mailbox, but
// nothing here reads them: every row already carries its own account and folder ids, which is what the
// pane and its actions target. They fall through as plain attributes, which this component (a fragment)
// cannot inherit — so it inherits nothing.
defineOptions({ inheritAttrs: false })

const { threadID } = defineProps<{
	threadID?: string
}>()

const route = useRoute()
const router = useRouter()
const socket = inject('$socket')
const user = inject('$user') as UserResource

const store = userStore()

// ── Infinite scroll ─────────────────────────────────────────────────────────────────────────────
// The loaded list (threads.data) is the single source of truth; usePaginatedThreads owns everything
// around it — the epochs, the refresh merge, the sentinel, the edge crossing. Rows are keyed by
// account + thread_id since the same thread_id can recur across accounts in this merged view.
const threadKey = (thread: Thread) => `${thread.account}:${thread.thread_id}`

const {
	container: mailListRef,
	hasMore,
	loadingMore,
	isFetching,
	canGoNext,
	threadIDs,
	threadByOffset,
	takeResetWindow,
	beginReset,
	beginRefresh,
	onResetSuccess,
	appendThreads,
	loadMoreThenOpenEdge,
	topUpIfShort,
	suppressRemoved,
	unsuppressRemoved,
} = usePaginatedThreads({
	resource: () => threads,
	fetchMore: () => loadMoreThreads.reload(),
	openThreadID: () => threadID,
	// A step off the loaded edge opens the appended thread when the pane is showing, and otherwise
	// just takes the cursor to it — onto whatever row stands for it (see rowForThread).
	onEdgeThread: (id, action) => (action === 'open' ? openThread(id) : focusOnThread(id)),
	threadKey,
})

const isLoaded = ref(false)

// The remembered All/Unread/Starred/Has-attachments choice, its menu, and its title (see
// useStoredFilter) — all shared with the mailbox list.
const { filter, FILTER_OPTIONS, filterTitle: title } = useStoredFilter({
	scope: () => 'all-inboxes',
	onChange: () => resetThreads(),
})

// Reset resource: always the first window, over-fetching one row (PAGE_LENGTH + 1) to detect whether
// more exist without a total.
const threads = createResource({
	url: 'suite.mail.api.mail.get_all_inbox_threads',
	makeParams: () => ({
		limit: PAGE_LENGTH + 1,
		start: 0,
		filter_by: filter.value,
	}),
	transform: (rows: Thread[]) => takeResetWindow(rows),
	onSuccess: () => {
		onResetSuccess()
		isLoaded.value = true
	},
	auto: true,
})

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

const isLoading = computed(() => !isLoaded.value && threads.loading)

// After an action, refresh the sidebar counts: the active account's per-mailbox counts, which via the
// store's mailboxes.onSuccess hook also refreshes the unified All Inboxes badge.
const refreshCounts = () => store.mailboxes.reload()

// The row's account, by its short name: blank for the currently open account (only
// the odd ones out get labelled), the local part otherwise, unless two accounts share one.
const shortAccountLabel = (name?: string | null) =>
	name ? (store.accountShortNames[name] ?? name) : undefined

// Reset-to-top: refetch only the first window, replacing the loaded list and scrolling to the top (via
// onResetSuccess). Bumping `epoch` discards any append/refresh still in flight. Used on filter change.
const resetThreads = () => {
	beginReset()
	// A reset replaces the list with a fresh first window, so any prior collapse or stack expansion no
	// longer maps to what's shown — clear them (else a group collapsed under one filter stays collapsed
	// and hides its threads).
	collapsedGroups.value = []
	expandedStacks.value = new Set()
	threads.reload()
	refreshCounts()
}

// Check for new mail without losing the reader's place: refetch the newest window and prepend only the
// threads not already loaded (see onResetSuccess), keeping scroll position and the loaded rows. Used by
// the Refresh button, the periodic poll, and the new-mail socket.
const refreshThreads = (reloadCounts = true) => {
	if (!beginRefresh()) return
	threads.reload()
	if (reloadCounts) refreshCounts()
}

// The pane asked for a reload (a reply was sent, a message deleted, …). The list refresh keeps
// already-loaded rows to hold the reader's place (see usePaginatedThreads), so it never updates the
// open row — refetch the thread directly, scoped to its owning account, and write it onto the row so
// the pane re-derives from fresh messages. MailboxView resets its whole list instead; doing that here
// would blank the pane for any row outside the first window (the pane only renders loaded rows).
const reloadPaneThread = () => {
	const row = openRow.value
	if (row)
		call('suite.mail.api.mail.get_thread', {
			account: row.account,
			thread_id: row.thread_id,
		}).then((mails: Mail[]) => {
			if (mails?.length) row.messages = mails
		})
	refreshThreads()
}

// The rendered rows and the keyboard cursor: date groups, stacks, and the marker that walks them —
// all shared with the mailbox list (see useListRows). Chatty senders stack here exactly as they do
// there: buildListRows keys runs by account + day + sender, so a run never mixes accounts even in
// this merged list.
const {
	groupMessagesBy,
	isLastGroup,
	collapsedGroups,
	expandedStacks,
	groupedRows,
	navigableRows,
	focusedRowKey,
	focusedRow,
	focusRow,
	focusOnThread,
	rowClasses,
	toggleStack,
	toggleGroupCollapse,
	revealThread,
} = useListRows({
	threads: () => threads.data ?? [],
	// A thread's row key is its id, so the cursor can be pointed straight at a thread.
	rowKey: (thread: Thread) => thread.thread_id,
	openThreadID: () => threadID,
	onOpenThreadHidden: () => closeThread(),
	container: mailListRef,
})

// The loaded row the open thread belongs to. Every mutation reads its account/archive/trash
// off the row, so the pane acts on the owning account without consulting the active one.
const openRow = computed(() =>
	threadID ? (threads.data ?? []).find((t: Thread) => t.thread_id === threadID) : undefined,
)

// MailThread's slide name while a swipe navigation renders; cleared on its slide-done, and left
// empty for every other thread change so taps and arrows keep swapping instantly.
const threadSlide = ref('')
let pendingThreadSlide = ''

// Swipe on the open thread (mobile): left → next thread, right → previous.
const { onTouchStart: onThreadTouchStart, onTouchEnd: onThreadTouchEnd } = useSwipeNav(
	() => isMobile.value && !!threadID,
	(offset) => {
		// Arms the paging animation for this navigation only — openThread consumes it.
		pendingThreadSlide = offset > 0 ? 'page-next' : 'page-prev'
		stepOpenThread(offset)
		pendingThreadSlide = ''
	},
)

const stepOpenThread = (offset: number) => {
	const next = threadByOffset(offset)
	if (next) return openThread(next)
	// At the last loaded thread, stepping further loads the next window and opens what arrives.
	loadMoreThenOpenEdge(offset, 'open')
}

// Up/down/j/k walk the list, or the open thread when one is showing. The merged list is flat —
// no stacks, no day headers, no selection — so a step is just the neighbouring row.
const gPrefix = useGPrefix()

// Thread shortcuts, acting on the open thread or — with none open — the row under the cursor.
// Each one goes through the row handlers, which read the account and its folder ids off the row
// itself, so a shortcut in the merged list targets the owning account like a click does.
// Returns true when it consumed the key.
const actionTarget = computed(() => {
	const key = threadID ?? focusedRowKey.value
	return (threads.data ?? []).find((t: Thread) => t.thread_id === key)
})

const handleThreadActions = (e: KeyboardEvent, key: string) => {
	const thread = actionTarget.value
	if (!thread) return false

	// Backspace on Mac, Delete elsewhere.
	if (key === (isMac ? 'backspace' : 'delete')) {
		e.preventDefault()
		handleTrash(thread)
		return true
	}

	if (key === 'u') {
		e.preventDefault()
		handleSetSeen(thread, e.shiftKey)
		return true
	}

	if (key === 'e') {
		e.preventDefault()
		handleArchive(thread)
		return true
	}

	// Junk needs no mailbox id of its own (set_mails_spam_status takes the account and the mails), so
	// unlike a move it works from a merged row.
	if (key === '!') {
		e.preventDefault()
		handleSetSpamStatus(true, thread)
		return true
	}

	return false
}

const handleKeyDown = (e: KeyboardEvent) => {
	const key = e.key.toLowerCase()
	if ((e.metaKey || e.ctrlKey) && key === 'z' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		gPrefix.disarm()
		return undo()
	}

	if (shouldIgnoreKeypress(e)) return

	// Escape backs out of the open thread, then clears the cursor.
	if (key === 'escape') {
		e.preventDefault()
		if (threadID) return closeThread()
		focusedRowKey.value = undefined
		return
	}

	if (key === 'enter') {
		if (!focusedRowKey.value) return
		e.preventDefault()
		return activateFocusedRow()
	}

	// `g g` to the top, `G` to the bottom of what is loaded.
	if (key === 'g') {
		e.preventDefault()
		const intent = gPrefix.press(e.shiftKey)
		if (intent === 'first') return goToEdge(0)
		if (intent === 'last') return goToEdge(-1)
		return
	}
	// A letter after `g` is a mailbox jump, which MailLayout owns. Swallow it so `g j` doesn't
	// also step the cursor — `j` is the one key in both that map and the navigation keys.
	if (gPrefix.armed.value) {
		gPrefix.disarm()
		return
	}

	if (handleThreadActions(e, key)) return

	if (!isNavigationKey(key)) return
	e.preventDefault()
	const offset = navigationOffset(key)

	if (threadID) return stepOpenThread(offset)

	// With no thread open the keys move the cursor without opening anything, as the mailbox list
	// does — Enter opens what the marker is on, or folds the day.
	const rows = navigableRows.value
	const next = stepFromKey(rows, focusedRowKey.value, offset)
	if (next) return focusRow(next)
	// Off the bottom of what is loaded: load the next window and take the cursor into it. Only from a
	// row the cursor is actually on — a lost cursor restarts from the top instead (see stepFromKey).
	if (hasCursor(rows, focusedRowKey.value)) loadMoreThenOpenEdge(offset, 'focus')
}

// Enter opens a thread, toggles the stack, or folds the day the marker is sitting on.
const activateFocusedRow = () => {
	const row = focusedRow.value
	if (!row) return
	if (row.type === 'thread') return openThread(row.thread.thread_id)
	if (row.type === 'stack') return toggleStack(row)
	if (!isLastGroup(row.dateKey)) toggleGroupCollapse(row.dateKey)
}

// The open thread keeps its row in view, as the mailbox list does: stepping prev/next or deep-linking
// scrolls the merged list along, and the cursor follows so keyboard navigation resumes from it.
watch(
	() => threadID,
	(val) => val && revealThread(val),
	{ immediate: true },
)

// `at()` so -1 reads as the last loaded thread. With a thread open the jump opens the edge one;
// otherwise it just moves the cursor there, mirroring the mailbox list.
const goToEdge = (index: number) => {
	if (threadID) {
		const next = threadIDs.value.at(index)
		return next && openThread(next)
	}
	focusRow(navigableRows.value.at(index))
}

const openThread = (nextThreadID: string) => {
	threadSlide.value = pendingThreadSlide
	const row = (threads.data ?? []).find((t: Thread) => t.thread_id === nextThreadID)
	if (!row) return
	router.push({
		name: 'mail-all-inboxes-mail',
		params: { accountId: row.account, mailbox: row.inbox, threadID: nextThreadID },
		query: route.query,
	})
}

// Archive and Trash already have optimistic list removal; anything else is a plain move.
const moveOpenThread = (mailboxId: string) => {
	const row = openRow.value
	if (!row) return
	if (mailboxId === row.archive) return handleArchive(row)
	if (mailboxId === row.trash) return handleTrash(row)
	goToNextThreadOrClose(row.thread_id)
	const restore = removeFromList(row)
	const folder = folderName(mailboxId)
	raiseOptimisticToast(
		moveThreadOut(row, mailboxId, restore),
		folder ? __('Thread moved to {0}.', [folder]) : __('Thread moved.'),
		withUndo(row, restore, __('Thread moved back.')),
	)
}

// Keep infinite scroll alive while the rendered list is too short to scroll (see topUpIfShort). Must
// stay below groupedRows: `watch` reads its source at setup.
watch(groupedRows, topUpIfShort)

// Per-item actions — each row carries its own account + that account's mailbox ids, so actions target
// the correct JMAP account without touching the active-account state.
const messageIds = (thread: Thread) => (thread.messages ?? []).map((m) => m.id)

// Optimistically drop the row. Its server row leaves the current view too, so the append offset
// (data.length) stays aligned. If the list empties while more remain, reset to top (the sentinel
// unmounts with an empty list and couldn't otherwise re-trigger a load). Returns a restore closure
// that re-inserts the row at its original index (or falls back to resetThreads if we had to reset).
const removeFromList = (thread: Thread) => {
	const key = threadKey(thread)
	const index = threads.data?.findIndex((t: Thread) => threadKey(t) === key) ?? -1
	threads.data = threads.data?.filter((t: Thread) => threadKey(t) !== key)
	// The server keeps returning the row until the mutation lands, so hold it out of any refresh or
	// append that resolves in the meantime — otherwise a thread archived mid-refresh reappears.
	suppressRemoved([key])
	// The row is back, so it must show again: lift the suppression before re-inserting it.
	const restore = (put: () => void) => () => {
		unsuppressRemoved([key])
		put()
	}
	if (!threads.data?.length && hasMore.value) {
		resetThreads()
		return restore(() => resetThreads())
	}
	return restore(() => threads.data?.splice(index, 0, thread))
}

// Each action is a stateless one-shot `call()` rather than a shared createResource: rows act on
// different accounts/threads and can be fired in rapid succession, so every invocation must be a
// fully independent request. A shared resource carries a single reactive state slot (and one abort
// controller); call() has no shared state, so concurrent row actions can never clobber one another.
// The pane's remaining actions. Each names the row's own account rather than the active one — the
// thread route carries accountId so the router has already switched, but passing it explicitly keeps
// these correct if that ever stops being true. Mailbox ids come from the store, which is the row's
// account for the same reason.
// `account` must be captured by the caller BEFORE its optimistic update, not resolved here: the
// removals take the row out of the list first, and openRow is derived from that list — so by the
// time the request fires the row it names is already gone. Falling back to openRow only covers the
// actions that leave the row in place.
//
// A deep-linked thread outside the loaded window has no account to act within either; refuse rather
// than firing `account: undefined` at the server and having it fail silently.
const paneCall = (method: string, params: Record<string, unknown>, account?: string) => {
	const acting = account ?? openRow.value?.account
	if (!acting) return Promise.reject(new Error(__('Thread is no longer in the list.')))
	return call(`suite.mail.api.mail.${method}`, { account: acting, ...params })
}

const messageIdsOf = (thread: Thread) => thread.messages?.map((m) => m.id) ?? [thread.id]

// Marked unread from a message downwards: MailThread reports the ids, we mirror it in the list.
const handleSyncUnseen = (ids: string[]) => {
	const thread = openRow.value
	if (!thread) return
	let changed = false
	thread.messages?.forEach((message) => {
		if (ids.includes(message.id)) {
			message.seen = 0
			changed = true
		}
	})
	if (changed) thread.seen = 0
	refreshCounts()
}

const mailThread = useTemplateRef<{
	syncFlagged: (ids: string[], flagged: boolean) => void
	syncMailboxMembership: (mailboxId: string, add: boolean) => void
	removeMailFromView: (mailId: string) => { emptied: boolean; rollback: () => void }
}>('mailThread')

// Folder membership shows as tags on the row and in the pane. Neither refetches, so both have to be
// told — mirroring syncListMailboxMembership plus MailThread's own syncMailboxMembership.
const syncFolderTag = (mailboxId: string, add: boolean) => {
	const mb = paneScope.mailboxes.value.data?.find((m: MailboxData) => m.id === mailboxId)
	const thread = openRow.value
	if (!mb || !thread) return

	const entry = { mailbox: mb.name, mailbox_id: mb.id, mailbox_name: mb._name }
	const apply = (item: { mailboxes: Mailbox[] }) => {
		if (add) {
			if (!item.mailboxes.some((m) => m.mailbox_id === mailboxId)) item.mailboxes.push({ ...entry })
		} else if (item.mailboxes.length > 1) {
			item.mailboxes = item.mailboxes.filter((m) => m.mailbox_id !== mailboxId)
		}
	}
	apply(thread)
	thread.messages?.forEach(apply)
	mailThread.value?.syncMailboxMembership(mailboxId, add)
}

const handleAddToMailbox = (mailboxId: string) => {
	const thread = openRow.value
	if (!thread) return
	const folder = folderName(mailboxId)
	const snapshot = threadSnapshot(thread)
	syncFolderTag(mailboxId, true)

	// Undo replays the exact membership rather than the inverse call: a mail that was already in
	// the folder before an "add" must stay in it afterwards.
	const undoAction = () => {
		syncFolderTag(mailboxId, false)
		raiseOptimisticToast(
			restoreMails(thread.account, snapshot),
			folder ? __('Thread removed from {0}.', [folder]) : __('Thread removed from folder.'),
		)
	}
	setUndoAction(undoAction)

	raiseOptimisticToast(
		paneCall(
			'add_mails_to_mailbox',
			{ ids: messageIdsOf(thread), mailbox_id: mailboxId },
			thread.account,
		).catch(
			(error) => {
				syncFolderTag(mailboxId, false)
				throw error
			},
		),
		folder ? __('Thread added to {0}.', [folder]) : __('Thread added to folder.'),
		undoAction,
	)
}

const handleRemoveFromMailbox = (mailboxId: string) => {
	const thread = openRow.value
	if (!thread) return
	const folder = folderName(mailboxId)
	const snapshot = threadSnapshot(thread)
	syncFolderTag(mailboxId, false)

	// Undo replays the exact membership rather than the inverse call: a mail that was already in
	// the folder before an "add" must stay in it afterwards.
	const undoAction = () => {
		syncFolderTag(mailboxId, true)
		raiseOptimisticToast(restoreMails(thread.account, snapshot), __('Thread added back.'))
	}
	setUndoAction(undoAction)

	raiseOptimisticToast(
		paneCall(
			'remove_mails_from_mailbox',
			{ ids: messageIdsOf(thread), mailbox_id: mailboxId },
			thread.account,
		).catch(
			(error) => {
				syncFolderTag(mailboxId, true)
				throw error
			},
		),
		folder ? __('Thread removed from {0}.', [folder]) : __('Thread removed from folder.'),
		undoAction,
	)
}

const handleSetSpamStatus = (spam: boolean, target?: Thread) => {
	const thread = target ?? openRow.value
	if (!thread) return
	goToNextThreadOrClose(thread.thread_id)
	const restore = removeFromList(thread)
	raiseOptimisticToast(
		paneCall('set_mails_spam_status', { ids: messageIdsOf(thread), spam }, thread.account).catch(
			(error) => {
				restore()
				throw error
			},
		),
		__('Thread marked as {0}.', [spam ? __('Junk') : __('Not Junk')]),
		// Undo flips the junk status back — name the resulting state, like the forward toast does.
		withUndo(thread, restore, __('Thread marked as {0}.', [spam ? __('Not Junk') : __('Junk')])),
	)
}

// Per-message actions from a message's own menu, on the shared orchestration (see useMailRemoval).
// The merged list is inbox-scoped, so its rows always summarise from the whole conversation — never
// from a folder, as Sent and Drafts do. No undo yet: the undo requests would have to be scoped to the
// row's own account rather than the active one.
const { setUndoAction, undo } = useUndo()

const { runMailRemoval } = useMailRemoval({
	row: () => openRow.value,
	mailThreadRef: mailThread,
	onEmptied: () => closeThread(),
	removeRow: (_mail, thread) => (thread ? removeFromList(thread) : () => {}),
})

// The pane's folder menus are scoped to the thread's own account, so its ids have to be resolved
// there too — the active account's list won't contain them for a thread from another account, and
// the lookup silently failing meant no folder tag appeared until a reload.
const paneScope = useAccountScope(() => openRow.value?.account)

const folderName = (mailboxId: string) =>
	paneScope.mailboxes.value.data?.find((m: MailboxData) => m.id === mailboxId)?._name

const undoMail = (mail: Mail, account: string | undefined, undoSuccess: string) => {
	const snapshot = mailSnapshot(mail)
	return { undoReq: () => restoreMails(account!, [snapshot]), undoSuccess }
}

const handleMailMove = (mail: Mail, target: string) => {
	const account = openRow.value?.account
	const folder = folderName(target)
	runMailRemoval(
		mail,
		() => paneCall('move_mails', { ids: [mail.id], mailbox: target }, account),
		folder ? __('Mail moved to {0}.', [folder]) : __('Mail moved.'),
		undoMail(mail, account, __('Mail moved back.')),
	)
}

const handleMailSpam = (mail: Mail, spam: boolean) => {
	const account = openRow.value?.account
	runMailRemoval(
		mail,
		() => paneCall('set_mails_spam_status', { ids: [mail.id], spam }, account),
		spam ? __('Mail marked as Junk.') : __('Mail marked as Not Junk.'),
		// Undo flips the junk status back — name the resulting state, like the forward toast does.
		undoMail(mail, account, __('Mail marked as {0}.', [spam ? __('Not Junk') : __('Junk')])),
	)
}

const handleMailDelete = (mail: Mail) =>
	runMailRemoval(
		mail,
		() =>
			call('suite.mail.doctype.mail_message.mail_message.bulk_delete', { names: [mail.name] }),
		__('Mail deleted.'),
	)

const closeThread = () => router.push({ name: 'mail-all-inboxes', query: route.query })

const handleSetSeen = (thread: Thread, seen: boolean, silent = false) => {
	if (thread.seen === (seen ? 1 : 0)) return

	// Marking the open thread unread means "come back to this later", so leave the pane — staying
	// in it would just mark it read again. Same exit as useThreadActions does for the mailbox list.
	if (!seen && threadID === thread.thread_id) closeThread()
	const applySeen = (value: 0 | 1) => {
		thread.seen = value
		thread.messages?.forEach((m) => (m.seen = value))
	}
	applySeen(seen ? 1 : 0)
	const request = call('suite.mail.api.mail.set_mails_seen', {
		account: thread.account,
		ids: messageIds(thread),
		seen,
	})
		.then(refreshCounts)
		.catch((error) => {
			applySeen(seen ? 0 : 1) // revert the optimistic update
			throw error
		})
	// The auto mark-as-read on opening a thread is silent (no toast); still roll back on failure.
	if (silent) return void request.catch(() => {})
	raiseOptimisticToast(request, __('Thread marked as {0}.', [seen ? __('read') : __('unread')]))
}

// Star/unstar, from a list row (which names no mails, so its own representative one) or from the
// pane (which names the mails whose star was clicked — the whole thread from the header, one message
// from its own star). The row's `flagged` drives the list star while the pane's stars read each
// message, so BOTH have to be told: the pane's star stayed hollow when starring from the list, and
// the list's star stayed hollow when starring from the pane. Only the ids actually sent to the
// server are flipped locally, or a refetch would contradict whatever we lit up.
const handleSetFlagged = (thread: Thread, flagged: boolean, ids: string[] = [thread.id]) => {
	// The row stands for its representative mail (see serialize_thread), so it takes the star only
	// when that mail is one of the ones being starred.
	const rowChanged = ids.includes(thread.id)
	const applyRow = (value: 0 | 1) => {
		if (rowChanged) thread.flagged = value
	}
	const applyPane = (value: boolean) => {
		if (threadID === thread.thread_id) mailThread.value?.syncFlagged(ids, value)
	}

	applyRow(flagged ? 1 : 0)
	applyPane(flagged)
	call('suite.mail.api.mail.set_flagged', {
		account: thread.account,
		ids,
		flagged,
	}).catch((error) => {
		// revert the optimistic update
		applyRow(flagged ? 0 : 1)
		applyPane(!flagged)
		raiseToast(error?.messages?.[0] || error?.message, 'error')
	})
}

// The row is already dropped optimistically by the caller, so move on the server directly. On success just
// refresh counts (the row and its server row are both gone, so the append offset stays aligned and scroll is
// preserved). On failure, restore the row in place via the passed closure; rethrow so the toast reports the error.
// Acting on the open thread from the pane should leave you on the next one, not on a thread that
// is no longer in the list. Resolved before the row is removed, so the index is still meaningful;
// falls back to closing the pane at the end of the list. Mirrors MailboxView.
const goToNextThreadOrClose = (movedThreadID: string) => {
	if (threadID !== movedThreadID) return
	const ids = threadIDs.value
	const next = ids.slice(ids.indexOf(movedThreadID) + 1).find((id) => id !== movedThreadID)
	if (next) openThread(next)
	else closeThread()
}

// Undo restores each mail's exact mailbox set and junk flag rather than guessing an inverse: a
// thread that sat in two folders has to come back to both, and un-junking is not the same as moving.
const mailSnapshot = (mail: Mail) => ({
	id: mail.id,
	mailbox_ids: mail.mailboxes.map((m) => m.mailbox_id),
	junk: mail.junk,
})

const threadSnapshot = (thread: Thread) => (thread.messages ?? []).map(mailSnapshot)

const restoreMails = (account: string, mails: ReturnType<typeof mailSnapshot>[]) =>
	call('suite.mail.api.mail.set_mails_mailboxes', { account, mails }).then(refreshCounts)

// Offered on the toast and on Cmd/Ctrl+Z, matching the mailbox list. `undoSuccess` is the caller's,
// because the mailbox list names the state the undo lands in ("Thread moved back.", "Thread marked
// as Not Junk.") rather than confirming it generically.
const withUndo = (thread: Thread, restore: () => void, undoSuccess: string) => {
	const snapshot = threadSnapshot(thread)
	const undoAction = () => {
		restore()
		raiseOptimisticToast(restoreMails(thread.account, snapshot), undoSuccess)
	}
	setUndoAction(undoAction)
	return undoAction
}

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
	goToNextThreadOrClose(thread.thread_id)
	const restore = removeFromList(thread)
	raiseOptimisticToast(
		moveThreadOut(thread, thread.archive!, restore),
		__('Thread archived.'),
		withUndo(thread, restore, __('Thread moved back.')),
	)
}

const handleTrash = (thread: Thread) => {
	if (!thread.trash) return raiseToast(__('No Trash folder for this account.'), 'error')
	goToNextThreadOrClose(thread.thread_id)
	const restore = removeFromList(thread)
	raiseOptimisticToast(
		moveThreadOut(thread, thread.trash!, restore),
		__('Thread moved to Trash.'),
		withUndo(thread, restore, __('Thread moved back.')),
	)
}

// Stack actions. A stack's members share one account (it is part of the stack key), so a single
// batched call covers the run — mirroring the mailbox's bulk handlers rather than firing one
// request per member.
const stackSetSeen = (threads: Thread[], seen: boolean) => {
	const changed = threads.filter((t) => t.seen !== (seen ? 1 : 0))
	if (!changed.length) return
	const applySeen = (value: 0 | 1) =>
		changed.forEach((t) => {
			t.seen = value
			t.messages?.forEach((m) => (m.seen = value))
		})
	applySeen(seen ? 1 : 0)
	raiseOptimisticToast(
		call('suite.mail.api.mail.set_mails_seen', {
			account: threads[0].account,
			ids: changed.flatMap(messageIds),
			seen,
		})
			.then(refreshCounts)
			.catch((error) => {
				applySeen(seen ? 0 : 1) // revert the optimistic update
				throw error
			}),
		__('Threads marked as {0}.', [seen ? __('read') : __('unread')]),
	)
}

// Restores run in reverse so each row splices back at the index captured when it was removed.
const stackMoveOut = (threads: Thread[], mailboxId: string | undefined, done: string) => {
	if (!mailboxId) return raiseToast(__('No such folder for this account.'), 'error')
	const restores = threads.map(removeFromList)
	const promise = call('suite.mail.api.mail.move_mails', {
		account: threads[0].account,
		ids: threads.flatMap(messageIds),
		mailbox: mailboxId,
		clear_junk: true,
	}).then(refreshCounts, (error) => {
		restores.reverse().forEach((restore) => restore())
		throw error
	})
	raiseOptimisticToast(promise, done)
}

// Plurals of the single-thread messages, as the mailbox list does — it never prefixes a count.
const stackArchive = (threads: Thread[]) =>
	stackMoveOut(threads, threads[0].archive, __('Threads archived.'))

const stackTrash = (threads: Thread[]) =>
	stackMoveOut(threads, threads[0].trash, __('Threads moved to Trash.'))

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
	window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	socket.off('new_mail_created', onNewMail)
	window.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
</style>
