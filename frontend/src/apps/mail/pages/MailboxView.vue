<template>
	<!-- Header -->
	<!-- hidden on mobile: the tab bar's morphing Mail tab carries the folder name, and
	     the header's actions live in the bar/FAB. Hidden (not v-if) so HeaderActions'
	     modals stay mounted for the views' v-model bindings. -->
	<header class="hidden items-center justify-between border-b px-3 py-2.5 sm:flex sm:px-5">
		<div class="flex items-center space-x-2">
			<!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
			<Breadcrumbs
				class="-ml-0.5"
				:items="[
					{
						label: mailboxName,
						route: { name: 'mail-mailbox', params: { accountId, mailbox } },
					},
				]"
			/>
		</div>
		<HeaderActions
			v-model:show-search="showSearchModal"
			v-model:show-advanced="showSearchAdvanced"
			v-model:edit-filter="searchEditFilter"
			@reload-mails="resetThreads(true, ['drafts', 'sent'])"
		/>
	</header>

	<!-- Unscreened-thread nudge on the inbox, mirroring the trash/junk info bar: shown while Hey-style
	     screening is on and threads are waiting to be screened. -->
	<div v-if="showScreenerBanner" class="flex items-center space-x-1 border-b py-2.5 px-5">
		<!-- w-4 wrapper centers the dot on the checkbox column below (checkbox is w-4) -->
		<span class="mr-1 flex w-4 shrink-0 justify-center">
			<span class="bg-blue-500 inline-block h-2 w-2 rounded-full" />
		</span>
		<span class="text-ink-gray-5">{{ screenerBanner.before
		}}<span class="font-medium text-ink-gray-8">{{ screenerBanner.phrase }}</span>{{ screenerBanner.after }}</span>
		<Button :label="__('Review Now')" variant="ghost" @click="goToScreener" />
	</div>

	<!-- On mobile this banner renders below the title header instead (inside the mobile
	     header block) — above it, it read as page chrome sitting on top of the title. -->
	<div v-if="showDeleteBanner && !isMobile" class="space-x-1 border-b px-3 py-2.5 sm:px-5">
		<span class="text-ink-gray-5">
			{{ __('Items in this mailbox will be automatically deleted after 30 days.') }}
		</span>
		<Button :label="__('Delete Now')" variant="ghost" @click="showEmptyMailbox = true" />
	</div>

	<!-- Mobile sizes by flex (the dvh calcs assume desktop chrome and overshoot
	     once the tab bar exists, making the outer container scroll too). -->
	<div
		class="relative flex max-sm:min-h-0 max-sm:flex-1 max-sm:!h-auto"
		:class="
			showDeleteBanner || showScreenerBanner
				? 'h-[calc(100dvh-6.125rem)]'
				: 'h-[calc(100dvh-3.0625rem)]'
		"
	>
		<!-- Loading -->
		<div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
			<div class="text-ink-gray-5 flex items-center space-x-2">
				<LoaderCircle class="h-5 w-5 animate-spin" />
				<span>{{ __('Loading...') }}</span>
			</div>
		</div>

		<template v-else-if="threadsResource?.data?.length || filter || mailbox === 'search'">
			<ThreadPane
				:thread-open="!!threadID"
				@touch-start="onThreadTouchStart"
				@touch-end="onThreadTouchEnd"
			>
				<template #list>
					<!-- The search view's own header: the query (click to edit) + removable filter pills, above
					     the results toolbar. It owns the query surface; the results below just read the route. -->
					<SearchResultsHeader
						v-if="mailbox === 'search'"
						v-model:show-search="showSearchModal"
						v-model:show-advanced="showSearchAdvanced"
						v-model:edit-filter="searchEditFilter"
					/>

					<!-- Mobile header: title row (folders · mailbox + count · search · compose) over
					     a toolbar row (filter selector on the left, filter/refresh pills on the
					     right). In selection mode the toolbar row swaps to ✕ / count / Select All.
					     Search skips both rows (SearchResultsHeader is the header there; the tab
					     bar carries the "you are in search" cue), keeping only the selection
					     toolbar and the loading bar — the border goes with the rows it underlines. -->
					<div
						v-if="isMobile"
						class="relative shrink-0"
						:class="{ 'border-b': mailbox !== 'search' || !!selections.length }"
					>
						<MobileTitleHeader
							v-if="mailbox !== 'search'"
							with-menu
							:title="mailboxName"
							:count="threadCount ? __('{0} threads', [threadCount]) : undefined"
						/>

						<!-- Trash/Junk auto-delete banner — below the title (its desktop slot above
						     the whole header read as chrome on top of the page). Borderless: it
						     reads as part of the header block, not a boxed-off strip. -->
						<div v-if="showDeleteBanner && mailbox !== 'search'" class="space-x-1 px-4">
							<span class="text-ink-gray-5">
								{{ __('Items in this mailbox will be automatically deleted after 30 days.') }}
							</span>
							<Button
								:label="__('Delete Now')"
								variant="ghost"
								@click="showEmptyMailbox = true"
							/>
						</div>

						<!-- Both toolbar variants share h-12 so toggling selection mode doesn't shift the list. -->
						<!-- px-1/gap-1 match the title row above, so the ✕ shares the hamburger's
						     axis and the count text starts where the title does. -->
						<div v-if="selections.length" class="flex h-12 items-center gap-1 px-1">
							<Button variant="ghost" class="!h-10 !w-10 !rounded-full" @click="toggleSelectAll(false)">
								<template #icon><X class="icon !h-5 !w-5" /></template>
							</Button>
							<span class="flex-1 truncate text-base !font-medium">
								{{ __('{0} selected', [String(selections.length)]) }}
							</span>
							<button
								class="text-ink-gray-8 text-md shrink-0 px-2 !font-medium"
								@click="toggleSelectAll(!isAllSelected)"
							>
								{{ isAllSelected ? __('Unselect All') : __('Select All') }}
							</button>
						</div>
						<div v-else-if="mailbox !== 'search'" class="flex h-12 items-center px-4">
							<!-- The selector label carries the active filter ("Unread Mails", …);
							     picking "All" in the sheet clears it, so no dismissal chip needed. -->
							<AdaptiveDropdown :options="FILTER_OPTIONS" :title="__('Filter')">
								<button class="flex min-w-0 items-center gap-1.5 text-base !font-medium">
									<span class="truncate">{{ title }}</span>
									<ChevronDown class="text-ink-gray-5 h-4 w-4 shrink-0" />
								</button>
							</AdaptiveDropdown>
						</div>

						<!-- Loading bar -->
						<LoadingBar v-if="threadsResource?.loading" />
					</div>

					<!-- Toolbar/Actions -->
					<div
						v-else
						class="relative flex items-center border-b border-l-transparent px-3.5 py-2.5 sm:border-l sm:px-5"
					>
						<div v-if="!isAllAccountsSearch" class="mr-5">
							<Tooltip
								:text="
									isAllSelected
										? __('Clear All (Esc)')
										: __('Select All ({0}+A)', [modifier])
								"
							>
								<div
									class="checkbox-hitbox -m-3 cursor-pointer p-3"
									@click.stop.prevent="toggleSelectAll(!isAllSelected)"
								>
									<Checkbox
										:model-value="isAllSelected"
										size="md"
										class="pointer-events-none"
									/>
								</div>
							</Tooltip>
						</div>
						<Dropdown
							v-if="!selections.length && mailbox !== 'search'"
							:options="FILTER_OPTIONS"
						>
							<button
								class="text-ink-gray-8 hover:bg-surface-gray-2 -ml-2 flex min-w-0 items-center gap-1 rounded px-2 py-1"
							>
								<span class="truncate">{{ title }}</span>
								<ChevronDown class="text-ink-gray-5 icon shrink-0" />
							</button>
						</Dropdown>
						<p v-else class="pb-[2px]">{{ title }}</p>
						<div class="-mr-1.5 ml-auto flex items-center space-x-1.5 sm:space-x-3">
							<Button
								v-if="!selections.length"
								variant="ghost"
								:tooltip="__('Refresh')"
								:disabled="isFetching"
								@click="refreshThreads()"
							>
								<template #icon>
									<RefreshCw class="icon" />
								</template>
							</Button>
							<template v-if="selections.length">
								<Dropdown v-if="showReadingPane" :options="selectActions">
									<Button variant="ghost" :tooltip="__('Actions')">
										<template #icon>
											<Ellipsis class="icon" />
										</template>
									</Button>
								</Dropdown>
								<template v-else>
									<Button
										v-for="action in selectActions.filter((a) => a.condition())"
										:key="action.label"
										:tooltip="action.label"
										variant="ghost"
										@click="action.onClick"
									>
										<template #icon>
											<component :is="action.icon" class="icon" />
										</template>
									</Button>
								</template>
							</template>

							<Dropdown
								v-if="!!selections.length && !['search', 'starred'].includes(mailbox)"
								:options="moveToOptions"
							>
								<Button variant="ghost" :tooltip="__('Move To')">
									<template #icon>
										<component :is="FolderInput" class="icon" />
									</template>
								</Button>
							</Dropdown>
							<Dropdown v-if="showAddTo" :options="addToOptions">
								<Button variant="ghost" :tooltip="__('Add To')">
									<template #icon>
										<component :is="FolderPlus" class="icon" />
									</template>
								</Button>
							</Dropdown>
							<Dropdown v-if="showRemoveFrom" :options="removeFromOptions">
								<Button variant="ghost" :tooltip="__('Remove From')">
									<template #icon>
										<component :is="FolderMinus" class="icon" />
									</template>
								</Button>
							</Dropdown>
						</div>
						<!-- Subtle loading bar: a segment sliding across the bottom outline (no layout shift) -->
						<LoadingBar v-if="threadsResource?.loading" />
					</div>

					<!-- Mail list -->
					<div
						v-if="threadsResource?.data?.length"
						ref="mailList"
						class="h-full overflow-y-auto overscroll-contain max-sm:pb-20"
					>
						<div v-for="(group, key) in groupedThreads" :key="key">
							<MailGroupHeader
								v-if="groupMessagesBy !== 'None' && !isMobile"
								:date-key="key"
								:monthly="groupMessagesBy === 'Month'"
								:collapsed="collapsedGroups.includes(key)"
								:collapsible="!isLastGroup(key)"
								:focused="focusedRowKey === `group:${key}`"
								:selected="isGroupSelected(key)"
								@toggle="toggleGroupCollapse(key)"
							>
								<!-- Mobile: group select ("all of Today") appears only in selection mode. -->
								<template #lead>
									<div
										v-if="!isAllAccountsSearch && (!isMobile || mobileSelectionMode)"
										class="pr-7.5 checkbox-hitbox -m-3 cursor-pointer py-3 pl-3"
										@click.stop.prevent="
											toggleSelect(getGroupThreads(key), !isGroupSelected(key))
										"
									>
										<Checkbox
											:model-value="isGroupSelected(key)"
											size="md"
											class="pointer-events-none"
										/>
									</div>
								</template>
							</MailGroupHeader>
							<template v-if="isMobile || !collapsedGroups.includes(key)">
								<!-- A stack row stands in for a run of look-alike threads; when expanded, its
								     members follow it as ordinary (indented) rows. -->
								<template v-for="row in groupedRows[key]" :key="row.key">
									<!-- Stacks are disabled in search (see stackingEnabled), so unlike the thread
									     rows below they never need the all-accounts cross-account handling. -->
									<StackListItem
										v-if="row.type === 'stack'"
										:threads="row.threads"
										:expanded="row.expanded"
										:is-selected="isStackSelected(row.threads)"
										:class="rowClasses(row)"
										:data-row-key="row.key"
										@toggle="toggleStack(row)"
										@set-seen="(seen: boolean) => stackSetSeen(row.threads, seen)"
										@archive-threads="stackArchive(row.threads)"
										@trash-threads="stackTrash(row.threads)"
										@delete-threads="stackDelete(row.threads)"
										@set-selected="
											(selected: boolean) =>
												toggleSelect(
													row.threads.map((t) => t.thread_id),
													selected,
												)
										"
									/>
									<MailListItem
										v-else
										:mailbox
										:mail="row.thread"
										:account-id="isAllAccountsSearch ? row.thread.account : undefined"
										:account-label="
											isAllAccountsSearch ? shortAccountLabel(row.thread.account_name) : undefined
										"
										:selectable="!isAllAccountsSearch"
										:selection-mode="mobileSelectionMode"
										:is-selected="selections.includes(row.thread.thread_id)"
										:hide-sender="row.inStack"
										:class="rowClasses(row)"
										:data-row-key="row.key"
										@set-seen="(seen: boolean) => rowSetSeen(row.thread, seen)"
										@archive-thread="rowArchive(row.thread)"
										@trash-thread="rowTrash(row.thread)"
										@delete-thread="junkOrDeleteThreads([row.thread.thread_id], false)"
										@set-flagged="(flagged: boolean) => rowSetFlagged(row.thread, flagged)"
										@set-selected="
											(selected: boolean) =>
												!isAllAccountsSearch &&
												toggleSelect([row.thread.thread_id], selected)
										"
									/>
								</template>
							</template>
						</div>
						<!-- Infinite-scroll sentinel: entering the viewport near the list bottom loads the next
						     batch (appended, never refetching loaded rows). Sits after all groups so collapsing
						     a group can't disable it. -->
						<div ref="loadMoreSentinel" class="h-px" />
						<div v-if="loadingMore" class="flex justify-center py-3">
							<LoaderCircle class="text-ink-gray-5 h-4 w-4 animate-spin" />
						</div>
					</div>
					<div v-else class="flex h-full items-center justify-center">
						<!-- While the (still-mounted) search header's new query loads, this area is the
						     loading surface — the empty message must not flash first. -->
						<LoaderCircle
							v-if="threadsResource?.loading"
							class="text-ink-gray-5 h-5 w-5 animate-spin"
						/>
						<p v-else class="text-ink-gray-5">
							{{
								mailbox !== 'search'
									? __('No mails found for the selected filter.')
									: hasSearchQuery
										? __('No results found for the given query.')
										: __('Search your mail')
							}}
						</p>
					</div>
				</template>

				<MailThread
					ref="mailThread"
					:slide="threadSlide"
					@slide-done="threadSlide = ''"
					:mailbox
					:thread-i-d
					:threads="threadIDs"
					:messages="currentThread?.messages"
					:can-go-next="canGoNext"
					@reload-mails="resetThreads"
					@set-seen="
						(seen: boolean, ids: string[]) =>
							handleSetSeen({ [Number(seen)]: [threadID!] }, seen, ids)
					"
					@sync-unseen="handleSyncUnseen"
					@set-flagged="
						(ids: string[], flagged: boolean) => setFlagged.submit({ ids, flagged })
					"
					@move-thread="
						(moveToMailbox: string) =>
							handleMoveThreads({ [moveToMailbox]: [threadID!] })
					"
					@add-thread-to-mailbox="
						(mailboxId: string) => handleAddThreadsToMailbox(mailboxId, [threadID!])
					"
					@remove-thread-from-mailbox="
						(mailboxId: string) =>
							handleRemoveThreadsFromMailbox(mailboxId, [threadID!])
					"
					@set-spam-status="
						(spam: boolean) =>
							spam
								? junkOrDeleteThreads([threadID!], true)
								: handleSetSpamStatus({ 0: [threadID!] })
					"
					@delete-thread="junkOrDeleteThreads([threadID!], false)"
					@move-mail="handleMailMove"
					@mark-mail-spam="handleMailSpam"
					@delete-mail="handleMailDelete"
					@prev-thread="goToThreadByOffset(-1)"
					@next-thread="goToThreadByOffset(1)"
				/>
			</ThreadPane>
		</template>

		<!-- No mails (the search view keeps its header and shows an inline message instead) -->
		<div v-else class="text-ink-gray-5 flex w-full flex-col items-center justify-center">
			<NoMails class="text-ink-gray-2 mb-2 h-16 w-16" />
			<p>{{ __('You have no mails in this folder.') }}</p>
		</div>
	</div>

	<Dialog v-model="showEmptyMailbox" :options="emptyMailboxOptions" />
	<Dialog v-model="showJunkOrDeleteThreads" :options="junkOrDeleteThreadsOptions" />
	<ScreenedEmailAddressModal />
	<!-- Selection action bar (design: 5·Selection) — replaces the tab bar while
	     selecting: thumb reach, Delete last and red. -->
	<!-- Same 52px row + safe-area padding as the tab bar it overlays, so entering/
	     leaving selection mode never shifts the layout. Teleported to body: inside
	     the layout's `isolate` stacking context, no z-index could beat the nav. -->
	<Teleport to="body">
	<div
		v-if="mobileSelectionMode"
		class="bg-surface-base fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)]"
	>
		<!-- Four labeled actions + More: seven unlabeled icons were the old screener
		     trap (no labels, no tooltips on touch). Overflow actions and the folder
		     menus live in the More sheet, which chains into the folder sheets. -->
		<!-- flex-1 columns (like the tab bar underneath): equal widths keep the icon
		     centers evenly spaced regardless of label length. -->
		<div class="flex h-15 items-stretch">
			<button
				v-for="action in visibleSelectActions.slice(0, 4)"
				:key="action.label"
				class="text-ink-gray-7 flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] !font-semibold"
				@click="action.onClick"
			>
				<component :is="action.icon" class="h-5 w-5" />
				<span class="max-w-full truncate">{{ action.shortLabel ?? stripShortcutHint(action.label) }}</span>
			</button>
			<button
				v-if="moreSelectionOptions.length"
				class="text-ink-gray-7 flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] !font-semibold"
				@click="showMoreActions = true"
			>
				<Ellipsis class="h-5 w-5" />
				<span>{{ __('More') }}</span>
			</button>
		</div>

		<AdaptiveDropdown
			v-model:open="showMoreActions"
			:options="moreSelectionOptions"
		/>
		<AdaptiveDropdown
			v-model:open="showMoveToSheet"
			:options="moveToOptions"
			:title="__('Move To')"
		/>
		<AdaptiveDropdown
			v-model:open="showAddToSheet"
			:options="addToOptions"
			:title="__('Add To')"
		/>
		<AdaptiveDropdown
			v-model:open="showRemoveFromSheet"
			:options="removeFromOptions"
			:title="__('Remove From')"
		/>
	</div>
	</Teleport>

