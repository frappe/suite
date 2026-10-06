<template>
  <!-- Mobile title header — no thread count since the merged view has no total.
	     The toolbar below carries the bottom border, matching the mailbox structure. -->
  <MobileTitleHeader v-if="isMobile" with-menu with-search :title="folderLabel" />

  <!-- Header -->
  <!-- hidden on mobile: the title row carries the folder name, and the header's
	     actions are the compose button and the sidebar sheet. Hidden (not v-if) so HeaderActions'
	     modals stay mounted for the views' v-model bindings. -->
  <header class="hidden items-center justify-between border-b px-3 py-2.5 sm:flex sm:px-5">
    <div class="flex items-center space-x-2">
      <!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
      <Breadcrumbs
        :items="[{ label: folderLabel, route: unifiedFolderRoute(folder) }]"
        class="-ml-0.5"
      />
    </div>
    <HeaderActions />
  </header>

  <div class="relative flex h-[calc(100dvh-3.05rem)] max-sm:min-h-0 max-sm:flex-1 max-sm:!h-auto">
    <!-- Loading -->
    <div v-if="isLoading" class="flex w-full flex-col items-center justify-center">
      <div class="text-ink-gray-5 flex items-center space-x-2">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        <span>{{ __('Loading...') }}</span>
      </div>
    </div>

    <template v-else-if="threadRows.length">
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
          <MailListToolbar
            class="border-b"
            :title="title"
            :filter-options="FILTER_OPTIONS"
            :fetching="isFetching"
            :loading="threads.isFetching"
            @refresh="refreshThreads()"
          />

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
								     mailbox list. -->
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
                    @delete-threads="confirmDelete(row.threads)"
                  />
                  <MailListItem
                    v-else
                    :mailbox="row.thread.view_mailbox || ''"
                    :account-id="row.thread.account"
                    :account-label="shortAccountLabel(row.thread.account_name)"
                    :mail="row.thread"
                    :is-selected="false"
                    :selectable="false"
                    :outgoing="isOutgoingFolder"
                    :thread-route-name="UNIFIED_THREAD_ROUTE"
                    :hide-avatar="!isMobile"
                    :hide-sender="row.inStack"
                    :class="rowClasses(row)"
                    :data-row-key="row.key"
                    @set-seen="(seen: boolean) => handleSetSeen(row.thread, seen)"
                    @archive-thread="handleArchive(row.thread)"
                    @trash-thread="handleTrash(row.thread)"
                    @delete-thread="confirmDelete([row.thread])"
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
          @delete-thread="isTrashFolder ? confirmDelete([openRow!]) : handleTrash(openRow!)"
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
</template>

