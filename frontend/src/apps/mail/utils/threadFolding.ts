import type { Mail } from '@/apps/mail/types'

// Which rows of a conversation fold to a line. A mail already seen comes back collapsed when the
// thread loads (see transformThreadMails), and a click opens it; these two say what that flag is
// worth for a given row.

// The message at the end of the conversation stays open — it is the one being read. Drafts do not
// count towards which that is: a reply written at the bottom of the thread is not a newer message,
// it is a thing being written about the last one, and the reader wants both on screen. Read as the
// last row outright, the message being replied to folded itself away the moment the draft under it
// was saved and the thread reloaded around it — every mail already seen comes back collapsed, and
// the exemption had moved on to the draft.
export const lastMessageOf = (thread: Mail[]): Mail | undefined =>
  [...thread].reverse().find((mail) => !mail.draft) ?? thread.at(-1)

// A draft is never collapsed: its card is the editor, whatever `collapsed` says. It still comes
// back seen and so collapsed, and being left out of `lastMessageOf` it has no exemption — so taken
// at its word it was styled as a folded row: the list's hover grey, a pointer, the slimmer padding.
export const isCollapsed = (mail: Mail, lastMessage: Mail | undefined): boolean =>
  !!(mail.collapsed && !mail.draft && mail !== lastMessage)

// The run of mail a long thread hides behind "N more messages": the seen mail between the first
// one and the newest two, once there are four or more of it. A draft is not mail to hide and not
// the newest message — counted as either, opening a reply under the last message made that message
// look like one more older mail, and the fold grew by one and swallowed the mail just above it.
export const foldedNames = (thread: Mail[]): string[] => {
  const last = lastMessageOf(thread)
  const seen = thread.filter((mail) => mail.seen && !mail.draft && mail !== last)
  if (seen.length < 4) return []
  return seen.slice(1, -1).map((mail) => mail.name)
}

// What a fold set when the thread loaded still hides as the thread changes on screen: the same
// mail, less any that has gone or been marked unread, and less what now stands at the fold's edges
// — the first seen mail, the newest and the one above it stay out, as foldedNames leaves them. Never
// more: worked out afresh, mail landing at the bottom made the message above the newest one more
// older mail, and it vanished into the fold while the reader was looking at it. Nor stuck: when
// the newest replies go, the ones left at the bottom come out from behind it.
export const stillFolded = (folded: readonly string[], thread: Mail[]): Set<string> => {
  const last = lastMessageOf(thread)
  const seen = thread.filter((mail) => mail.seen && !mail.draft && mail !== last)
  const hideable = new Set(seen.slice(1, -1).map((mail) => mail.name))
  return new Set(folded.filter((name) => hideable.has(name)))
}

// Mail is about to land under the message being read, which was open only for being the newest.
// Opened in its own right first, it stays open rather than folding away under the reader.
export const holdNewestOpen = (thread: Mail[]) => {
  const newest = lastMessageOf(thread)
  if (newest) newest.collapsed = false
}
