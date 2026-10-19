<template>
  <!-- Mobile title header — no thread count since the merged view has no total.
	     The toolbar below carries the bottom border, matching the mailbox structure. -->
  <MobileTitleHeader v-if="isMobile" with-menu with-search :title="folderLabel" />

  <!-- Header -->
  <!-- hidden on mobile: the title row carries the folder name, and the header's
	     actions are the compose button and the sidebar sheet. Hidden (not v-if) so HeaderActions'
	     modals stay mounted for the views' v-model bindings. -->
  <!-- Stretched, the padding inside, so a split Inbox's tabs can run the header's full height and
       underline on its border — as the mailbox list's header is. -->
  <header class="hidden items-stretch border-b px-3 sm:flex sm:px-5">
    <!-- h-12: one height with or without the Inbox's tabs. The title's crumb stands a little taller
         than the tabs and the actions, and the bar grew with it. -->
    <div class="flex h-12 min-w-0 flex-1 items-center space-x-2 py-2.5">
      <!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
      <Breadcrumbs
        v-if="!inboxTab"
        :items="[{ label: folderLabel, route: unifiedFolderRoute(folder) }]"
        class="-ml-0.5"
      />
      <!-- A split Inbox's tabs stand in for its title. -->
      <InboxHeaderTabs
        v-else
        class="-my-2.5 min-w-0 self-stretch"
        :tabs="inboxTabs"
        :active="inboxTab"
        :route-for="routeForTab"
      />
    </div>
    <div class="flex h-12 shrink-0 items-center py-2.5">
      <HeaderActions view-menu :inbox="folder === INBOX_FOLDER" />
    </div>
  </header>

  <div class="relative flex h-[calc(100dvh-3.05rem)] max-sm:min-h-0 max-sm:flex-1 max-sm:!h-auto">
    <!-- Loading -->
    <div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
      <div class="text-ink-gray-5 flex items-center space-x-2">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        <span>{{ __('Loading...') }}</span>
      </div>
    </div>

    <template v-else-if="threadRows.length || inboxTab || filter || filterChanged">
      <ThreadPane
        :thread-open="!!threadID"
        @touch-start="onThreadTouchStart"
        @touch-move="onThreadTouchMove"
        @touch-end="onThreadTouchEnd"
      >
        <template #list>
          <!-- The toolbar itself carries the bottom border here: unlike the mailbox
					     list, the merged one has no header block above the row for it to sit
					     under (its mobile title header is a sibling of ThreadPane). -->
          <InboxTabs
            v-if="isMobile && inboxTab"
            :tabs="inboxTabs"
            :active="inboxTab"
            :route-for="routeForTab"
          />

          <div v-if="isMobile && selections.length" class="border-b">
            <MobileSelectionHeader
              :count="selections.length"
              :all-selected="isAllSelected"
              @toggle-all="toggleSelectAll"
            />
          </div>
          <MailListToolbar
            v-else
            class="border-b"
            :title="title"
            :filter-options="FILTER_OPTIONS"
            :show-filter="!selections.length"
            :show-actions="!selections.length"
            :fetching="isFetching"
            @refresh="refreshThreads()"
          >
            <template v-if="!isMobile" #lead>
              <div class="mr-5">
                <SelectAllCheckbox
                  :selected="isAllSelected"
                  :some="selections.length > 0"
                  @toggle="toggleSelectAll"
                />
              </div>
            </template>
            <!-- The filters as chips, where the selector would go. -->
            <template v-if="!isMobile && !selections.length" #filter>
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
                :target="{ folder }"
              />
              <SelectActionButtons
                v-if="selections.length"
                :actions="selectActions"
                :collapsed="showReadingPane"
              />
            </template>
            <template v-if="clearScope" #mobile-actions>
              <ClearListMenu :scope="clearScope" :target="{ folder }" />
            </template>
          </MailListToolbar>

          <!-- Mail list -->
          <div
            ref="mailList"
            class="h-full overflow-y-auto overscroll-contain max-sm:pb-20"
            @focusin="onListFocusIn"
          >
            <!-- An empty tab keeps its tabs, and an empty filtered list its filter, to leave it by.
                 While a new tab or filter loads, the list area spins in its place. -->
            <div v-if="!threadRows.length && threads.isFetching" class="flex justify-center py-10">
              <LoaderCircle class="text-ink-gray-5 h-5 w-5 animate-spin" />
            </div>
            <p
              v-else-if="!threadRows.length"
              class="text-ink-gray-5 px-3 py-10 text-center text-p-sm sm:px-5"
            >
              {{
                filter
                  ? __('No mails found for the selected filter.')
                  : __('No mails in {0}.', [inboxTab ? tabName(inboxTab) : folderLabel])
              }}
            </p>
            <div v-for="(rows, key) in groupedRows" :key="key">
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
                    v-if="!isMobile || mobileSelectionMode"
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
								     members follow it as ordinary (indented) rows — the same model as the
								     mailbox list. -->
                <template v-for="row in rows" :key="row.key">
                  <StackListItem
                    v-if="row.type === 'stack'"
                    :drafts="folder === 'drafts'"
                    :threads="row.threads"
                    :expanded="row.expanded"
                    :is-selected="isStackSelected(row.threads.map(threadKey))"
                    :hide-avatar="!isMobile"
                    :account-label="shortAccountLabel(row.threads[0].account_name)"
                    :class="rowClasses(row)"
                    :data-row-key="row.key"
                    :unarchive="true"
                    @toggle="toggleStack(row)"
                    @set-seen="(seen: boolean) => setThreadsSeen(row.threads, seen)"
                    @archive-threads="archiveThreads(row.threads)"
                    @unarchive-threads="unarchiveThreads(row.threads)"
                    @trash-threads="trashThreads(row.threads)"
                    @delete-threads="confirmDelete(row.threads)"
                    @set-selected="
                      (selected: boolean) => toggleSelect(row.threads.map(threadKey), selected)
                    "
                  />
                  <MailListItem
                    v-else
                    :mailbox="row.thread.view_mailbox || ''"
                    :drafts="folder === 'drafts'"
                    :account-id="row.thread.account"
                    :account-label="shortAccountLabel(row.thread.account_name)"
                    :mail="row.thread"
                    :is-selected="selections.includes(threadKey(row.thread))"
                    :selection-mode="mobileSelectionMode"
                    :screened="screener.isScreened(row.thread)"
                    :outgoing="isOutgoingFolder"
                    :thread-route-name="UNIFIED_THREAD_ROUTE"
                    :hide-avatar="!isMobile"
                    :hide-sender="row.inStack"
                    :class="rowClasses(row)"
                    :data-row-key="row.key"
                    :unarchive="true"
                    @set-seen="(seen: boolean) => handleSetSeen(row.thread, seen)"
                    @archive-thread="handleArchive(row.thread)"
                    @unarchive-thread="handleUnarchive(row.thread)"
                    @trash-thread="handleTrash(row.thread)"
                    @delete-thread="confirmDelete([row.thread])"
                    @set-flagged="(flagged: boolean) => handleSetFlagged(row.thread, flagged)"
                    @set-selected="
                      (selected: boolean) => toggleSelect([threadKey(row.thread)], selected)
                    "
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
          v-if="openRow || !threadID"
          ref="mailThread"
          :slide="threadSlide"
          :account="openRow?.account"
          :mailbox="openRow?.view_mailbox || ''"
          :thread-i-d="threadID"
          :threads="headerThreadIDs"
          :can-go-next="canGoNext"
          :messages="openRow?.messages"
          @slide-done="threadSlide = ''"
          @reload-mails="reloadPaneThread()"
          @set-seen="(seen: boolean) => handleSetSeen(openRow!, seen, seen)"
          @set-flagged="
            (ids: string[], flagged: boolean) => handleSetFlagged(openRow!, flagged, ids)
          "
          @move-thread="(mailboxId: string) => moveOpenThread(mailboxId)"
          @delete-thread="
            isTrashFolder || folder === 'drafts' ? confirmDelete([openRow!]) : handleTrash(openRow!)
          "
          @archive-thread="handleArchive(openRow!)"
          @unarchive-thread="handleUnarchive(openRow!)"
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
      <p>{{ __('No mails in {0}.', [folderLabel]) }}</p>
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

  <Dialog v-model:open="showDelete" v-bind="deleteOptions" />
  <MobileSelectionBar :open="mobileSelectionMode" :actions="selectActions" />