</template>
<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
	Archive,
	ChevronDown,
	CircleAlert,
	CircleCheck,
	Ellipsis,
	FolderInput,
	FolderMinus,
	FolderPlus,
	LoaderCircle,
	Mail as MailIcon,
	MailOpen,
	RefreshCw,
	Star,
	StarOff,
	Trash2,
	X,
} from 'lucide-vue-next'
import {
	Breadcrumbs,
	Button,
	Checkbox,
	Dialog,
	Dropdown,
	Tooltip,
	call,
	createResource,
	usePageMeta,
} from 'frappe-ui'

import {
	isMac,
	raisePromiseToast,
	raiseToast,
	shouldIgnoreKeypress,
	stripShortcutHint,
} from '@/apps/mail/utils'
import { utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import {
	hasCursor,
	isNavigationKey,
	navigationOffset,
	stepFromKey,
	useGPrefix,
} from '@/apps/mail/utils/listNavigation'
import {
	useMobileSelection,
	useReadingPane,
	useScreenSize,
	useSwipeNav,
	useUndo,
} from '@/apps/mail/utils/composables'
import { useStoredFilter } from '@/apps/mail/utils/listFilter'
import { useListRows } from '@/apps/mail/composables/useListRows'
import {
	PAGE_LENGTH,
	usePaginatedThreads,
} from '@/apps/mail/composables/usePaginatedThreads'
import { useThreadActions } from '@/apps/mail/utils/useThreadActions'
import { type MailboxRole, userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import LoadingBar from '@/apps/mail/components/LoadingBar.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailGroupHeader from '@/apps/mail/components/MailGroupHeader.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import ScreenedEmailAddressModal from '@/apps/mail/components/Modals/ScreenedEmailAddressModal.vue'
import SearchResultsHeader from '@/apps/mail/components/SearchResultsHeader.vue'
import StackListItem from '@/apps/mail/components/StackListItem.vue'
import ThreadPane from '@/apps/mail/components/ThreadPane.vue'

import type { MailboxData, Thread, UserResource } from '@/apps/mail/types'
import type { NavRow } from '@/apps/mail/composables/useListRows'

const { accountId, mailbox, threadID } = defineProps<{
	accountId: string
	mailbox: string
	threadID?: string
}>()

const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const { setMobileSelectionActive } = useMobileSelection()
const { undo, setUndoAction } = useUndo()

const socket = inject('$socket')
const user = inject('$user') as UserResource

const store = userStore()
const { mailboxes, mailboxIds } = store

// Appearance

// Split View. Shared with ThreadPane, which sizes both halves of the split from it — this view also
// reads it to decide whether the info banners survive an open thread, and how the toolbar's bulk
// actions collapse (into a menu with the pane taking two thirds of the row, spelled out without).
const showReadingPane = useReadingPane()

// Infinite scroll (shared by the threads and search resources — only one is active at a time).
// usePaginatedThreads owns the state between the reset and append fetches: the epochs, the refresh
// merge, the removal suppression, the sentinel, the edge crossing. See there.
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
	resource: () => threadsResource.value,
	fetchMore: () => (mailbox === 'search' ? loadMoreSearch : loadMoreThreads).reload(),
	openThreadID: () => threadID,
	onEdgeThread: (id, action) => (action === 'open' ? goToThread(id) : focusOnThread(id)),
	// Deferred read — visibleThreadCount is declared below, with the rows it counts.
	fillProgress: () => visibleThreadCount.value,
})

