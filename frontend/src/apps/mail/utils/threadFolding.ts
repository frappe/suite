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