</template>

<script setup lang="ts">
import { Breadcrumbs, Button, Checkbox, Dialog, usePageMeta } from 'frappe-ui'
import { LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { computed, inject, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client, useInfiniteQuery } from '@/api'
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
import StackListItem from '@/apps/mail/components/StackListItem.vue'
import ThreadPane from '@/apps/mail/components/ThreadPane.vue'
import { listScope } from '@/apps/mail/composables/useClearList'
import { closeComposeWindowFor } from '@/apps/mail/composables/useComposeWindow'
import { tabName, useInboxTabs } from '@/apps/mail/composables/useInboxTabs'
import { useKeptRead } from '@/apps/mail/composables/useKeptRead'
import { useListRows } from '@/apps/mail/composables/useListRows'
import { useListSelection } from '@/apps/mail/composables/useListSelection'
import { useMailRemoval } from '@/apps/mail/composables/useMailRemoval'
import { PAGE_LENGTH, usePaginatedThreads } from '@/apps/mail/composables/usePaginatedThreads'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { userStore } from '@/apps/mail/stores/user'
import type { Mail, Mailbox, MailboxData, MailCopy, Thread, UnifiedFolder } from '@/apps/mail/types'
import {
  commitAfterUndo,
  isMac,
  raiseError,
  raiseOptimisticToast,
  raiseToast,
  shouldIgnoreKeypress,
} from '@/apps/mail/utils'
import { useAccountScope } from '@/apps/mail/utils/accountScope'
import {
  useDiscardingDrafts,
  useListReload,
  useReadingPane,
  useScreenSize,
  useSwipeNav,
  useUndo,
} from '@/apps/mail/utils/composables'
import { useListFilter } from '@/apps/mail/utils/listFilter'
import {
  hasCursor,
  isNavigationKey,
  navigationOffset,
  neighbourAfterRemoval,
  stepFromKey,
  useGPrefix,
} from '@/apps/mail/utils/listNavigation'
import { mailCopies, mailCopyIds, threadStarIds } from '@/apps/mail/utils/mailCopies'
import {
  archivable,
  holdsReceivedMail,
  isReceived,
  unarchivable,
} from '@/apps/mail/utils/receivedMail'
import { selectActions as buildSelectActions } from '@/apps/mail/utils/selectActions'
import { threadRow } from '@/apps/mail/utils/threadRows'
import {
  INBOX_FOLDER,
  STARRED_FOLDER,
  UNIFIED_ROUTE,
  UNIFIED_THREAD_ROUTE,
  unifiedFolderLabel,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { appPageMeta } from '@/platform/page-meta'

const { isMobile } = useScreenSize()
const { listReloadRequest } = useListReload()
const showReadingPane = useReadingPane()

// Mail from a sender nobody has decided on yet is marked in the list, as in a single account's.
const screener = useScreener()

// The `mail-unified-mail` route carries the open thread's owning accountId and mailbox. The
// mailbox falls through as a plain attribute — every row carries its own folder ids, which is what
// the pane and its actions target — and this component (a fragment) cannot inherit attributes, so it
// inherits nothing. accountId is read: it is half of the open thread's identity here (see openKey).
defineOptions({
  inheritAttrs: false,
})
const { folder, accountId, threadID } = defineProps<{
  // The folder's slug, the same in every account (see utils/unifiedFolders).
  folder: string
  accountId?: string
  threadID?: string
}>()
const route = useRoute()
const router = useRouter()
const socket = inject('$socket')
const store = userStore()

const folderLabel = computed(() => unifiedFolderLabel(folder, store.unifiedFolders.data))

// Read off the slug rather than any one account's mailbox ids, which differ from row to row.
const isTrashFolder = computed(() => folder === 'trash')
const isJunkFolder = computed(() => folder === 'junk')

// Sent and Drafts are about who the mail is going to, so their rows name the recipients.
const isOutgoingFolder = computed(() => folder === 'sent' || folder === 'drafts')

// ── Infinite scroll ─────────────────────────────────────────────────────────────────────────────
// The loaded list (threadRows.value) is the single source of truth; usePaginatedThreads owns everything
// around it — the epochs, the refresh merge, the sentinel, the edge crossing. Rows are keyed by
// account + thread_id since the same thread_id can recur across accounts in this merged view.
const threadKey = (thread: Thread) => `${thread.account}:${thread.thread_id}`

/**
 * The open thread's key, from the two route params that name it.
 *
 * A thread id is only unique within its account — they are short per-account counters, so two
 * inboxes of similar size hold the same ones — and this list spans accounts. Everything that
 * resolves or steps through threads works in key space for that reason: the row the pane is
 * showing, the cursor, the prev/next step, and the row a verdict moves on from.
 */
const openKey = computed(() => (accountId && threadID ? `${accountId}:${threadID}` : undefined))
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
  query: () => threads,
  rows: () => threadRows.value,
  openThreadID: () => openKey.value,
  // A step off the loaded edge opens the appended thread when the pane is showing, and otherwise
  // just takes the cursor to it — onto whatever row stands for it (see rowForThread).
  onEdgeThread: (key, action) => (action === 'open' ? openThread(key) : focusOnThread(key)),
  threadKey,
  // Deferred read — visibleThreadCount is declared below, with the rows it counts.
  fillProgress: () => visibleThreadCount.value,
})

