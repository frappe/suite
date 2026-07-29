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
				? 'h-[calc(100dvh-6.1rem)]'
				: 'h-[calc(100dvh-3.05rem)]'
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
			<div
				ref="mailSidebar"
				class="sticky top-16 flex flex-col border-r"
				:class="!isMobile && showReadingPane ? 'w-1/3' : 'w-full'"
			>
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
							:disabled="threadsResource?.loading || loadingMore"
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
						<div
							v-if="groupMessagesBy !== 'None' && !isMobile"
							class="text-ink-gray-6 group flex items-center border-b border-l-transparent p-3.5 text-xs-semibold sm:border-l sm:px-5"
							:class="{
								'!bg-surface-blue-1': isGroupSelected(key),
								'sm:hover:bg-surface-gray-1': !isLastGroup(key),
								'!border-l-outline-blue-5': focusedRowKey === `group:${key}`,
							}"
							:data-row-key="`group:${key}`"
							@click="toggleGroupCollapse(key)"
						>
							<!-- Mobile: group select ("all of Today") appears only in selection mode. -->
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

							<span class="select-none pt-[2px]">
								{{ getFormattedDate(key, groupMessagesBy === 'Month').toUpperCase() }}
							</span>

							<component
								:is="collapsedGroups.includes(key) ? ChevronRight : ChevronDown"
								v-if="!isLastGroup(key)"
								class="icon ml-auto"
							/>
						</div>
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
									class="border-l-transparent sm:border-l"
									:class="{ '!border-l-outline-blue-5': row.key === focusedRowKey }"
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
										isAllAccountsSearch ? row.thread.account_name : undefined
									"
									:selectable="!isAllAccountsSearch"
									:selection-mode="mobileSelectionMode"
									:is-selected="selections.includes(row.thread.thread_id)"
									:hide-sender="row.inStack"
									class="border-l-transparent sm:border-l"
									:class="{
										'!bg-surface-blue-1':
											row.thread.thread_id === threadID && !isMobile,
										'!border-l-outline-blue-5': row.key === focusedRowKey,
										'!pl-10 sm:!pl-12': row.inStack,
									}"
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
			</div>
			<div class="flex cursor-col-resize justify-center" @mousedown="startResizing">
				<div
					ref="resizer"
					class="group-hover:bg-surface-gray-8 h-full rounded-full transition-all duration-300 ease-in-out"
				/>
			</div>

			<!-- Mail thread -->
			<!-- Mobile opens as a page push (iOS-style slide from the right): the pane
			     stays mounted and slides via transform, so close animates too.
			     visibility rides the same transition — it flips only after the
			     slide-out ends, keeping the offscreen pane out of the focus order.
			     Teleported to body on mobile (like the selection bar): inside the
			     layout's isolate stacking context the remounting tab bar would paint
			     over the pane during the slide-out. -->
			<Teleport to="body" :disabled="!isMobile">
			<div
				class="bg-surface-base"
				:class="{
					'overflow-hidden': isMobile,
					'w-2/3': !isMobile && showReadingPane,
					'absolute bottom-0 left-0 right-0 top-0': !isMobile && !showReadingPane,
					'fixed inset-0 z-20 transition-[transform,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]':
						isMobile,
					'invisible translate-x-full': isMobile && !threadID,
					hidden: !isMobile && !showReadingPane && !threadID,
				}"
				@touchstart.passive="onThreadTouchStart"
				@touchend.passive="onThreadTouchEnd"
			>
				<!-- The swipe slide lives inside MailThread (its toolbar must not move), armed
				     via `slide` per swipe and cleared on slide-done. The scroll wrapper must be
				     h-full on desktop too, or the empty state's h-full collapses. -->
				<div class="h-full overflow-y-auto">
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
				</div>
			</div>
			</Teleport>
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

	<ShortcutsModal v-model="showShortcuts" />
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntersectionObserver } from '@vueuse/core'
import {
	Archive,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	Ellipsis,
	FolderInput,
	FolderMinus,
	FolderPlus,
	LoaderCircle,
	Mail as MailIcon,
	MailOpen,
	Mails,
	Paperclip,
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
	getFormattedDate,
	isMac,
	raisePromiseToast,
	raiseToast,
	shouldIgnoreKeypress,
	startResizing,
	stripShortcutHint,
} from '@/apps/mail/utils'
import {
	useMobileSelection,
	useScreenSize,
	useSwipeNav,
	useUndo,
} from '@/apps/mail/utils/composables'
import { rangeSelection } from '@/apps/mail/utils/rangeSelection'
import { buildListRows } from '@/apps/mail/utils/threadStacks'
import { useThreadActions } from '@/apps/mail/utils/useThreadActions'
import { type MailboxRole, userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import LoadingBar from '@/apps/mail/components/LoadingBar.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import ScreenedEmailAddressModal from '@/apps/mail/components/Modals/ScreenedEmailAddressModal.vue'
import SearchResultsHeader from '@/apps/mail/components/SearchResultsHeader.vue'
import ShortcutsModal from '@/apps/mail/components/Modals/ShortcutsModal.vue'
import StackListItem from '@/apps/mail/components/StackListItem.vue'

import type { MailboxData, Thread, UserResource } from '@/apps/mail/types'
import type { ListRow, StackRow } from '@/apps/mail/utils/threadStacks'

// A date header, the one navigable row the list draws itself rather than getting from buildListRows —
// which is deliberately date-agnostic, so this type belongs here rather than in threadStacks.
type GroupRow = { type: 'group'; key: string; dateKey: string }
type NavRow = ListRow | GroupRow

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
const dayjs = inject('$dayjs')

const store = userStore()
const { mailboxes, mailboxIds } = store

// Appearance

const showReadingPane = computed(() => !!user.data?.show_reading_pane)
const groupMessagesBy = computed(() => user.data.group_messages_by)

// Thread Groups

const groupedThreads = computed<Record<string, Thread[]>>(() =>
	threadsResource.value?.data?.reduce((groups: Record<string, Thread[]>, thread: Thread) => {
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
	// The cursor follows the click, as it does when you open a mail: Enter and a click are the same
	// gesture on the same row, and Enter can only mean that if the cursor is already there. Above the
	// last-group guard, so clicking a header that can't fold still takes the cursor.
	focusedRowKey.value = `group:${key}`
	if (isLastGroup(key)) return

	if (collapsedGroups.value.includes(key))
		return (collapsedGroups.value = collapsedGroups.value.filter((d) => d !== key))

	collapsedGroups.value.push(key)
	// Collapsing keeps the group's selection: "collapse a day, tick it, archive it" is a bulk move
	// worth having, and the header's own checkbox goes on showing that the day is selected. Only the
	// reading pane has to move, since it would otherwise point at a row that is no longer rendered.
	if (groupedThreads.value[key]?.some((thread) => thread.thread_id === threadID)) goToMailbox()
}

const getGroupThreads = (group: string) => groupedThreads.value[group]?.map((t) => t.thread_id)

watch(groupMessagesBy, () => (collapsedGroups.value = []))

// Thread Stacks
//
// A run of adjacent look-alike threads from one sender collapses into a single row, so a chatty
// notification sender can't bury the rest of the mailbox. This is a display layer over groupedThreads:
// runs are detected within a date group and never span one.

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

// The thread_ids of every member of every expanded stack. In-memory only — stacks re-collapse on a
// mailbox switch. Keyed by member id rather than by stack key so a run keeps its expanded state as it
// grows in either direction (appended by infinite scroll, prepended by a refresh), and so routing to a
// thread can expand its stack without having to locate the run first.
const expandedStacks = ref(new Set<string>())

const isRunExpanded = (run: Thread[]) => run.some((t) => expandedStacks.value.has(t.thread_id))

const rowKeyOf = (mail: Thread) =>
	isAllAccountsSearch.value ? `${mail.account}:${mail.name}` : mail.name

const groupedRows = computed<Record<string, ListRow[]>>(() =>
	Object.fromEntries(
		Object.entries(groupedThreads.value ?? {}).map(([key, group]) => [
			key,
			buildListRows(group, {
				rowKey: rowKeyOf,
				isExpanded: isRunExpanded,
				enabled: stackingEnabled.value,
			}),
		]),
	),
)

// The rows the list actually renders, in visual order. The cursor walks these rather than the flat list
// of loaded threads, so it can never land on a row that isn't on screen: a collapsed stack is a single
// stop (its members aren't rendered), and a collapsed date group contributes only its header.
//
// Headers exist only when the user groups by day or month; with grouping off none are rendered, and
// collapsedGroups is provably empty there because only a header's own click can fill it.
const navigableRows = computed<NavRow[]>(() => {
	const rows: NavRow[] = []
	for (const [dateKey, groupRows] of Object.entries(groupedRows.value)) {
		if (groupMessagesBy.value !== 'None')
			rows.push({ type: 'group', key: `group:${dateKey}`, dateKey })
		if (collapsedGroups.value.includes(dateKey)) continue
		rows.push(...groupRows)
	}
	return rows
})

const focusedRow = computed(() => navigableRows.value.find((row) => row.key === focusedRowKey.value))

// Every thread a row stands for: one for a thread row, the whole run for a stack, the whole day for a
// header — mirroring exactly what each row's own checkbox selects.
const rowThreadIDs = (row: NavRow): string[] =>
	row.type === 'thread'
		? [row.thread.thread_id]
		: row.type === 'stack'
			? row.threads.map((t) => t.thread_id)
			: (getGroupThreads(row.dateKey) ?? [])

const toggleStack = (row: StackRow) => {
	const ids = row.threads.map((t) => t.thread_id)
	// The cursor follows the click, as it does when you open a mail. This also covers the fold: the
	// members are about to be hidden, so the stack row that now stands for them is where the cursor
	// belongs, and Enter-fold-Enter-unfold stays a round trip rather than a way to lose your place.
	focusedRowKey.value = row.key
	if (!row.expanded) return ids.forEach((id) => expandedStacks.value.add(id))

	ids.forEach((id) => expandedStacks.value.delete(id))
	// Don't leave the reading pane pointing at a row we just hid — the same reason toggleGroupCollapse
	// leaves the thread when its group collapses.
	if (threadID && ids.includes(threadID)) goToMailbox()
}

// Derived rather than stored, mirroring isGroupSelected: it can never drift from `selections`, and
// every existing path that mutates them (Cmd+A, Esc, resetSelections, shift+arrow, a member's own
// checkbox) keeps the stack checkbox honest for free.
const isStackSelected = (threads: Thread[]) =>
	threads.every((t) => selections.value.includes(t.thread_id))

// The keyboard cursor, as a row key (see navigableRows). A row key rather than a thread id because the
// cursor can sit on a stack row or a date header, neither of which is a thread — and one ref rather
// than two so the cursor can never be in two places at once.
const focusedRowKey = ref<string>()

watch(
	() => threadID,
	(val) => {
		if (!val) return

		// A deep link or a step to the next thread can land inside a collapsed stack — surface it, just
		// as a collapsed date group opens below. An opened thread is always visible in the list.
		expandedStacks.value.add(val)

		setTimeout(() => focusOnThread(val))
		for (const group of collapsedGroups.value) {
			if (getGroupThreads(group).includes(val))
				return (collapsedGroups.value = collapsedGroups.value.filter((d) => d !== group))
		}
	},
	{ immediate: true },
)

// Selection

const mailThreadRef = useTemplateRef('mailThread')
const mailListRef = useTemplateRef('mailList')

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

// An in-progress shift+arrow range: where it began (every thread that row stands for) and what was
// already selected then. Held across steps so each one recomputes anchor..cursor (see rangeSelection)
// instead of toggling the rows it passes — the toggle was asymmetric, shrinking the range from below
// dropped both the row being left and the row being entered.
const keyboardRange = ref<{ anchorIDs: string[]; base: string[] }>()

const isAllSelected = computed(
	() => threadIDs.value.length && selections.value.length === threadIDs.value.length,
)

// Selecting no longer forces a collapsed date group or stack open. Ticking either one is how you act
// on the whole set at once — collapse the pile, tick, archive — and expanding it on tick would undo
// exactly the thing being asked for, at the worst moment. Nothing is concealed by staying collapsed:
// the header or stack row shows its own checkbox ticked, and the toolbar counts individual threads.

const toggleSelect = (threadIDs: string[], selected: boolean) => {
	const allIDs = new Set([...threadIDs, ...getShiftSelectedIDs(threadIDs[0])])
	if (selected) selections.value = [...new Set([...selections.value, ...allIDs])]
	else selections.value = selections.value.filter((id) => !allIDs.has(id))
	lastSelected.value = threadIDs
	// Ticking a box is a fresh starting point: the next shift+arrow anchors here rather than extending
	// a range the pointer has since moved away from.
	keyboardRange.value = undefined
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
	keyboardRange.value = undefined
}

const resetSelections = () => {
	selections.value = []
	lastSelected.value = undefined
	keyboardRange.value = undefined
}

const isGroupSelected = (key: string) =>
	getGroupThreads(key).every((id) => selections.value.includes(id))

// Shortcuts

const showShortcuts = ref(false)

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const isShiftPressed = ref(false)
const isGPressed = ref(false)
const gPressTimeout = ref<ReturnType<typeof setTimeout>>()
const reloadInterval = ref<ReturnType<typeof setInterval>>()

const handleKeyDown = (e: KeyboardEvent) => {
	isShiftPressed.value = e.shiftKey
	const key = e.key.toLowerCase()

	// Handle Ctrl/Cmd+A (Select All)
	if ((e.metaKey || e.ctrlKey) && key === 'a' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		isGPressed.value = false
		return toggleSelectAll(true)
	}

	// Handle Ctrl/Cmd+Z (Undo)
	if ((e.metaKey || e.ctrlKey) && key === 'z' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		isGPressed.value = false
		return undo()
	}

	if (shouldIgnoreKeypress(e)) return

	if (key === 'g') return handleGKeyPress(e)
	if (isGPressed.value) return handleGMenuNavigation(e, key)
	if (key === 'enter') return handleEnter(e)
	if (key === 'escape') return handleEscape(e)
	if (key === '?') return handleShowShortcuts(e)

	const hasSelection = selections.value.length > 0 || threadID
	if (hasSelection) handleThreadActions(e, key)
	handleArrowNavigation(e, key)
}

const handleGKeyPress = (e: KeyboardEvent) => {
	clearTimeout(gPressTimeout.value)

	// The reading pane walks threads, so it names one; the list walks rows, so it takes the edge row —
	// which is the day's header when one sits above the first mail.
	if (e.shiftKey) {
		if (threadID) return goToThread(threadIDs.value.at(-1))
		return focusRow(navigableRows.value.at(-1))
	}

	if (isGPressed.value) {
		isGPressed.value = false
		if (threadID) return goToThread(threadIDs.value[0])
		return focusRow(navigableRows.value[0])
	}

	isGPressed.value = true
	gPressTimeout.value = setTimeout(() => (isGPressed.value = false), 750)
}

const handleGMenuNavigation = (e: KeyboardEvent, key: string) => {
	isGPressed.value = false

	const navigationMap: Record<string, string> = {
		i: mailboxIds.inbox,
		f: 'starred',
		s: mailboxIds.sent,
		d: mailboxIds.drafts,
		j: mailboxIds.junk,
		a: mailboxIds.archive,
		t: mailboxIds.trash,
	}

	const mailboxId = navigationMap[key]
	if (mailboxId) {
		e.preventDefault()
		router.push({ name: 'mail-mailbox', params: { accountId, mailbox: mailboxId } })
	}
}

const handleShowShortcuts = (e: KeyboardEvent) => {
	e.preventDefault()
	showShortcuts.value = true
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
	const navigationKeys = ['arrowup', 'arrowdown', 'j', 'k']
	if (!navigationKeys.includes(key)) return

	e.preventDefault()

	const offset = ['arrowup', 'k'].includes(key) ? -1 : 1
	// Where a range would begin if this keypress starts one: the threads being stepped off — the open
	// thread in the reading pane, everything the cursor's row stands for in the list.
	const fromIDs = threadID ? [threadID] : focusedRow.value ? rowThreadIDs(focusedRow.value) : []

	let newIDs: string[] = []

	// At the last loaded thread, stepping further loads the next window (like the ThreadHeader arrows).
	// newIDs stays the in-list target (empty at the edge), so shift-select skips the crossing — the
	// appended thread resolves asynchronously and a reset would clear selections anyway.
	if (threadID) {
		// The reading pane walks threads rather than rows: opening one always reveals it, so it can
		// never land on something hidden (see the threadID watcher).
		const next = getThreadByOffset(offset)
		goToThreadByOffset(offset)
		if (next) newIDs = [next]
	} else {
		const rows = navigableRows.value
		// A cursor whose row is gone — folded away, or removed by a mutation — restarts at the top.
		const index = rows.findIndex((row) => row.key === focusedRowKey.value)
		const next = index === -1 ? rows[0] : rows[index + offset]

		if (next) {
			focusRow(next)
			newIDs = rowThreadIDs(next)
		} else if (index !== -1) loadMoreThenOpenEdge(offset, 'focus')
	}

	// Handle shift+arrow selection. A row carries every thread it stands for, so shifting onto a stack
	// takes its whole run and onto a header takes the day — the same sets their checkboxes select.
	// Moving without Shift ends the range, so the next one anchors where the cursor now is.
	if (!isShiftPressed.value) return (keyboardRange.value = undefined)
	if (!newIDs.length) return

	const { anchorIDs, base } = (keyboardRange.value ??= {
		anchorIDs: fromIDs,
		base: [...selections.value],
	})
	selections.value = rangeSelection(threadIDs.value, anchorIDs, newIDs, base)
	// A shift+click afterwards extends from wherever the keyboard left the cursor.
	lastSelected.value = newIDs
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

// Infinite-scroll state (shared by the threads and search resources — only one is active at a time)
const PAGE_LENGTH = 25
const hasMore = ref(false) // lookahead: the last fetched window returned an extra row, so more exist
const loadingMore = ref(false) // an append fetch is in flight (drives the bottom spinner)
// An optimistic removal emptied the list but more threads exist, so a refill is coming once the server
// mutation lands. Keeps the loading state (not the empty state) during the gap before the refill fetch.
const refillPending = ref(false)
// Bumped on every reset-to-top; an in-flight append captures it and discards its result if it changed
// meanwhile, so a stale window can't land on a freshly reset list.
const epoch = ref(0)
let loadEpoch = 0 // epoch captured when the current append was triggered
// Refresh ("check for new mail") state: merges the newest window into the loaded list, preserving
// scroll — set while such a reload is in flight so its onSuccess prepends instead of replacing.
const refreshMode = ref(false)
let refreshEpoch = 0 // epoch captured when the refresh was triggered (dropped if a reset intervenes)
// The loaded list to merge the fresh window into. Captured at *response* time (in the resource
// transform), not refresh-start, so it reflects any optimistic removals/undo-inserts that happened
// while the refresh was in flight — otherwise a thread archived mid-refresh would reappear.
let refreshSnapshot: Thread[] = []
// Thread ids optimistically removed by an action whose request is still in flight. The server still
// returns these for a moment, so a refresh/append landing in that window would re-insert the row; the
// merges below skip them. Cleared on rollback (restoreThreadsToList) and after a short timeout.
const recentlyRemoved = new Set<string>()
// Current mailbox's record (carries total_threads/unread_threads); used by the periodic poll to
// detect count changes and by the tab title's unread badge.
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

const scrollListToTop = () => mailListRef.value?.scrollTo({ top: 0 })

// Called when a first-window fetch resolves. Two modes:
// - refresh: keep the loaded rows, prepend only threads not already loaded (new mail), and hold the
//   reader's scroll position (re-anchored by the height the prepended rows added).
// - reset: reveal the fresh first window and scroll to top (mailbox switch, filter, undo, …).
// Either way, cancel any pending edge navigation.
const onResetSuccess = () => {
	pendingEdgeThread = null

	if (refreshMode.value) {
		refreshMode.value = false
		// A reset (mailbox switch, filter, undo) raced in and bumped the epoch — drop this stale merge.
		if (refreshEpoch !== epoch.value) return
		// Anchor to the current scroll before merging. The window replaced `data` a beat ago but the DOM
		// hasn't re-rendered yet, so these still reflect the loaded list the reader is looking at.
		const el = mailListRef.value
		const prevTop = el?.scrollTop ?? 0
		const prevHeight = el?.scrollHeight ?? 0
		const freshWindow = threadsResource.value.data ?? []
		const existing = new Set(refreshSnapshot.map((t) => t.thread_id))
		const fresh = freshWindow.filter(
			(t: Thread) => !existing.has(t.thread_id) && !recentlyRemoved.has(t.thread_id),
		)
		threadsResource.value.data = [...fresh, ...refreshSnapshot]
		// Keep the reader where they were: shift scroll by the height the prepended rows added. If they
		// were already at the top, leave them there so the new mail is visible.
		nextTick(() => {
			if (el && prevTop > 0) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
		})
		return
	}

	scrollListToTop()
}

// Cross-account search: when the search dialog's "all accounts" toggle was on, the flag rides along in
// the query (kept out of the filter conditions on the server). The merged results carry their owning
// account, so each row opens in — and acts within — its own account (see the row-action wrappers).
const isAllAccountsSearch = computed(() => mailbox === 'search' && route.query.all_accounts != null)

// The mobile Search tab lands on this route with no query yet. There's nothing to fetch —
// an empty filter would run an unbounded search — so the list area shows a hint instead
// (all_accounts is scope, not a search condition, so it alone doesn't count as a query).
const hasSearchQuery = computed(() => Object.keys(route.query).some((k) => k !== 'all_accounts'))

// Null while a search is pending — the count is only known once the fetch resolves (set in the
// searchResults transform below, reset in resetThreads). Guards the title against a stale or zero count.
const searchTotal = ref<number | null>(null)

// Reset resource for search: always the first window, over-fetching one row to drive `hasMore`.
const searchResults = createResource({
	url: 'suite.mail.api.mail.search_mails',
	makeParams: () => ({
		account: store.accountId,
		filter: route.query,
		limit: PAGE_LENGTH + 1,
		start: 0,
		all_accounts: isAllAccountsSearch.value,
	}),
	transform: (data: [Thread[], number]) => {
		if (refreshMode.value) refreshSnapshot = threadsResource.value.data ?? []
		hasMore.value = data[0].length > PAGE_LENGTH
		searchTotal.value = data[1] ?? 0
		return data[0].slice(0, PAGE_LENGTH)
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

const filter = ref<string | null>(
	localStorage.getItem(`user:${user.data.name}:filter:${mailbox}`) || null,
)
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
	transform: (data: [Thread[], string]) => {
		// In refresh mode, snapshot the live loaded list now — before this window replaces it — so the
		// merge in onResetSuccess reflects any optimistic removals/undo-inserts made during the fetch.
		if (refreshMode.value) refreshSnapshot = threadsResource.value.data ?? []
		const rows = data[0]
		hasMore.value = rows.length > PAGE_LENGTH
		return rows.slice(0, PAGE_LENGTH)
	},
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

// ── Infinite scroll ─────────────────────────────────────────────────────────────────────────────
// Two fetch paths that both write `threadsResource.value.data` — the single accumulated list every
// consumer reads: the reset resources above replace it (start:0); the append resources below push the
// next window onto it. Kept separate so createResource's replace-on-reload never fights the append.

// Appends the next window onto the loaded list, deduped by thread_id. `start = data.length` stays
// correct across optimistic removals (the server list shifts left by the same rows we dropped); the
// only skew is new mail inserted at the front, which the dedupe absorbs and the next reset reconciles.
const appendThreads = (rows: Thread[]) => {
	loadingMore.value = false
	// Discard a stale window that resolved after a reset began (mailbox switch, refresh, undo, …).
	if (loadEpoch !== epoch.value) return
	const seen = new Set(threadsResource.value.data.map((t: Thread) => t.thread_id))
	const fresh = rows
		.slice(0, PAGE_LENGTH)
		.filter((t) => !seen.has(t.thread_id) && !recentlyRemoved.has(t.thread_id))
	// Stop auto-loading if the window added nothing new (offset stuck behind heavy front-inserted mail);
	// the next reset (poll/refresh/socket) reconciles. Guards against a tight reload loop while the
	// sentinel stays in view.
	hasMore.value = rows.length > PAGE_LENGTH && fresh.length > 0
	threadsResource.value.data = [...threadsResource.value.data, ...fresh]
	openPendingEdgeThread()
}

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
		filter: route.query,
		limit: PAGE_LENGTH + 1,
		start: threadsResource.value.data.length,
		all_accounts: isAllAccountsSearch.value,
	}),
	onSuccess: (data: [Thread[], number]) => appendThreads(data[0]),
	onError: () => (loadingMore.value = false),
})

const loadMore = () => {
	if (!hasMore.value || loadingMore.value || threadsResource.value.loading) return
	loadingMore.value = true
	loadEpoch = epoch.value
	;(mailbox === 'search' ? loadMoreSearch : loadMoreThreads).reload()
}

const loadMoreSentinel = useTemplateRef('loadMoreSentinel')

// True while the sentinel is in view.
const sentinelVisible = ref(false)

// The height the list had reached the last time we topped it up, so a fill that adds nothing can be
// detected. Reset at the start of each fill episode (see below).
let lastFillHeight = 0

useIntersectionObserver(
	loadMoreSentinel,
	([entry]) => {
		const entering = !!entry?.isIntersecting && !sentinelVisible.value
		sentinelVisible.value = !!entry?.isIntersecting
		if (entering) lastFillHeight = 0
		if (sentinelVisible.value) loadMore()
	},
	{ root: mailListRef },
)

// Rescues the one case the observer cannot: the rendered list is too short to scroll, so the sentinel
// can never leave and re-enter the viewport to fire again — infinite scroll would die with nothing left
// to scroll. A window of 25 threads can collapse to a single stack row, so filling the viewport can take
// several of them.
//
// Both guards are load-bearing. Stop once the list can scroll, because from there the user's own
// scrolling drives the observer. And stop if a window added no height: its rows landed somewhere they
// cannot be seen (a collapsed date group), so further windows would be just as invisible — without this,
// collapsing a large group turns into a stampede that walks the entire mailbox 25 threads at a time.
watch(groupedRows, () => {
	if (!sentinelVisible.value || !hasMore.value) return

	nextTick(() => {
		const el = mailListRef.value
		if (!el || !sentinelVisible.value) return

		const grew = el.scrollHeight > lastFillHeight
		lastFillHeight = el.scrollHeight
		if (el.scrollHeight <= el.clientHeight && grew) loadMore()
	})
})

// The reading pane's Next arrow can always advance while more threads remain to load (crossing the
// last loaded thread triggers an append). The Prev arrow is disabled at the first loaded thread, which
// is the first thread overall (we always start from the top).
const canGoNext = computed(() => hasMore.value)

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

const threadIDs = computed(
	() => threadsResource.value.data?.map((thread: Thread) => thread.thread_id) || [],
)

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
	refreshMode.value = false
	epoch.value++
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
	if (threadsResource.value.loading || loadingMore.value) return

	refreshMode.value = true
	// Bump the epoch so an append still in flight is discarded (appendThreads checks it) instead of
	// landing after the merge and clobbering it. A new append can't start mid-refresh (loadMore bails
	// while the resource is loading), so this fully closes the refresh/append race. The merge base
	// (refreshSnapshot) and scroll anchor are captured later, at response time, so they reflect the list
	// as it actually is when the window arrives — not a stale start-of-refresh copy.
	epoch.value++
	refreshEpoch = epoch.value
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
	thread_ids.forEach((id) => {
		recentlyRemoved.add(id)
		setTimeout(() => recentlyRemoved.delete(id), 15000)
	})
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
	restored.forEach((t: Thread) => recentlyRemoved.delete(t.thread_id))
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
		filter.value = localStorage.getItem(`user:${user.data.name}:filter:${mailbox}`) || null
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
// when the mailbox's thread count actually changed — so a quiet mailbox isn't touched (and the reader
// isn't disturbed) every 30s.
const pollForChanges = async () => {
	const prevTotal = mailboxObj.value?.total_threads
	await mailboxes.reload()
	if (mailboxObj.value?.total_threads !== prevTotal) refreshThreads(false)
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

const getThreadByOffset = (offset: number, currentThread: string = threadID!) =>
	threadIDs.value[threadIDs.value.indexOf(currentThread) + offset]

const goToThread = (threadID: string) => {
	threadSlide.value = pendingThreadSlide
	if (threadID)
		router.push({ name: 'mail-mail', params: { accountId, mailbox, threadID }, query: route.query })
}

// Stepping past the last loaded thread loads the next window, then opens/focuses the newly appended
// thread once it arrives (`openPendingEdgeThread`, called from the append's onSuccess). `action`
// distinguishes the reading view (open) from list keyboard focus (focus). `anchor` is the thread we
// stepped off (the previously-last loaded), captured so we can resolve its successor after the append.
// There's no backward case — the first loaded thread is the first thread overall.
let pendingEdgeThread: { action: 'open' | 'focus'; anchor: string | undefined } | null = null

const loadMoreThenOpenEdge = (offset: number, action: 'open' | 'focus') => {
	// One crossing at a time: ignore further edge steps until the append resolves, so key auto-repeat
	// at the bottom of the list can't fire a burst of loads.
	if (pendingEdgeThread || offset < 0 || !hasMore.value) return
	// A focus crossing can only happen from the last navigable row, whose last thread is the last loaded
	// one — so the tail anchors the successor without needing to map a row back to a thread.
	pendingEdgeThread = { action, anchor: action === 'open' ? threadID : threadIDs.value.at(-1) }
	loadMore()
}

const goToThreadByOffset = (offset: number) => {
	const next = getThreadByOffset(offset)
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

const openPendingEdgeThread = () => {
	if (!pendingEdgeThread) return
	const { action, anchor } = pendingEdgeThread
	// The successor of the anchor is now loaded (undefined only if nothing new arrived — then stop).
	const id = getThreadByOffset(1, anchor)
	pendingEdgeThread = null
	if (!id) return
	if (action === 'open') goToThread(id)
	else focusOnThread(id)
}

const goToNextThreadOrMailbox = (excludedThreads: string[] = []) => {
	const idx = threadIDs.value.indexOf(threadID)
	const next = threadIDs.value.slice(idx + 1).find((id) => !excludedThreads.includes(id))
	if (next) goToThread(next)
	else goToMailbox()
}

const focusRow = (row?: NavRow) => {
	if (!row) return

	focusedRowKey.value = row.key
	scrollIntoView(row.key)
}

// The row that stands for a thread on screen: its own row when rendered, the collapsed stack that hides
// it, or — when its whole day is folded away — that day's header. Callers name a thread ("go to the
// first mail", "open the thread that just loaded"); this is how that lands somewhere visible.
const rowForThread = (threadID?: string): NavRow | undefined => {
	if (!threadID) return

	const row = navigableRows.value.find(
		(row) =>
			(row.type === 'thread' && row.thread.thread_id === threadID) ||
			// Only a collapsed stack stands in for its members. An expanded one precedes its member rows,
			// so without this guard every member would resolve to the stack row above it.
			(row.type === 'stack' && !row.expanded && row.threads.some((t) => t.thread_id === threadID)),
	)
	if (row) return row

	const dateKey = collapsedGroups.value.find((key) => getGroupThreads(key)?.includes(threadID))
	return navigableRows.value.find((row) => row.key === `group:${dateKey}`)
}

const focusOnThread = (threadID?: string) => focusRow(rowForThread(threadID))

const scrollIntoView = (rowKey: string) => {
	// Centering the focused row is a keyboard-navigation affordance; on mobile it
	// only made the list visibly jump behind the thread pane's slide-in.
	if (isMobile.value) return

	// The row may have only just been revealed by its stack or its day opening, so wait for the render
	// before looking it up. A no-op when nothing changed.
	nextTick(() => {
		mailListRef.value
			?.querySelector(`[data-row-key="${rowKey}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' })
	})
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

// Filter

const FILTER_OPTIONS = [
	{
		label: __('All'),
		icon: Mails,
		onClick: () => setFilter(null),
	},
	{
		label: __('Unread'),
		icon: MailIcon,
		onClick: () => setFilter('unread'),
	},
	{
		label: __('Starred'),
		icon: Star,
		onClick: () => setFilter('starred'),
		condition: () => ![mailboxIds.trash, 'starred'].includes(mailbox),
	},
	{
		label: __('Has attachments'),
		icon: Paperclip,
		onClick: () => setFilter('has_attachments'),
	},
]

const setFilter = (value: string | null) => {
	filter.value = value
	localStorage.setItem(`user:${user.data.name}:filter:${mailbox}`, value ?? '')
	resetThreads(false)
}

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