// Rows and the cursor

// Stacking earns its place only where mail arrives unasked-for and one sender can drown the rest. It is
// off wherever the sender is not the signal, or where hiding rows would defeat the list itself:
//   Sent, Drafts — every row is from me, so a pile headed by my own name says nothing (MailListItem
//                  shows recipients rather than the sender here for exactly the same reason).
//   Starred      — a list curated by hand: collapsing away rows I deliberately marked is backwards.
//   Search       — results answer a question just asked, so every match should stay visible. This also
//                  covers all-accounts search (a subset of 'search'), whose rows must be acted on
//                  through per-row cross-account handlers a stack could not use.
const stackingEnabled = computed(
	() => !['search', 'starred', mailboxIds.sent, mailboxIds.drafts].includes(mailbox),
)

// The date groups, the stacks and the keyboard cursor that walks them — all shared with the merged All
// Inboxes list (see useListRows).
const {
	groupMessagesBy,
	groupedThreads,
	getGroupThreads,
	isLastGroup,
	collapsedGroups,
	expandedStacks,
	groupedRows,
	visibleThreadCount,
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
	threads: () => threadsResource.value?.data ?? [],
	// Rows are keyed by mail name, prefixed with the account in an all-accounts search — where two
	// accounts' rows sit in one list and a name alone need not be unique.
	rowKey: (mail: Thread) =>
		isAllAccountsSearch.value ? `${mail.account}:${mail.name}` : mail.name,
	stackingEnabled: () => stackingEnabled.value,
	openThreadID: () => threadID,
	onOpenThreadHidden: () => goToMailbox(),
	container: mailListRef,
})