// The list's filters, their menu, and its title (see useListFilter) — all shared with the mailbox
// list.
const {
  filter,
  changed: filterChanged,
  FILTER_OPTIONS,
  filterTitle: title,
  reloadFilter,
  clear: clearFilter,
} = useListFilter({
  onChange: () => resetThreads(),
  starrable: () => folder !== STARRED_FOLDER && !isTrashFolder.value,
  // The merged Inbox, when any of the accounts screens new senders.
  screenable: () =>
    folder === INBOX_FOLDER && !!store.userResource.data?.accounts?.some((a) => a.enable_screening),
})

// The Inbox's category tabs, across every account; `inboxTab` is the open one, and undefined in any
// other folder or when the Inbox isn't split.
const {
  tabs: inboxTabs,
  active: inboxTab,
  routeFor: routeForTab,
  switched: tabSwitched,
} = useInboxTabs(
  () => folder === INBOX_FOLDER && 'unified',
  () => unifiedFolderRoute(folder),
  () => resetThreads(),
)
// What the list's menu clears (see listScope). Not offered where there is no folder to clear
// (Starred) or nothing unread to clear (Sent, Drafts).
const clearScope = computed(() =>
  folder === STARRED_FOLDER || isOutgoingFolder.value
    ? undefined
    : listScope(inboxTab.value, folderLabel.value, filter.value),
)

// The engine owns loaded windows and refreshes their rows together.
const threads = useInfiniteQuery(api.mail.unified.threads, () => ({
  folder,
  limit: PAGE_LENGTH,
  start: 0,
  filter_by: filter.value,
  category: inboxTab.value,
}))
// Drafts discarded but still inside their Undo window are off the list, not yet off the server.
// Held by message id, so only a row made of those drafts goes: the conversation a reply draft
// belongs to keeps its row in every other folder.
const {
  isDiscarding: isDiscardingDraft,
  withoutHeldDrafts,
  holdDraft,
  releaseDraft,
} = useDiscardingDrafts()
// Filtered to unread mail, what is read here stays until the list changes (see useKeptRead).
const keptRead = useKeptRead({
  filtering: () => !!filter.value?.split(',').includes('unread'),
  scope: () => [folder, filter.value, inboxTab.value],
  key: threadKey,
})
const threadRows = computed(() =>
  keptRead.withKept(
    threads.rows
      .map((row) => threadRow(row, store.accountId))
      .filter((row) => !isDiscardingDraft(row, { inDrafts: folder === 'drafts' }))
      .map(withoutHeldDrafts),
  ),
)
watch(threadRows, keptRead.keep)
const isLoading = computed(
  () =>
    threads.status === 'pending' && !(tabSwitched.value && inboxTab.value) && !filterChanged.value,
)

// After an action, and on the poll: every count the sidebar shows, the merged folders' included.
const refreshCounts = () => void store.refreshCounts()

// The row's account, by its short name: blank for the currently open account (only
// the odd ones out get labelled), the local part otherwise, unless two accounts share one.
const shortAccountLabel = (name?: string | null) =>
  name ? (store.accountShortNames[name] ?? name) : undefined

// Filters and folder changes reset engine paging; reset the corresponding presentation state too.
const resetThreads = () => {
  // A reset replaces the list with a fresh first window, so any prior collapse or stack expansion no
  // longer maps to what's shown — clear them (else a group collapsed under one filter stays collapsed
  // and hides its threads).
  collapsedGroups.value = []
  expandedStacks.value = new Set()
  // Ticked threads belong to the list they were ticked in; another folder or filter starts clear.
  resetSelections()
  void threads.refetch().catch(() => {})
  refreshCounts()
}

// Refresh the loaded windows without changing the reader's selection.
const refreshThreads = (reloadCounts = true) => {
  if (isFetching.value) return
  void threads.refetch().catch(() => {})
  if (reloadCounts) refreshCounts()
}

// A verdict on a sender, from the pane or anywhere else, changes which rows are waiting: the
// "Unknown sender" filter drops the ones decided.
watch(useScreener().version, () => refreshThreads(false))

// The layout's composer, announcing that it sent something (see useListReload). A refresh rather
// than a reset, so the reader keeps their place in a list that spans every account.
watch(listReloadRequest, () => refreshThreads())

// The pane asked for a reload (a reply was sent, a message deleted, …). The list refresh keeps
// already-loaded rows to hold the reader's place (see usePaginatedThreads), so it never updates the
// open row — refetch the thread directly, scoped to its owning account, and write it onto the row so
// the pane re-derives from fresh messages. MailboxView resets its whole list instead; doing that here
// would blank the pane for any row outside the first window (the pane only renders loaded rows).
const reloadPaneThread = () => refreshThreads()

// The rendered rows and the keyboard cursor: date groups, stacks, and the marker that walks them —
// all shared with the mailbox list (see useListRows). Chatty senders stack here exactly as they do
// there: buildListRows keys runs by account + day + sender, so a run never mixes accounts even in
// this merged list. And not in the same folders: every row in Sent or Drafts is from the reader, and
// Starred is curated by hand (see MailboxView's stackingEnabled).
const {
  groupedByDate,
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
  // Account-qualified, both of them: the cursor can be pointed straight at a thread, and it lands
  // on the right account's row when two of them share a thread id.
  rowKey: threadKey,
  threadKey,
  stackingEnabled: () => !isOutgoingFolder.value && folder !== STARRED_FOLDER,
  openThreadID: () => openKey.value,
  onOpenThreadHidden: () => closeThread(),
  container: mailListRef,
})

