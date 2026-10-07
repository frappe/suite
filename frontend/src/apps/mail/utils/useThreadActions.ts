import { Icon } from 'frappe-ui/experimental'
import { computed, h, ref, type ComputedRef, type Ref } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { closeComposeWindowFor } from '@/apps/mail/composables/useComposeWindow'
import { useMailRemoval } from '@/apps/mail/composables/useMailRemoval'
import { useScreener } from '@/apps/mail/composables/useScreener'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { userStore, type MailboxRole } from '@/apps/mail/stores/user'
import type { Mail, Mailbox, MailCopy, Thread } from '@/apps/mail/types'
import { getIcon, raiseOptimisticToast, raisePromiseToast } from '@/apps/mail/utils'
import { useUndo } from '@/apps/mail/utils/composables'
import { canMoveToMailbox, commonMailboxIds } from '@/apps/mail/utils/mailboxTargets'
import { mailCopies, mailCopyIds, mailCopyNames, rowMailIds } from '@/apps/mail/utils/mailCopies'

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
  const { setUndoAction, undo } = useUndo()
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
  const isSentMail = (m: MailCopy) => m.mailboxes.some((mb) => mb.mailbox_id === mailboxIds.sent)
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
  const moveMails = useMutation(api.mail.messages.move)
  async function moveMailsSubmit({
    ids,
    mailbox: target,
    clear_junk,
  }: {
    ids: string[]
    mailbox: string
    clear_junk?: boolean
  }) {
    const input: InputOf<typeof api.mail.messages.move> = {
      account: store.accountId,
      ids,
      mailbox: target,
      clear_junk,
    }
    await moveMails.run(input)
  }

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
  const showMoveTo = computed(() => !!selections.value.length && !!moveToOptions.value?.length)
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
  const showAddTo = computed(
    () =>
      selections.value.length &&
      addToOptions.value.length &&
      !['search', 'starred', mailboxIds.junk, mailboxIds.trash].includes(mailbox.value),
  )

  // Removable when any selected mail is in more than one mailbox (so removing one keeps it elsewhere).
  const showRemoveFrom = computed(
    () =>
      !!selections.value.length &&
      threadMails(selections.value).some((m) => m.mailboxes.length > 1),
  )
  const addToOptions = computed(() =>
    mailboxes.data
      ?.filter(
        (m) => !m.role || ['inbox', 'archive'].includes(m.role),
      )
      .filter(
        (m) =>
          !selectedRows.value.every((t: Thread) =>
            t.mailboxes.some((mb) => mb.mailbox_id === m.id),
          ),
      )
      .map((m) => ({
        label: m._name,
        icon: h(Icon, {
          name: getIcon(m),
          class: FOLDER_ICON_COLOR_MAP[m.color],
        }),
        onClick: () => handleAddThreadsToMailbox(m.id, selections.value),
      })),
  )
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

  // Optimistically mirror a move on the rows that STAY in the list (Sent / Starred keptInList): each item
  // (summary + nested messages) takes the target mailbox, keeping Sent for sent copies — exactly what the
  // forward ops do server-side — so MailListItem's folder tags update at once instead of showing the old
  // folder until a refetch. Returns a revert closure (restores the exact prior mailbox sets).
  const syncListMove = (threadIDs: Record<string, string[]>) => {
    const prev = new Map<
      {
        mailboxes: Mailbox[]
      },
      Mailbox[]
    >()
    const sentEntry = mailboxEntry(mailboxIds.sent)
    for (const [target, tids] of Object.entries(threadIDs)) {
      const targetEntry = mailboxEntry(target)
      if (!targetEntry) continue
      rows.value
        ?.filter((t: Thread) => tids.includes(t.thread_id))
        .forEach((t: Thread) => {
          ;[t, ...(t.messages ?? [])].forEach((item: { mailboxes: Mailbox[] }) => {
            prev.set(item, item.mailboxes)
            const keepsSent = item.mailboxes.some((mb) => mb.mailbox_id === mailboxIds.sent)
            item.mailboxes =
              keepsSent && sentEntry
                ? [
                    {
                      ...targetEntry,
                    },
                    {
                      ...sentEntry,
                    },
                  ]
                : [
                    {
                      ...targetEntry,
                    },
                  ]
          })
        })
    }
    return () => prev.forEach((mailboxes, item) => (item.mailboxes = mailboxes))
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
    const mailIds = allMailIds(threadIds)
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
  const removeFromOptions = computed(() => {
    const mailboxIdsInUse = new Set(
      threadMails(selections.value).flatMap((m) => m.mailboxes.map((mb) => mb.mailbox_id)),
    )
    return mailboxes.data
      ?.filter(
        (m) => mailboxIdsInUse.has(m.id) && ![mailboxIds.sent, mailboxIds.drafts].includes(m.id),
      )
      .map((m) => ({
        label: m._name,
        icon: h(Icon, {
          name: getIcon(m),
          class: FOLDER_ICON_COLOR_MAP[m.color],
        }),
        onClick: () => handleRemoveThreadsFromMailbox(m.id, selections.value),
      }))
  })
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
  const setMailsSpam = useMutation(api.mail.messages.spam)
  async function setMailsSpamSubmit({
    ids,
    spam,
    screen_action,
  }: {
    ids: string[]
    spam: boolean
    screen_action?: string | null
  }) {
    const input: InputOf<typeof api.mail.messages.spam> = {
      account: store.accountId,
      ids,
      spam,
      screen_action,
    }
    await setMailsSpam.run(input)
  }
  const showJunkOrDeleteThreads = ref(false)
  const threadsToBeDeleted = ref<string[]>([])

  // Marking as Junk is reversible (and may still prompt to block per the account setting), so it
  // runs inline with no confirmation; only the destructive delete keeps a confirmation dialog.
  const junkOrDeleteThreads = (threadIDs: string[], isJunk: boolean) => {
    if (!threadIDs?.length) return
    if (isJunk)
      return handleSetSpamStatus({
        1: threadIDs,
      })
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
    const ids = touched.flatMap(rowMailIds)
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
    const forward: Array<() => Promise<unknown>> = []
    for (const [target, tids] of Object.entries(threadIDs)) {
      const mails = threadMails(tids)
      const ids = mails.map((m) => m.id)
      if (target === mailboxIds.junk) {
        forward.push(() =>
          setMailsSpamSubmit({
            ids,
            spam: true,
          }),
        )
      } else if (target === mailboxIds.trash) {
        forward.push(() =>
          moveMailsSubmit({
            ids,
            mailbox: target,
            clear_junk: true,
          }),
        )
      } else {
        const sentIds = mails.filter(isSentMail).map((m) => m.id)
        const nonSentIds = mails.filter((m) => !isSentMail(m)).map((m) => m.id)
        if (nonSentIds.length)
          forward.push(() =>
            moveMailsSubmit({
              ids: nonSentIds,
              mailbox: target,
              clear_junk: true,
            }),
          )
        // A sent mail keeps only Sent + the target: replace its mailboxes with the target
        // (dropping the rest), then re-add Sent. Clearing junk is part of that, as it is for
        // every other move: a copy that kept the keyword would land in the target and be
        // hidden there, since a junked message is only ever shown in Junk (server-side, see
        // visible_in_mailbox). Unconditional, unlike the per-message moves that test
        // `mail.junk`, because a list row doesn't always carry it — a search result has no
        // junk field at all. Membership is unaffected: clearing files the mail in the Inbox,
        // and the two ops below settle where it ends up.
        if (sentIds.length) {
          forward.push(() =>
            moveMailsSubmit({
              ids: sentIds,
              mailbox: target,
              clear_junk: true,
            }),
          )
          forward.push(() =>
            addMailsSubmit({
              ids: sentIds,
              mailbox_id: mailboxIds.sent,
            }),
          )
        }
      }
    }

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
      // their folder tags change — update them now, before the request, and revert on failure/undo.
      const revertMove = syncListMove(threadIDs)
      let forwardOk = false
      const forwardPromise = (async () => {
        try {
          for (const op of forward) await op()
          forwardOk = true
          mailboxes.refetch().catch(() => {})
        } catch (error) {
          revertMove()
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
            revertMove()
            setUndoAction(undefined)
            const restore = setMailsMailboxesSubmit({
              mails: snapshot,
            })
              .then(() => mailboxes.refetch().catch(() => {}))
              .catch((error) => {
                // The undo didn't land server-side — re-apply the move to the tags so they
                // match the server instead of showing the stale pre-move folder.
                syncListMove(threadIDs)
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
    const reconcileView = mailbox.value === 'search' || (mailbox.value === 'starred' && !spam)

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
          await setMailsSpamSubmit({
            ids,
            spam,
            screen_action: screenForward,
          })
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

    // Reconcile (search/starred): the list only changes once the server responds.
    const action = async () => {
      await setMailsSpamSubmit({
        ids,
        spam,
        screen_action: screenForward,
      })
      handleSuccessAndRemoveFromList(threadIDs)
      setUndoAction(() => {
        const undoAction = async () => {
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
    // Trash and Junk take the message away entirely, so they take every copy of it — leave the
    // twin of a self-addressed mail behind and it sits in Sent, keeping the thread alive there.
    // Any other move moves the copy at hand and lets the sent one keep Sent, which is what a
    // thread-level move does with sent mails too (see handleMoveThreads).
    const ids = [mailboxIds.junk, mailboxIds.trash].includes(target) ? mailCopyIds(mail) : [mail.id]
    runMailRemoval(
      mail,
      () =>
        moveMailsSubmit({
          ids,
          mailbox: target,
          clear_junk: mail.junk === 1 && target !== mailboxIds.junk,
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
        setMailsSpamSubmit({
          ids: mailCopyIds(mail),
          spam,
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
    addToOptions,
    removeFromOptions,
    showMoveTo,
    showAddTo,
    showRemoveFrom,
    // Junk/Delete confirmation dialog
    showJunkOrDeleteThreads,
    junkOrDeleteThreadsOptions,
  }
}
