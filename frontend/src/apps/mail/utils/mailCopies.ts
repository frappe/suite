import type { Mail, MailCopy, Thread } from '@/apps/mail/types'

/**
 * A message together with the other copies of it the account holds.
 *
 * Mail you send to yourself — directly, by copying yourself, or through a list you are on — leaves
 * two of the same message behind: the copy saved in Sent, and the copy delivery filed. The server
 * hands the thread one of them (see `collapse_duplicate_copies`) with the rest hanging off it as
 * `duplicates`, so the conversation reads once and the row counts once.
 *
 * Which is exactly the split to keep in mind here: **render the message, act on its copies**. An
 * action that reaches only the copy on screen leaves the invisible one behind, and the invisible one
 * still counts — a trashed mail keeps a twin in Sent, an unstarred thread stays starred (JMAP asks
 * whether *any* message in the thread carries the keyword), and a conversation marked read stays
 * unread. Undo has the same appetite: each copy must go back to the mailboxes it came from, which is
 * why a copy carries its own membership rather than the survivor's.
 *
 * Every message but a self-addressed handful has no twin, so these are lists of one.
 */
export const mailCopies = (mail: Mail): MailCopy[] => [mail, ...(mail.duplicates ?? [])]

/** The mail ids an action on `mail` should carry: its own, and those of the copies it stands for. */
export const mailCopyIds = (mail: Mail): string[] => mailCopies(mail).map((copy) => copy.id)

/** The same, as Mail Message document names — what deletes are addressed by. */
export const mailCopyNames = (mail: Mail): string[] => mailCopies(mail).map((copy) => copy.name)

/**
 * The mail ids a list row's star, or any action naming no message of its own, should carry.
 *
 * A row stands for one representative message (see serialize_thread) — and in Sent, for a mail you
 * sent yourself, that is the copy the pane does *not* render. Acting on it alone leaves the row and
 * the open thread disagreeing about the same message: starred in the list, hollow in the pane.
 */
export const rowMailIds = (thread: Thread): string[] => {
	const shown = (thread.messages ?? []).find((mail) => mailCopyIds(mail).includes(thread.id))
	return shown ? mailCopyIds(shown) : [thread.id]
}
