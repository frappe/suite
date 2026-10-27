import { Checkbox } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import { computed, h, ref, type ComputedRef, type Ref } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { closeComposeWindowFor } from '@/apps/mail/composables/useComposeWindow'
import { useMailRemoval } from '@/apps/mail/composables/useMailRemoval'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { userStore, type MailboxRole } from '@/apps/mail/stores/user'
import type { Mail, Mailbox, MailCopy, Thread } from '@/apps/mail/types'
import {
  commitAfterUndo,
  getIcon,
  raiseOptimisticToast,
  raisePromiseToast,
} from '@/apps/mail/utils'
import { useDiscardingDrafts, useUndo } from '@/apps/mail/utils/composables'
import { folderTicks } from '@/apps/mail/utils/folderTicks'
import { canMoveToMailbox, commonMailboxIds } from '@/apps/mail/utils/mailboxTargets'
import { mailCopies, mailCopyIds, mailCopyNames, threadStarIds } from '@/apps/mail/utils/mailCopies'
import { isReceived } from '@/apps/mail/utils/receivedMail'

type SetSeenParams = {
  0?: string[]
  1?: string[]
}
interface MailThreadInstance {
  syncFlagged: (ids: string[], flagged: boolean) => void
  syncMailboxMembership: (mailboxId: string, isMember: boolean) => void
  removeMailFromView: (mailId: string) => {
    emptied: boolean
    rollback: () => void
  }
}

/**
 * List/reading-pane thread actions performed directly on mail ids (the full thread is loaded, so the
 * server doesn't need to resolve thread ids). Optimistic UI, undo and toasts live here too.
 */
