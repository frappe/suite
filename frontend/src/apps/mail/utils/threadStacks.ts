import dayjs from '@/apps/mail/utils/dayjs'

import type { Thread } from '@/apps/mail/types'

// Chatty automated senders (uptime alerts, CI, ticket systems) post runs of threads that bury
// everything around them. A run of this many adjacent threads from one lone sender collapses into a
// single stack row. Two in a row is normal correspondence, not a flood — hence three.
const MIN_STACK_SIZE = 3

// The thread's lone sender — display name AND address — or null when more than one of either has
// written in it. Search results are single messages with no conversation behind them, so their
// sender is all there is to go on.
//
// The name is part of the identity, not decoration. A relay (a mailing list, Discourse, GitHub)
// gives every writer the same address and rewrites the display name per original sender, so keying
// on the address alone piled a whole list digest into one row headed by whichever member happened
// to be newest — ten distinct people and ten distinct subjects presented as ten from Scaleway.
// Burying distinct writers is worse than a longer list, so they stay apart. The cost is that
// relays now rarely stack at all, since a run has to be three ADJACENT threads and a busy list
// interleaves its senders; that is the intended trade.
//
// A blank name is not a name: bots that fill it on some messages and not others would otherwise
// look like two writers.
const loneSenderOf = (thread: Thread): string | null => {
	const messages = thread.messages ?? []

	const emails = new Set(messages.map((m) => (m.from_email ?? '').trim().toLowerCase()).filter(Boolean))
	if (emails.size > 1) return null

	const names = new Set(messages.map((m) => (m.from_name ?? '').trim().toLowerCase()).filter(Boolean))
	if (names.size > 1) return null

	const email = [...emails][0] || (thread.from_email ?? '').trim().toLowerCase()
	if (!email) return null

	const name = [...names][0] ?? (thread.from_name ?? '').trim().toLowerCase()
	return `${name}|${email}`
}

/**
 * The stack identity of a thread, or null when it must never stack.
 *
 * Only threads that ONE person has written in can stack, and they stack by that person — name and
 * address both, see loneSenderOf — never by the subject. Matching subjects too was tried and
 * measured against a real 300-thread inbox, and the two
 * classes turned out not to be separable: "Outbound IP Change — KSA Region" vs "… Johannesburg Region"
 * (one template, must stack) scored 0.71 similarity, while "Your CRM trial just expired" vs "Your
 * Learning trial just expired" (distinct notices, must not stack) scored 0.74 — higher. Any threshold
 * loose enough to catch the real floods admits everything from a sender anyway, which is this rule with
 * extra machinery. So: one sender, nobody else in the thread, one day, three in a row.
 *
 * The moment a second address writes — you replying included — the thread is correspondence rather than
 * a flood, and correspondence is never worth burying: it has an answer in it, and the row names a cast
 * a stack headed by one sender cannot stand for. Keying on the latest sender instead used to pile such
 * threads together under your own name, since the latest sender of anything you have answered is you.
 *
 * `account` is part of the key because the merged all-accounts search view can place two accounts' rows
 * adjacent: the same sender writing to two of my accounts is two piles, not one.
 *
 * The `received_at` day is part of the key so a stack never spans more than one calendar day, even when
 * the user groups by Month (or not at all) and the enclosing date bucket is far wider. Putting the day
 * here rather than pre-bucketing in the caller means run detection needs no date awareness: two
 * adjacent threads from different days simply get different keys and the run flushes at midnight.
 */
export const stackKeyOf = (thread: Thread): string | null => {
	const sender = loneSenderOf(thread)
	if (!sender) return null

	const day = dayjs(thread.received_at).format('YYYY-MM-DD')
	return `${thread.account ?? ''}|${day}|${sender}`
}

interface ThreadRow {
	type: 'thread'
	key: string
	thread: Thread
	// Set on the members of an expanded stack, which the list indents so the run still reads as one
	// unit. They are emitted as siblings of their stack row rather than nested inside it, so the list
	// template keeps a single MailListItem branch for every thread row, stacked or not.
	inStack?: boolean
}

export interface StackRow {
	type: 'stack'
	key: string
	threads: Thread[]
	expanded: boolean
}

// One rendered row. An expanded stack contributes its stack row followed by a ThreadRow per member.
export type ListRow = ThreadRow | StackRow

/**
 * Collapses maximal runs of >= MIN_STACK_SIZE adjacent threads sharing a stack key into one stack row,
 * preserving list order.
 *
 * Call this per date group: the caller's slice is the boundary a run can never cross (the day component
 * of the stack key caps it at a calendar day besides).
 */
export const buildListRows = (
	threads: Thread[],
	options: {
		rowKey: (thread: Thread) => string
		isExpanded: (run: Thread[]) => boolean
		enabled?: boolean
	},
): ListRow[] => {
	const { rowKey, isExpanded, enabled = true } = options
	const rows: ListRow[] = []

	const pushThreads = (run: Thread[], inStack = false) => {
		for (const thread of run) rows.push({ type: 'thread', key: rowKey(thread), thread, inStack })
	}

	const flush = (run: Thread[]) => {
		if (!run.length) return

		if (!enabled || run.length < MIN_STACK_SIZE) return pushThreads(run)

		// Keyed by the run's first row, which is stable while the run grows downwards (the common case:
		// infinite scroll appending older mail). Expansion state is tracked separately, by member id, so
		// a key change on a refresh-prepend costs nothing.
		const expanded = isExpanded(run)
		rows.push({ type: 'stack', key: `stack:${rowKey(run[0])}`, threads: run, expanded })
		if (expanded) pushThreads(run, true)
	}

	let run: Thread[] = []
	let runKey: string | null = null

	for (const thread of threads) {
		const key = stackKeyOf(thread)
		// A null key never matches, so senderless threads always flush on their own and never merge
		// with each other.
		if (key && key === runKey) {
			run.push(thread)
			continue
		}

		flush(run)
		run = [thread]
		runKey = key
	}
	flush(run)

	return rows
}