// The ticked threads and the phone's selection mode, as in a single account's list (see
// useListSelection). Ticked threads are named by key, since thread ids repeat across accounts.
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
const selectedRows = computed(() =>
  (threadRows.value ?? []).filter((t: Thread) => selections.value.includes(threadKey(t))),
)

// ThreadHeader's prev/next arrows compare their list against the route's plain thread id, so they
// get plain ids. Key space is for stepping and resolution — where landing on the wrong account's
// duplicate actually shows the wrong mail; here it would only mis-grey an arrow.
const headerThreadIDs = computed(() => (threadRows.value ?? []).map((t: Thread) => t.thread_id))

// The loaded row the open thread belongs to. Every mutation reads its account/archive/trash
// off the row, so the pane acts on the owning account without consulting the active one.
const openRow = computed(() =>
  openKey.value
    ? (threadRows.value ?? []).find((t: Thread) => threadKey(t) === openKey.value)
    : undefined,
)

// MailThread's slide name while a swipe navigation renders; cleared on its slide-done, and left
// empty for every other thread change so taps and arrows keep swapping instantly.
const threadSlide = ref('')
let pendingThreadSlide = ''

// Swipe on the open thread (mobile): left → next thread, right → previous.
const {
  onTouchStart: onThreadTouchStart,
  onTouchMove: onThreadTouchMove,
  onTouchEnd: onThreadTouchEnd,
} = useSwipeNav(
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

// Up/down/j/k walk the list, or the open thread when one is showing.
const gPrefix = useGPrefix()

// Thread shortcuts, acting on the open thread or — with none open — the row under the cursor.
// Each one goes through the row handlers, which read the account and its folder ids off the row
// itself, so a shortcut in the merged list targets the owning account like a click does.
// Returns true when it consumed the key.
const actionTarget = computed(() => {
  const key = openKey.value ?? focusedRowKey.value
  return (threadRows.value ?? []).find((t: Thread) => threadKey(t) === key)
})
const handleThreadActions = (e: KeyboardEvent, key: string) => {
  // Ticked threads take the shortcut first, as in a single account's list.
  if (selections.value.length) return handleSelectionShortcut(e, key)
  const thread = actionTarget.value
  if (!thread) return false

  // Backspace on Mac, Delete elsewhere.
  if (key === (isMac ? 'backspace' : 'delete')) {
    e.preventDefault()
    if (folder === 'drafts') confirmDelete([thread])
    else handleTrash(thread)
    return true
  }
  if (key === 'u') {
    e.preventDefault()
    handleSetSeen(thread, e.shiftKey)
    return true
  }
  // Archive and Unarchive share a place, so E does whichever it shows, and nothing where neither
  // has anything to do.
  const messages = thread.messages?.length ? thread.messages : [thread]
  if (key === 'e') {
    e.preventDefault()
    if (archivable(messages, thread)) handleArchive(thread)
    else if (unarchivable(messages, thread)) handleUnarchive(thread)
    return true
  }

  // Junk takes only mail you received; Not junk, in Junk, whatever is there.
  if (key === '!') {
    e.preventDefault()
    if (isJunkFolder.value) handleSetSpamStatus(false, thread)
    else if (holdsReceivedMail(messages, thread.sent)) handleSetSpamStatus(true, thread)
    return true
  }
  return false
}
const handleSelectionShortcut = (e: KeyboardEvent, key: string) => {
  const action = {
    [isMac ? 'backspace' : 'delete']:
      isTrashFolder.value || folder === 'drafts' ? deleteSelected : trashSelected,
    u: () => setThreadsSeen(takeSelected(), e.shiftKey),
    // As on one thread: whichever of Archive and Unarchive the toolbar shows.
    e: () => {
      const rows = selectedRows.value
      const messagesOf = (t: Thread) => (t.messages?.length ? t.messages : [t])
      if (rows.some((t) => archivable(messagesOf(t), t))) archiveSelected()
      else if (rows.some((t) => unarchivable(messagesOf(t), t))) unarchiveThreads(takeSelected())
    },
    '!': () => setThreadsSpam(takeSelected(), !isJunkFolder.value),
  }[key]
  if (!action) return false
  e.preventDefault()
  action()
  return true
}
const handleKeyDown = (e: KeyboardEvent) => {
  const key = e.key.toLowerCase()
  if ((e.metaKey || e.ctrlKey) && key === 'a' && !shouldIgnoreKeypress(e, true)) {
    e.preventDefault()
    gPrefix.disarm()
    return toggleSelectAll(true)
  }
  if (shouldIgnoreKeypress(e)) return

  // Escape backs out of the open thread, then clears the selection, then the cursor.
  if (key === 'escape') {
    e.preventDefault()
    if (threadID) return closeThread()
    if (selections.value.length) return resetSelections()
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
  if (row.type === 'thread') return openThread(threadKey(row.thread))
  if (row.type === 'stack') return toggleStack(row)
  if (!isLastGroup(row.dateKey)) toggleGroupCollapse(row.dateKey)
}

// The open thread keeps its row in view, as the mailbox list does: stepping prev/next or deep-linking
// scrolls the merged list along, and the cursor follows so keyboard navigation resumes from it.
watch(openKey, (key) => key && revealThread(key), {
  immediate: true,
})

// `at()` so -1 reads as the last loaded thread. With a thread open the jump opens the edge one;
// otherwise it just moves the cursor there, mirroring the mailbox list.
const goToEdge = (index: number) => {
  if (threadID) {
    const next = threadIDs.value.at(index)
    return next && openThread(next)
  }
  focusRow(navigableRows.value.at(index))
}
const openThread = (key: string) => {
  threadSlide.value = pendingThreadSlide
  const row = (threadRows.value ?? []).find((t: Thread) => threadKey(t) === key)
  if (!row) return
  router.push({
    name: UNIFIED_THREAD_ROUTE,
    // The row's own ids, which is what the key was made of — and what the pane, its actions and
    // the URL all need in their plain form.
    params: { folder, accountId: row.account, threadID: row.thread_id },
    query: route.query,
  })
}

// Archive and Trash already have optimistic list removal; anything else is a plain move.
const moveOpenThread = (mailboxId: string) => {
  const row = openRow.value
  if (row) fileThreads([row], 'move', { target: mailboxId })
}

// Keep infinite scroll alive while the rendered list is too short to scroll (see topUpIfShort). Must
// stay below groupedRows: `watch` reads its source at setup.
watch(groupedRows, topUpIfShort)

// Per-item actions — each row carries its own account + that account's mailbox ids, so actions target
// the correct JMAP account without touching the active-account state.
const messageIds = (thread: Thread) => (thread.messages ?? []).map((m) => m.id)

// Each invocation passes its row's account through the shared mutation queue.
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
type PaneCommand =
  | {
      kind: 'add'
      input: {
        ids: string[]
        mailbox_id: string
      }
    }
  | {
      kind: 'remove'
      input: {
        ids: string[]
        mailbox_id: string
      }
    }

function runPaneCommand(command: PaneCommand, account?: string) {
  const acting = account ?? openRow.value?.account
  if (!acting) return Promise.reject(new Error(__('Thread is no longer in the list.')))
  switch (command.kind) {
    case 'add':
      return client.mutation(api.mail.messages.addToFolder, {
        ...command.input,
        account: acting,
      })
    case 'remove':
      return client.mutation(api.mail.messages.removeFromFolder, {
        ...command.input,
        account: acting,
      })
  }
}
const messageIdsOf = (thread: Thread) => thread.messages?.flatMap(mailCopyIds) ?? [thread.id]

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
  removeMailFromView: (mailId: string) => {
    emptied: boolean
    rollback: () => void
  }
}>('mailThread')

// Folder membership shows as tags on the row and in the pane. Neither refetches, so both have to be
// told — mirroring syncListMailboxMembership plus MailThread's own syncMailboxMembership.
const syncFolderTag = (mailboxId: string, add: boolean) => {
  const mb = paneScope.mailboxes.value.data?.find((m: MailboxData) => m.id === mailboxId)
  const thread = openRow.value
  if (!mb || !thread) return
  const entry = {
    mailbox: mb.name,
    mailbox_id: mb.id,
    mailbox_name: mb._name,
  }
  const apply = (item: { mailboxes: Mailbox[] }) => {
    if (add) {
      if (!item.mailboxes.some((m) => m.mailbox_id === mailboxId))
        item.mailboxes.push({
          ...entry,
        })
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
  // Not a draft, ever; and your own mail never into the Inbox or Archive (see filing.py).
  const ids = (thread.messages ?? [])
    .flatMap(mailCopies)
    .filter(
      (m) =>
        !m.draft &&
        (![thread.inbox, thread.archive].includes(mailboxId) || isReceived(m, thread.sent)),
    )
    .map((m) => m.id)
  if (!ids.length) return
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
    runPaneCommand(
      {
        kind: 'add',
        input: {
          ids,
          mailbox_id: mailboxId,
        },
      },
      thread.account,
    ).catch((error) => {
      syncFolderTag(mailboxId, false)
      throw error
    }),
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
    runPaneCommand(
      {
        kind: 'remove',
        input: {
          ids: messageIdsOf(thread),
          mailbox_id: mailboxId,
        },
      },
      thread.account,
    ).catch((error) => {
      syncFolderTag(mailboxId, true)
      throw error
    }),
    folder ? __('Thread removed from {0}.', [folder]) : __('Thread removed from folder.'),
    undoAction,
  )
}
const handleSetSpamStatus = (spam: boolean, target?: Thread) => {
  const thread = target ?? openRow.value
  // Not junk accepts the sender, in the same request, as a single account's list does.
  if (thread)
    fileThreads([thread], spam ? 'junk' : 'not_junk', { screenAction: spam ? null : 'Accepted' })
}

// Per-message actions from a message's own menu, on the shared orchestration (see useMailRemoval).
// Each row carries the mailbox it was listed from, which is what it is summarised and dated by.
const { setUndoAction, retireUndoAction } = useUndo()
const { runMailRemoval } = useMailRemoval({
  row: () => openRow.value,
  mailThreadRef: mailThread,
  onEmptied: () => closeThread(),
  // Its last message gone, a conversation kept read on the list goes too; a failure keeps it again.
  removeRow: (_mail, thread) => {
    if (thread) keptRead.release([threadKey(thread)])
    // Put back only on the list it left: another filter or folder since has rules of its own.
    const at = keptRead.current()
    return () => {
      if (thread) keptRead.restore([thread], at)
      refreshThreads()
    }
  },
  viewMailbox: (thread) => thread.view_mailbox,
  outgoing: () => isOutgoingFolder.value,
})

// The pane's folder menus are scoped to the thread's own account, so its ids have to be resolved
// there too — the active account's list won't contain them for a thread from another account, and
// the lookup silently failing meant no folder tag appeared until a reload.
const paneScope = useAccountScope(() => openRow.value?.account)
const folderName = (mailboxId: string) =>
  paneScope.mailboxes.value.data?.find((m: MailboxData) => m.id === mailboxId)?._name
const undoMail = (mail: Mail, account: string | undefined, undoSuccess: string) => {
  // Every copy, as filing moved them all (see fileMail).
  const snapshots = mailCopies(mail).map(mailSnapshot)
  return {
    undoReq: () => restoreMails(account!, snapshots),
    undoSuccess,
  }
}
// One message and its copies, by the same rules as a conversation (see fileThreads).
const fileMail = (mail: Mail, account: string | undefined, action: Filing, target?: string) =>
  account
    ? client.mutation(api.mail.messages.file, {
        account,
        ids: mailCopyIds(mail),
        action,
        mailbox: target ?? null,
        screen_action: action === 'not_junk' ? 'Accepted' : null,
      })
    : Promise.reject(new Error(__('Thread is no longer in the list.')))
const handleMailMove = (mail: Mail, target: string) => {
  const account = openRow.value?.account
  const folder = folderName(target)
  runMailRemoval(
    mail,
    () => fileMail(mail, account, 'move', target),
    folder ? __('Mail moved to {0}.', [folder]) : __('Mail moved.'),
    undoMail(mail, account, __('Mail moved back.')),
  )
}
const handleMailSpam = (mail: Mail, spam: boolean) => {
  const account = openRow.value?.account
  runMailRemoval(
    mail,
    () => fileMail(mail, account, spam ? 'junk' : 'not_junk'),
    spam ? __('Mail marked as Junk.') : __('Mail marked as Not Junk.'),
    // Undo flips the junk status back — name the resulting state, like the forward toast does.
    undoMail(mail, account, __('Mail marked as {0}.', [spam ? __('Not Junk') : __('Junk')])),
  )
}
const handleMailDelete = (mail: Mail) =>
  runMailRemoval(
    mail,
    () =>
      client.mutation(api.mail.messages.delete, {
        names: [mail.name],
      }),
    __('Mail deleted.'),
  )
const closeThread = () =>
  router.push({ name: UNIFIED_ROUTE, params: { folder }, query: route.query })
const handleSetSeen = (thread: Thread, seen: boolean, silent = false) => {
  if (thread.seen === (seen ? 1 : 0)) return

  // Marking the open thread unread means "come back to this later", so leave the pane — staying
  // in it would just mark it read again. Same exit as useThreadActions does for the mailbox list.
  if (!seen && openKey.value === threadKey(thread)) closeThread()
  const applySeen = (value: 0 | 1) => {
    thread.seen = value
    thread.messages?.forEach((m) => (m.seen = value))
  }
  applySeen(seen ? 1 : 0)
  const request = client
    .mutation(api.mail.messages.seen, {
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
const handleSetFlagged = (
  thread: Thread,
  flagged: boolean,
  ids: string[] = threadStarIds(thread, flagged),
) => {
  // The row stands for its representative mail (see serialize_thread), so it takes the star only
  // when that mail is one of the ones being starred.
  const rowChanged = ids.includes(thread.id)
  const applyRow = (value: 0 | 1) => {
    if (rowChanged) thread.flagged = value
  }
  const applyPane = (value: boolean) => {
    if (openKey.value === threadKey(thread)) mailThread.value?.syncFlagged(ids, value)
  }
  applyRow(flagged ? 1 : 0)
  applyPane(flagged)
  client
    .mutation(api.mail.messages.flag, {
      account: thread.account,
      ids,
      flagged,
    })
    .catch((error) => {
      // revert the optimistic update
      applyRow(flagged ? 0 : 1)
      applyPane(!flagged)
      raiseError(error)
    })
}

// The row is already dropped optimistically by the caller, so move on the server directly. On success just
// refresh counts (the row and its server row are both gone, so the append offset stays aligned and scroll is
// preserved). On failure, restore the row in place via the passed closure; rethrow so the toast reports the error.
// Acting on the open thread from the pane should leave you on the next one, not on a thread that
// is no longer in the list. Resolved before the row is removed, so the index is still meaningful;
// falls back to closing the pane at the end of the list. Mirrors MailboxView.
const goToNextThreadOrClose = (moved: string | string[]) => {
  const movedKeys = new Set(Array.isArray(moved) ? moved : [moved])
  if (!openKey.value || !movedKeys.has(openKey.value)) return
  const keys = threadIDs.value
  // Below first, then above — the same turn-around the mailbox makes at the end of the list.
  const next = neighbourAfterRemoval(
    keys,
    keys.indexOf(openKey.value),
    (key) => !movedKeys.has(key),
  )
  if (next) openThread(next)
  else closeThread()
}

// Undo restores each mail's exact mailbox set and junk flag rather than guessing an inverse: a
// thread that sat in two folders has to come back to both, and un-junking is not the same as moving.
const mailSnapshot = (mail: MailCopy) => ({
  id: mail.id,
  mailbox_ids: mail.mailboxes.map((m) => m.mailbox_id),
  junk: mail.junk,
})
const threadSnapshot = (thread: Thread) => (thread.messages ?? []).map(mailSnapshot)
// `screenAction` takes back the sender verdict the action gave (Not junk's Accepted), with the mail.
const restoreMails = (
  account: string,
  mails: ReturnType<typeof mailSnapshot>[],
  screenAction: string | null = null,
) =>
  client
    .mutation(api.mail.messages.setFolders, {
      account,
      mails,
      screen_action: screenAction,
    })
    .then(refreshCounts)

// Archive, Unarchive, Move, Junk, Not junk and Trash, on one thread or several, by the filing rules
// (suite/mail/filing.py), as in a single account's list: mail you received goes where it is filed,
// your sent mail never leaves Sent but by Trash, a draft is never filed. One request per account,
// carrying every copy of every message; one Undo puts back exactly what each account's request moved.
type Filing = 'archive' | 'unarchive' | 'move' | 'junk' | 'not_junk' | 'trash'
// Whether the conversation leaves this folder's list. Sent and Starred keep it whatever is filed:
// your sent mail stays, and so may the star.
const leavesFolder = (action: Filing, thread: Thread, target?: string) => {
  if (action === 'trash') return !isTrashFolder.value
  if (folder === 'sent' || folder === STARRED_FOLDER) return false
  if (action === 'archive') return [INBOX_FOLDER, 'junk', 'trash'].includes(folder)
  if (action === 'unarchive') return folder === 'archive'
  if (action === 'junk') return !isJunkFolder.value
  if (action === 'not_junk') return isJunkFolder.value
  return target !== thread.view_mailbox
}
const fileThreads = (
  threads: Thread[],
  action: Filing,
  { target, screenAction }: { target?: string; screenAction?: string | null } = {},
) => {
  if (!threads.length) return
  const leaves = leavesFolder(action, threads[0], target)
  // The next thread is found on the list as it stands, the conversations still on it. Rows read in
  // the Unread filter go back on that list on Undo, or if the action fails (see useKeptRead).
  const at = keptRead.current()
  if (leaves) {
    goToNextThreadOrClose(threads.map(threadKey))
    keptRead.release(threads.map(threadKey))
  }
  if (action === 'trash' || action === 'junk') closeComposeWindowFor(copyIds(threads))
  const one = threads.length === 1
  const folderOfTarget = target ? folderName(target) : undefined
  const done = (answers: unknown[]) => {
    if (action === 'archive')
      return !answers.some((a) => (a as { left_inbox?: boolean })?.left_inbox)
        ? __('Added to Archive.')
        : one
          ? __('Thread archived.')
          : __('Threads archived.')
    if (action === 'unarchive') return one ? __('Thread unarchived.') : __('Threads unarchived.')
    if (action === 'trash')
      return one ? __('Thread moved to Trash.') : __('Threads moved to Trash.')
    if (action === 'junk' || action === 'not_junk') {
      const state = action === 'junk' ? __('Junk') : __('Not Junk')
      return one ? __('Thread marked as {0}.', [state]) : __('Threads marked as {0}.', [state])
    }
    return folderOfTarget
      ? one
        ? __('Thread moved to {0}.', [folderOfTarget])
        : __('Threads moved to {0}.', [folderOfTarget])
      : __('Thread moved.')
  }
  const undone =
    action === 'junk'
      ? one
        ? __('Thread marked as Not Junk.')
        : __('Threads marked as Not Junk.')
      : action === 'not_junk'
        ? one
          ? __('Thread marked as Junk.')
          : __('Threads marked as Junk.')
        : one
          ? __('Thread moved back.')
          : __('Threads moved back.')
  actPerAccount(
    threads,
    (account, rows) =>
      client
        .mutation(api.mail.messages.file, {
          account,
          ids: copyIds(rows),
          action,
          mailbox: target ?? null,
          screen_action: screenAction ?? null,
          leaves: leaves ? folder : null,
        })
        .then((filed) => {
          // A list that keeps the rows reads them again for their new folders.
          if (!leaves) refreshThreads()
          return filed
        }),
    done,
    undone,
    {
      // Not junk accepted the senders; Undo puts them back as junk senders, as it puts the mail
      // back in Junk.
      undoScreen:
        screenAction === 'Accepted' ? 'Spam' : screenAction === 'Spam' ? 'Accepted' : null,
      putBack: leaves ? (rows) => keptRead.restore(rows, at) : undefined,
    },
  )
}
const handleArchive = (thread: Thread) => fileThreads([thread], 'archive')
const handleUnarchive = (thread: Thread) => fileThreads([thread], 'unarchive')
const handleTrash = (thread: Thread) => fileThreads([thread], 'trash')

// Actions on several threads at once: a stack's run, or the ticked threads. They can span accounts,
// so each runs once per account, with that account's own folder ids, and one Undo puts every
// account's mail back as it was.
const byAccount = (threads: Thread[]) => {
  const groups = new Map<string, Thread[]>()
  threads.forEach((t) => groups.set(t.account, [...(groups.get(t.account) ?? []), t]))
  return [...groups.entries()]
}
const perAccount = (
  threads: Thread[],
  request: (account: string, rows: Thread[]) => Promise<unknown>,
) => Promise.all(byAccount(threads).map(([account, rows]) => request(account, rows)))

// The ids an action on several threads carries, and the state its Undo puts back: every copy of every
// message (see mailCopies), so a twin in Sent goes and comes back with the rest.
const copyIds = (threads: Thread[]) =>
  threads.flatMap((t) => t.messages?.flatMap(mailCopyIds) ?? [t.id])
const copySnapshot = (threads: Thread[]) =>
  threads.flatMap((t) => (t.messages ?? []).flatMap(mailCopies)).map(mailSnapshot)

// Runs `request` once per account, and arms an Undo that puts back exactly the accounts whose request
// went through, as they were. The Undo waits for every account to answer (a restore that ran first
// would be overwritten), so when one account fails the others can still be taken back: the error
// toast offers the Undo too.
const actPerAccount = (
  threads: Thread[],
  request: (account: string, rows: Thread[]) => Promise<unknown>,
  done: string | ((answers: unknown[]) => string),
  undoSuccess: string,
  {
    undoScreen = null,
    putBack,
  }: {
    /** The sender verdict Undo gives, taking back the action's. */
    undoScreen?: string | null
    /** Puts back on the list the given rows the action took off it, which the server won't list
     * again: an account's whose action was undone, or refused. */
    putBack?: (rows: Thread[]) => void
  } = {},
) => {
  const groups = byAccount(threads)
  const snapshots = groups.map(([account, rows]) => [account, copySnapshot(rows)] as const)
  const settled = Promise.allSettled(groups.map(([account, rows]) => request(account, rows)))
  const landed = settled.then((results) =>
    groups.filter((_, i) => results[i].status === 'fulfilled').map(([account]) => account),
  )
  const undoAction = () =>
    void landed.then((accounts) => {
      const restoring = snapshots.filter(([account]) => accounts.includes(account))
      if (!restoring.length) return
      putBack?.(
        groups.filter(([account]) => accounts.includes(account)).flatMap(([, rows]) => rows),
      )
      raiseOptimisticToast(
        Promise.all(
          restoring.map(([account, mails]) => restoreMails(account, mails, undoScreen)),
        ).then(() => refreshThreads()),
        undoSuccess,
      )
    })
  setUndoAction(undoAction)
  void settled.then((results) => {
    refreshCounts()
    // An account whose request was refused may have had some of its mail changed first: that is
    // put back as it was, since its Undo is gone.
    const refused = snapshots.filter((_, i) => results[i].status === 'rejected')
    refused.forEach(([account, mails]) => void restoreMails(account, mails).catch(() => {}))
    if (refused.length)
      putBack?.(
        groups.filter((_, i) => results[i].status === 'rejected').flatMap(([, rows]) => rows),
      )
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    const undo = { label: __('Undo'), onClick: undoAction }
    const answers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (!failure)
      return raiseToast(typeof done === 'string' ? done : done(answers), 'success', undo)
    refreshThreads()
    const someLanded = results.some((r) => r.status === 'fulfilled')
    raiseToast(
      (failure.reason as Error)?.message || __('Action failed.'),
      'error',
      someLanded ? undo : undefined,
    )
  })
}

const setThreadsSeen = (threads: Thread[], seen: boolean) => {
  const changed = threads.filter((t) => t.seen !== (seen ? 1 : 0))
  if (!changed.length) return
  const applySeen = (value: 0 | 1) =>
    changed.forEach((t) => {
      t.seen = value
      t.messages?.forEach((m) => (m.seen = value))
    })
  applySeen(seen ? 1 : 0)
  raiseOptimisticToast(
    perAccount(changed, (account, rows) =>
      client.mutation(api.mail.messages.seen, { account, ids: copyIds(rows), seen }),
    )
      .then(refreshCounts)
      .catch((error) => {
        applySeen(seen ? 0 : 1) // revert the optimistic update
        throw error
      }),
    __('Threads marked as {0}.', [seen ? __('read') : __('unread')]),
  )
}

const setThreadsFlagged = (threads: Thread[], flagged: boolean) => {
  const changed = threads.filter((t) => t.flagged !== (flagged ? 1 : 0))
  if (!changed.length) return
  const apply = (value: 0 | 1) => changed.forEach((t) => (t.flagged = value))
  apply(flagged ? 1 : 0)
  perAccount(changed, (account, rows) =>
    client.mutation(api.mail.messages.flag, {
      account,
      ids: rows.flatMap((row) => threadStarIds(row, flagged)),
      flagged,
    }),
  ).catch((error) => {
    apply(flagged ? 0 : 1) // revert the optimistic update
    raiseError(error)
  })
}

const setThreadsSpam = (threads: Thread[], spam: boolean) =>
  fileThreads(threads, spam ? 'junk' : 'not_junk', { screenAction: spam ? null : 'Accepted' })

// Plurals of the single-thread messages, as the mailbox list does — it never prefixes a count.
const archiveThreads = (threads: Thread[]) => fileThreads(threads, 'archive')
const unarchiveThreads = (threads: Thread[]) => fileThreads(threads, 'unarchive')
const trashThreads = (threads: Thread[]) => fileThreads(threads, 'trash')

// The ticked threads, taken: an action on them clears the selection, as in a single account's list.
const takeSelected = () => {
  const rows = selectedRows.value
  resetSelections()
  return rows
}
const archiveSelected = () => archiveThreads(takeSelected())
const trashSelected = () => trashThreads(takeSelected())
const deleteSelected = () => confirmDelete(takeSelected())

const selectActions = buildSelectActions(
  () => selectedRows.value,
  () => ({
    archive: folder === 'archive',
    trash: isTrashFolder.value,
    drafts: folder === 'drafts',
  }),
  {
    star: () => setThreadsFlagged(takeSelected(), true),
    unstar: () => setThreadsFlagged(takeSelected(), false),
    archive: archiveSelected,
    unarchive: () => unarchiveThreads(takeSelected()),
    junk: () => setThreadsSpam(takeSelected(), true),
    notJunk: () => setThreadsSpam(takeSelected(), false),
    trash: trashSelected,
    delete: deleteSelected,
    read: () => setThreadsSeen(takeSelected(), true),
    unread: () => setThreadsSeen(takeSelected(), false),
  },
)

// Permanent delete, offered once the threads are already in Trash. Each row names its own account,
// and a stack never mixes accounts, so one request covers each confirmation. Only the copies in Trash
// go: the rest of the conversation lives on in the folders it was filed in.
const showDelete = ref(false)
const toDelete = ref<Thread[]>([])

const confirmDelete = (rows: Thread[]) => {
  if (!rows.length) return
  if (folder === 'drafts') return discardDrafts(rows)
  toDelete.value = rows
  showDelete.value = true
}

const deleteOptions = computed(() => {
  const many = toDelete.value.length > 1
  return {
    title: many ? __('Delete {0} Threads', [toDelete.value.length]) : __('Delete Thread'),
    message: __('Are you sure you want to permanently delete the selected {0}?', [
      many ? __('threads') : __('thread'),
    ]),
    actions: [
      {
        label: __('Confirm'),
        variant: 'solid' as const,
        autofocus: true,
        onClick: () => {
          showDelete.value = false
          handleDelete(toDelete.value)
        },
      },
    ],
  }
})

// The copies a removal takes from the folder on screen: in Trash the trashed ones, in Drafts the
// drafts. The rest of the conversation lives on in the folders it was filed in.
const copiesHere = (rows: Thread[]) =>
  rows.flatMap((thread) =>
    (thread.messages ?? [])
      .flatMap(mailCopies)
      .filter((copy) => copy.mailboxes.some((m) => m.mailbox_id === thread.view_mailbox))
      .map((copy) => copy.name),
  )

// Drafts are discarded with an Undo rather than a confirmation: hidden here at once, deleted once
// the toast has passed. Nothing is sent before then, so Undo only has to show them again.
const discardDrafts = (rows: Thread[]) => {
  const names = copiesHere(rows)
  const keys = rows.map(threadKey)
  goToNextThreadOrClose(keys)
  closeComposeWindowFor(rows.flatMap(messageIds))
  // Only the drafts, as in a single account's list (see useThreadActions).
  const held = rows.flatMap((row) => row.messages.filter((m) => m.draft).map((m) => m.id))
  held.forEach(holdDraft)
  const show = () => held.forEach(releaseDraft)
  commitAfterUndo({
    message: rows.length === 1 ? __('Draft discarded.') : __('Drafts discarded.'),
    removal: { kind: 'messages', names },
    onSent: () => {
      refreshCounts()
      refreshThreads()
    },
    restore: show,
    undoSlot: { set: (action) => setUndoAction(action), retire: retireUndoAction },
  })
}

const handleDelete = (rows: Thread[]) => {
  const names = copiesHere(rows)
  goToNextThreadOrClose(rows.map(threadKey))
  keptRead.release(rows.map(threadKey))
  closeComposeWindowFor(rows.flatMap(messageIds))
  raiseOptimisticToast(
    client.mutation(api.mail.messages.delete, { names }).then(refreshCounts, (error) => {
      refreshThreads()
      throw error
    }),
    rows.length === 1 ? __('Thread deleted.') : __('Threads deleted.'),
  )
}

// Another folder reuses this component, so it starts over: unfiltered, from the top.
watch(
  () => folder,
  () => {
    reloadFilter()
    resetThreads()
  },
)

const unreadCount = computed(
  () =>
    store.unifiedFolders.data?.find((f: UnifiedFolder) => f.slug === folder)?.unread_threads ?? 0,
)

// An open thread names itself, as in a single account's list; otherwise the folder and its unread.
usePageMeta(() => {
  if (threadID) return appPageMeta(openRow.value?.subject || __('[No Subject]'), 'Mail')
  return appPageMeta(
    `${unreadCount.value ? `(${unreadCount.value})` : ''} ${folderLabel.value}`,
    'Mail',
  )
})

// Keep the merged list fresh: poll periodically and react to push events — new mail, or mail changed
// on another device — which can arrive for any account. Either way the newest window is merged into
// the list, preserving scroll.
const reloadInterval = ref<ReturnType<typeof setInterval>>()
const onNewMail = () => refreshThreads()
onMounted(() => {
  reloadInterval.value = setInterval(onNewMail, 30000)
  socket.on('new_mail_created', onNewMail)
  socket.on('mail_changed', onNewMail)
  window.addEventListener('keydown', handleKeyDown)
})
onUnmounted(() => {
  if (reloadInterval.value) clearInterval(reloadInterval.value)
  socket.off('new_mail_created', onNewMail)
  socket.off('mail_changed', onNewMail)
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped></style>