export function useThreadActions(deps: {
  rows: ComputedRef<Thread[]>
  mailbox: ComputedRef<string>
  threadID: ComputedRef<string>
  selections: Ref<string[]>
  mailThreadRef: Ref<MailThreadInstance | null>
  // Refetch only the first window, replacing the list and scrolling to top (mailbox switch, undo, …).
  resetThreads: (reloadMailboxes?: boolean, mailboxRoles?: MailboxRole[]) => void
  // Refresh selections + sidebar counts only, without refetching the loaded list.
  syncAfterAction: () => void
  // Drop the given threads from the loaded list optimistically; returns the removed rows for undo.
  removeThreadsFromList: (threadIds: string[]) => Thread[]
  // Re-insert threads at their sorted position (undo of a move/junk) without jumping to top.
  restoreThreadsToList: (threads: Thread[]) => void
  // Refetch the first window if an optimistic removal emptied the list while more threads exist. Call
  // only after the server mutation lands, or the refetch returns the not-yet-removed rows.
  refillIfEmpty: () => void
  goToMailbox: () => void
  goToNextThreadOrMailbox: (excludedThreads?: string[]) => void
}) {
  const {
    rows,
    mailbox,
    threadID,
    selections,
    mailThreadRef,
    resetThreads,
    syncAfterAction,
    removeThreadsFromList,
    restoreThreadsToList,
    refillIfEmpty,
    goToMailbox,
    goToNextThreadOrMailbox,
  } = deps
  const store = userStore()
  const { mailboxes, mailboxIds } = store
  const { setUndoAction, retireUndoAction, undo } = useUndo()
  const { holdDraft, releaseDraft } = useDiscardingDrafts()
  const screener = useScreener()

  // The loaded rows behind the current selection. In Search each row is itself a mail rather than
  // a thread summary, but it carries its mailboxes all the same (that's the folder tag on the
  // row), so the folder menus can ask where a selection sits without caring which of the two it is.
  const selectedRows = computed<Thread[]>(() =>
    (rows.value ?? []).filter((t: Thread) => selections.value.includes(t.thread_id)),
  )

  // Every mail the given threads hold — the copies included. A thread's messages are what the pane
  // *shows*, and a message the account holds twice (mail to yourself) shows once; an action has to
  // reach both copies all the same, and undo has to put each back where it was. See mailCopies.
  const threadMails = (threadIds: string[]): MailCopy[] => {
    const items = (rows.value ?? []).filter((t: Thread) => threadIds.includes(t.thread_id))
    // In search, each result is itself a mail with no nested conversation.
    if (mailbox.value === 'search') return items as unknown as MailCopy[]
    return items.flatMap((t: Thread) => (t.messages ?? []).flatMap(mailCopies))
  }
  const allMailIds = (threadIds: string[]): string[] => threadMails(threadIds).map((m) => m.id)

  /** The composer window gives up a draft whose thread is being trashed, junked or deleted. */
  const closeComposeWindowHolding = (threadIds: string[]) =>
    closeComposeWindowFor(allMailIds(threadIds))

  // Mails of the threads that live in the current view's mailbox(es) — mirrors the old
  // get_filtered_message_ids (starred → all non-trash, search → all).
  const currentMailboxMails = (threadIds: string[]): MailCopy[] => {
    const mails = threadMails(threadIds)
    if (mailbox.value === 'search') return mails
    const ids =
      mailbox.value === 'starred'
        ? (mailboxes.data ?? []).filter((m) => m.role !== 'trash').map((m) => m.id)
        : [mailbox.value]
    return mails.filter((m) => m.mailboxes.some((mb) => ids.includes(mb.mailbox_id)))
  }
  const setSeen = useMutation(api.mail.messages.seen)
  async function setSeenSubmit({ ids, seen }: { ids: string[]; seen: boolean }) {
    const input: InputOf<typeof api.mail.messages.seen> = {
      account: store.accountId,
      ids,
      seen,
    }
    await setSeen.run(input)
    await mailboxes.refetch().catch(() => {})
  }

  const setFlagged = useMutation(api.mail.messages.flag)
  async function setFlaggedSubmit({ ids, flagged }: { ids: string[]; flagged: boolean }) {
    const input: InputOf<typeof api.mail.messages.flag> = {
      account: store.accountId,
      ids,
      flagged,
    }
    await setFlagged.run(input)
  }

  // Archive, Move, Junk, Not junk and Trash all go through one request, which files each message of
  // the conversation by the folder rules (suite/mail/filing.py): mail you received goes where it is
  // filed, your sent mail never leaves Sent but by Trash, and a draft is never filed. `leaves` names
  // the list the conversation leaves, so the client policy takes its rows off at once.
  const fileMails = useMutation(api.mail.messages.file)
  const fileMailsSubmit = (input: Omit<InputOf<typeof api.mail.messages.file>, 'account'>) =>
    fileMails.run({ account: store.accountId, ...input })

  // Where the selection can go, read off the selection itself rather than off the open mailbox —
  // so the menu is just as answerable in Search and Starred, which are queries and not mailboxes.
  // In a plain mailbox the two agree: every row there is in it, so it subtracts itself.
  const moveToOptions = computed(() => {
    const filedIn = commonMailboxIds(selectedRows.value)
    return mailboxes.data
      ?.filter((m) => canMoveToMailbox(m.id, filedIn, mailboxIds))
      .map((m) => ({
        label: m._name,
        icon: h(Icon, {
          name: getIcon(m),
          class: FOLDER_ICON_COLOR_MAP[m.color],
        }),
        onClick: () =>
          handleMoveThreads({
            [m.id]: selections.value,
          }),
      }))
  })
  // Drafts offers only Discard: a draft is never moved or filed.
  const showMoveTo = computed(
    () =>
      !!selections.value.length &&
      mailbox.value !== mailboxIds.drafts &&
      !!moveToOptions.value?.length,
  )
  const addMails = useMutation(api.mail.messages.addToFolder)
  async function addMailsSubmit({ ids, mailbox_id }: { ids: string[]; mailbox_id: string }) {
    const input: InputOf<typeof api.mail.messages.addToFolder> = {
      account: store.accountId,
      ids,
      mailbox_id,
    }
    await addMails.run(input)
  }
  const removeMails = useMutation(api.mail.messages.removeFromFolder)
  async function removeMailsSubmit({ ids, mailbox_id }: { ids: string[]; mailbox_id: string }) {
    const input: InputOf<typeof api.mail.messages.removeFromFolder> = {
      account: store.accountId,
      ids,
      mailbox_id,
    }
    await removeMails.run(input)
  }

  // Restores each mail to an exact snapshot (mailbox set + junk) — used to undo a move precisely.
  type MailSnapshot = {
    id: string
    mailbox_ids: string[]
    junk: 0 | 1
  }
  const setMailsMailboxes = useMutation(api.mail.messages.setFolders)
  async function setMailsMailboxesSubmit({
    mails,
    screen_action,
  }: {
    mails: MailSnapshot[]
    screen_action?: string | null
  }) {
    const input: InputOf<typeof api.mail.messages.setFolders> = {
      account: store.accountId,
      mails,
      screen_action,
    }
    await setMailsMailboxes.run(input)
  }
  // The selection's Folders menu: a box per folder it can be filed in (the Inbox, Archive and your
  // own), ticked where every selected thread is, half-ticked where some are, greyed where unticking
  // would leave a message in no folder. Not offered where filing is not what a list is for: search
  // and Starred are queries, and mail comes out of Junk and Trash by a move.
  const showFolders = computed(
    () =>
      !!selections.value.length &&
      !['search', 'starred', mailboxIds.junk, mailboxIds.trash, mailboxIds.drafts].includes(
        mailbox.value,
      ),
  )
  const folderOptions = computed(() => {
    if (!showFolders.value) return []
    const folders = (mailboxes.data ?? []).filter(
      (m) => !m.role || ['inbox', 'archive'].includes(m.role),
    )
    const ticks = folderTicks(
      selections.value.map((id) => threadMails([id])),
      folders.map((m) => m.id),
    )
    return folders.map((m, i) => {
      const { ticked, removable } = ticks[i]
      const blocked = ticked === 'all' && !removable
      return {
        label: m._name,
        slots: {
          prefix: () =>
            h(Checkbox, {
              modelValue: ticked === 'all',
              indeterminate: ticked === 'some',
              disabled: blocked,
              class: 'pointer-events-none',
            }),
        },
        disabled: blocked,
        keepOpen: true,
        onClick: (event?: Event) => {
          event?.preventDefault()
          if (blocked) return
          // A half-ticked folder takes the whole selection; a ticked one lets it go.
          if (ticked === 'all') handleRemoveThreadsFromMailbox(m.id, selections.value)
          else void handleAddThreadsToMailbox(m.id, selections.value)
        },
      }
    })
  })
  const mailboxEntry = (mailboxId: string): Mailbox | null => {
    const mb = mailboxes.data?.find((m) => m.id === mailboxId)
    return mb
      ? {
          mailbox: mb.name,
          mailbox_id: mb.id,
          mailbox_name: mb._name,
        }
      : null
  }

  // Optimistically reflect an add/remove of a mailbox on the loaded list rows (thread summary + its
  // nested messages) so MailListItem's folder tags update immediately, without waiting for a refetch.
  // Mirrors MailThread.syncMailboxMembership, which does the same for the open thread's reading pane.
  const syncListMailboxMembership = (mailboxId: string, threadIds: string[], add: boolean) => {
    const entry = mailboxEntry(mailboxId)
    if (!entry) return
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
    rows.value
      ?.filter((t: Thread) => threadIds.includes(t.thread_id))
      .forEach((t: Thread) => {
        apply(t)
        t.messages?.forEach(apply)
      })
  }

  const addThreadsToMailbox = (mailboxId: string, threadIds: string[], isUndo = false) => {
    const mailboxName = mailboxes.data?.find((m) => m.id === mailboxId)?._name

    // The threads stay in the current view (only gain another mailbox) — no list refetch; toggle the
    // folder tag on the list rows + the open thread. Applied before the request, reverted on failure.
    const applyAdd = () => {
      syncListMailboxMembership(mailboxId, threadIds, true)
      if (threadID.value && threadIds.includes(threadID.value))
        mailThreadRef.value?.syncMailboxMembership(mailboxId, true)
    }
    const revertAdd = () => {
      syncListMailboxMembership(mailboxId, threadIds, false)
      if (threadID.value && threadIds.includes(threadID.value))
        mailThreadRef.value?.syncMailboxMembership(mailboxId, false)
    }
    // Not a draft, ever; and your own mail never into the Inbox or Archive, which are for mail you
    // received (see filing.py) — it is filed into folders of yours only.
    const toInboxOrArchive = [mailboxIds.inbox, mailboxIds.archive].includes(mailboxId)
    const mailIds = threadMails(threadIds)
      .filter((m) => !m.draft && (!toInboxOrArchive || isReceived(m, mailboxIds.sent)))
      .map((m) => m.id)
    if (!mailIds.length) return
    applyAdd() // optimistic: tag shown before the request

    setUndoAction(undefined)
    const forward = (async () => {
      try {
        await addMailsSubmit({
          ids: mailIds,
          mailbox_id: mailboxId,
        })
      } catch (error) {
        revertAdd()
        if (!isUndo) setUndoAction(undefined)
        throw error
      }
      syncAfterAction()
    })()
    if (isUndo) {
      // Undo of a remove — immediate confirmation, no further undo.
      const success = threadIds.length === 1 ? __('Thread added back.') : __('Threads added back.')
      return raiseOptimisticToast(forward, success)
    }

    // Undo = remove again, but only once the add has actually landed (no-op if it failed).
    setUndoAction(
      () =>
        void forward.then(
          () => handleRemoveThreadsFromMailbox(mailboxId, threadIds, true),
          () => {},
        ),
    )
    const success =
      threadIds.length === 1
        ? __('Thread added to {0}.', [mailboxName])
        : __('Threads added to {0}.', [mailboxName])
    raiseOptimisticToast(forward, success, undo)
    return forward.then(
      () => true,
      () => false,
    )
  }
  const handleRemoveThreadsFromMailbox = (
    mailboxId: string,
    threadIds: string[],
    isUndo = false,
  ) => {
    // Only remove mails that are in this mailbox AND at least one other — never orphan a mail.
    const isRemovable = (m: MailCopy) =>
      m.mailboxes.length > 1 && m.mailboxes.some((mb) => mb.mailbox_id === mailboxId)
    const threadIdsToBeUpdated = threadIds.filter((threadId) =>
      threadMails([threadId]).some(isRemovable),
    )

    // Removing from the current mailbox drops the rows from the view; removing from another mailbox
    // leaves them here (they just lose that membership). Compute the mail ids now, before the
    // optimistic mutation empties threadMails.
    const isCurrentMailbox = mailboxId === mailbox.value
    const ids = threadMails(threadIdsToBeUpdated)
      .filter(isRemovable)
      .map((m) => m.id)
    let removedThreads: Thread[] = []
    const applyRemove = () => {
      if (isCurrentMailbox) {
        if (threadID.value && threadIdsToBeUpdated.includes(threadID.value))
          goToNextThreadOrMailbox(threadIdsToBeUpdated)
        removedThreads = removeThreadsFromList(threadIdsToBeUpdated)
      } else {
        syncListMailboxMembership(mailboxId, threadIdsToBeUpdated, false)
        if (threadID.value && threadIdsToBeUpdated.includes(threadID.value))
          mailThreadRef.value?.syncMailboxMembership(mailboxId, false)
      }
    }
    const revertRemove = () => {
      if (isCurrentMailbox) {
        if (removedThreads.length) restoreThreadsToList(removedThreads)
      } else {
        syncListMailboxMembership(mailboxId, threadIdsToBeUpdated, true)
        if (threadID.value && threadIdsToBeUpdated.includes(threadID.value))
          mailThreadRef.value?.syncMailboxMembership(mailboxId, true)
      }
    }
    applyRemove() // optimistic: row/tag dropped before the request

    setUndoAction(undefined)
    const forward = (async () => {
      try {
        await removeMailsSubmit({
          ids,
          mailbox_id: mailboxId,
        })
      } catch (error) {
        revertRemove()
        if (!isUndo) setUndoAction(undefined)
        throw error
      }
      syncAfterAction()
      refillIfEmpty()
    })()
    const mailboxName = mailboxes.data?.find((m) => m.id === mailboxId)?._name
    const success =
      threadIdsToBeUpdated.length === 1
        ? __('Thread removed from {0}.', [mailboxName])
        : __('Threads removed from {0}.', [mailboxName])

    // Undo of an add — immediate confirmation, no further undo.
    if (isUndo) return raiseOptimisticToast(forward, success)

    // Undo = add back, but only once the remove has landed (no-op if it failed).
    setUndoAction(
      () =>
        void forward.then(
          () => void addThreadsToMailbox(mailboxId, threadIdsToBeUpdated, true),
          () => {},
        ),
    )
    raiseOptimisticToast(forward, success, undo)
  }
  const showJunkOrDeleteThreads = ref(false)
  const threadsToBeDeleted = ref<string[]>([])

  // In Drafts the bin discards: a draft is one's own unsent text, let go for good rather than filed
  // in Trash, and taken back with Undo rather than confirmed up front (see discardDrafts).
  const isDraftsList = computed(() => mailbox.value === mailboxIds.drafts)
  // Marking as Junk is reversible (and may still prompt to block per the account setting), so it
  // runs inline with no confirmation; only the destructive delete keeps a confirmation dialog.
  const junkOrDeleteThreads = (threadIDs: string[], isJunk: boolean) => {
    if (!threadIDs?.length) return
    if (isJunk)
      return handleSetSpamStatus({
        1: threadIDs,
      })
    if (isDraftsList.value) return discardDrafts(threadIDs)
    threadsToBeDeleted.value = threadIDs
    showJunkOrDeleteThreads.value = true
  }
  const handleDeleteConfirmed = () => {
    handleDeleteThreads(threadsToBeDeleted.value)
    showJunkOrDeleteThreads.value = false
  }
  const junkOrDeleteThreadsOptions = computed(() => {
    const total = threadsToBeDeleted.value.length
    const count = total === 1 ? '' : total.toString()
    const noun = total > 1 ? __('Threads') : __('Thread')
    const lowerNoun = total > 1 ? __('threads') : __('thread')
    return {
      title: __('Delete {0} {1}', [count, noun]),
      message: __('Are you sure you want to permanently delete the selected {0}?', [lowerNoun]),
      actions: [
        {
          label: __('Confirm'),
          variant: 'solid',
          autofocus: true,
          onClick: handleDeleteConfirmed,
        },
      ],
    }
  })
  const bulkDelete = useMutation(api.mail.messages.delete)
  async function bulkDeleteSubmit({ names }: { names: string[] }) {
    const input: InputOf<typeof api.mail.messages.delete> = {
      names,
    }
    await bulkDelete.run(input)
  }

  // Removes the given threads from the loaded list and returns them (so an undo can re-insert the exact
  // rows in place). Empty for the search/starred path, which resets instead.
  const handleSuccessAndRemoveFromList = (
    thread_ids: string[] | SetSeenParams,
    excludeCommonMailboxes: boolean = true,
  ): Thread[] => {
    // In search/starred, membership is server-determined (a moved thread may still be starred / still
    // match the query), so reset to top and let the server decide rather than removing locally.
    if (excludeCommonMailboxes && ['search', 'starred'].includes(mailbox.value)) {
      resetThreads()
      return []
    }
    if (!Array.isArray(thread_ids)) thread_ids = Object.values(thread_ids).flat()
    // Navigate off a removed open thread before dropping it, so the "next thread" is resolved
    // against the still-complete list.
    if (threadID.value && thread_ids.includes(threadID.value)) goToNextThreadOrMailbox(thread_ids)
    const removed = removeThreadsFromList(thread_ids)
    syncAfterAction()
    return removed
  }
  const handleSetSeen = (threadIDs: SetSeenParams, silent = false, mailIds?: string[]) => {
    const seen = Object.keys(threadIDs)[0] === '1'
    const selectedThreads = Object.values(threadIDs).flat()
    // The reading pane passes explicit ids and has already decided a change is needed; the thread-level
    // `seen` flag only reflects the current mailbox, so it can't gate a whole-conversation update.
    if (
      !mailIds &&
      selectedThreads.every(
        (thread_id) =>
          rows.value?.find((t: Thread) => t.thread_id === thread_id)?.seen === (seen ? 1 : 0),
      )
    )
      return

    // Apply optimistically so a quick reopen sees the new seen state immediately — waiting for the
    // server round-trip would leave the thread's messages stale (no auto mark-as-read / unseen marker).
    // (No-op for threads not in the list, e.g. ones opened via the get_thread fallback.) Snapshot the
    // prior state first so a failure can roll it back.
    const seenSnapshot = (rows.value ?? [])
      .filter((t: Thread) => selectedThreads.includes(t.thread_id))
      .map((t: Thread) => ({
        thread: t,
        prev: t.seen,
        messages: (t.messages ?? []).map((m) => ({
          message: m,
          prev: m.seen,
        })),
      }))
    seenSnapshot.forEach(({ thread }) => {
      thread.seen = seen ? 1 : 0
      thread.messages?.forEach((message) => (message.seen = seen ? 1 : 0))
    })
    const rollback = () =>
      seenSnapshot.forEach(({ thread, prev, messages }) => {
        thread.seen = prev
        messages.forEach(({ message, prev }) => (message.seen = prev))
      })
    if (!seen && threadID.value && selectedThreads.includes(threadID.value)) goToMailbox()

    // Seen applies to the whole conversation (every mailbox) so the state stays consistent. Prefer
    // the open thread's mail ids from the reading pane (covers fallback threads not in the list).
    const ids = mailIds ?? allMailIds(selectedThreads)

    // The auto mark-as-read on opening a thread is silent (no toast); still roll back on failure.
    if (silent)
      return void setSeenSubmit({
        ids,
        seen,
      }).catch(() => rollback())

    // The seen flag already flipped — confirm immediately; roll back + error toast only if it fails.
    const success =
      selectedThreads.length === 1
        ? __('Thread marked as {0}.', [seen ? __('read') : __('unread')])
        : __('Threads marked as {0}.', [seen ? __('read') : __('unread')])
    raiseOptimisticToast(
      setSeenSubmit({
        ids,
        seen,
      }).catch((error) => {
        rollback()
        throw error
      }),
      success,
    )
  }

  // "Mark Unread from Here" (set_mails_seen) marks individual messages unread. Sync those message ids
  // onto each thread's nested messages so reopening reads the fresh state without a full reload.
  const handleSyncUnseen = (ids: string[]) => {
    rows.value?.forEach((thread: Thread) => {
      // Search results are flat mails with no nested messages — match on the result's own id.
      if (!thread.messages?.length) {
        if (ids.includes(thread.id)) thread.seen = 0
        return
      }
      let changed = false
      thread.messages.forEach((message) => {
        if (ids.includes(message.id)) {
          message.seen = 0
          changed = true
        }
      })
      if (changed) thread.seen = 0
    })
  }
  const setFlaggedByThreadIDs = (threadIDs: string[], flagged: boolean) => {
    setUndoAction(undefined)
    const touched = rows.value.filter((t: Thread) => threadIDs.includes(t.thread_id))
    const ids = touched.flatMap((thread: Thread) => threadStarIds(thread, flagged))
    void setFlaggedSubmit({
      ids,
      flagged,
    }).catch(() => {})
    // Starring a screened thread accepts its sender; the toast's Undo unstars it too.
    if (flagged)
      screener.acceptWithUndo(
        touched,
        () => void setFlaggedSubmit({ ids, flagged: false }).catch(() => {}),
      )
  }

  // Moving: non-sent mails move to the target; sent mails keep only Sent + the target (other
  // memberships dropped) — except for junk/trash, which move everything.
  const moveThreads = (threadIDs: Record<string, string[]>) => {
    const selectedThreads = Object.values(threadIDs).flat()
    if (!selectedThreads.length) return

    // Moving to Junk is the same as Mark as Junk: no undo, offer to block the sender instead.
    if (Object.keys(threadIDs).length === 1 && Object.keys(threadIDs)[0] === mailboxIds.junk)
      return handleSetSpamStatus({
        1: selectedThreads,
      })
    const originOf = (tid: string): string | undefined =>
      rows.value?.find((t: Thread) => t.thread_id === tid)?.mailboxes[0]?.mailbox_id
    const originalState: Record<string, string[]> = selectedThreads.reduce(
      (acc: Record<string, string[]>, tid: string) => {
        const key = originOf(tid)
        if (key) (acc[key] ??= []).push(tid)
        return acc
      },
      {} as Record<string, string[]>,
    )
    if (JSON.stringify(originalState) === JSON.stringify(threadIDs)) return
    closeComposeWindowHolding(selectedThreads)
    const movesAll = (t: string) => [mailboxIds.junk, mailboxIds.trash].includes(t)

    // Snapshot each affected mail's exact state now (while the threads are still loaded), so undo
    // restores every mail to its precise mailbox set + junk status — even mails in several mailboxes.
    const snapshot = threadMails(selectedThreads).map((m) => ({
      id: m.id,
      mailbox_ids: m.mailboxes.map((mb) => mb.mailbox_id),
      junk: m.junk,
    }))
    // In Sent, a non-junk/trash move leaves the sent copies in Sent; in Starred, any move other than to
    // Trash keeps a non-junk/trash copy (and the flag), so the thread stays starred — either way the
    // row stays in the list.
    const keptInList =
      (mailbox.value === mailboxIds.sent || mailbox.value === 'starred') &&
      Object.keys(threadIDs).every((t) => !movesAll(t))
    // Only Search stays server-reconciled: its membership is a text query we can't re-evaluate locally.
    // Starred's rule (a non-junk/trash copy AND some flagged message) is computable from the loaded
    // thread, so a move to Trash removes the row optimistically below.
    const reconcileView = !keptInList && mailbox.value === 'search'
    // One filing per target: the server decides what each message does (sent mail keeps Sent, a draft
    // stays in Drafts, Junk and Trash are their own rules).
    const forward = Object.entries(threadIDs).map(
      ([target, tids]) =>
        () =>
          fileMailsSubmit({
            ids: threadMails(tids).map((m) => m.id),
            action: 'move',
            mailbox: target,
            leaves: keptInList || reconcileView ? null : mailbox.value,
            shows: keptInList ? expectedFolders('move', tids, target) : null,
          }),
    )

    // Optimistic (plain mailbox, or a Starred thread leaving via Trash): drop the rows now, before any
    // request fires. Captured so a failure can restore them in place, and so undo can re-insert them.
    // Pass excludeCommonMailboxes=false so the removal also applies in Starred (Search never reaches
    // here — it's reconcileView).
    let removedThreads: Thread[] = []
    if (!keptInList && !reconcileView)
      removedThreads = handleSuccessAndRemoveFromList(threadIDs, false)
    const moveToMailboxName = mailboxes.data?.find((m) => m.id === Object.keys(threadIDs)[0])?._name
    const movedBack =
      selectedThreads.length === 1 ? __('Thread moved back.') : __('Threads moved back.')
    const success =
      selectedThreads.length === 1
        ? __('Thread moved to {0}.', [moveToMailboxName])
        : __('Threads moved to {0}.', [moveToMailboxName])

    // Drop any prior undo so it isn't triggerable while this action is in flight.
    setUndoAction(undefined)
    if (!keptInList && !reconcileView) {
      // Optimistic path: confirm immediately, arm undo now, fire the request in the background.
      let forwardOk = false
      const forwardPromise = (async () => {
        try {
          for (const op of forward) await op()
          forwardOk = true
          mailboxes.refetch().catch(() => {})
          refillIfEmpty()
        } catch (error) {
          // Roll back the optimistic UI now, and undo any partial server move in the background
          // (the snapshot restores the exact pre-move state) so the error toast isn't delayed.
          restoreThreadsToList(removedThreads)
          setMailsMailboxesSubmit({
            mails: snapshot,
          }).catch(() => {})
          setUndoAction(undefined)
          throw error
        }
      })()
      setUndoAction(
        () =>
          void (async () => {
            // Wait for the forward to settle (instant if already done); no-op if it failed.
            await forwardPromise.catch(() => {})
            if (!forwardOk) return
            restoreThreadsToList(removedThreads)
            setUndoAction(undefined)
            const restore = setMailsMailboxesSubmit({
              mails: snapshot,
            })
              .then(() => mailboxes.refetch().catch(() => {}))
              .catch((error) => {
                removeThreadsFromList(removedThreads.map((t) => t.thread_id))
                throw error
              })
            raiseOptimisticToast(restore, movedBack)
          })(),
      )
      raiseOptimisticToast(forwardPromise, success, undo)
      return forwardPromise.then(
        () => true,
        () => false,
      )
    }
    if (keptInList) {
      // The rows stay (Sent keeps its sent copy; a Starred thread keeps a non-junk/trash copy), but
      // their folder tags change: the request carries the folders expected (`shows`), which the
      // client policy shows at once and takes back if the request fails.
      let forwardOk = false
      const forwardPromise = (async () => {
        try {
          for (const op of forward) await op()
          forwardOk = true
          mailboxes.refetch().catch(() => {})
        } catch (error) {
          setMailsMailboxesSubmit({
            mails: snapshot,
          }).catch(() => {})
          setUndoAction(undefined)
          throw error
        }
      })()
      setUndoAction(
        () =>
          void (async () => {
            await forwardPromise.catch(() => {})
            if (!forwardOk) return
            setUndoAction(undefined)
            const restore = setMailsMailboxesSubmit({
              mails: snapshot,
            }).then(() => mailboxes.refetch().catch(() => {}))
            raiseOptimisticToast(restore, movedBack)
          })(),
      )
      raiseOptimisticToast(forwardPromise, success, undo)
      return forwardPromise.then(
        () => true,
        () => false,
      )
    }

    // Reconcile (Search only): membership is a server-side text query, so the list changes once the
    // server responds — keep the loading → success toast.
    const action = async () => {
      try {
        for (const op of forward) await op()
      } catch (error) {
        await setMailsMailboxesSubmit({
          mails: snapshot,
        }).catch(() => {})
        throw error
      }
      handleSuccessAndRemoveFromList(threadIDs)
      setUndoAction(() => {
        const undoAction = async () => {
          await setMailsMailboxesSubmit({
            mails: snapshot,
          })
          resetThreads()
          mailboxes.refetch().catch(() => {})
        }
        raisePromiseToast(undoAction, __('Undoing...'), movedBack)
      })
      mailboxes.refetch().catch(() => {})
    }
    const loading = __('Moving to {0}...', [moveToMailboxName])
    return raisePromiseToast(async () => (await action(), true), loading, success, undo).then(
      (done) => !!done,
    )
  }
  // The folders each message of these conversations is expected in once filed, by the filing rules
  // (filing.py), for rows that stay on the list: sent with the request, the client policy shows
  // them on the click — and with them the Archive/Unarchive button and the folder tags.
  const expectedFolders = (
    action: 'archive' | 'unarchive' | 'move',
    threadIds: string[],
    target?: string,
  ): Record<string, Mailbox[]> => {
    const entry = (id: string) => mailboxEntry(id)
    const shows: Record<string, Mailbox[]> = {}
    rows.value
      ?.filter((t: Thread) => threadIds.includes(t.thread_id))
      .forEach((t: Thread) => {
        // The row stands for one of its messages, but its `draft` says whether the newest is one:
        // asked of the message itself.
        const messageOf = (item: Thread | Mail) =>
          item === t ? ((t.messages ?? []).find((m) => m.id === t.id) ?? t) : item
        ;[t, ...(t.messages ?? [])].forEach((item) => {
          if (messageOf(item).draft) return
          const ids = item.mailboxes.map((m) => m.mailbox_id)
          const own = ids.includes(mailboxIds.sent)
          let next: string[] | undefined
          if (action === 'move' && target)
            next = own
              ? target === mailboxIds.inbox
                ? [mailboxIds.sent]
                : [mailboxIds.sent, target]
              : [target]
          else if (action === 'unarchive' && ids.includes(mailboxIds.archive))
            // Out of Archive; back in the Inbox only if you received it.
            next = [
              ...ids.filter((id) => id !== mailboxIds.archive && id !== mailboxIds.inbox),
              ...(own ? [] : [mailboxIds.inbox]),
            ]
          else if (own) {
            // Never archived; out of the Inbox only (see filing.py).
            if (action !== 'archive' || !ids.includes(mailboxIds.inbox)) return
            next = ids.filter((id) => id !== mailboxIds.inbox)
          } else if (action === 'archive')
            next = [
              ...ids.filter(
                (id) =>
                  ![
                    mailboxIds.inbox,
                    mailboxIds.junk,
                    mailboxIds.trash,
                    mailboxIds.archive,
                  ].includes(id),
              ),
              mailboxIds.archive,
            ]
          if (!next) return
          const entries = next.map(entry).filter((m): m is Mailbox => !!m)
          if (entries.length === next.length) shows[item.id] = entries
        })
      })
    return shows
  }

  // Archive and Unarchive file a conversation in place: the rows leave only the list named as left,
  // and Undo puts each message back exactly. `told` reads the toast off the server's answer.
  const fileInPlace = (
    action: 'archive' | 'unarchive',
    threadIds: string[],
    leaves: boolean,
    told: (filed: { left_inbox: boolean }) => string,
  ) => {
    if (!threadIds.length) return
    const mails = threadMails(threadIds)
    const snapshot = mails.map((m) => ({
      id: m.id,
      mailbox_ids: m.mailboxes.map((mb) => mb.mailbox_id),
      junk: m.junk,
    }))
    setUndoAction(undefined)
    const removed = leaves ? handleSuccessAndRemoveFromList(threadIds, false) : []
    let forwardOk = false
    const forward = fileMailsSubmit({
      ids: mails.map((m) => m.id),
      action,
      leaves: leaves ? mailbox.value : null,
      // Rows that stay show the new folders at once; Search is read again, its rows being matches.
      shows: leaves || mailbox.value === 'search' ? null : expectedFolders(action, threadIds),
    }).then(
      (filed) => {
        forwardOk = true
        mailboxes.refetch().catch(() => {})
        if (leaves) refillIfEmpty()
        else if (mailbox.value === 'search') resetThreads()
        // Rows that stay are let go of, as a list's other actions do.
        if (!leaves) syncAfterAction()
        return filed
      },
      (error) => {
        // The server may have filed some messages before refusing the rest: they are put back as
        // they were, or they would stay filed with no Undo left to take them back.
        void setMailsMailboxesSubmit({ mails: snapshot }).catch(() => {})
        restoreThreadsToList(removed)
        setUndoAction(undefined)
        throw error
      },
    )
    setUndoAction(
      () =>
        void (async () => {
          await forward.catch(() => {})
          if (!forwardOk) return
          restoreThreadsToList(removed)
          setUndoAction(undefined)
          const restore = setMailsMailboxesSubmit({ mails: snapshot }).then(() => {
            mailboxes.refetch().catch(() => {})
            if (mailbox.value === 'search') resetThreads()
          })
          raiseOptimisticToast(
            restore,
            threadIds.length > 1 ? __('Threads moved back.') : __('Thread moved back.'),
          )
        })(),
    )
    raiseOptimisticToast(forward, told, undo)
    return forward.then(
      () => true,
      () => false,
    )
  }

  // Archive clears the Inbox: the conversation's received mail swaps Inbox for Archive, or just gains
  // Archive where it wasn't in the Inbox, and your own mail stays where it is. So only the Inbox loses
  // the row; archived from a folder of yours, Sent or Starred the conversation stays put, and the
  // toast says it was added to Archive rather than archived.
  const archiveThreads = (threadIds: string[]) =>
    fileInPlace(
      'archive',
      threadIds,
      [mailboxIds.inbox, mailboxIds.junk, mailboxIds.trash].includes(mailbox.value),
      (filed) =>
        !filed.left_inbox
          ? __('Added to Archive.')
          : threadIds.length > 1
            ? __('Threads archived.')
            : __('Thread archived.'),
    )

  // Archive reversed: the received mail goes back from Archive to the Inbox, every other folder kept,
  // and your own mail stays where it is. Only Archive loses the row.
  const unarchiveThreads = (threadIds: string[]) =>
    fileInPlace('unarchive', threadIds, mailbox.value === mailboxIds.archive, () =>
      threadIds.length > 1 ? __('Threads unarchived.') : __('Thread unarchived.'),
    )

  const setSpamStatus = (threadIDs: SetSeenParams) => {
    const selectedThreads = Object.values(threadIDs).flat()
    const originalState = getOriginalState(selectedThreads, 'junk')
    if (JSON.stringify(originalState) === JSON.stringify(threadIDs)) return
    closeComposeWindowHolding(selectedThreads)
    const spam = Object.keys(threadIDs)[0] === '1'
    const mails = threadMails(selectedThreads)
    // Snapshot exact state now (threads leave the list on success) so undo restores the original
    // mailbox + junk, rather than set_spam_status's blanket move to Inbox.
    const snapshot = mails.map((m) => ({
      id: m.id,
      mailbox_ids: m.mailboxes.map((mb) => mb.mailbox_id),
      junk: m.junk,
    }))
    const ids = snapshot.map((m) => m.id)

    // Marking as Junk only marks the mail: blocking the sender is its own action. Not Junk still
    // accepts the sender, in the SAME call as the mail change (no second request, no undo race); undo
    // flips it, also in the same call as the mailbox restore.
    const screenForward = spam ? null : 'Accepted'

    // Only Search stays server-reconciled. Starred is computable: junking removes the last non-junk copy
    // (→ the thread leaves), so junk there is optimistic; the rare Not-Junk-in-Starred keeps a non-junk
    // copy (→ stays starred), so leave that one reconciled.
    // Sent keeps the conversation either way: your sent mail is never junked.
    // In Starred too: your own mail is never junked, and may be what keeps the thread starred.
    const reconcileView =
      mailbox.value === 'search' || mailbox.value === mailboxIds.sent || mailbox.value === 'starred'
    const forward = () =>
      fileMailsSubmit({
        ids,
        action: spam ? 'junk' : 'not_junk',
        screen_action: screenForward,
        leaves: reconcileView ? null : mailbox.value,
      })

    // Optimistic (plain mailbox, or junking a Starred thread): drop the rows now, before the request.
    // excludeCommonMailboxes=false so the removal also applies in Starred. Captured for rollback + undo.
    let removedThreads: Thread[] = []
    if (!reconcileView) removedThreads = handleSuccessAndRemoveFromList(threadIDs, false)
    const restore = {
      mails: snapshot,
      screen_action: screenForward ? (spam ? 'Accepted' : 'Spam') : null,
    }
    // Undo flips the junk status back — name the resulting state, like the forward toast does.
    const restored =
      selectedThreads.length === 1
        ? __('Thread marked as {0}.', [spam ? __('Not Junk') : __('Junk')])
        : __('Threads marked as {0}.', [spam ? __('Not Junk') : __('Junk')])
    const success =
      selectedThreads.length === 1
        ? __('Thread marked as {0}.', [spam ? __('Junk') : __('Not Junk')])
        : __('Threads marked as {0}.', [spam ? __('Junk') : __('Not Junk')])

    // Drop any prior undo so it isn't triggerable while this action is in flight.
    setUndoAction(undefined)
    if (!reconcileView) {
      // Optimistic path: confirm immediately, arm undo now, fire in the background.
      let forwardOk = false
      const forwardPromise = (async () => {
        try {
          await forward()
          forwardOk = true
          mailboxes.refetch().catch(() => {})
          refillIfEmpty()
        } catch (error) {
          // Single request: the server is unchanged on failure, so just restore the UI.
          restoreThreadsToList(removedThreads)
          setUndoAction(undefined)
          throw error
        }
      })()
      setUndoAction(
        () =>
          void (async () => {
            await forwardPromise.catch(() => {})
            if (!forwardOk) return
            restoreThreadsToList(removedThreads)
            setUndoAction(undefined)
            const undoReq = setMailsMailboxesSubmit(restore)
              .then(() => mailboxes.refetch().catch(() => {}))
              .catch((error) => {
                removeThreadsFromList(removedThreads.map((t) => t.thread_id))
                throw error
              })
            raiseOptimisticToast(undoReq, restored)
          })(),
      )
      return raiseOptimisticToast(forwardPromise, success, undo)
    }

    // Reconcile (search/starred/sent): the list only changes once the server responds. Sent keeps the
    // conversation — your reply is never junked — so the open thread stays put there.
    const action = async () => {
      await forward()
      // Sent and Starred keep the conversation and its open thread (your reply, starred or not, is
      // never junked), but the mail you received is junked now: it leaves the open thread, as it
      // would on reading the conversation again.
      let unjunkPane = () => {}
      if (mailbox.value === mailboxIds.sent || mailbox.value === 'starred') {
        resetThreads()
        if (spam && threadID.value && selectedThreads.includes(threadID.value)) {
          const rollbacks = threadMails([threadID.value])
            .filter((m) => isReceived(m, mailboxIds.sent))
            .map((m) => mailThreadRef.value?.removeMailFromView(m.id).rollback)
          // Last out, first back: each put back where it stood before the ones after it left.
          unjunkPane = () => [...rollbacks].reverse().forEach((rollback) => rollback?.())
        }
      } else handleSuccessAndRemoveFromList(threadIDs)
      setUndoAction(() => {
        const undoAction = async () => {
          unjunkPane()
          await setMailsMailboxesSubmit(restore)
          resetThreads()
          mailboxes.refetch().catch(() => {})
        }
        raisePromiseToast(undoAction, __('Undoing...'), restored)
      })
      mailboxes.refetch().catch(() => {})
    }
    const loading = spam ? __('Marking as Junk...') : __('Marking as Not Junk...')
    raisePromiseToast(action, loading, success, undo)
  }
  const handleDeleteThreads = (thread_ids: string[]) => {
    if (!thread_ids?.length) return
    closeComposeWindowHolding(thread_ids)

    // Resolve mail names before the optimistic removal empties currentMailboxMails.
    const names = currentMailboxMails(thread_ids).map((m) => m.name)
    // Optimistic: drop the rows now (excludeCommonMailboxes=false removes locally even in
    // search/starred — a hard delete is unambiguous). No undo; restore the rows if the request fails.
    const removed = handleSuccessAndRemoveFromList(thread_ids, false)
    const forward = bulkDeleteSubmit({
      names,
    })
      .then(() => refillIfEmpty())
      .catch((error) => {
        if (removed.length) restoreThreadsToList(removed)
        throw error
      })
    raiseOptimisticToast(
      forward,
      thread_ids.length === 1 ? __('Thread deleted.') : __('Threads deleted.'),
    )
  }

  // Drafts leave the list at once and are deleted once the toast's Undo has passed; Undo puts the
  // rows back and sends nothing. Only the copies in Drafts go: a reply draft's conversation stays.
  const discardDrafts = (thread_ids: string[]) => {
    if (!thread_ids?.length) return
    closeComposeWindowHolding(thread_ids)
    const names = currentMailboxMails(thread_ids).map((m) => m.name)
    const removed = handleSuccessAndRemoveFromList(thread_ids, false)
    // Removing from the list only names the rows; the list hides them because their drafts are held
    // as discarding, until the delete lands or Undo lets them go. Only the drafts: the mail they
    // answer is not being discarded, and held too it took the conversation off every other list.
    const held = removed.flatMap((thread) =>
      thread.messages.filter((m) => m.draft).map((m) => m.id),
    )
    held.forEach(holdDraft)
    const restore = () => {
      held.forEach(releaseDraft)
      if (removed.length) restoreThreadsToList(removed)
    }
    commitAfterUndo({
      message: thread_ids.length === 1 ? __('Draft discarded.') : __('Drafts discarded.'),
      removal: { kind: 'messages', names },
      onSent: refillIfEmpty,
      restore,
      undoSlot: { set: (action) => setUndoAction(action), retire: retireUndoAction },
    })
  }

  // ── Per-message (single mail) actions from the reading pane ─────────────────────────────────────
  // The orchestration is shared with the merged All Inboxes list (see useMailRemoval); what differs is
  // where the pane goes when a thread empties, and how a removed row is put back — Sent and Drafts
  // also summarise their rows from the folder rather than the conversation.
  const { runMailRemoval } = useMailRemoval({
    row: (mail) => rows.value?.find((t: Thread) => t.thread_id === mail.thread_id),
    mailThreadRef,
    onEmptied: (mail) => goToNextThreadOrMailbox([mail.thread_id]),
    removeRow: (mail) => {
      const removed = removeThreadsFromList([mail.thread_id])
      return () => {
        if (removed.length) restoreThreadsToList(removed)
      }
    },
    viewMailbox: () => mailbox.value,
    outgoing: () => [mailboxIds.sent, mailboxIds.drafts].includes(mailbox.value),
    afterForward: refillIfEmpty,
  })

  // Each copy snapshotted with its OWN mailboxes, so undo puts the sent copy back in Sent rather
  // than wherever the copy on screen came from.
  const mailSnapshot = (mail: Mail) =>
    mailCopies(mail).map((copy) => ({
      id: copy.id,
      mailbox_ids: copy.mailboxes.map((mb) => mb.mailbox_id),
      junk: copy.junk,
    }))
  const handleMailMove = (mail: Mail, target: string) => {
    const snapshot = mailSnapshot(mail)
    const mailboxName = mailboxes.data?.find((m) => m.id === target)?._name
    // Every copy of it, filed by the same rules as a conversation (see fileMails): Trash takes the
    // sent twin of a self-addressed mail too, while any other move leaves it in Sent.
    runMailRemoval(
      mail,
      () =>
        fileMailsSubmit({
          ids: mailCopyIds(mail),
          action: 'move',
          mailbox: target,
        }),
      __('Mail moved to {0}.', [mailboxName]),
      {
        undoReq: () =>
          setMailsMailboxesSubmit({
            mails: snapshot,
          }),
        undoSuccess: __('Mail moved back.'),
      },
    )
  }
  const handleMailSpam = (mail: Mail, spam: boolean) => {
    const snapshot = mailSnapshot(mail)
    // Junk only marks the mail; Not Junk accepts the sender, in the same call (see
    // handleSetSpamStatus).
    const screenForward = spam ? null : 'Accepted'
    const success = spam ? __('Mail marked as Junk.') : __('Mail marked as Not Junk.')
    runMailRemoval(
      mail,
      () =>
        fileMailsSubmit({
          ids: mailCopyIds(mail),
          action: spam ? 'junk' : 'not_junk',
          screen_action: screenForward,
        }),
      success,
      {
        undoReq: () =>
          setMailsMailboxesSubmit({
            mails: snapshot,
            screen_action: screenForward ? (spam ? 'Accepted' : 'Spam') : null,
          }),
        undoSuccess: __('Mail marked as {0}.', [spam ? __('Not Junk') : __('Junk')]),
      },
    )
  }
  const handleMailDelete = (mail: Mail) =>
    runMailRemoval(
      mail,
      () =>
        bulkDeleteSubmit({
          names: mailCopyNames(mail),
        }),
      __('Mail deleted.'),
    )
  const getOriginalState = (
    selectedThreads: string[],
    propertyName: 'seen' | 'junk' | 'flagged',
  ): SetSeenParams => {
    const statusMap: Record<string, 0 | 1> = Object.fromEntries(
      rows.value.map((thread: Thread) => [thread.thread_id, thread[propertyName]]),
    )
    const originalState: SetSeenParams = selectedThreads.reduce(
      (acc: SetSeenParams, thread_id: string) => {
        const key = statusMap[thread_id]
        if (!acc[key]) acc[key] = []
        acc[key].push(thread_id)
        return acc
      },
      {},
    )
    return originalState
  }
  // A screened thread is decided by what is done with it: moving it anywhere but Junk, or filing it
  // into a folder, accepts its sender, and the action's own Undo takes the acceptance back (see
  // useScreener). The rows are read before the action, which may drop them from the list.
  const touchedRows = (threadIds: string[]) =>
    rows.value.filter((t: Thread) => threadIds.includes(t.thread_id))

  const landedOf = (result: unknown) =>
    result instanceof Promise ? (result as Promise<boolean>) : undefined

  const handleMoveThreads = (threadIDs: Record<string, string[]>) => {
    const touched = touchedRows(Object.values(threadIDs).flat())
    const result = moveThreads(threadIDs)
    if (!(mailboxIds.junk in threadIDs)) screener.acceptOnAction(touched, landedOf(result))
    return result
  }

  const handleArchiveThreads = (threadIds: string[]) => {
    const touched = touchedRows(threadIds)
    const result = archiveThreads(threadIds)
    screener.acceptOnAction(touched, landedOf(result))
    return result
  }

  const handleUnarchiveThreads = (threadIds: string[]) => {
    const touched = touchedRows(threadIds)
    const result = unarchiveThreads(threadIds)
    screener.acceptOnAction(touched, landedOf(result))
    return result
  }

  const handleAddThreadsToMailbox = (mailboxId: string, threadIds: string[], isUndo = false) => {
    const touched = touchedRows(threadIds)
    const result = addThreadsToMailbox(mailboxId, threadIds, isUndo)
    if (!isUndo) screener.acceptOnAction(touched, landedOf(result))
    return result
  }

  // Junk is the one refusal: a selection holding a screened thread blocks the senders it waits on,
  // as No does in the open thread, and goes to Junk whole — the ordinary threads in it too, so one
  // Undo puts everything back where it was.
  const handleSetSpamStatus = (threadIDs: SetSeenParams) => {
    const junked = threadIDs[1]
    if (Object.keys(threadIDs).length !== 1 || !junked?.length) return setSpamStatus(threadIDs)
    const senders = screener.sendersOf(touchedRows(junked))
    if (!senders.length) return setSpamStatus(threadIDs)
    const mails = threadMails(junked).map((m) => ({
      id: m.id,
      mailbox_ids: m.mailboxes.map((mb) => mb.mailbox_id),
      junk: m.junk,
    }))
    closeComposeWindowHolding(junked)
    const removed = handleSuccessAndRemoveFromList(junked, false)
    void screener.deny(senders, { mails }).then((done) => done || restoreThreadsToList(removed))
  }

  return {
    // Handlers
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
    // Per-message (reading-pane) actions
    handleMailMove,
    handleMailSpam,
    handleMailDelete,
    setFlaggedSubmit,
    // Toolbar option lists
    selectedRows,
    moveToOptions,
    folderOptions,
    showMoveTo,
    showFolders,
    // Junk/Delete confirmation dialog
    showJunkOrDeleteThreads,
    junkOrDeleteThreadsOptions,
  }
}