<script setup lang="ts">
import { Breadcrumbs, Button, Dialog, usePageMeta } from 'frappe-ui'
import { LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { computed, inject, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client, useInfiniteQuery } from '@/api'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailGroupHeader from '@/apps/mail/components/MailGroupHeader.vue'
import MailListItem from '@/apps/mail/components/MailListItem.vue'
import MailListToolbar from '@/apps/mail/components/MailListToolbar.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import StackListItem from '@/apps/mail/components/StackListItem.vue'
import ThreadPane from '@/apps/mail/components/ThreadPane.vue'
import { closeComposeWindowFor } from '@/apps/mail/composables/useComposeWindow'
import { useListRows } from '@/apps/mail/composables/useListRows'
import { useMailRemoval } from '@/apps/mail/composables/useMailRemoval'
import { PAGE_LENGTH, usePaginatedThreads } from '@/apps/mail/composables/usePaginatedThreads'
import { userStore } from '@/apps/mail/stores/user'
import type { Mail, Mailbox, MailboxData, Thread, UnifiedFolder } from '@/apps/mail/types'
import {
  isMac,
  raiseError,
  raiseOptimisticToast,
  raiseToast,
  shouldIgnoreKeypress,
} from '@/apps/mail/utils'
import { useAccountScope } from '@/apps/mail/utils/accountScope'
import { useListReload, useScreenSize, useSwipeNav, useUndo } from '@/apps/mail/utils/composables'
import { useStoredFilter } from '@/apps/mail/utils/listFilter'
import {
  hasCursor,
  isNavigationKey,
  navigationOffset,
  neighbourAfterRemoval,
  stepFromKey,
  useGPrefix,
} from '@/apps/mail/utils/listNavigation'
import { mailCopies, mailCopyIds, rowMailIds } from '@/apps/mail/utils/mailCopies'
import { threadRow } from '@/apps/mail/utils/threadRows'
import {
  STARRED_FOLDER,
  UNIFIED_ROUTE,
  UNIFIED_THREAD_ROUTE,
  unifiedFolderLabel,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { appPageMeta } from '@/platform/page-meta'

const { isMobile } = useScreenSize()
const { listReloadRequest } = useListReload()

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

// The remembered All/Unread/Starred/Has-attachments choice, its menu, and its title (see
// useStoredFilter) — all shared with the mailbox list, and remembered per folder as it is there.
const {
  filter,
  FILTER_OPTIONS,
  filterTitle: title,
  reloadFilter,
} = useStoredFilter({
  scope: () => `unified:${folder}`,
  onChange: () => resetThreads(),
  starrable: () => folder !== STARRED_FOLDER && !isTrashFolder.value,
})

// The engine owns loaded windows and refreshes their rows together.
const threads = useInfiniteQuery(api.mail.unified.threads, () => ({
  folder,
  limit: PAGE_LENGTH,
  start: 0,
  filter_by: filter.value,
}))
const threadRows = computed(() => threads.rows.map((row) => threadRow(row, store.accountId)))
const isLoading = computed(() => threads.status === 'pending')

// After an action, refresh the sidebar counts: the active account's per-mailbox counts, which via the
// store's mailboxes watcher also refreshes the unified folders' counts.
const refreshCounts = () => store.mailboxes.refetch().catch(() => {})

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
  void threads.refetch().catch(() => {})
  refreshCounts()
}

// Refresh the loaded windows without changing the reader's selection.
const refreshThreads = (reloadCounts = true) => {
  if (isFetching.value) return
  void threads.refetch().catch(() => {})
  if (reloadCounts) refreshCounts()
}

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
  groupMessagesBy,
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

// Up/down/j/k walk the list, or the open thread when one is showing. The merged list is flat —
// no stacks, no day headers, no selection — so a step is just the neighbouring row.
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
    handleSetSpamStatus(!isJunkFolder.value, thread)
    return true
  }
  return false
}
const handleKeyDown = (e: KeyboardEvent) => {
  const key = e.key.toLowerCase()
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
  if (!row) return
  if (mailboxId === row.archive) return handleArchive(row)
  if (mailboxId === row.trash) return handleTrash(row)
  goToNextThreadOrClose(threadKey(row))
  const restore = refreshThreads
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
  | {
      kind: 'spam'
      input: {
        ids: string[]
        spam: boolean
        screen_action?: string | null
      }
    }
  | {
      kind: 'move'
      input: {
        ids: string[]
        mailbox: string
        clear_junk?: boolean
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
    case 'spam':
      return client.mutation(api.mail.messages.spam, {
        ...command.input,
        account: acting,
      })
    case 'move':
      return client.mutation(api.mail.messages.move, {
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
          ids: messageIdsOf(thread),
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
  if (!thread) return
  goToNextThreadOrClose(threadKey(thread))
  const restore = refreshThreads
  raiseOptimisticToast(
    runPaneCommand(
      {
        kind: 'spam',
        input: {
          ids: messageIdsOf(thread),
          spam,
        },
      },
      thread.account,
    ).catch((error) => {
      restore()
      throw error
    }),
    __('Thread marked as {0}.', [spam ? __('Junk') : __('Not Junk')]),
    // Undo flips the junk status back — name the resulting state, like the forward toast does.
    withUndo(thread, restore, __('Thread marked as {0}.', [spam ? __('Not Junk') : __('Junk')])),
  )
}

// Per-message actions from a message's own menu, on the shared orchestration (see useMailRemoval).
// Each row carries the mailbox it was listed from, which is what it is summarised and dated by.
const { setUndoAction } = useUndo()
const { runMailRemoval } = useMailRemoval({
  row: () => openRow.value,
  mailThreadRef: mailThread,
  onEmptied: () => closeThread(),
  removeRow: () => refreshThreads,
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
  const snapshot = mailSnapshot(mail)
  return {
    undoReq: () => restoreMails(account!, [snapshot]),
    undoSuccess,
  }
}
const handleMailMove = (mail: Mail, target: string) => {
  const account = openRow.value?.account
  const folder = folderName(target)
  runMailRemoval(
    mail,
    () =>
      runPaneCommand(
        {
          kind: 'move',
          input: {
            ids: [mail.id],
            mailbox: target,
            clear_junk: mail.junk === 1 && target !== paneScope.mailboxIds.value.junk,
          },
        },
        account,
      ),
    folder ? __('Mail moved to {0}.', [folder]) : __('Mail moved.'),
    undoMail(mail, account, __('Mail moved back.')),
  )
}
const handleMailSpam = (mail: Mail, spam: boolean) => {
  const account = openRow.value?.account
  runMailRemoval(
    mail,
    () =>
      runPaneCommand(
        {
          kind: 'spam',
          input: {
            ids: [mail.id],
            spam,
          },
        },
        account,
      ),
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
const handleSetFlagged = (thread: Thread, flagged: boolean, ids: string[] = rowMailIds(thread)) => {
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
const mailSnapshot = (mail: Mail) => ({
  id: mail.id,
  mailbox_ids: mail.mailboxes.map((m) => m.mailbox_id),
  junk: mail.junk,
})
const threadSnapshot = (thread: Thread) => (thread.messages ?? []).map(mailSnapshot)
const restoreMails = (account: string, mails: ReturnType<typeof mailSnapshot>[]) =>
  client
    .mutation(api.mail.messages.setFolders, {
      account,
      mails,
    })
    .then(refreshCounts)

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
const moveThreadOut = (thread: Thread, mailbox: string, restore: () => void) => {
  closeComposeWindowFor(messageIds(thread))
  return client
    .mutation(api.mail.messages.move, {
      account: thread.account,
      ids: messageIds(thread),
      mailbox,
      clear_junk: true,
    })
    .then(refreshCounts, (error) => {
      restore()
      throw error
    })
}
const handleArchive = (thread: Thread) => {
  if (!thread.archive) return raiseToast(__('No Archive folder for this account.'), 'error')
  goToNextThreadOrClose(threadKey(thread))
  const restore = refreshThreads
  raiseOptimisticToast(
    moveThreadOut(thread, thread.archive!, restore),
    __('Thread archived.'),
    withUndo(thread, restore, __('Thread moved back.')),
  )
}
const handleTrash = (thread: Thread) => {
  if (!thread.trash) return raiseToast(__('No Trash folder for this account.'), 'error')
  goToNextThreadOrClose(threadKey(thread))
  const restore = refreshThreads
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
    client
      .mutation(api.mail.messages.seen, {
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

const stackMoveOut = (threads: Thread[], mailboxId: string | undefined, done: string) => {
  if (!mailboxId) return raiseToast(__('No such folder for this account.'), 'error')
  closeComposeWindowFor(threads.flatMap(messageIds))
  const promise = client
    .mutation(api.mail.messages.move, {
      account: threads[0].account,
      ids: threads.flatMap(messageIds),
      mailbox: mailboxId,
      clear_junk: true,
    })
    .then(refreshCounts, (error) => {
      refreshThreads()
      throw error
    })
  raiseOptimisticToast(promise, done)
}

// Plurals of the single-thread messages, as the mailbox list does — it never prefixes a count.
const stackArchive = (threads: Thread[]) =>
  stackMoveOut(threads, threads[0].archive, __('Threads archived.'))
const stackTrash = (threads: Thread[]) =>
  stackMoveOut(threads, threads[0].trash, __('Threads moved to Trash.'))

// Permanent delete, offered once the threads are already in Trash. Each row names its own account,
// and a stack never mixes accounts, so one request covers each confirmation. Only the copies in Trash
// go: the rest of the conversation lives on in the folders it was filed in.
const showDelete = ref(false)
const toDelete = ref<Thread[]>([])

const confirmDelete = (rows: Thread[]) => {
  if (!rows.length) return
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

const handleDelete = (rows: Thread[]) => {
  const names = rows.flatMap((thread) =>
    (thread.messages ?? [])
      .flatMap(mailCopies)
      .filter((copy) => copy.mailboxes.some((m) => m.mailbox_id === thread.view_mailbox))
      .map((copy) => copy.name),
  )
  goToNextThreadOrClose(rows.map(threadKey))
  closeComposeWindowFor(rows.flatMap(messageIds))
  raiseOptimisticToast(
    client.mutation(api.mail.messages.delete, { names }).then(refreshCounts, (error) => {
      refreshThreads()
      throw error
    }),
    rows.length === 1 ? __('Thread deleted.') : __('Threads deleted.'),
  )
}

// Another folder reuses this component, so it starts over: its own remembered filter, from the top.
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

usePageMeta(() =>
  appPageMeta(`${unreadCount.value ? `(${unreadCount.value})` : ''} ${folderLabel.value}`, 'Mail'),
)

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
