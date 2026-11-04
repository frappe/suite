/**
 * Mail you received, told from your own as the filing rules tell it (suite/mail/filing.py): not a
 * draft, and not filed in Sent — what you send is kept there, and a draft in Drafts. Archive and Junk
 * act only on received mail, so a conversation of nothing but your own has nothing to archive or junk.
 */
type Filed = { draft?: number | boolean | null; mailboxes: { mailbox_id: string }[] }

export const isReceived = (mail: Filed, sentId?: string): boolean =>
  !mail.draft && !mail.mailboxes.some((mailbox) => mailbox.mailbox_id === sentId)

/** Whether any of these messages is mail you received. */
export const holdsReceivedMail = (mails: Filed[], sentId?: string): boolean =>
  mails.some((mail) => isReceived(mail, sentId))

/**
 * Whether Archive would still do something to these messages: some mail you received is outside
 * Archive, or anything is still in the Inbox. Asked of the messages you received, not of a row's own message —
 * in Sent that is your reply, which Archive never touches, so it never reads as archived.
 */
export const archivable = (
  mails: Filed[],
  boxes: { sent?: string; archive?: string; inbox?: string },
): boolean =>
  mails.some((mail) => {
    if (mail.draft) return false
    const ids = mail.mailboxes.map((mailbox) => mailbox.mailbox_id)
    // Your own mail is never archived, but Archive clears it out of the Inbox, where an earlier
    // move could have filed it.
    if (!isReceived(mail, boxes.sent)) return ids.includes(boxes.inbox ?? '')
    return !ids.includes(boxes.archive ?? '') || ids.includes(boxes.inbox ?? '')
  })

/**
 * Whether Unarchive would do something: some of the conversation is in Archive, and none of the mail
 * you received is still in the Inbox. Archive's opposite, so the two share one place and only one of
 * them shows. Your own mail counts here, unlike for Archive: Archive once filed it there too, and
 * Unarchive lets it out.
 */
export const unarchivable = (
  mails: Filed[],
  boxes: { sent?: string; archive?: string; inbox?: string },
): boolean =>
  !archivable(mails, boxes) &&
  mails.some(
    (mail) => !mail.draft && mail.mailboxes.some((mailbox) => mailbox.mailbox_id === boxes.archive),
  )

/**
 * The folders the mail you received is in, apart from the usual places — the Inbox, Sent and Drafts —
 * and the list being shown: what a Sent or Starred row's tags say, the row standing for the
 * conversation rather than for its own message (in Sent, your reply, which is never filed away).
 */
export const receivedFolders = <F extends { mailbox_id: string }>(
  mails: (Filed & { mailboxes: F[] })[],
  boxes: { sent?: string; inbox?: string; drafts?: string },
  shown: string,
): F[] => foldersOf(mails, boxes.sent, [boxes.inbox, boxes.sent, boxes.drafts, shown])

/**
 * Where a search result's conversation is: the folders the mail you received is in, the Inbox
 * among them, since a search has no usual place. Sent only for a conversation of nothing but your
 * own mail, where it is the one answer.
 */
export const searchFolders = <F extends { mailbox_id: string }>(
  mails: (Filed & { mailboxes: F[] })[],
  boxes: { sent?: string; drafts?: string },
): F[] =>
  foldersOf(
    mails,
    boxes.sent,
    holdsReceivedMail(mails, boxes.sent) ? [boxes.sent, boxes.drafts] : [boxes.drafts],
  )

const foldersOf = <F extends { mailbox_id: string }>(
  mails: (Filed & { mailboxes: F[] })[],
  sent: string | undefined,
  skipped: (string | undefined)[],
): F[] => {
  // A conversation of nothing but your own mail has no received mail to describe: then it is your
  // sent mail that says where you filed it.
  const described = holdsReceivedMail(mails, sent)
    ? mails.filter((mail) => isReceived(mail, sent))
    : mails.filter((mail) => !mail.draft)
  const folders = new Map<string, F>()
  for (const mail of described)
    for (const folder of mail.mailboxes)
      if (!skipped.includes(folder.mailbox_id) && !folders.has(folder.mailbox_id))
        folders.set(folder.mailbox_id, folder)
  return [...folders.values()]
}