// Every thread a row stands for: one for a thread row, the whole run for a stack, the whole day for a
// header — mirroring exactly what each row's own checkbox selects.
const rowThreadIDs = (row: NavRow): string[] =>
	row.type === 'thread'
		? [row.thread.thread_id]
		: row.type === 'stack'
			? row.threads.map((t) => t.thread_id)
			: (getGroupThreads(row.dateKey) ?? [])

// Derived rather than stored, mirroring isGroupSelected: it can never drift from `selections`, and
// every existing path that mutates them (Cmd+A, Esc, resetSelections, shift+arrow, a member's own
// checkbox) keeps the stack checkbox honest for free.
const isStackSelected = (threads: Thread[]) =>
	threads.every((t) => selections.value.includes(t.thread_id))

// A deep link or a step to the next thread can land inside a collapsed stack or a folded day — surface
// it either way, and leave the cursor on it (see revealThread).
watch(
	() => threadID,
	(val) => val && revealThread(val),
	{ immediate: true },
)

// Selection

const mailThreadRef = useTemplateRef('mailThread')

const selections = ref<string[]>([])

// Mobile selection mode (design: 5·Selection): rows show checkboxes, the toolbar
// turns contextual, and the action bar replaces the tab bar (via the composable).
const mobileSelectionMode = computed(() => isMobile.value && selections.value.length > 0)
watch(mobileSelectionMode, (active) => setMobileSelectionActive(active))
onUnmounted(() => setMobileSelectionActive(false))

// Selection bar: first four condition-passing actions get labeled slots; the rest,
// plus the folder menus, overflow into the More sheet (chained sheet opens).
const showMoreActions = ref(false)
const showMoveToSheet = ref(false)
const showAddToSheet = ref(false)
const showRemoveFromSheet = ref(false)

const visibleSelectActions = computed(() => selectActions.value.filter((a) => a.condition()))

const moreSelectionOptions = computed(() => [
	...visibleSelectActions.value.slice(4).map((a) => ({
		label: a.label,
		icon: a.icon,
		onClick: a.onClick,
	})),
	...(!['search', 'starred'].includes(mailbox)
		? [{ label: __('Move To'), icon: FolderInput, onClick: () => (showMoveToSheet.value = true) }]
		: []),
	...(showAddTo.value
		? [{ label: __('Add To'), icon: FolderPlus, onClick: () => (showAddToSheet.value = true) }]
		: []),
	...(showRemoveFrom.value
		? [
				{
					label: __('Remove From'),
					icon: FolderMinus,
					onClick: () => (showRemoveFromSheet.value = true),
				},
			]
		: []),
])
const lastSelected = ref<string[]>()

const isAllSelected = computed(
	() => threadIDs.value.length && selections.value.length === threadIDs.value.length,
)

// Selecting no longer forces a collapsed date group or stack open. Ticking either one is how you act
// on the whole set at once — collapse the pile, tick, archive — and expanding it on tick would undo
// exactly the thing being asked for, at the worst moment. Nothing is concealed by staying collapsed:
// the header or stack row shows its own checkbox ticked, and the toolbar counts individual threads.

const toggleSelect = (
	threadIDs: string[],
	selected: boolean,
	isKeyboardSelect: boolean = false,
) => {
	const allIDs = new Set([
		...threadIDs,
		...(isKeyboardSelect ? [] : getShiftSelectedIDs(threadIDs[0])),
	])
	if (selected) selections.value = [...new Set([...selections.value, ...allIDs])]
	else selections.value = selections.value.filter((id) => !allIDs.has(id))
	lastSelected.value = threadIDs
}

const getShiftSelectedIDs = (thread: string) => {
	if (!(isShiftPressed.value && lastSelected.value?.length)) return []

	const currentIndex = threadIDs.value.indexOf(thread)
	const firstIndex = threadIDs.value.indexOf(lastSelected.value[0])
	const lastIndex = threadIDs.value.indexOf(lastSelected.value.at(-1))

	const farthestIndex =
		Math.abs(currentIndex - firstIndex) > Math.abs(currentIndex - lastIndex)
			? firstIndex
			: lastIndex

	const [lower, higher] = [farthestIndex, currentIndex].sort((a, b) => a - b)
	return threadIDs.value.slice(lower, higher + 1)
}

const toggleSelectAll = (selected: boolean) => {
	if (selected) selections.value = [...threadIDs.value]
	else selections.value = []
	lastSelected.value = undefined
}

const resetSelections = () => {
	selections.value = []
	lastSelected.value = undefined
}

const isGroupSelected = (key: string) =>
	getGroupThreads(key).every((id) => selections.value.includes(id))

// Shortcuts


const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const isShiftPressed = ref(false)
const gPrefix = useGPrefix()
const reloadInterval = ref<ReturnType<typeof setInterval>>()

const handleKeyDown = (e: KeyboardEvent) => {
	isShiftPressed.value = e.shiftKey
	const key = e.key.toLowerCase()

	// Handle Ctrl/Cmd+A (Select All)
	if ((e.metaKey || e.ctrlKey) && key === 'a' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		gPrefix.disarm()
		return toggleSelectAll(true)
	}

	// Handle Ctrl/Cmd+Z (Undo)
	if ((e.metaKey || e.ctrlKey) && key === 'z' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		gPrefix.disarm()
		return undo()
	}

	if (shouldIgnoreKeypress(e)) return

	if (key === 'g') return handleGKeyPress(e)
	// A letter after `g` is a mailbox jump, which MailLayout owns. Swallow it here so it can't
	// also fire a thread-action shortcut sharing that letter.
	if (gPrefix.armed.value) {
		gPrefix.disarm()
		return
	}
	if (key === 'enter') return handleEnter(e)
	if (key === 'escape') return handleEscape(e)

	const hasSelection = selections.value.length > 0 || threadID
	if (hasSelection) handleThreadActions(e, key)
	handleArrowNavigation(e, key)
}

const handleGKeyPress = (e: KeyboardEvent) => {
	// The reading pane walks threads, so it names one; the list walks rows, so it takes the edge row —
	// which is the day's header when one sits above the first mail.
	const intent = gPrefix.press(e.shiftKey)

	if (intent === 'last') {
		if (threadID) return goToThread(threadIDs.value.at(-1))
		return focusRow(navigableRows.value.at(-1))
	}

	if (intent === 'first') {
		if (threadID) return goToThread(threadIDs.value[0])
		return focusRow(navigableRows.value[0])
	}
}

// Enter means "act on the row I'm on": open a mail, or fold/unfold a stack or a day.
const handleEnter = (e: KeyboardEvent) => {
	e.preventDefault()

	const row = focusedRow.value
	if (!row) return focusRow(navigableRows.value[0])
	if (row.type === 'thread') return goToThread(row.thread.thread_id)
	if (row.type === 'stack') return toggleStack(row)
	// Folds the day, or does nothing on the last group — exactly what clicking the header does.
	toggleGroupCollapse(row.dateKey)
}

