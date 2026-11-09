// The most hover actions a row in this list can show at once (see MailRowActions). The full-width list
// keeps room for that many in every row: the date and the actions share one column, so a column sized
// to the date let the actions spill over the attachments, and one sized to each row's actions would
// shift the row on hover and stop stack and thread rows lining up.
export function rowActionSlots(list: {
  drafts?: boolean
  unarchive?: boolean
  pinnable?: boolean
}): number {
  // Discard. A draft has no star.
  if (list.drafts) return 1
  // Read or Unread, Archive or Unarchive, Trash or Delete, and the star.
  const thread = 4 + Number(!!list.pinnable)
  // A stack's run can hold mail to archive and mail to unarchive at once; its chevron takes the star's place.
  const stack = 4 + Number(!!list.unarchive)
  return Math.max(thread, stack)
}
