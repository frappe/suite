<template>
  <!-- Header -->
  <!-- hidden on mobile: the title row carries the folder name, and the header's
	     actions are the compose button and the sidebar sheet. Hidden (not v-if) so HeaderActions'
	     modals stay mounted for the views' v-model bindings. -->
  <!-- Stretched, the padding inside, so a split Inbox's tabs can run the header's full height and
       underline on its border. -->
  <header class="hidden items-stretch border-b px-3 sm:flex sm:px-5">
    <!-- h-12: one height with or without the Inbox's tabs. The title's crumb stands a little taller
         than the tabs and the actions, and the bar grew with it. -->
    <div class="flex h-12 min-w-0 flex-1 items-center space-x-2 py-2.5">
      <!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
      <Breadcrumbs
        v-if="!inboxTab"
        class="-ml-0.5"
        :items="[
          {
            label: mailboxName,
            route: { name: 'mail-mailbox', params: { accountId, mailbox } },
          },
        ]"
      />
      <!-- A split Inbox's tabs stand in for its title, starting on the header's own px-5 axis so
           the first tab's icon lines up with the checkboxes and chips below. -->
      <InboxHeaderTabs
        v-else
        class="-my-2.5 min-w-0 self-stretch"
        :tabs="inboxTabs"
        :active="inboxTab"
        :route-for="routeForTab"
      />
    </div>
    <div class="flex h-12 shrink-0 items-center py-2.5">
      <HeaderActions view-menu :inbox="mailbox === mailboxIds.inbox" />
    </div>
  </header>

  <!-- On mobile this banner renders below the title header instead (inside the mobile
	     header block) — above it, it read as page chrome sitting on top of the title. -->
  <div v-if="showDeleteBanner && !isMobile" class="space-x-1 border-b px-3 py-2.5 sm:px-5">
    <span class="text-ink-gray-5">
      {{ __('Items in this folder will be automatically deleted after 30 days.') }}
    </span>
    <Button :label="__('Delete Now')" variant="ghost" @click="showEmptyMailbox = true" />
  </div>

  <!-- Mobile sizes by flex (the dvh calcs assume desktop chrome and overshoot
	     once the bottom nav exists, making the outer container scroll too). -->
  <div
    class="relative flex max-sm:min-h-0 max-sm:flex-1 max-sm:!h-auto"
    :class="showDeleteBanner ? 'h-[calc(100dvh-6.125rem)]' : 'h-[calc(100dvh-3.0625rem)]'"
  >
    <!-- Loading -->
    <div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
      <div class="text-ink-gray-5 flex items-center space-x-2">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        <span>{{ __('Loading...') }}</span>
      </div>
    </div>

    <template
      v-else-if="threadRows.length || filter || filterChanged || mailbox === 'search' || inboxTab"
    >
      <ThreadPane
        :thread-open="!!threadID"
        @touch-start="onThreadTouchStart"
        @touch-move="onThreadTouchMove"
        @touch-end="onThreadTouchEnd"
      >
        <template #list>
          <!-- The search view's own header: the query (click to edit) + removable filter pills, above
					     the results toolbar. It owns the query surface; the results below just read the route. -->
          <SearchResultsHeader v-if="mailbox === 'search'" />

          <!-- Mobile header: title row (folders · mailbox + count · search) over
					     a toolbar row (filter selector on the left, filter/refresh pills on the
					     right). In selection mode the toolbar row swaps to ✕ / count / Select All.
					     Search skips both rows (SearchResultsHeader is the header there; no tab
					     in the bar reads as active), keeping only the selection
					     toolbar and the loading bar — the border goes with the rows it underlines. -->
          <div
            v-if="isMobile"
            class="relative shrink-0"
            :class="{ 'border-b': mailbox !== 'search' || !!selections.length }"
          >
            <MobileTitleHeader
              v-if="mailbox !== 'search'"
              with-menu
              with-search
              :title="mailboxName"
              :count="threadCount ? __('{0} threads', [threadCount]) : undefined"
            />

            <!-- Trash/Junk auto-delete banner — below the title (its desktop slot above
						     the whole header read as chrome on top of the page). Borderless: it
						     reads as part of the header block, not a boxed-off strip. -->
            <div v-if="showDeleteBanner && mailbox !== 'search'" class="space-x-1 px-4">
              <span class="text-ink-gray-5">
                {{ __('Items in this folder will be automatically deleted after 30 days.') }}
              </span>
              <Button :label="__('Delete Now')" variant="ghost" @click="showEmptyMailbox = true" />
            </div>

            <InboxTabs
              v-if="inboxTab && !selections.length"
              :tabs="inboxTabs"
              :active="inboxTab"
              :route-for="routeForTab"
            />

            <!-- Both toolbar variants share h-12 so toggling selection mode doesn't shift the list. -->
            <!-- px-1/gap-1 match the title row above, so the ✕ shares the hamburger's
						     axis and the count text starts where the title does. -->
            <MobileSelectionHeader
              v-if="selections.length"
              :count="selections.length"
              :all-selected="isAllSelected"
              @toggle-all="toggleSelectAll"
            />
            <!-- No `loading`: the bar below spans this whole header block, so it
						     also covers selection mode and search, where this row is absent. -->
            <MailListToolbar
              v-else-if="mailbox !== 'search'"
              :title="title"
              :filter-options="FILTER_OPTIONS"
            >
              <template v-if="clearScope" #mobile-actions>
                <ClearListMenu :scope="clearScope" :target="{ account: accountId, mailbox }" />
              </template>
            </MailListToolbar>
          </div>

          <!-- Toolbar/Actions -->
          <MailListToolbar
            v-if="!isMobile"
            :title="title"
            :filter-options="FILTER_OPTIONS"
            :show-filter="!selections.length && mailbox !== 'search'"
            :show-actions="!selections.length"
            :fetching="isFetching"
            @refresh="refreshThreads()"
          >
            <template #lead>
              <div v-if="!isAllAccountsSearch" class="mr-5">
                <SelectAllCheckbox
                  :selected="isAllSelected"
                  :some="selections.length > 0"
                  @toggle="toggleSelectAll"
                />
              </div>
            </template>

            <!-- The filters as chips, where the selector would go. -->
            <template v-if="!selections.length && mailbox !== 'search'" #filter>
              <ListFilterChips
                :filter-options="FILTER_OPTIONS"
                :filter="filter"
                :clear="clearFilter"
              />
            </template>

            <template #actions>
              <ClearListMenu
                v-if="clearScope && !selections.length"
                :scope="clearScope"
                :target="{ account: accountId, mailbox }"
              />
              <SelectActionButtons
                v-if="selections.length"
                :actions="selectActions"
                :collapsed="showReadingPane"
              />

              <Dropdown v-if="showMoveTo" :options="moveToOptions">
                <Button variant="ghost" :tooltip="__('Move To')">
                  <template #icon>
                    <component :is="FolderInput" class="icon" />
                  </template>
                </Button>
              </Dropdown>
              <!-- Where the selection is filed, as ticks — the thread toolbar's Folders menu, for
                   every ticked thread at once. Stays open, to file them in several. -->
              <Dropdown v-if="folderOptions.length" :options="folderOptions">
                <Button variant="ghost" :tooltip="__('Folders')">
                  <template #icon>
                    <component :is="Folders" class="icon" />
                  </template>
                </Button>
              </Dropdown>
            </template>
          </MailListToolbar>

          <!-- Mail list -->
          <div
            v-if="threadRows.length"
            ref="mailList"
            class="h-full overflow-y-auto overscroll-contain max-sm:pb-20"
            @focusin="onListFocusIn"
          >
            <div v-for="(group, key) in groupedThreads" :key="key">
              <MailGroupHeader
                v-if="groupedByDate && !isMobile"
                :date-key="key"
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
                    class="checkbox-hitbox -mx-3 -my-2.5 flex cursor-pointer items-center py-2.5 pl-3 pr-8"
                    @click.stop.prevent="toggleSelect(getGroupThreads(key), !isGroupSelected(key))"
                  >
                    <Checkbox
                      :model-value="isGroupSelected(key)"
                      size="md"
                      class="pointer-events-none [&_input]:mt-0"
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
                    :drafts="mailbox === mailboxIds.drafts"
                    :unarchive="true"
                    :threads="row.threads"
                    :expanded="row.expanded"
                    :is-selected="isStackSelected(row.threads.map((t) => t.thread_id))"
                    :class="rowClasses(row)"
                    :data-row-key="row.key"
                    @toggle="toggleStack(row)"
                    @set-seen="(seen: boolean) => stackSetSeen(row.threads, seen)"
                    @archive-threads="stackArchive(row.threads)"
                    @unarchive-threads="handleUnarchiveThreads(stackIDs(row.threads))"
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
                    :drafts="mailbox === mailboxIds.drafts"
                    :unarchive="!isAllAccountsSearch"
                    :mail="row.thread"
                    :account-id="isAllAccountsSearch ? row.thread.account : undefined"
                    :account-label="
                      isAllAccountsSearch ? shortAccountLabel(row.thread.account_name) : undefined
                    "
                    :selectable="!isAllAccountsSearch"
                    :selection-mode="mobileSelectionMode"
                    :is-selected="selections.includes(row.thread.thread_id)"
                    :hide-sender="row.inStack"
                    :draggable="!isMobile && !isAllAccountsSearch && mailbox !== mailboxIds.drafts"
                    :screened="screener.active.value && screener.isScreened(row.thread)"
                    :class="rowClasses(row)"
                    :data-row-key="row.key"
                    @drag-start="(e: DragEvent) => startThreadDrag(row.thread, e)"
                    @drag-end="threadDrag.end()"
                    @set-seen="(seen: boolean) => rowSetSeen(row.thread, seen)"
                    @archive-thread="rowArchive(row.thread)"
                    @unarchive-thread="handleUnarchiveThreads([row.thread.thread_id])"
                    @trash-thread="rowTrash(row.thread)"
                    @delete-thread="junkOrDeleteThreads([row.thread.thread_id], false)"
                    @set-flagged="(flagged: boolean) => rowSetFlagged(row.thread, flagged)"
                    @set-selected="
                      (selected: boolean) =>
                        !isAllAccountsSearch && toggleSelect([row.thread.thread_id], selected)
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
              v-if="activeThreads.isFetching"
              class="text-ink-gray-5 h-5 w-5 animate-spin"
            />
            <p v-else class="text-ink-gray-5">
              {{
                mailbox !== 'search'
                  ? filter
                    ? __('No mails found for the selected filter.')
                    : __('You have no mails in this folder.')
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
          :mailbox
          :thread-i-d
          :threads="threadIDs"
          :messages="currentThread?.messages"
          :land-on="mailbox === 'search' ? currentThread?.match_id : undefined"
          :can-go-next="canGoNext"
          @slide-done="threadSlide = ''"
          @reload-mails="resetThreads"
          @set-seen="
            (seen: boolean, ids: string[]) =>
              handleSetSeen({ [Number(seen)]: [threadID!] }, seen, ids)
          "
          @sync-unseen="handleSyncUnseen"
          @set-flagged="(ids: string[], flagged: boolean) => setFlaggedSubmit({ ids, flagged })"
          @archive-thread="handleArchiveThreads([threadID!])"
          @unarchive-thread="handleUnarchiveThreads([threadID!])"
          @move-thread="
            (moveToMailbox: string) => handleMoveThreads({ [moveToMailbox]: [threadID!] })
          "
          @add-thread-to-mailbox="
            (mailboxId: string) => handleAddThreadsToMailbox(mailboxId, [threadID!])
          "
          @remove-thread-from-mailbox="
            (mailboxId: string) => handleRemoveThreadsFromMailbox(mailboxId, [threadID!])
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

  <Dialog v-model:open="showEmptyMailbox" v-bind="emptyMailboxOptions" />
  <Dialog v-model:open="showJunkOrDeleteThreads" v-bind="junkOrDeleteThreadsOptions" />
  <!-- The phone's selection bar; the folder menus open from its More sheet as sheets of their own. -->
  <MobileSelectionBar
    :open="mobileSelectionMode"
    :actions="selectActions"
    :extra-options="folderSelectionOptions"
  />
</template>
<script setup lang="ts">
import { Breadcrumbs, Button, Checkbox, Dialog, Dropdown, usePageMeta } from 'frappe-ui'
import { FolderInput, Folders, LoaderCircle } from 'lucide-vue-next'
import { computed, inject, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client, useInfiniteQuery, useMutation, type InputOf } from '@/api'
import ClearListMenu from '@/apps/mail/components/ClearListMenu.vue'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import InboxHeaderTabs from '@/apps/mail/components/InboxHeaderTabs.vue'
import InboxTabs from '@/apps/mail/components/InboxTabs.vue'
import ListFilterChips from '@/apps/mail/components/ListFilterChips.vue'
import MobileSelectionBar from '@/apps/mail/components/ListSelection/MobileSelectionBar.vue'
import MobileSelectionHeader from '@/apps/mail/components/ListSelection/MobileSelectionHeader.vue'
import SelectActionButtons from '@/apps/mail/components/ListSelection/SelectActionButtons.vue'
import SelectAllCheckbox from '@/apps/mail/components/ListSelection/SelectAllCheckbox.vue'
import MailGroupHeader from '@/apps/mail/components/MailGroupHeader.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'
import MailListToolbar from '@/apps/mail/components/MailListToolbar.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import SearchResultsHeader from '@/apps/mail/components/SearchResultsHeader.vue'
import StackListItem from '@/apps/mail/components/StackListItem.vue'
import ThreadPane from '@/apps/mail/components/ThreadPane.vue'
import { listScope } from '@/apps/mail/composables/useClearList'
import { useInboxTabs } from '@/apps/mail/composables/useInboxTabs'
import { useKeptRead } from '@/apps/mail/composables/useKeptRead'
import { useListRows, type NavRow } from '@/apps/mail/composables/useListRows'
import { useListSelection } from '@/apps/mail/composables/useListSelection'
import { PAGE_LENGTH, usePaginatedThreads } from '@/apps/mail/composables/usePaginatedThreads'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { useThreadDrag } from '@/apps/mail/composables/useThreadDrag'
import { userStore, type MailboxRole } from '@/apps/mail/stores/user'
import type { Thread } from '@/apps/mail/types'
import {
  isMac,
  raiseError,
  raisePromiseToast,
  raiseToast,
  shouldIgnoreKeypress,
} from '@/apps/mail/utils'
import {
  useDiscardingDrafts,
  useListReload,
  useMobileSearch,
  useReadingPane,
  useScreenSize,
  useSwipeNav,
  useUndo,
} from '@/apps/mail/utils/composables'
import { utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import { useListFilter } from '@/apps/mail/utils/listFilter'
import {
  hasCursor,
  isNavigationKey,
  navigationOffset,
  neighbourAfterRemoval,
  stepFromKey,
  useGPrefix,
} from '@/apps/mail/utils/listNavigation'
import { commonMailboxIds } from '@/apps/mail/utils/mailboxTargets'
import { archivable, holdsReceivedMail, unarchivable } from '@/apps/mail/utils/receivedMail'
import { selectActions as buildSelectActions } from '@/apps/mail/utils/selectActions'
import { threadRow } from '@/apps/mail/utils/threadRows'
import { mailboxParam } from '@/apps/mail/utils/unifiedFolders'
import { useThreadActions } from '@/apps/mail/utils/useThreadActions'
import { appPageMeta } from '@/platform/page-meta'

const {
  accountId,
  mailbox,
  threadID = '',
} = defineProps<{
  accountId: string
  mailbox: string
  threadID?: string
}>()
const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const { listReloadRequest } = useListReload()
const { dropViewUndo } = useUndo()
const socket = inject('$socket')
// MailLayout's overlay layer; see the selection bar's Teleport.
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
  loadingMore,
  isFetching,
  canGoNext,
  threadIDs,
  threadByOffset,
  loadMoreThenOpenEdge,
  topUpIfShort,
} = usePaginatedThreads({
  query: () => activeThreads.value,
  rows: () => threadRows.value,
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

// Mail from a sender nobody has decided on yet sits in the Inbox, marked unscreened (see useScreener).
const screener = useScreener()

// The date groups, the stacks and the keyboard cursor that walks them — all shared with the merged All
// Inboxes list (see useListRows).
const {
  groupedByDate,
  groupedThreads,
  getGroupThreads,
  isLastGroup,
  collapsedGroups,
  expandedStacks,
  groupedRows,
  visibleThreadCount,
  navigableRows,
  focusedRowKey,
  onListFocusIn,
  focusedRow,
  focusRow,
  focusOnThread,
  rowClasses,
  toggleStack,
  toggleGroupCollapse,
  revealThread,
} = useListRows({
  threads: () => threadRows.value ?? [],
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

// A deep link or a step to the next thread can land inside a collapsed stack or a folded day — surface
// it either way, and leave the cursor on it (see revealThread).
watch(
  () => threadID,
  (val) => val && revealThread(val),
  {
    immediate: true,
  },
)

// Selection

const mailThreadRef = useTemplateRef('mailThread')
// The ticked threads, and the phone's selection mode (see useListSelection).
const {
  selections,
  isAllSelected,
  mobileSelectionMode,
  toggleSelect,
  toggleSelectAll,
  resetSelections,
  isGroupSelected,
  isStackSelected,
} = useListSelection({
  keys: () => threadIDs.value,
  groupKeys: (dateKey) => getGroupThreads(dateKey),
})

// The folder menus join the phone selection bar's More sheet, each opening as a sheet of its own.
const folderSelectionOptions = computed(() => [
  ...(showMoveTo.value
    ? [{ label: __('Move To'), icon: FolderInput, options: moveToOptions.value }]
    : []),
  ...(folderOptions.value.length
    ? [{ label: __('Folders'), icon: Folders, options: folderOptions.value }]
    : []),
])
// Selecting doesn't force a collapsed date group or stack open: ticking either one is how you act on
// the whole set at once — collapse the pile, tick, archive.

// Shortcuts

const gPrefix = useGPrefix()
const reloadInterval = ref<ReturnType<typeof setInterval>>()
const handleKeyDown = (e: KeyboardEvent) => {
  const key = e.key.toLowerCase()

  // Handle Ctrl/Cmd+A (Select All)
  if ((e.metaKey || e.ctrlKey) && key === 'a' && !shouldIgnoreKeypress(e, true)) {
    e.preventDefault()
    gPrefix.disarm()
    return toggleSelectAll(true)
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
    // Trash and Drafts let go for good: a draft is discarded rather than filed in Trash.
    if (e.shiftKey || mailbox === mailboxIds.trash || mailbox === mailboxIds.drafts)
      return junkOrDeleteThreads(thread_ids, false)
    return handleMoveThreads({
      [mailboxIds.trash]: thread_ids,
    })
  }

  // Drafts offers only Discard: a draft isn't read, archived or junked.
  if (mailbox === mailboxIds.drafts) return

  // Mark as read/unread (u)
  if (key === 'u') {
    e.preventDefault()
    return handleSetSeen({
      [Number(e.shiftKey)]: thread_ids,
    })
  }

  // Archive (e): Archive and Unarchive share a place, so E does whichever it shows — and nothing
  // where neither has anything to do.
  const acted = threadRows.value.filter((t) => thread_ids.includes(t.thread_id))
  const boxes = { sent: mailboxIds.sent, archive: mailboxIds.archive, inbox: mailboxIds.inbox }
  const messagesOf = (t: Thread) => (t.messages?.length ? t.messages : [t])
  if (key === 'e') {
    e.preventDefault()
    if (acted.some((t) => archivable(messagesOf(t), boxes))) return handleArchiveThreads(thread_ids)
    if (acted.some((t) => unarchivable(messagesOf(t), boxes)))
      return handleUnarchiveThreads(thread_ids)
    return
  }

  // Mark as junk (!): only mail you received is junked.
  if (key === '!') {
    e.preventDefault()
    if (!acted.some((t) => holdsReceivedMail(messagesOf(t), mailboxIds.sent))) return
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
  if (!(e.shiftKey && newIDs.length)) return
  const shouldSelect = !newIDs.every((id) => selections.value.includes(id))
  toggleSelect([...prevIDs, ...newIDs], shouldSelect, true)
}
// The actions on the ticked threads, the same set the All accounts list offers (see selectActions).
const selectActions = buildSelectActions(
  () => selectedRows.value,
  () => ({
    archive: mailbox === mailboxIds.archive,
    trash: mailbox === mailboxIds.trash,
    drafts: mailbox === mailboxIds.drafts,
    sent: mailboxIds.sent,
    archiveId: mailboxIds.archive,
    inboxId: mailboxIds.inbox,
  }),
  {
    star: () => setFlaggedByThreadIDs(selections.value, true),
    unstar: () => setFlaggedByThreadIDs(selections.value, false),
    archive: () => handleArchiveThreads(selections.value),
    unarchive: () => handleUnarchiveThreads(selections.value),
    junk: () => junkOrDeleteThreads(selections.value, true),
    notJunk: () => handleSetSpamStatus({ 0: selections.value }),
    trash: () => handleMoveThreads({ [mailboxIds.trash]: selections.value }),
    delete: () => junkOrDeleteThreads(selections.value, false),
    read: () => handleSetSeen({ 1: selections.value }),
    unread: () => handleSetSeen({ 0: selections.value }),
  },
)

// Search

// An optimistic removal emptied the list but more threads exist, so a refill is coming once the server
// mutation lands. Keeps the loading state (not the empty state) during the gap before the refill fetch.
const refillPending = ref(false)
// Current mailbox's record (carries total_emails/total_threads/unread_threads); used by the periodic
// poll to detect count changes and by the tab title's unread badge.
const mailboxObj = computed(() => mailboxes.data?.find((m) => m.id === mailbox))

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
const { hasSearchQuery } = useMobileSearch()

// Null while a search is pending — the count is only known once the fetch resolves (set in the
// searchResults transform below, reset in resetThreads). Guards the title against a stale or zero count.
const searchTotal = ref<number | null>(null)

// The search dialog stores bare `YYYY-MM-DD` days in the route; the API listens UTC, so the
// day's bounds are resolved in the user's zone here at the request boundary (the URL stays clean).
const searchFilter = () => {
  const filter: Record<string, any> = {
    ...route.query,
  }
  if (typeof filter.after === 'string' && filter.after) filter.after = utcDayStart(filter.after)
  if (typeof filter.before === 'string' && filter.before) filter.before = utcDayEnd(filter.before)
  return filter
}

// Reset resource for search: the window starts at the top and runs as deep as the composable asks
// (one page on a reset, the loaded list on a refresh), over-fetching one row to drive `hasMore`.
const searchResults = useInfiniteQuery(api.mail.messages.search, () =>
  mailbox === 'search' && hasSearchQuery.value
    ? {
        account: store.accountId,
        filter: searchFilter(),
        limit: PAGE_LENGTH,
        start: 0,
        all_accounts: isAllAccountsSearch.value,
      }
    : false,
)
watch(
  () => searchResults.total,
  (total) => {
    searchTotal.value = total ?? null
  },
)
watch(
  () => JSON.stringify(route.query),
  () => {
    if (mailbox === 'search') resetThreads()
  },
)

// Main data

// The list's filters, their menu, and its own title (see useListFilter) — all shared with the
// merged All Inboxes list. Starred is not offered inside Trash, nor inside the Starred list itself,
// where it would filter a list to itself.
const {
  filter,
  changed: filterChanged,
  reloadFilter,
  clear: clearFilter,
  FILTER_OPTIONS,
  filterTitle,
} = useListFilter({
  onChange: () => resetThreads(false),
  starrable: () => ![mailboxIds.trash, 'starred'].includes(mailbox),
  screenable: () => mailbox === mailboxIds.inbox && screener.active.value,
})
const isMailboxLoaded = ref(false)

// The Inbox's category tabs; `inboxTab` is the open one, and undefined in any other list or when the
// Inbox isn't split.
const {
  tabs: inboxTabs,
  active: inboxTab,
  routeFor: routeForTab,
  switched: tabSwitched,
} = useInboxTabs(
  () => mailbox === mailboxIds.inbox && 'account',
  () => ({ name: 'mail-mailbox', params: { accountId, mailbox: route.params.mailbox } }),
  () => resetThreads(false),
)
// What the list's menu clears (see listScope). Not offered where there is no folder to clear
// (Starred, a search) or nothing unread to clear (Sent, Drafts).
const clearScope = computed(() =>
  ['search', 'starred', mailboxIds.sent, mailboxIds.drafts].includes(mailbox)
    ? undefined
    : listScope(inboxTab.value, mailboxName.value, filter.value),
)

// Reset resource for a mailbox: the window starts at the top and runs as deep as the composable asks
// (see resetLimit) — one page on a reset, the loaded list on a refresh, so a refresh can tell which
// loaded rows are gone. Over-fetches one row to detect whether more exist without relying on the
// (flaky) stored count.
const threads = useInfiniteQuery(api.mail.threads.list, () =>
  mailbox !== 'search'
    ? {
        account: store.accountId,
        mailbox,
        limit: PAGE_LENGTH,
        start: 0,
        filter_by: filter.value,
        category: inboxTab.value,
      }
    : false,
)
const activeThreads = computed(() => (mailbox === 'search' ? searchResults : threads))
const { isDiscarding, withoutHeldDrafts } = useDiscardingDrafts()
// Filtered to unread mail, what is read here stays until the list changes (see useKeptRead).
const keptRead = useKeptRead({
  filtering: () => !!filter.value?.split(',').includes('unread'),
  scope: () => [mailbox, accountId, filter.value, inboxTab.value],
  key: (thread) => thread.thread_id,
})
const threadRows = computed(() =>
  keptRead.withKept(
    activeThreads.value.rows
      .map((row) => threadRow(row, store.accountId))
      .filter((row) => !isDiscarding(row, { inDrafts: mailbox === mailboxIds.drafts }))
      .map(withoutHeldDrafts),
  ),
)
watch(threadRows, keptRead.keep)
watch(
  () => threads.status,
  (status) => {
    isMailboxLoaded.value = status !== 'pending'
  },
)

// The Trash/Junk "auto-deleted after 30 days" banner is about the whole mailbox, so show it whenever the
// mailbox has threads — or a filter is applied (the filtered view may be empty while the mailbox isn't).
// The layout below reserves height for it only when it's actually rendered, so the two stay in sync.
const showDeleteBanner = computed(
  () =>
    [mailboxIds.trash, mailboxIds.junk].includes(mailbox) &&
    !activeThreads.value.isFetching &&
    (!!threadRows.value?.length || !!filter.value) &&
    (showReadingPane.value || !threadID),
)

// Keep infinite scroll alive while the rendered list is too short to scroll (see topUpIfShort). Must
// stay below groupedRows: `watch` evaluates its source at setup.
watch(groupedRows, topUpIfShort)
const isLoading = computed(() => {
  // Search is one page: its header (input + filter chips) mounts immediately and stays put
  // across query changes — loading shows inline in the list area, never as the full spinner.
  // Checked first: entering the route resets isMailboxLoaded, which must not blank the view.
  if (mailbox === 'search') return false
  if (tabSwitched.value && inboxTab.value) return false
  // A new filter is a new query, pending as a mailbox's first is: checked before that.
  if (filterChanged.value) return false
  if (!isMailboxLoaded.value) return true
  if (emptyMailbox.isPending) return true
  if (refillPending.value) return true
  // A split Inbox keeps its tabs up while an emptied tab refills (an Undo, a refresh).
  if (inboxTab.value) return false
  return !threadRows.value.length && activeThreads.value.isFetching
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
  void activeThreads.value.refetch().catch(() => {})
  if (reloadMailboxes) void store.refreshCounts()
}

// The composer lives in the layout now, above every route, so it has no view to hand an event to —
// it announces a send or a draft saved instead (see useListReload). Drafts and Sent are the two lists
// that answer: everywhere else the mail it wrote does not belong.
watch(listReloadRequest, () => resetThreads(true, ['drafts', 'sent']))
// A Screener verdict moves mail in or out of this list.
watch(screener.version, () => refreshThreads(false))

// Check for new mail without losing the reader's place: refetch the newest window and prepend only the
// threads not already loaded (see onResetSuccess), keeping scroll position and the loaded rows. Used by
// the Refresh button, the periodic poll, and the new-mail socket. Selections are preserved.
const refreshThreads = (reloadMailboxes = true) => {
  if (isFetching.value) return
  void activeThreads.value.refetch().catch(() => {})
  if (reloadMailboxes) void store.refreshCounts()
}

// After an optimistic action whose threads stay in the list (add-to-mailbox, or a move that leaves
// copies in the current mailbox): refresh selections + sidebar counts only, never refetch the list.
const syncAfterAction = () => {
  resetSelections()
  mailboxes.refetch().catch(() => {})
}

// Drops threads from the loaded list optimistically and returns the removed rows (so an undo can put
// them back). Their server rows leave the current view too, so the append offset (data.length) stays
// aligned.
// Which list each removed row left (see useKeptRead): Undo, or a failed action, puts a row read in
// the Unread filter back on that list, which no longer gets it from the server.
const removedFrom = new WeakMap<Thread, number>()
const removeThreadsFromList = (ids: string[]): Thread[] => {
  // Taken before letting go of them, while the rows read here are still on the list.
  const removed = threadRows.value.filter((row) => ids.includes(row.thread_id))
  const at = keptRead.current()
  removed.forEach((row) => removedFrom.set(row, at))
  keptRead.release(ids)
  return removed
}
const refillIfEmpty = () => {
  refillPending.value = false
}
const restoreThreadsToList = (rows: Thread[]) => {
  for (const row of rows) {
    const at = removedFrom.get(row)
    if (at !== undefined) keptRead.restore([row], at)
  }
  void activeThreads.value.refetch().catch(() => {})
}
watch(
  () => [mailbox, accountId],
  (_new, old) => {
    // Opening a result in an all-accounts search switches the route's account (so the reading pane
    // loads the thread from the right account) while the mailbox stays 'search'. The merged list spans
    // every account, so a mere account switch mustn't reset it — keep the results and scroll position.
    if (isAllAccountsSearch.value && mailbox === 'search' && old?.[0] === 'search') return
    // Loaded already when the list is cached (back to the Inbox, say): its status never leaves
    // 'success' then, so the watcher above, which only hears changes, would leave the spinner up.
    isMailboxLoaded.value = threads.status !== 'pending'
    tabSwitched.value = false
    reloadFilter()
    focusedRowKey.value = undefined
    collapsedGroups.value = []
    // Stacks re-collapse on a mailbox switch. Note a *filter* change deliberately doesn't clear
    // this: stale ids are inert (a run is expanded only if one of its current members is listed),
    // and keeping them means toggling Unread→All doesn't re-collapse a stack you just opened.
    expandedStacks.value = new Set()
    resetThreads(false)
  },
  {
    immediate: true,
  },
)

// Periodically refresh the mailbox list (keeps sidebar counts current), then merge in new threads only
// when the mailbox's message count actually changed — so a quiet mailbox isn't touched (and the reader
// isn't disturbed) every 30s.
//
// Messages, not threads: a reply landing in a thread that's already here leaves total_threads flat, so
// gating on that count made this backstop blind to exactly the arrivals the socket exists to deliver.
const pollForChanges = async () => {
  const prevTotal = mailboxObj.value?.total_emails
  await store.refreshCounts()
  if (mailboxObj.value?.total_emails !== prevTotal) refreshThreads(false)
}

// Mail was read, moved or deleted somewhere else (another device, another tab). Which mailboxes it
// touched isn't known — a deleted mail can no longer be asked — so every list refreshes.
const onMailChanged = () => refreshThreads()
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  reloadInterval.value = setInterval(pollForChanges, 30000)
  socket.on('new_mail_created', (updatedMailboxes: string[]) => {
    if (updatedMailboxes.includes(mailbox)) refreshThreads()
  })
  socket.on('mail_changed', onMailChanged)
  socket.on('mail_exchange_completed', (payload: { success: boolean; message: string }) =>
    raiseToast(payload.message, payload.success ? 'success' : 'error'),
  )
  socket.on('calendar_exchange_completed', (payload: { success: boolean; message: string }) =>
    raiseToast(payload.message, payload.success ? 'success' : 'error'),
  )
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  if (reloadInterval.value) clearInterval(reloadInterval.value)
  socket.off('mail_changed', onMailChanged)
  // Leaving the mailbox drops any pending undo so a lingering toast can't undo into another view.
  dropViewUndo()
})

// The URL names the folder by slug; this view works in its id (see utils/unifiedFolders).
const mailboxInUrl = () => mailboxParam(mailbox, mailboxes.data)

const goToMailbox = () =>
  router.push({
    name: 'mail-mailbox',
    params: { accountId, mailbox: mailboxInUrl() },
    query: route.query,
  })

const goToThread = (threadID: string) => {
  threadSlide.value = pendingThreadSlide
  if (threadID)
    router.push({
      name: 'mail-mail',
      params: { accountId, mailbox: mailboxInUrl(), threadID },
      query: route.query,
    })
}
const goToThreadByOffset = (offset: number) => {
  const next = threadByOffset(offset)
  if (next) return goToThread(next)
  loadMoreThenOpenEdge(offset, 'open')
}

// Swipe on the open thread (mobile): left → next thread, right → previous.
const {
  onTouchStart: onThreadTouchStart,
  onTouchMove: onThreadTouchMove,
  onTouchEnd: onThreadTouchEnd,
} = useSwipeNav(
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

// Down the list first, then up: triaging from the oldest mail lives at the bottom, where there is
// never anything below (see neighbourAfterRemoval). Only an emptied list falls back to the mailbox.
const goToNextThreadOrMailbox = (excludedThreads: string[] = []) => {
  const next = neighbourAfterRemoval(
    threadIDs.value,
    threadIDs.value.indexOf(threadID),
    (id) => !excludedThreads.includes(id),
  )
  if (next) goToThread(next)
  else goToMailbox()
}

// Actions

const {
  handleSetSeen,
  handleSyncUnseen,
  setFlaggedByThreadIDs,
  handleMoveThreads,
  handleArchiveThreads,
  handleUnarchiveThreads,
  handleSetSpamStatus,
  handleAddThreadsToMailbox,
  handleRemoveThreadsFromMailbox,
  junkOrDeleteThreads,
  handleMailMove,
  handleMailSpam,
  handleMailDelete,
  setFlaggedSubmit,
  selectedRows,
  moveToOptions,
  folderOptions,
  showMoveTo,
  showJunkOrDeleteThreads,
  junkOrDeleteThreadsOptions,
} = useThreadActions({
  rows: threadRows,
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

// ── Dragging threads onto a folder ────────────────────────────────────────────────────────────────
// A drop is the same act as picking a folder from the "Move to" menu, so it runs the same handler —
// undo snapshot, Junk diversion and toast included. The sidebar owns the drop; it borrows the move
// from here, since only the view knows how to perform one.
const threadDrag = useThreadDrag()
onMounted(() => threadDrag.setMoveHandler(handleMoveThreads))
onUnmounted(() => threadDrag.setMoveHandler(null))

/**
 * What the drag carries. Dragging a row that is part of the selection takes the
 * whole selection with it; dragging one outside it takes that row alone and
 * leaves the selection untouched — the same reading every file manager gives
 * the gesture, and the alternative (always the selection) silently moves mail
 * the reader never pointed at.
 *
 * Rows are undraggable in an all-accounts search, alongside `selectable`, and
 * for the same reason: the move below runs against the active account, while
 * those rows can belong to any. There is no cross-account handler to route to
 * either — the ones above work by reading a role off the row's own account
 * (`mail.archive`, `mail.trash`), and the folder being dropped on is one of
 * *this* account's, which another account has no counterpart for.
 */
const startThreadDrag = (thread: Thread, e: DragEvent) => {
  const dragged = selections.value.includes(thread.thread_id) ? selectedRows.value : [thread]
  // The folders these rows are already in ride along, so the sidebar can rule them out as targets
  // without holding the list itself.
  threadDrag.start(
    dragged.map((t) => t.thread_id),
    commonMailboxIds(dragged),
    e,
  )
}

// ── Cross-account search row actions ──────────────────────────────────────────────────────────────
// In an all-accounts search the merged rows can belong to any account, so the shared handlers above
// (which target the single active account) can't drive them. These act on each row's own account via
// client mutations — mirroring the All Inboxes view — with the active account left untouched. Star and
// read/unread update optimistically in place; archive/trash re-run the search on success, since a
// result's membership is server-determined (an archived mail may still match the query). Delete is
// account-agnostic (it targets Mail Message names), so it stays on the shared junk/delete flow below.
const crossAccountSetSeen = (mail: Thread, seen: boolean) => {
  if (mail.seen === (seen ? 1 : 0)) return
  mail.seen = seen ? 1 : 0
  client
    .mutation(api.mail.messages.seen, {
      account: mail.account,
      ids: [mail.id],
      seen,
    })
    .then(() => mailboxes.refetch().catch(() => {}))
    .catch((error) => {
      mail.seen = seen ? 0 : 1 // revert the optimistic update
      raiseError(error)
    })
}
const crossAccountSetFlagged = (mail: Thread, flagged: boolean) => {
  if (mail.flagged === (flagged ? 1 : 0)) return
  mail.flagged = flagged ? 1 : 0
  client
    .mutation(api.mail.messages.flag, {
      account: mail.account,
      ids: [mail.id],
      flagged,
    })
    .catch((error) => {
      mail.flagged = flagged ? 0 : 1 // revert the optimistic update
      raiseError(error)
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
      client
        .mutation(api.mail.messages.move, {
          account: mail.account,
          ids: [mail.id],
          mailbox: target,
          clear_junk: true,
        })
        .then(() => resetThreads(false)),
    loading,
    success,
  )
}

// Route a list row's action to the cross-account handler in an all-accounts search, else to the shared
// active-account handler (keeping single-account search behaviour identical).
const rowSetSeen = (mail: Thread, seen: boolean) =>
  isAllAccountsSearch.value
    ? crossAccountSetSeen(mail, seen)
    : handleSetSeen({
        [Number(seen)]: [mail.thread_id],
      })

const rowSetFlagged = (mail: Thread, flagged: boolean) =>
  isAllAccountsSearch.value
    ? crossAccountSetFlagged(mail, flagged)
    : setFlaggedByThreadIDs([mail.thread_id], flagged)

const rowArchive = (mail: Thread) => {
  if (isAllAccountsSearch.value)
    return crossAccountMoveOut(
      mail,
      mail.archive,
      __('Archiving...'),
      __('Thread archived.'),
      __('No Archive folder for this account.'),
    )
  return handleArchiveThreads([mail.thread_id])
}

const rowTrash = (mail: Thread) => {
  if (isAllAccountsSearch.value)
    return crossAccountMoveOut(
      mail,
      mail.trash,
      __('Moving to Trash...'),
      __('Thread moved to Trash.'),
      __('No Trash folder for this account.'),
    )
  return handleMoveThreads({ [mailboxIds.trash]: [mail.thread_id] })
}

// A stack's hover actions apply to its whole run in one operation — one request, one toast, one undo,
// rather than N of each. The row's own tooltips name the count. These take the same paths as the
// selection toolbar's bulk actions, and are safe to key off the active account because stacks are
// disabled in all-accounts search (see stackingEnabled).

const stackIDs = (threads: Thread[]) => threads.map((t) => t.thread_id)
const stackSetSeen = (threads: Thread[], seen: boolean) =>
  handleSetSeen({
    [Number(seen)]: stackIDs(threads),
  })
const stackArchive = (threads: Thread[]) => handleArchiveThreads(stackIDs(threads))
const stackTrash = (threads: Thread[]) =>
  handleMoveThreads({
    [mailboxIds.trash]: stackIDs(threads),
  })
const stackDelete = (threads: Thread[]) => junkOrDeleteThreads(stackIDs(threads), false)
const showEmptyMailbox = ref(false)
const emptyMailbox = useMutation(api.mail.mailboxes.empty)
async function emptyMailboxSubmit() {
  const input: InputOf<typeof api.mail.mailboxes.empty> = {
    account: store.accountId,
    mailbox,
  }
  await emptyMailbox.run(input)
  raiseToast(__('{0} emptied.', [mailboxName.value]))
  resetThreads()
}
const emptyMailboxOptions = computed(() => ({
  title: __('Empty {0}', [mailboxName.value]),
  message: __(`Are you sure you want to empty this folder?`),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: () => {
        emptyMailboxSubmit()
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
      return mailboxObj.value?._name ?? ''
  }
})
const unreadThreads = computed(() => mailboxObj.value?.unread_threads)
const unreadThreadsPrefix = computed(() => (unreadThreads.value ? `(${unreadThreads.value})` : ''))
const currentThread = computed(() =>
  threadRows.value?.find((t: Thread) => t.thread_id === threadID),
)
usePageMeta(() => {
  if (threadID) return appPageMeta(currentThread.value?.subject || __('[No Subject]'), 'Mail')
  return appPageMeta(`${unreadThreadsPrefix.value} ${mailboxName.value}`, 'Mail')
})
const title = computed(() => {
  if (selections.value.length)
    return selections.value.length === 1
      ? __('1 item selected')
      : __('{0} items selected', [String(selections.value.length)])
  if (mailbox === 'search') {
    // Null until the current search resolves — show a neutral label rather than a stale/zero count.
    if (searchTotal.value === null) return __('Searching…')
    return searchTotal.value === 1 ? __('1 result') : __('{0} results', [String(searchTotal.value)])
  }
  return filterTitle.value
})
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