const handleEscape = (e: KeyboardEvent) => {
	e.preventDefault()
	if (threadID) goToMailbox()
	else if (selections.value.length) resetSelections()
	else focusedRowKey.value = undefined
}

const handleThreadActions = (e: KeyboardEvent, key: string) => {
	const thread_ids = selections.value.length ? selections.value : [threadID!]

	// Delete/Trash (Backspace on Mac, Delete on Windows)
	if (key === (isMac ? 'backspace' : 'delete')) {
		e.preventDefault()
		if (e.shiftKey || mailbox === mailboxIds.trash)
			return junkOrDeleteThreads(thread_ids, false)
		return handleMoveThreads({ [mailboxIds.trash]: thread_ids })
	}

	// Mark as read/unread (u)
	if (key === 'u') {
		e.preventDefault()
		return handleSetSeen({ [Number(e.shiftKey)]: thread_ids })
	}

	// Archive (e)
	if (key === 'e') {
		e.preventDefault()
		return mailbox === mailboxIds.sent
			? handleAddThreadsToMailbox(mailboxIds.archive, thread_ids)
			: handleMoveThreads({ [mailboxIds.archive]: thread_ids })
	}

	// Mark as junk (!)
	if (key === '!') {
		e.preventDefault()
		return junkOrDeleteThreads(thread_ids, true)
	}
}

const handleArrowNavigation = (e: KeyboardEvent, key: string) => {
	if (!isNavigationKey(key)) return

	e.preventDefault()

	const offset = navigationOffset(key)
	const prevIDs = focusedRow.value ? rowThreadIDs(focusedRow.value) : []

	let newIDs: string[] = []

	// At the last loaded thread, stepping further loads the next window (like the ThreadHeader arrows).
	// newIDs stays the in-list target (empty at the edge), so shift-select skips the crossing — the
	// appended thread resolves asynchronously and a reset would clear selections anyway.
	if (threadID) {
		// The reading pane walks threads rather than rows: opening one always reveals it, so it can
		// never land on something hidden (see the threadID watcher).
		const next = threadByOffset(offset)
		goToThreadByOffset(offset)
		if (next) newIDs = [next]
	} else {
		const rows = navigableRows.value
		const next = stepFromKey(rows, focusedRowKey.value, offset)

		if (next) {
			focusRow(next)
			newIDs = rowThreadIDs(next)
		} else if (hasCursor(rows, focusedRowKey.value)) loadMoreThenOpenEdge(offset, 'focus')
	}

	// Handle shift+arrow selection. A row carries every thread it stands for, so shifting onto a stack
	// takes its whole run and onto a header takes the day — the same sets their checkboxes select.
	if (!(isShiftPressed.value && newIDs.length)) return

	const shouldSelect = !newIDs.every((id) => selections.value.includes(id))
	toggleSelect([...prevIDs, ...newIDs], shouldSelect, true)
}

const handleKeyUp = (e: KeyboardEvent) => {
	if (e.key === 'Shift') isShiftPressed.value = false
}

interface SelectAction {
	label: string
	// One-word label for the mobile selection bar; verb phrases stay in menus/tooltips.
	shortLabel?: string
	onClick: () => void
	icon: typeof RefreshCw
	condition: () => boolean
}

const selectActions = computed((): SelectAction[] => [
	{
		label: __('Star'),
		onClick: () => setFlaggedByThreadIDs(selections.value, true),
		icon: Star,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.flagged === 0,
			),
	},
	{
		label: __('Unstar'),
		onClick: () => setFlaggedByThreadIDs(selections.value, false),
		icon: StarOff,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.flagged === 1,
			),
	},
	{
		label: __('Archive (E)'),
		onClick: () =>
			mailbox === mailboxIds.sent
				? handleAddThreadsToMailbox(mailboxIds.archive, selections.value)
				: handleMoveThreads({ [mailboxIds.archive]: selections.value }),
		icon: Archive,
		condition: () => mailbox !== mailboxIds.archive,
	},
	{
		label: __('Mark as Junk (!)'),
		shortLabel: __('Junk'),
		onClick: () => junkOrDeleteThreads(selections.value, true),
		icon: CircleAlert,
		condition: () =>
			mailbox !== mailboxIds.drafts &&
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.junk === 0,
			),
	},
	{
		label: __('Mark as Not Junk'),
		shortLabel: __('Not Junk'),
		onClick: () => handleSetSpamStatus({ 0: selections.value }),
		icon: CircleCheck,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.junk === 1,
			),
	},
	{
		label: __('Move to Trash (Delete)'),
		shortLabel: __('Trash'),
		onClick: () => handleMoveThreads({ [mailboxIds.trash]: selections.value }),
		icon: Trash2,
		condition: () => mailbox !== mailboxIds.trash,
	},
	{
		label: __('Delete Threads (Shift+Delete)'),
		shortLabel: __('Delete'),
		onClick: () => junkOrDeleteThreads(selections.value, false),
		icon: Trash2,
		condition: () => mailbox === mailboxIds.trash,
	},
	{
		label: __('Mark as Read (Shift+U)'),
		shortLabel: __('Read'),
		onClick: () => handleSetSeen({ 1: selections.value }),
		icon: MailOpen,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.seen === 0,
			),
	},
	{
		label: __('Mark as Unread (U)'),
		shortLabel: __('Unread'),
		onClick: () => handleSetSeen({ 0: selections.value }),
		icon: MailIcon,
		condition: () =>
			selections.value.some(
				(threadID) =>
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID)
						?.seen === 1,
			),
	},
])

// Search

// An optimistic removal emptied the list but more threads exist, so a refill is coming once the server
// mutation lands. Keeps the loading state (not the empty state) during the gap before the refill fetch.
const refillPending = ref(false)
// Current mailbox's record (carries total_emails/total_threads/unread_threads); used by the periodic
// poll to detect count changes and by the tab title's unread badge.
const mailboxObj = computed(() => mailboxes.data?.find((m) => m.id === mailbox))

// ── Screener banner ─────────────────────────────────────────────────────────────────────────────
// An info bar mirroring the trash/junk one, shown on the inbox while Hey-style screening is on and
// unscreened threads are waiting. The count is the Screening folder's unread count, kept fresh by the
// periodic mailbox poll below.
const activeAccount = computed(() => user.data?.accounts?.find((a) => a.id === accountId))
const screeningEnabled = computed(() => !!activeAccount.value?.enable_screening)
const screenerCount = computed(
	() =>
		mailboxes.data?.find((m: MailboxData) => m.id === mailboxIds.screener)?.unread_threads ??
		0,
)
const showScreenerBanner = computed(
	() =>
		// The mobile tab bar's Screener badge carries this nudge; the banner is desktop-only.
		!isMobile.value &&
		mailbox === mailboxIds.inbox &&
		screeningEnabled.value &&
		screenerCount.value > 0 &&
		(showReadingPane.value || !threadID),
)
// Emphasise only the count phrase ("3 new threads") while keeping the sentence a single translatable
// unit: the full string keeps a literal {0} placeholder (no args passed) so translators control word
// order, then we split on {0} to slot the emphasised phrase back in.
const screenerBanner = computed(() => {
	const one = screenerCount.value === 1
	const phrase = one ? __('1 new thread') : __('{0} new threads', [String(screenerCount.value)])
	const sentence = one
		? __('{0} is waiting to be screened.')
		: __('{0} are waiting to be screened.')
	const [before, after] = sentence.split('{0}')
	return { phrase, before, after }
})
const goToScreener = () => router.push({ name: 'mail-screener', params: { accountId } })

