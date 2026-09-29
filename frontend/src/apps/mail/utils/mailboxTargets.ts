/** Anything filed in mailboxes: a mail, a thread summary, a search result. */
interface Filed {
	mailboxes: { mailbox_id: string }[]
}

interface MailboxIds {
	sent?: string
	drafts?: string
	screener?: string
}

/**
 * The mailboxes every one of `items` already sits in.
 *
 * What a folder menu has to subtract, asked of the things being moved rather than of the list
 * they were picked from — which is the only way to ask it in Search or Starred, where the view
 * is a query and not a mailbox. Intersection, not union: a folder holding only some of a
 * selection is still somewhere the rest can go, and moving the ones already there is a no-op.
 *
 * The same question one level down is "which mailboxes does this whole thread sit in", over its
 * mails — including the copy in Sent that a mail to yourself leaves behind (see mailCopies).
 */
export const commonMailboxIds = (items: Filed[]): string[] =>
	items.length
		? items
				.map((item) => item.mailboxes.map((m) => m.mailbox_id))
				.reduce((common, ids) => common.filter((id) => ids.includes(id)))
		: []

/**
 * Whether a mailbox can be moved into. The "Move to" menu and the folders that take a dragged
 * thread are the same question asked twice, so they ask it here: nothing moves to where it
 * already is, and Sent, Drafts and the Screener hold mail that is defined by how it got there
 * rather than by a folder anyone files into.
 *
 * `filedIn` is where the mail being moved already sits — `commonMailboxIds` of a selection, of a
 * thread's mails, or of the rows a drag is carrying (which the list works out at dragstart and
 * hands to the sidebar, so a folder is never offered as the target it is already the source of).
 */
export const canMoveToMailbox = (
	mailboxId: string | undefined,
	filedIn: string[],
	mailboxIds: MailboxIds,
): boolean =>
	!!mailboxId &&
	!filedIn.includes(mailboxId) &&
	![mailboxIds.sent, mailboxIds.drafts, mailboxIds.screener].includes(mailboxId)
