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

/**
 * Whether the reader has read `mail`: any copy of it read counts. A reply sent to yourself is
 * delivered unread, and that delivered copy is the one the thread shows, but its copy in Sent was
 * read as it was written — it is not news to the person who just sent it.
 */
export const isMailSeen = (mail: Mail): boolean => mailCopies(mail).some((copy) => !!copy.seen)

/**
 * Each row of `mails` under the id of every copy it stands for. Which copy the server leads with
 * changes: a reply to yourself is its Sent copy until it is delivered, and the delivered copy from
 * then on. A thread already showing one finds the same message under the other here.
 */
export const byCopyId = (mails: Mail[]): Map<string, Mail> =>
  new Map(mails.flatMap((mail) => mailCopyIds(mail).map((id) => [id, mail] as const)))

/** The copies of `fresh` other than the one shown under `id`: what that row's actions also reach. */
export const copiesBeside = (fresh: Mail, id: string): MailCopy[] =>
  mailCopies(fresh).filter((copy) => copy.id !== id)

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

/**
 * The mail ids pinning or unpinning a conversation carries: all of them, since the pin is the
 * conversation's. The server keeps to those in the Inbox when pinning (see suite/mail/pins.py).
 */
export const threadPinIds = (thread: Thread): string[] =>
  thread.messages?.length ? thread.messages.flatMap(mailCopyIds) : [thread.id]

/**
 * The mail ids starring or unstarring a whole thread carries. A thread is starred while any message
 * in it is (as the Starred folder reads it), so unstarring clears every starred message — clearing
 * only the row's own left the thread in Starred, starred by an older message. Starring marks the
 * row's own message alone: marking them all filled every message's star in the open thread.
 */
export const threadStarIds = (thread: Thread, flagged: boolean): string[] => {
  if (flagged) return rowMailIds(thread)
  // Every copy that is starred, hidden ones too: a message you sent yourself keeps a copy in Sent
  // the thread does not show, and a star left on it kept the conversation in Starred.
  const starred = (thread.messages ?? [])
    .flatMap(mailCopies)
    .filter((copy) => copy.flagged)
    .map((copy) => copy.id)
  return [...new Set([...rowMailIds(thread), ...starred])]
}
