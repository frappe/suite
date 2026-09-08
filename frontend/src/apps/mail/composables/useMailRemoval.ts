import { type Ref } from 'vue'

import { raiseOptimisticToast } from '@/apps/mail/utils'
import { useUndo } from '@/apps/mail/utils/composables'
import { resummariseRow } from '@/apps/mail/utils/threadSummary'
import { userStore } from '@/apps/mail/stores/user'

import type { Mail, Thread } from '@/apps/mail/types'

interface MailThreadInstance {
	removeMailFromView: (mailId: string) => { emptied: boolean; rollback: () => void }
}

interface MailRemovalOptions {
	/** The loaded row the mail's thread belongs to, if it is in the loaded window. */
	row: (mail: Mail) => Thread | undefined
	/** The open reading pane, which drops the mail from its own view. */
	mailThreadRef: Ref<MailThreadInstance | null>
	/**
	 * The mail was the last one its thread had to show, so the pane has nothing left: take it
	 * elsewhere. Runs before the row is dropped, since where to go is read off the list.
	 */
	onEmptied: (mail: Mail) => void
	/** Drop the thread's row from the list. Returns a closure putting it back where it was. */
	removeRow: (mail: Mail, thread?: Thread) => () => void
	/** The current mailbox id, but only in Sent or Drafts — see resummariseRow. */
	outgoingMailbox?: () => string | undefined
	/** Runs once the forward request lands, after the sidebar counts are reloaded. */
	afterForward?: () => void
}

/**
 * Per-message actions from the reading pane — move a single mail out of its thread, junk it, delete it.
 *
 * The mail leaves the pane at once: waiting for the request meant a click did nothing visible until the
 * round-trip landed. Three things have to move with it, and all three had to be got right twice, once
 * per list view, before this was shared — the same stale-row bug was then fixed in both copies within
 * one commit:
 *
 * 1. the pane drops the message (removeMailFromView),
 * 2. the row drops it from its own `messages`, which is where its message count and its participants
 *    come from, and re-derives the summary fields describing the thread's latest message,
 * 3. if that was the thread's last message, the pane goes elsewhere and the row leaves the list.
 *
 * A failure puts all of it back. Undo, when the caller supplies `undoReq`, restores the server state and
 * replays the same UI restore — and if the undo itself fails, re-removes, so the UI never shows a mail
 * the server still considers gone.
 */
export const useMailRemoval = ({
	row,
	mailThreadRef,
	onEmptied,
	removeRow,
	outgoingMailbox,
	afterForward,
}: MailRemovalOptions) => {
	const { mailboxes } = userStore()
	const { setUndoAction, undo } = useUndo()

	const runMailRemoval = (
		mail: Mail,
		req: () => Promise<unknown>,
		success: string,
		opts: {
			undoReq?: () => Promise<unknown>
			undoSuccess?: string
			afterSuccess?: () => void
		} = {},
	) => {
		const { emptied, rollback } = mailThreadRef.value?.removeMailFromView(mail.id) ?? {
			emptied: false,
			rollback: () => {},
		}

		const thread = row(mail)
		const mailIndex = thread?.messages?.findIndex((m: Mail) => m.id === mail.id) ?? -1

		// Drop the mail from the row's own conversation and re-summarise it. Returns the inverse.
		const dropFromRow = () => {
			if (!thread || mailIndex === -1) return () => {}
			const index = thread.messages.findIndex((m: Mail) => m.id === mail.id)
			if (index === -1) return () => {}
			thread.messages.splice(index, 1)
			const restoreSummary = resummariseRow(thread, outgoingMailbox?.())
			return () => {
				thread.messages.splice(mailIndex, 0, mail)
				restoreSummary()
			}
		}

		let restoreFromRow = dropFromRow()

		let restoreRow: (() => void) | undefined
		if (emptied) {
			onEmptied(mail)
			restoreRow = removeRow(mail, thread)
		}

		const restoreUi = () => {
			rollback()
			restoreFromRow()
			restoreRow?.()
		}

		setUndoAction(undefined)
		let forwardOk = false
		const forwardPromise = (async () => {
			try {
				await req()
				forwardOk = true
				mailboxes.reload()
				afterForward?.()
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
							// instead of showing the mail (and its row) as restored. The pane stays where
							// it is: it was already taken elsewhere once, and the reader has since asked
							// to come back.
							mailThreadRef.value?.removeMailFromView(mail.id)
							restoreFromRow = dropFromRow()
							if (emptied) restoreRow = removeRow(mail, thread)
							throw error
						}),
					opts.undoSuccess ?? success,
				)
			})(),
		)
		raiseOptimisticToast(forwardPromise, success, undo)
	}

	return { runMailRemoval }
}