// Cross-account search: when the search dialog's "all accounts" toggle was on, the flag rides along in
// the query (kept out of the filter conditions on the server). The merged results carry their owning
// account, so each row opens in — and acts within — its own account (see the row-action wrappers).
const isAllAccountsSearch = computed(() => mailbox === 'search' && route.query.all_accounts != null)

// The row's account, by its short name: blank for the currently open account (only
// the odd ones out get labelled), the local part otherwise, unless two accounts share one.
const shortAccountLabel = (name?: string | null) =>
	name ? (store.accountShortNames[name] ?? name) : undefined

// The mobile Search tab lands on this route with no query yet. There's nothing to fetch —
// an empty filter would run an unbounded search — so the list area shows a hint instead
// (all_accounts is scope, not a search condition, so it alone doesn't count as a query).
const hasSearchQuery = computed(() => Object.keys(route.query).some((k) => k !== 'all_accounts'))

// Null while a search is pending — the count is only known once the fetch resolves (set in the
// searchResults transform below, reset in resetThreads). Guards the title against a stale or zero count.
const searchTotal = ref<number | null>(null)

// The search dialog stores bare `YYYY-MM-DD` days in the route; the API listens UTC, so the
// day's bounds are resolved in the user's zone here at the request boundary (the URL stays clean).
const searchFilter = () => {
	const filter: Record<string, any> = { ...route.query }
	if (typeof filter.after === 'string' && filter.after) filter.after = utcDayStart(filter.after)
	if (typeof filter.before === 'string' && filter.before) filter.before = utcDayEnd(filter.before)
	return filter
}

// Reset resource for search: always the first window, over-fetching one row to drive `hasMore`.
const searchResults = createResource({
	url: 'suite.mail.api.mail.search_mails',
	makeParams: () => ({
		account: store.accountId,
		filter: searchFilter(),
		limit: PAGE_LENGTH + 1,
		start: 0,
		all_accounts: isAllAccountsSearch.value,
	}),
	transform: (data: [Thread[], number]) => {
		searchTotal.value = data[1] ?? 0
		return takeResetWindow(data[0])
	},
	onSuccess: () => {
		onResetSuccess()
		if (mailbox === 'search') isMailboxLoaded.value = true
	},
	// On failure the count never arrives, so clear the pending state instead of leaving the title stuck
	// on "Searching…" — the empty result list then reads as "0 results".
	onError: () => {
		searchTotal.value = 0
	},
})

watch(
	() => JSON.stringify(route.query),
	() => {
		if (mailbox === 'search') resetThreads()
	},
)

// Main data

// The remembered All/Unread/Starred/Has-attachments choice, its menu, and its own title (see
// useStoredFilter) — all shared with the merged All Inboxes list. Starred is not offered inside
// Trash, nor inside the Starred list itself, where it would filter a list to itself.
const { filter, reloadFilter, FILTER_OPTIONS, filterTitle } = useStoredFilter({
	scope: () => mailbox,
	onChange: () => resetThreads(false),
	starrable: () => ![mailboxIds.trash, 'starred'].includes(mailbox),
})

const isMailboxLoaded = ref(false)

// Reset resource for a mailbox: always the first window. Over-fetches one row (PAGE_LENGTH + 1) to
// detect whether more exist without relying on the (flaky) stored count.
const threads = createResource({
	url: 'suite.mail.api.mail.get_threads',
	makeParams: () => ({
		account: store.accountId,
		mailbox,
		limit: PAGE_LENGTH + 1,
		start: 0,
		filter_by: filter.value,
	}),
	transform: (data: [Thread[], string]) => takeResetWindow(data[0]),
	onSuccess: (data: [Thread[], string]) => {
		onResetSuccess()
		if (mailbox === data[1]) isMailboxLoaded.value = true
	},
})

const threadsResource = computed(() => (mailbox === 'search' ? searchResults : threads))

// The Trash/Junk "auto-deleted after 30 days" banner is about the whole mailbox, so show it whenever the
// mailbox has threads — or a filter is applied (the filtered view may be empty while the mailbox isn't).
// The layout below reserves height for it only when it's actually rendered, so the two stay in sync.
const showDeleteBanner = computed(
	() =>
		[mailboxIds.trash, mailboxIds.junk].includes(mailbox) &&
		!threadsResource.value.data?.loading &&
		(!!threadsResource.value.data?.length || !!filter.value) &&
		(showReadingPane.value || !threadID),
)

// ── Append fetches ──────────────────────────────────────────────────────────────────────────────
// The other half of the two fetch paths that write `threadsResource.value.data`: the reset resources
// above replace it (start:0), these push the next window onto it (via appendThreads). Kept separate so
// createResource's replace-on-reload never fights the append.

const loadMoreThreads = createResource({
	url: 'suite.mail.api.mail.get_threads',
	makeParams: () => ({
		account: store.accountId,
		mailbox,
		limit: PAGE_LENGTH + 1,
		start: threadsResource.value.data.length,
		filter_by: filter.value,
	}),
	onSuccess: (data: [Thread[], string]) => appendThreads(data[0]),
	onError: () => (loadingMore.value = false),
})

const loadMoreSearch = createResource({
	url: 'suite.mail.api.mail.search_mails',
	makeParams: () => ({
		account: store.accountId,
		filter: searchFilter(),
		limit: PAGE_LENGTH + 1,
		start: threadsResource.value.data.length,
		all_accounts: isAllAccountsSearch.value,
	}),
	onSuccess: (data: [Thread[], number]) => appendThreads(data[0]),
	onError: () => (loadingMore.value = false),
})

// Keep infinite scroll alive while the rendered list is too short to scroll (see topUpIfShort). Must
// stay below groupedRows: `watch` evaluates its source at setup.
watch(groupedRows, topUpIfShort)

const isLoading = computed(() => {
	// Search is one page: its header (input + filter chips) mounts immediately and stays put
	// across query changes — loading shows inline in the list area, never as the full spinner.
	// Checked first: entering the route resets isMailboxLoaded, which must not blank the view.
	if (mailbox === 'search') return false
	if (!isMailboxLoaded.value) return true
	if (emptyMailbox.loading) return true
	if (refillPending.value) return true
	return !threadsResource.value.data.length && threadsResource.value?.loading
})

// Reset-to-top: refetch only the first window, replacing the loaded list and scrolling to the top
// (via onResetSuccess). Bumping `epoch` discards any append/refresh still in flight. Used for
// mailbox/account switch, filter change, undo, and empty-mailbox.
const resetThreads: (reloadMailboxes?: boolean, mailboxRoles?: MailboxRole[]) => void = (
	reloadMailboxes = true,
	mailboxRoles = [],
) => {
	if (mailboxRoles.length && !mailboxRoles.map((m) => mailboxIds[m]).includes(mailbox)) return

	// This reload supersedes any pending refill (its own, or an interrupting mailbox switch); from here
	// the resource's `loading` drives isLoading, so the flag has done its job.
	refillPending.value = false
	beginReset()
	resetSelections()
	// Clear the previous search's count so the header doesn't show a stale total while the new fetch runs.
	if (mailbox === 'search') {
		searchTotal.value = null
		// No query yet (the Search tab's landing state): skip the fetch and settle the count
		// so nothing sits on "Searching…".
		if (!hasSearchQuery.value) {
			searchTotal.value = 0
			return
		}
	}
	threadsResource.value.reload()
	if (reloadMailboxes) mailboxes.reload()
}

