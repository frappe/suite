import { type ComputedRef, type Ref, computed, h, ref } from 'vue'
import { Icon } from 'frappe-ui/icons'
import { createResource } from 'frappe-ui'

import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { getIcon, raiseOptimisticToast, raisePromiseToast, raiseToast } from '@/apps/mail/utils'
import { useBlockSender, useUndo } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'

import type { Mail, Mailbox, Thread } from '@/apps/mail/types'

export type SetSeenParams = {
	0?: string[]
	1?: string[]
}

interface ThreadsResource {
	data: Thread[]
	reload: () => void
}

interface MailThreadInstance {
	syncFlagged: (ids: string[], flagged: boolean) => void
	syncMailboxMembership: (mailboxId: string, isMember: boolean) => void
	removeMailFromView: (mailId: string) => { emptied: boolean; rollback: () => void }
}

/**
 * List/reading-pane thread actions performed directly on mail ids (the full thread is loaded, so the
 * server doesn't need to resolve thread ids). Optimistic UI, undo and toasts live here too.
 */
export function useThreadActions(deps: {
	threadsResource: ComputedRef<ThreadsResource>
	mailbox: ComputedRef<string>
	threadID: ComputedRef<string>
	selections: Ref<string[]>
	mailThreadRef: Ref<MailThreadInstance | null>
	// Refetch only the first window, replacing the list and scrolling to top (mailbox switch, undo, …).
	resetThreads: (reloadMailboxes?: boolean, mailboxRoles?: string[]) => void
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
		threadsResource,
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
	const { promptBlockSenders, willJunkSenders } = useBlockSender()

	const threadMails = (threadIds: string[]): Mail[] => {
		const items = (threadsResource.value.data ?? []).filter((t: Thread) =>
			threadIds.includes(t.thread_id),
		)
		// In search, each result is itself a mail with no nested conversation.
		if (mailbox.value === 'search') return items as unknown as Mail[]
		return items.flatMap((t: Thread) => t.messages ?? [])
	}

	const isSentMail = (m: Mail) => m.mailboxes.some((mb) => mb.mailbox_id === mailboxIds.sent)

	const allMailIds = (threadIds: string[]): string[] => threadMails(threadIds).map((m) => m.id)

	// Mails of the threads that live in the current view's mailbox(es) — mirrors the old
	// get_filtered_message_ids (starred → all non-trash, search → all).
	const currentMailboxMails = (threadIds: string[]): Mail[] => {
		const mails = threadMails(threadIds)
		if (mailbox.value === 'search') return mails
		const ids =
			mailbox.value === 'starred'
				? (mailboxes.data ?? []).filter((m) => m.role !== 'trash').map((m) => m.id)
				: [mailbox.value]
		return mails.filter((m) => m.mailboxes.some((mb) => ids.includes(mb.mailbox_id)))
	}

	const setSeen = createResource({
		url: 'suite.mail.api.mail.set_mails_seen',
		makeParams: ({ ids, seen }: { ids: string[]; seen: boolean }) => ({
			account: store.accountId,
			ids,
			seen,
		}),
		onSuccess: () => mailboxes.reload(),
	})

	// Optimistic star/unstar: flip `flagged` on the affected rows (and the open thread) *before* the
	// request fires, remembering the prior state so a failure rolls it back. Both entry points — the
	// list (setFlaggedByThreadIDs) and the reading pane (setFlagged.submit) — go through beforeSubmit.
	let flagRollback: (() => void) | null = null
	const setFlagged = createResource({
		url: 'suite.mail.api.mail.set_flagged',
		makeParams: ({ ids, flagged }: { ids: string[]; flagged: boolean }) => ({
			account: store.accountId,
			ids,
			flagged,
		}),
		beforeSubmit: ({ ids, flagged }: { ids: string[]; flagged: boolean }) => {
			const changed: Array<{ thread: Thread; prev: 0 | 1 }> = []
			ids.forEach((id) => {
				const thread = threadsResource.value.data?.find((t: Thread) => t.id === id)
				if (thread) {
					changed.push({ thread, prev: thread.flagged })
					thread.flagged = flagged ? 1 : 0
				}
			})
			if (threadID.value) mailThreadRef.value?.syncFlagged(ids, flagged)
			flagRollback = () => {
				changed.forEach(({ thread, prev }) => (thread.flagged = prev))
				if (threadID.value) mailThreadRef.value?.syncFlagged(ids, !flagged)
			}
		},
		onSuccess: () => (flagRollback = null),
		onError: (error) => {
			flagRollback?.()
			flagRollback = null
			raiseToast(error.messages[0], 'error')
		},
	})

	const moveMails = createResource({
		url: 'suite.mail.api.mail.move_mails',
		makeParams: ({
			ids,
			mailbox: target,
			clear_junk,
		}: {
			ids: string[]
			mailbox: string
			clear_junk?: boolean
		}) => ({ account: store.accountId, ids, mailbox: target, clear_junk }),
	})

	const moveToOptions = computed(() =>
		mailboxes.data
			?.filter(
				(m) =>
					![
						mailbox.value,
						mailboxIds.sent,
						mailboxIds.drafts,
						mailboxIds.screener,
					].includes(m.id),
			)
			.map((m) => ({
				label: m._name,
				icon: h(Icon, { name: getIcon(m), class: FOLDER_ICON_COLOR_MAP[m.color] }),
				onClick: () => handleMoveThreads({ [m.id]: selections.value }),
			})),
	)

	const addMails = createResource({
		url: 'suite.mail.api.mail.add_mails_to_mailbox',
		makeParams: ({ ids, mailbox_id }: { ids: string[]; mailbox_id: string }) => ({
			account: store.accountId,
			ids,
			mailbox_id,
		}),
	})

	const removeMails = createResource({
		url: 'suite.mail.api.mail.remove_mails_from_mailbox',
		makeParams: ({ ids, mailbox_id }: { ids: string[]; mailbox_id: string }) => ({
			account: store.accountId,
			ids,
			mailbox_id,
		}),
	})

	// Restores each mail to an exact snapshot (mailbox set + junk) — used to undo a move precisely.
	type MailSnapshot = { id: string; mailbox_ids: string[]; junk: 0 | 1 }
	const setMailsMailboxes = createResource({
		url: 'suite.mail.api.mail.set_mails_mailboxes',
		makeParams: ({
			mails,
			screen_action,
		}: {
			mails: MailSnapshot[]
			screen_action?: string | null
		}) => ({ account: store.accountId, mails, screen_action }),
	})

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
				(m) =>
					(!m.role || ['inbox', 'archive'].includes(m.role)) &&
					m.id !== mailboxIds.screener,
			)
			.filter((m) => {
				const selected = threadsResource.value.data?.filter((t: Thread) =>
					selections.value.includes(t.thread_id),
				)
				return !selected?.every((t: Thread) =>
					t.mailboxes.some((mb) => mb.mailbox_id === m.id),
				)
			})
			.map((m) => ({
				label: m._name,
				icon: h(Icon, { name: getIcon(m), class: FOLDER_ICON_COLOR_MAP[m.color] }),
				onClick: () => handleAddThreadsToMailbox(m.id, selections.value),
			})),
	)

	const mailboxEntry = (mailboxId: string): Mailbox | null => {
		const mb = mailboxes.data?.find((m) => m.id === mailboxId)
		return mb ? { mailbox: mb.name, mailbox_id: mb.id, mailbox_name: mb._name } : null
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
					item.mailboxes.push({ ...entry })
			} else if (item.mailboxes.length > 1) {
				item.mailboxes = item.mailboxes.filter((m) => m.mailbox_id !== mailboxId)
			}
		}
		threadsResource.value.data
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
		const prev = new Map<{ mailboxes: Mailbox[] }, Mailbox[]>()
		const sentEntry = mailboxEntry(mailboxIds.sent)
		for (const [target, tids] of Object.entries(threadIDs)) {
			const targetEntry = mailboxEntry(target)
			if (!targetEntry) continue
			threadsResource.value.data
				?.filter((t: Thread) => tids.includes(t.thread_id))
				.forEach((t: Thread) => {
					;[t, ...(t.messages ?? [])].forEach((item: { mailboxes: Mailbox[] }) => {
						prev.set(item, item.mailboxes)
						const keepsSent = item.mailboxes.some((mb) => mb.mailbox_id === mailboxIds.sent)
						item.mailboxes =
							keepsSent && sentEntry
								? [{ ...targetEntry }, { ...sentEntry }]
								: [{ ...targetEntry }]
					})
				})
		}
		return () => prev.forEach((mailboxes, item) => (item.mailboxes = mailboxes))
	}

	const handleAddThreadsToMailbox = (mailboxId: string, threadIds: string[], isUndo = false) => {
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
				await addMails.submit({ ids: mailIds, mailbox_id: mailboxId })
			} catch (error) {
				revertAdd()
				if (!isUndo) setUndoAction(undefined)
				throw error
			}
			syncAfterAction()
		})()

		if (isUndo) {
			// Undo of a remove — immediate confirmation, no further undo.
			const success =
				threadIds.length === 1 ? __('Thread added back.') : __('Threads added back.')
			return raiseOptimisticToast(forward, success)
		}

		// Undo = remove again, but only once the add has actually landed (no-op if it failed).
		setUndoAction(() =>
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
	}

	const removeFromOptions = computed(() => {
		const mailboxIdsInUse = new Set(
			threadMails(selections.value).flatMap((m) => m.mailboxes.map((mb) => mb.mailbox_id)),
		)
		return mailboxes.data
			?.filter(
				(m) =>
					mailboxIdsInUse.has(m.id) &&
					![mailboxIds.sent, mailboxIds.drafts].includes(m.id),
			)
			.map((m) => ({
				label: m._name,
				icon: h(Icon, { name: getIcon(m), class: FOLDER_ICON_COLOR_MAP[m.color] }),
				onClick: () => handleRemoveThreadsFromMailbox(m.id, selections.value),
			}))
	})

	const handleRemoveThreadsFromMailbox = (
		mailboxId: string,
		threadIds: string[],
		isUndo = false,
	) => {
		// Only remove mails that are in this mailbox AND at least one other — never orphan a mail.
		const isRemovable = (m: Mail) =>
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
				await removeMails.submit({ ids, mailbox_id: mailboxId })
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
		setUndoAction(() =>
			void forward.then(
				() => handleAddThreadsToMailbox(mailboxId, threadIdsToBeUpdated, true),
				() => {},
			),
		)
		raiseOptimisticToast(forward, success, undo)
	}

	const setMailsSpam = createResource({
		url: 'suite.mail.api.mail.set_mails_spam_status',
		makeParams: ({
			ids,
			spam,
			screen_action,
		}: {
			ids: string[]
			spam: boolean
			screen_action?: string | null
		}) => ({ account: store.accountId, ids, spam, screen_action }),
	})

	const showJunkOrDeleteThreads = ref(false)
	const threadsToBeDeleted = ref<string[]>([])

	// Marking as Junk is reversible (and may still prompt to block per the account setting), so it
	// runs inline with no confirmation; only the destructive delete keeps a confirmation dialog.
	const junkOrDeleteThreads = (threadIDs: string[], isJunk: boolean) => {
		if (!threadIDs?.length) return

		if (isJunk) return handleSetSpamStatus({ 1: threadIDs })

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
			message: __('Are you sure you want to permanently delete the selected {0}?', [
				lowerNoun,
			]),
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

	const bulkDelete = createResource({
		url: 'suite.mail.doctype.mail_message.mail_message.bulk_delete',
		makeParams: ({ names }: { names: string[] }) => ({ names }),
	})

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
		if (threadID.value && thread_ids.includes(threadID.value))
			goToNextThreadOrMailbox(thread_ids)
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
					threadsResource.value?.data?.find((t: Thread) => t.thread_id === thread_id)
						?.seen === (seen ? 1 : 0),
			)
		)
			return

		// Apply optimistically so a quick reopen sees the new seen state immediately — waiting for the
		// server round-trip would leave the thread's messages stale (no auto mark-as-read / unseen marker).
		// (No-op for threads not in the list, e.g. ones opened via the get_thread fallback.) Snapshot the
		// prior state first so a failure can roll it back.
		const seenSnapshot = (threadsResource.value.data ?? [])
			.filter((t: Thread) => selectedThreads.includes(t.thread_id))
			.map((t: Thread) => ({
				thread: t,
				prev: t.seen,
				messages: (t.messages ?? []).map((m) => ({ message: m, prev: m.seen })),
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
		if (silent) return void setSeen.submit({ ids, seen }, { onError: rollback })

		// The seen flag already flipped — confirm immediately; roll back + error toast only if it fails.
		const success =
			selectedThreads.length === 1
				? __('Thread marked as {0}.', [seen ? __('read') : __('unread')])
				: __('Threads marked as {0}.', [seen ? __('read') : __('unread')])

		raiseOptimisticToast(setSeen.submit({ ids, seen }, { onError: rollback }), success)
	}

	// "Mark Unread from Here" (set_mails_seen) marks individual messages unread. Sync those message ids
	// onto each thread's nested messages so reopening reads the fresh state without a full reload.
	const handleSyncUnseen = (ids: string[]) => {
		threadsResource.value.data?.forEach((thread: Thread) => {
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
		const ids = threadsResource.value.data
			.filter((t: Thread) => threadIDs.includes(t.thread_id))
			.map((t: Thread) => t.id)
		setFlagged.submit({ ids, flagged })
	}

	// Moving: non-sent mails move to the target; sent mails keep only Sent + the target (other
	// memberships dropped) — except for junk/trash, which move everything.
	const handleMoveThreads = (threadIDs: Record<string, string[]>) => {
		const selectedThreads = Object.values(threadIDs).flat()
		if (!selectedThreads.length) return

		// Moving to Junk is the same as Mark as Junk: no undo, offer to block the sender instead.
		if (Object.keys(threadIDs).length === 1 && Object.keys(threadIDs)[0] === mailboxIds.junk)
			return handleSetSpamStatus({ 1: selectedThreads })

		const originOf = (tid: string): string | undefined =>
			threadsResource.value.data?.find((t: Thread) => t.thread_id === tid)?.mailboxes[0]
				?.mailbox_id

		const originalState: Record<string, string[]> = selectedThreads.reduce(
			(acc: Record<string, string[]>, tid: string) => {
				const key = originOf(tid)
				if (key) (acc[key] ??= []).push(tid)
				return acc
			},
			{} as Record<string, string[]>,
		)
		if (JSON.stringify(originalState) === JSON.stringify(threadIDs)) return

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
				forward.push(() => setMailsSpam.submit({ ids, spam: true }))
			} else if (target === mailboxIds.trash) {
				forward.push(() => moveMails.submit({ ids, mailbox: target, clear_junk: true }))
			} else {
				const sentIds = mails.filter(isSentMail).map((m) => m.id)
				const nonSentIds = mails.filter((m) => !isSentMail(m)).map((m) => m.id)
				if (nonSentIds.length)
					forward.push(() =>
						moveMails.submit({ ids: nonSentIds, mailbox: target, clear_junk: true }),
					)
				// A sent mail keeps only Sent + the target: replace its mailboxes with the target
				// (dropping the rest), then re-add Sent.
				if (sentIds.length) {
					forward.push(() => moveMails.submit({ ids: sentIds, mailbox: target }))
					forward.push(() =>
						addMails.submit({ ids: sentIds, mailbox_id: mailboxIds.sent }),
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

		const moveToMailboxName = mailboxes.data?.find(
			(m) => m.id === Object.keys(threadIDs)[0],
		)?._name
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
					mailboxes.reload()
					refillIfEmpty()
				} catch (error) {
					// Roll back the optimistic UI now, and undo any partial server move in the background
					// (the snapshot restores the exact pre-move state) so the error toast isn't delayed.
					restoreThreadsToList(removedThreads)
					setMailsMailboxes.submit({ mails: snapshot }).catch(() => {})
					setUndoAction(undefined)
					throw error
				}
			})()

			setUndoAction(() =>
				void (async () => {
					// Wait for the forward to settle (instant if already done); no-op if it failed.
					await forwardPromise.catch(() => {})
					if (!forwardOk) return
					restoreThreadsToList(removedThreads)
					setUndoAction(undefined)
					const restore = setMailsMailboxes
						.submit({ mails: snapshot })
						.then(() => mailboxes.reload())
						.catch((error) => {
							removeThreadsFromList(removedThreads.map((t) => t.thread_id))
							throw error
						})
					raiseOptimisticToast(restore, movedBack)
				})(),
			)
			return raiseOptimisticToast(forwardPromise, success, undo)
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
					mailboxes.reload()
				} catch (error) {
					revertMove()
					setMailsMailboxes.submit({ mails: snapshot }).catch(() => {})
					setUndoAction(undefined)
					throw error
				}
			})()

			setUndoAction(() =>
				void (async () => {
					await forwardPromise.catch(() => {})
					if (!forwardOk) return
					revertMove()
					setUndoAction(undefined)
					const restore = setMailsMailboxes
						.submit({ mails: snapshot })
						.then(() => mailboxes.reload())
						.catch((error) => {
							// The undo didn't land server-side — re-apply the move to the tags so they
							// match the server instead of showing the stale pre-move folder.
							syncListMove(threadIDs)
							throw error
						})
					raiseOptimisticToast(restore, movedBack)
				})(),
			)
			return raiseOptimisticToast(forwardPromise, success, undo)
		}

		// Reconcile (Search only): membership is a server-side text query, so the list changes once the
		// server responds — keep the loading → success toast.
		const action = async () => {
			try {
				for (const op of forward) await op()
			} catch (error) {
				await setMailsMailboxes.submit({ mails: snapshot }).catch(() => {})
				throw error
			}
			handleSuccessAndRemoveFromList(threadIDs)
			setUndoAction(() => {
				const undoAction = async () => {
					await setMailsMailboxes.submit({ mails: snapshot })
					resetThreads()
					mailboxes.reload()
				}
				raisePromiseToast(undoAction, __('Undoing...'), movedBack)
			})
			mailboxes.reload()
		}

		const loading = __('Moving to {0}...', [moveToMailboxName])
		raisePromiseToast(action, loading, success, undo)
	}

	const handleSetSpamStatus = (threadIDs: SetSeenParams) => {
		const selectedThreads = Object.values(threadIDs).flat()
		const originalState = getOriginalState(selectedThreads, 'junk')
		if (JSON.stringify(originalState) === JSON.stringify(threadIDs)) return

		const spam = Object.keys(threadIDs)[0] === '1'
		const mails = threadMails(selectedThreads)
		// Snapshot exact state now (threads leave the list on success) so undo restores the original
		// mailbox + junk, rather than set_spam_status's blanket move to Inbox.
		const snapshot = mails.map((m) => ({
			id: m.id,
			mailbox_ids: m.mailboxes.map((mb) => mb.mailbox_id),
			junk: m.junk,
		}))
		const senders = mails.map((m) => ({ name: m.from_name, email: m.from_email }))
		const ids = snapshot.map((m) => m.id)

		// Screen the senders in the SAME call as the mail change (no second request, no undo race): Junk
		// → Spam (unless the account prompts to block instead), Not Junk → Accept. Undo flips it, also in
		// the same call as the mailbox restore.
		const screenForward = spam ? (willJunkSenders(senders) ? 'Spam' : null) : 'Accepted'

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
		// When the account auto-junks the sender, surface that as the single toast for the whole action.
		const success =
			spam && willJunkSenders(senders)
				? __('Mails from sender will go to Junk.')
				: selectedThreads.length === 1
					? __('Thread marked as {0}.', [spam ? __('Junk') : __('Not Junk')])
					: __('Threads marked as {0}.', [spam ? __('Junk') : __('Not Junk')])

		// 'Ask to Block Sender' mode: junking still prompts to fully block the sender (Reject).
		const maybePromptBlock = () => spam && !screenForward && promptBlockSenders(senders)

		// Drop any prior undo so it isn't triggerable while this action is in flight.
		setUndoAction(undefined)

		if (!reconcileView) {
			// Optimistic path: confirm immediately, arm undo now, fire in the background.
			let forwardOk = false
			const forwardPromise = (async () => {
				try {
					await setMailsSpam.submit({ ids, spam, screen_action: screenForward })
					forwardOk = true
					mailboxes.reload()
					refillIfEmpty()
					maybePromptBlock()
				} catch (error) {
					// Single request: the server is unchanged on failure, so just restore the UI.
					restoreThreadsToList(removedThreads)
					setUndoAction(undefined)
					throw error
				}
			})()

			setUndoAction(() =>
				void (async () => {
					await forwardPromise.catch(() => {})
					if (!forwardOk) return
					restoreThreadsToList(removedThreads)
					setUndoAction(undefined)
					const undoReq = setMailsMailboxes
						.submit(restore)
						.then(() => mailboxes.reload())
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
			await setMailsSpam.submit({ ids, spam, screen_action: screenForward })
			handleSuccessAndRemoveFromList(threadIDs)
			setUndoAction(() => {
				const undoAction = async () => {
					await setMailsMailboxes.submit(restore)
					resetThreads()
					mailboxes.reload()
				}
				raisePromiseToast(undoAction, __('Undoing...'), restored)
			})
			mailboxes.reload()
			maybePromptBlock()
		}

		const loading = spam ? __('Marking as Junk...') : __('Marking as Not Junk...')
		raisePromiseToast(action, loading, success, undo)
	}

	const handleDeleteThreads = (thread_ids: string[]) => {
		if (!thread_ids?.length) return

		// Resolve mail names before the optimistic removal empties currentMailboxMails.
		const names = currentMailboxMails(thread_ids).map((m) => m.name)
		// Optimistic: drop the rows now (excludeCommonMailboxes=false removes locally even in
		// search/starred — a hard delete is unambiguous). No undo; restore the rows if the request fails.
		const removed = handleSuccessAndRemoveFromList(thread_ids, false)
		const forward = bulkDelete
			.submit({ names })
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
	// Optimistically drops the mail from the open thread's pane (via the exposed removeMailFromView); if
	// that empties the thread's view, the pane closes and the thread row leaves the list — all before the
	// request fires, mirroring the thread-level pattern. `undoReq` (when present) restores the server
	// state for undo; `afterSuccess` runs once the forward request lands (e.g. the block-sender prompt).
	const runMailRemoval = (
		mail: Mail,
		req: () => Promise<unknown>,
		success: string,
		opts: { undoReq?: () => Promise<unknown>; undoSuccess?: string; afterSuccess?: () => void } = {},
	) => {
		const { emptied, rollback } = mailThreadRef.value?.removeMailFromView(mail.id) ?? {
			emptied: false,
			rollback: () => {},
		}
		let removed: Thread[] = []
		if (emptied) {
			goToNextThreadOrMailbox([mail.thread_id])
			removed = removeThreadsFromList([mail.thread_id])
		}
		const restoreUi = () => {
			rollback()
			if (removed.length) restoreThreadsToList(removed)
		}

		setUndoAction(undefined)
		let forwardOk = false
		const forwardPromise = (async () => {
			try {
				await req()
				forwardOk = true
				mailboxes.reload()
				refillIfEmpty()
				opts.afterSuccess?.()
			} catch (error) {
				restoreUi()
				setUndoAction(undefined)
				throw error
			}
		})()

		if (!opts.undoReq) return raiseOptimisticToast(forwardPromise, success)

		setUndoAction(() =>
			void (async () => {
				await forwardPromise.catch(() => {})
				if (!forwardOk) return
				restoreUi()
				setUndoAction(undefined)
				raiseOptimisticToast(
					opts
						.undoReq!()
						.then(() => mailboxes.reload())
						.catch((error) => {
							// The undo didn't land server-side — re-remove so the UI matches the server
							// instead of showing the mail (and its row) as restored.
							mailThreadRef.value?.removeMailFromView(mail.id)
							if (removed.length) removeThreadsFromList([mail.thread_id])
							throw error
						}),
					opts.undoSuccess ?? success,
				)
			})(),
		)
		raiseOptimisticToast(forwardPromise, success, undo)
	}

	const mailSnapshot = (mail: Mail) => [
		{ id: mail.id, mailbox_ids: mail.mailboxes.map((mb) => mb.mailbox_id), junk: mail.junk },
	]

	const handleMailMove = (mail: Mail, target: string) => {
		const snapshot = mailSnapshot(mail)
		const mailboxName = mailboxes.data?.find((m) => m.id === target)?._name
		runMailRemoval(
			mail,
			() =>
				moveMails.submit({
					ids: [mail.id],
					mailbox: target,
					clear_junk: mail.junk === 1 && target !== mailboxIds.junk,
				}),
			__('Mail moved to {0}.', [mailboxName]),
			{ undoReq: () => setMailsMailboxes.submit({ mails: snapshot }), undoSuccess: __('Mail moved back.') },
		)
	}

	const handleMailSpam = (mail: Mail, spam: boolean) => {
		const snapshot = mailSnapshot(mail)
		const senders = [{ name: mail.from_name, email: mail.from_email }]
		// Screen the sender in the same call (see handleSetSpamStatus): Junk → Spam (unless the account
		// prompts to block instead), Not Junk → Accept.
		const screenForward = spam ? (willJunkSenders(senders) ? 'Spam' : null) : 'Accepted'
		const success =
			spam && willJunkSenders(senders)
				? __('Mails from sender will go to Junk.')
				: spam
					? __('Mail marked as Junk.')
					: __('Mail marked as Not Junk.')
		runMailRemoval(
			mail,
			() => setMailsSpam.submit({ ids: [mail.id], spam, screen_action: screenForward }),
			success,
			{
				undoReq: () =>
					setMailsMailboxes.submit({
						mails: snapshot,
						screen_action: screenForward ? (spam ? 'Accepted' : 'Spam') : null,
					}),
				undoSuccess: __('Mail marked as {0}.', [spam ? __('Not Junk') : __('Junk')]),
				// 'Ask to Block Sender' mode: junking still prompts to fully block the sender (Reject).
				afterSuccess: () => spam && !screenForward && promptBlockSenders(senders),
			},
		)
	}

	const handleMailDelete = (mail: Mail) =>
		runMailRemoval(mail, () => bulkDelete.submit({ names: [mail.name] }), __('Mail deleted.'))

	const getOriginalState = (
		selectedThreads: string[],
		propertyName: 'seen' | 'junk' | 'flagged',
	): SetSeenParams => {
		const statusMap: Record<string, 0 | 1> = Object.fromEntries(
			threadsResource.value.data.map((thread: Thread) => [
				thread.thread_id,
				thread[propertyName],
			]),
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
		// Resource exposed to the template (MailThread @set-flagged)
		setFlagged,
		// Toolbar option lists
		moveToOptions,
		addToOptions,
		removeFromOptions,
		showAddTo,
		showRemoveFrom,
		// Junk/Delete confirmation dialog
		showJunkOrDeleteThreads,
		junkOrDeleteThreadsOptions,
	}
}
