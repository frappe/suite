import type { Mail, Thread } from '@/apps/mail/types'
import { mailCopies, mailCopyIds } from '@/apps/mail/utils/mailCopies'

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

// A long thread comes in part: its first mail, its newest, and whatever it was opened on (see
// thread_window in mail_message.py). Each mail says how many ahead of it are still on the server,
// and this is how many that is over a run of mail: what a row's count and a fold's add to the mail
// they hold. The last mail shown may say how many after it are too, where the newest are mail the
// view leaves out.
export const unloadedIn = (mails: readonly Mail[]): number =>
  mails.reduce(
    (count, mail) => count + (mail.earlier_unloaded ?? 0) + (mail.later_unloaded ?? 0),
    0,
  )

// The threads that came in part, by id. An action on a whole thread names them, and the server
// reaches the mail the client never held (see suite/mail/long_threads.py); Undo restores the mail
// the client does hold, and the server puts the rest back with it.
export const threadsInPart = (threads: readonly Thread[]): string[] =>
  threads.flatMap((thread) => (unloadedIn(thread.messages ?? []) > 0 ? [thread.thread_id] : []))

// A page of that mail, asked for ahead of `before`, takes its place in the thread. `fetched` is the
// page as it came and `shown` what the pane makes of it: a view leaves out junked and trashed mail.
// What is still on the server is said by the oldest mail now shown, or by `before` again when the
// page shows nothing. The next page is then asked for from the oldest mail fetched (`earlier_from`),
// not from the mail that says it, or the same page would come back.
export const withEarlier = (
  thread: Mail[],
  before: Mail,
  fetched: Mail[],
  shown: Mail[],
): Mail[] => {
  const held = new Set(thread.flatMap(mailCopyIds))
  const added = shown.filter((mail) => !mailCopyIds(mail).some((id) => held.has(id)))
  const left = unloadedIn(fetched)
  const [oldest] = fetched
    .flatMap(mailCopies)
    .sort((a, b) => a.received_at.localeCompare(b.received_at))

  before.earlier_unloaded = 0
  before.earlier_from = undefined
  added.forEach((mail) => (mail.earlier_unloaded = 0))
  const carrier = added[0] ?? before
  carrier.earlier_unloaded = left
  if (left && oldest && oldest.id !== carrier.id) carrier.earlier_from = oldest.id

  const at = thread.indexOf(before)
  return [...thread.slice(0, at), ...added, ...thread.slice(at)]
}

// Mail the pane does not hold yet, in fresh rows of its thread (`source`, oldest first). Of a thread
// read whole, all of it has arrived since. Fresh rows of a long thread are a part of it, and not
// always the part the pane holds: the thread fetched on its own comes with more of its newest mail
// than a list's row does. So only what follows the newest mail held is an arrival, and older mail
// waits behind "more messages", where it belongs. Arrivals can outrun a part as well: the first
// then says how many came between it and the mail held. Otherwise an arrival says nothing about
// what is ahead of it: the pane may hold more of the thread by now than the rows do (see withEarlier).
// Nor more than the rows say is ahead of it: the pane holds mail it does not show (trashed mail, in
// a page it loaded), which its count of cards leaves out.
export const arrivalsIn = (source: Mail[], thread: Mail[]): Mail[] => {
  const held = new Set(thread.flatMap(mailCopyIds))
  const size = (mails: Mail[]) => mails.filter((mail) => !mail.draft).length + unloadedIn(mails)
  const inPart = unloadedIn(source) > 0
  const newestHeld = inPart
    ? source.findLastIndex((mail) => !mail.draft && mailCopyIds(mail).some((id) => held.has(id)))
    : -1
  const isArrival = (mail: Mail, at: number) => at > newestHeld && !held.has(mail.id) && !mail.draft
  const arrivals = source.filter(isArrival)
  const ahead = unloadedIn(source.slice(newestHeld + 1, source.findIndex(isArrival) + 1))
  const between = inPart ? Math.min(size(source) - size(thread) - arrivals.length, ahead) : 0
  arrivals.forEach((mail) => (mail.earlier_unloaded = 0))
  if (arrivals.length && between > 0) arrivals[0].earlier_unloaded = between
  return arrivals
}