// Check for new mail without losing the reader's place: refetch the newest window and prepend only the
// threads not already loaded (see onResetSuccess), keeping scroll position and the loaded rows. Used by
// the Refresh button, the periodic poll, and the new-mail socket. Selections are preserved.
const refreshThreads = (reloadMailboxes = true) => {
	if (!beginRefresh()) return
	threadsResource.value.reload()
	if (reloadMailboxes) mailboxes.reload()
}

// After an optimistic action whose threads stay in the list (add-to-mailbox, or a move that leaves
// copies in the current mailbox): refresh selections + sidebar counts only, never refetch the list.
const syncAfterAction = () => {
	resetSelections()
	mailboxes.reload()
}

// Drops threads from the loaded list optimistically and returns the removed rows (so an undo can put
// them back). Their server rows leave the current view too, so the append offset (data.length) stays
// aligned.
const removeThreadsFromList = (thread_ids: string[]): Thread[] => {
	const data = threadsResource.value.data ?? []
	const removed = data.filter((thread: Thread) => thread_ids.includes(thread.thread_id))
	threadsResource.value.data = data.filter(
		(thread: Thread) => !thread_ids.includes(thread.thread_id),
	)
	// Suppress re-insertion by an in-flight refresh/append until the server-side removal lands.
	suppressRemoved(thread_ids)
	// If this emptied the list but more exist, a refill is coming (refillIfEmpty, once the mutation
	// lands) — flag it so the empty state doesn't flash in the meantime.
	if (!threadsResource.value.data.length && hasMore.value) refillPending.value = true
	return removed
}

// When an optimistic removal empties the loaded list while more threads exist server-side (e.g. select
// all + delete/move), refetch the first window so the view refills — the sentinel unmounts with an empty
// list and couldn't otherwise re-trigger a load. Must run *after* the server mutation lands: a reset
// mid-request refetches start:0 and gets the same not-yet-removed rows back (they'd reappear).
const refillIfEmpty = () => {
	if (!threadsResource.value.data.length && hasMore.value) resetThreads()
	// resetThreads sets the resource loading (so isLoading holds the spinner from here); clear the flag.
	refillPending.value = false
}

// Re-insert threads (after undoing a move/junk) at their correct position by received_at, so they
// return to where they were instead of jumping to the top. Scroll stays put — the browser's
// scroll-anchoring holds the viewport as rows reappear above it.
const restoreThreadsToList = (restored: Thread[]) => {
	if (!restored.length) return
	// Rows are back (removal failed / undo), so no refill is coming — drop the pending-refill hold.
	refillPending.value = false
	// A restored thread should be visible again — lift any removal suppression.
	unsuppressRemoved(restored.map((t: Thread) => t.thread_id))
	const list = [...(threadsResource.value.data ?? [])]
	const present = new Set(list.map((t: Thread) => t.thread_id))
	for (const thread of restored) {
		if (present.has(thread.thread_id)) continue
		// The list is sorted newest-first; drop the thread before the first older row.
		const idx = list.findIndex((t: Thread) => t.received_at < thread.received_at)
		idx === -1 ? list.push(thread) : list.splice(idx, 0, thread)
	}
	threadsResource.value.data = list
}

watch(
	() => [mailbox, accountId],
	(_new, old) => {
		// Opening a result in an all-accounts search switches the route's account (so the reading pane
		// loads the thread from the right account) while the mailbox stays 'search'. The merged list spans
		// every account, so a mere account switch mustn't reset it — keep the results and scroll position.
		if (isAllAccountsSearch.value && mailbox === 'search' && old?.[0] === 'search') return

		isMailboxLoaded.value = false
		threadsResource.value.data = []
		reloadFilter()
		focusedRowKey.value = undefined
		collapsedGroups.value = []
		// Stacks re-collapse on a mailbox switch. Note a *filter* change deliberately doesn't clear
		// this: stale ids are inert (a run is expanded only if one of its current members is listed),
		// and keeping them means toggling Unread→All doesn't re-collapse a stack you just opened.
		expandedStacks.value = new Set()
		resetThreads(false)
	},
	{ immediate: true },
)

// Periodically refresh the mailbox list (keeps sidebar counts current), then merge in new threads only
// when the mailbox's message count actually changed — so a quiet mailbox isn't touched (and the reader
// isn't disturbed) every 30s.
//
// Messages, not threads: a reply landing in a thread that's already here leaves total_threads flat, so
// gating on that count made this backstop blind to exactly the arrivals the socket exists to deliver.
const pollForChanges = async () => {
	const prevTotal = mailboxObj.value?.total_emails
	await mailboxes.reload()
	if (mailboxObj.value?.total_emails !== prevTotal) refreshThreads(false)
}

onMounted(() => {
	window.addEventListener('keydown', handleKeyDown)
	window.addEventListener('keyup', handleKeyUp)
	reloadInterval.value = setInterval(pollForChanges, 30000)

	socket.on('new_mail_created', (updatedMailboxes: string[]) => {
		if (updatedMailboxes.includes(mailbox)) refreshThreads()
	})

	socket.on('mail_exchange_completed', (payload: { success: boolean; message: string }) =>
		raiseToast(payload.message, payload.success ? 'success' : 'error'),
	)

	socket.on('calendar_exchange_completed', (payload: { success: boolean; message: string }) =>
		raiseToast(payload.message, payload.success ? 'success' : 'error'),
	)
})

onUnmounted(() => {
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	if (reloadInterval.value) clearInterval(reloadInterval.value)
	// Leaving the mailbox drops any pending undo so a lingering toast can't undo into another view.
	setUndoAction(undefined)
})

const goToMailbox = () =>
	router.push({ name: 'mail-mailbox', params: { accountId, mailbox }, query: route.query })

const goToThread = (threadID: string) => {
	threadSlide.value = pendingThreadSlide
	if (threadID)
		router.push({ name: 'mail-mail', params: { accountId, mailbox, threadID }, query: route.query })
}

const goToThreadByOffset = (offset: number) => {
	const next = threadByOffset(offset)
	if (next) return goToThread(next)
	loadMoreThenOpenEdge(offset, 'open')
}

// Swipe on the open thread (mobile): left → next thread, right → previous.
const { onTouchStart: onThreadTouchStart, onTouchEnd: onThreadTouchEnd } = useSwipeNav(
	() => isMobile.value && !!threadID,
	(offset) => {
		// Arms the paging animation for this navigation only — goToThread consumes it, so
		// taps/arrows (which never set it) keep swapping instantly.
		pendingThreadSlide = offset > 0 ? 'page-next' : 'page-prev'
		goToThreadByOffset(offset)
		pendingThreadSlide = ''
	},
)

// MailThread's slide name while a swipe navigation renders; cleared on its slide-done
// (and left empty for every other thread change, which should swap instantly).
const threadSlide = ref('')
let pendingThreadSlide = ''

const goToNextThreadOrMailbox = (excludedThreads: string[] = []) => {
	const idx = threadIDs.value.indexOf(threadID)
	const next = threadIDs.value.slice(idx + 1).find((id) => !excludedThreads.includes(id))
	if (next) goToThread(next)
	else goToMailbox()
}

// Actions

const {
	handleSetSeen,
	handleSyncUnseen,
	setFlaggedByThreadIDs,
	handleMoveThreads,
	handleSetSpamStatus,
	handleAddThreadsToMailbox,
	handleRemoveThreadsFromMailbox,
	junkOrDeleteThreads,
	handleMailMove,
	handleMailSpam,
	handleMailDelete,
	setFlagged,
	moveToOptions,
	addToOptions,
	removeFromOptions,
	showAddTo,
	showRemoveFrom,
	showJunkOrDeleteThreads,
	junkOrDeleteThreadsOptions,
} = useThreadActions({
	threadsResource,
	mailbox: computed(() => mailbox),
	threadID: computed(() => threadID),
	selections,
	mailThreadRef,
	resetThreads,
	syncAfterAction,
	removeThreadsFromList,
	restoreThreadsToList,
	refillIfEmpty,
	goToMailbox,
	goToNextThreadOrMailbox,
})

// ── Cross-account search row actions ──────────────────────────────────────────────────────────────
// In an all-accounts search the merged rows can belong to any account, so the shared handlers above
// (which target the single active account) can't drive them. These act on each row's own account via
// stateless call()s — mirroring the All Inboxes view — with the active account left untouched. Star and
// read/unread update optimistically in place; archive/trash re-run the search on success, since a
// result's membership is server-determined (an archived mail may still match the query). Delete is
// account-agnostic (it targets Mail Message names), so it stays on the shared junk/delete flow below.
const crossAccountSetSeen = (mail: Thread, seen: boolean) => {
	if (mail.seen === (seen ? 1 : 0)) return
	mail.seen = seen ? 1 : 0
	call('suite.mail.api.mail.set_mails_seen', { account: mail.account, ids: [mail.id], seen })
		.then(() => mailboxes.reload())
		.catch((error) => {
			mail.seen = seen ? 0 : 1 // revert the optimistic update
			raiseToast(error?.messages?.[0] || error?.message, 'error')
		})
}

const crossAccountSetFlagged = (mail: Thread, flagged: boolean) => {
	if (mail.flagged === (flagged ? 1 : 0)) return
	mail.flagged = flagged ? 1 : 0
	call('suite.mail.api.mail.set_flagged', {
		account: mail.account,
		ids: [mail.id],
		flagged,
	}).catch((error) => {
		mail.flagged = flagged ? 0 : 1 // revert the optimistic update
		raiseToast(error?.messages?.[0] || error?.message, 'error')
	})
}

const crossAccountMoveOut = (
	mail: Thread,
	target: string | undefined,
	loading: string,
	success: string,
	missing: string,
) => {
	if (!target) return raiseToast(missing, 'error')
	raisePromiseToast(
		() =>
			call('suite.mail.api.mail.move_mails', {
				account: mail.account,
				ids: [mail.id],
				mailbox: target,
				clear_junk: true,
			}).then(() => resetThreads(false)),
		loading,
		success,
	)
}

// Route a list row's action to the cross-account handler in an all-accounts search, else to the shared
// active-account handler (keeping single-account search behaviour identical).
const rowSetSeen = (mail: Thread, seen: boolean) =>
	isAllAccountsSearch.value
		? crossAccountSetSeen(mail, seen)
		: handleSetSeen({ [Number(seen)]: [mail.thread_id] })

const rowSetFlagged = (mail: Thread, flagged: boolean) =>
	isAllAccountsSearch.value
		? crossAccountSetFlagged(mail, flagged)
		: setFlaggedByThreadIDs([mail.thread_id], flagged)

const rowArchive = (mail: Thread) =>
	isAllAccountsSearch.value
		? crossAccountMoveOut(
				mail,
				mail.archive,
				__('Archiving...'),
				__('Thread archived.'),
				__('No Archive folder for this account.'),
			)
		: mailbox === mailboxIds.sent
			? handleAddThreadsToMailbox(mailboxIds.archive, [mail.thread_id])
			: handleMoveThreads({ [mailboxIds.archive]: [mail.thread_id] })

const rowTrash = (mail: Thread) =>
	isAllAccountsSearch.value
		? crossAccountMoveOut(
				mail,
				mail.trash,
				__('Moving to Trash...'),
				__('Thread moved to Trash.'),
				__('No Trash folder for this account.'),
			)
		: handleMoveThreads({ [mailboxIds.trash]: [mail.thread_id] })

// A stack's hover actions apply to its whole run in one operation — one request, one toast, one undo,
// rather than N of each. The row's own tooltips name the count. These take the same paths as the
// selection toolbar's bulk actions, and are safe to key off the active account because stacks are
// disabled in all-accounts search (see stackingEnabled).

const stackIDs = (threads: Thread[]) => threads.map((t) => t.thread_id)

const stackSetSeen = (threads: Thread[], seen: boolean) =>
	handleSetSeen({ [Number(seen)]: stackIDs(threads) })

const stackArchive = (threads: Thread[]) =>
	mailbox === mailboxIds.sent
		? handleAddThreadsToMailbox(mailboxIds.archive, stackIDs(threads))
		: handleMoveThreads({ [mailboxIds.archive]: stackIDs(threads) })

const stackTrash = (threads: Thread[]) =>
	handleMoveThreads({ [mailboxIds.trash]: stackIDs(threads) })

const stackDelete = (threads: Thread[]) => junkOrDeleteThreads(stackIDs(threads), false)

const showEmptyMailbox = ref(false)

const emptyMailbox = createResource({
	url: 'suite.mail.api.mail.empty_user_mailbox',
	makeParams: () => ({ account: store.accountId, mailbox }),
	onSuccess: () => {
		threadsResource.value.data = []
		raiseToast(__('{0} emptied.', [mailboxName.value]))
		resetThreads()
	},
	onError: (error) => raiseToast(error.message, 'error'),
})

const emptyMailboxOptions = computed(() => ({
	title: __('Empty {0}', [mailboxName.value]),
	message: __(`Are you sure you want to empty the contents of this mailbox?`),
	icon: { name: 'alert-triangle', appearance: 'warning' },
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid',
			onClick: () => {
				emptyMailbox.submit()
				showEmptyMailbox.value = false
			},
		},
	],
}))

// UI formatting

const mailboxName = computed(() => {
	switch (mailbox) {
		case 'starred':
			return __('Starred')
		case 'search':
			return __('Search')
		default:
			return mailboxObj.value?._name
	}
})
const unreadThreadsPrefix = computed(() =>
	mailboxObj.value?.unread_threads ? `(${mailboxObj.value.unread_threads})` : '',
)

const currentThread = computed(() =>
	threadsResource.value?.data?.find((t: Thread) => t.thread_id === threadID),
)

usePageMeta(() => {
	if (threadID) return { title: currentThread.value?.subject || __('[No Subject]') }
	return { title: `${unreadThreadsPrefix.value} ${mailboxName.value}` }
})

const title = computed(() => {
	if (selections.value.length)
		return selections.value.length === 1
			? __('1 item selected')
			: __('{0} items selected', [String(selections.value.length)])

	if (mailbox === 'search') {
		// Null until the current search resolves — show a neutral label rather than a stale/zero count.
		if (searchTotal.value === null) return __('Searching…')
		return searchTotal.value === 1
			? __('1 result')
			: __('{0} results', [String(searchTotal.value)])
	}

	return filterTitle.value
})

// The search modal lives in HeaderActions but is opened from two places — its own button, and the
// search view's header — so its state sits here, between them. Everything else about the query surface
// belongs to SearchResultsHeader.
const showSearchModal = ref(false)
const showSearchAdvanced = ref(false)
const searchEditFilter = ref('')

const threadCount = computed(() => {
	const count = mailboxObj.value?.total_threads
	return count ? count.toLocaleString() : ''
})
</script>

<style scoped>
.checkbox-hitbox:hover :deep(input[type='checkbox']) {
	@apply shadow-sm;
	border-color: var(--outline-gray-7);
}


</style>
