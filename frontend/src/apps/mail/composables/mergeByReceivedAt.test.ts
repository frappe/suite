import { describe, expect, it } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { mergeByReceivedAt, refreshLoadedThreads } from './usePaginatedThreads'

// Only received_at and thread_id matter to the merge.
const thread = (thread_id: string, received_at: string) =>
	({ thread_id, received_at }) as unknown as Thread

const ids = (threads: Thread[]) => threads.map((t) => t.thread_id)

const key = (t: Thread) => t.thread_id

describe('mergeByReceivedAt', () => {
	it('prepends genuinely new mail', () => {
		const fresh = [thread('new', '2026-07-30 10:00:00')]
		const loaded = [thread('a', '2026-07-29 10:00:00'), thread('b', '2026-07-28 10:00:00')]
		expect(ids(mergeByReceivedAt(fresh, loaded))).toEqual(['new', 'a', 'b'])
	})

	// The All Inboxes case: a second account's newest mail is older than the first account's oldest
	// loaded row, so it belongs at the bottom — a prepend would open a stale date group above today's.
	it('sorts an older fresh thread below the loaded rows', () => {
		const fresh = [thread('old', '2026-07-26 10:00:00')]
		const loaded = [thread('a', '2026-07-30 10:00:00'), thread('b', '2026-07-29 10:00:00')]
		expect(ids(mergeByReceivedAt(fresh, loaded))).toEqual(['a', 'b', 'old'])
	})

	it('interleaves by date', () => {
		const fresh = [thread('f1', '2026-07-30 10:00:00'), thread('f2', '2026-07-28 10:00:00')]
		const loaded = [thread('l1', '2026-07-29 10:00:00'), thread('l2', '2026-07-27 10:00:00')]
		expect(ids(mergeByReceivedAt(fresh, loaded))).toEqual(['f1', 'l1', 'f2', 'l2'])
	})

	it('keeps the fresh row first on a tie', () => {
		const fresh = [thread('f', '2026-07-30 10:00:00')]
		const loaded = [thread('l', '2026-07-30 10:00:00')]
		expect(ids(mergeByReceivedAt(fresh, loaded))).toEqual(['f', 'l'])
	})

	it('handles either side being empty', () => {
		const rows = [thread('a', '2026-07-30 10:00:00')]
		expect(ids(mergeByReceivedAt([], rows))).toEqual(['a'])
		expect(ids(mergeByReceivedAt(rows, []))).toEqual(['a'])
		expect(mergeByReceivedAt([], [])).toEqual([])
	})
})

describe('refreshLoadedThreads', () => {
	// The reason this exists: a reply lands in a thread that's already on screen. It never appears as
	// a new row, so the loaded copy has to be swapped for the server's.
	it('takes the server copy of a thread that changed', () => {
		const stale = thread('a', '2026-07-29 10:00:00')
		const updated = thread('a', '2026-07-30 12:00:00')
		const loaded = [stale, thread('b', '2026-07-28 10:00:00')]

		const result = refreshLoadedThreads(loaded, [updated], key)

		expect(result[0]).toBe(updated)
		expect(result[0]).not.toBe(stale)
	})

	it('moves a replied-to thread up to its new date', () => {
		const loaded = [
			thread('a', '2026-07-30 10:00:00'),
			thread('b', '2026-07-29 10:00:00'),
			thread('c', '2026-07-28 10:00:00'),
		]
		// c just got a reply, so it is now the newest.
		const freshWindow = [thread('c', '2026-07-30 18:00:00')]

		expect(ids(refreshLoadedThreads(loaded, freshWindow, key))).toEqual(['c', 'a', 'b'])
	})

	it('leaves rows past the window alone', () => {
		const older = thread('old', '2026-06-01 10:00:00')
		const loaded = [thread('a', '2026-07-30 10:00:00'), older]

		const result = refreshLoadedThreads(loaded, [thread('a', '2026-07-30 10:00:00')], key)

		expect(result[1]).toBe(older)
	})

	it('holds order when nothing changed', () => {
		const loaded = [
			thread('a', '2026-07-30 10:00:00'),
			thread('b', '2026-07-30 10:00:00'),
			thread('c', '2026-07-29 10:00:00'),
		]

		expect(ids(refreshLoadedThreads(loaded, loaded, key))).toEqual(['a', 'b', 'c'])
	})

	// The merged All Inboxes list keys by account + thread id, since one thread id can recur across
	// accounts — a refresh must not let one account's copy overwrite the other's.
	it('respects a composite thread key', () => {
		const composite = (t: Thread) => `${(t as unknown as { account: string }).account}|${t.thread_id}`
		const rowA = { ...thread('t1', '2026-07-29 10:00:00'), account: 'a1' } as unknown as Thread
		const rowB = { ...thread('t1', '2026-07-28 10:00:00'), account: 'a2' } as unknown as Thread
		const updatedA = { ...thread('t1', '2026-07-30 10:00:00'), account: 'a1' } as unknown as Thread

		const result = refreshLoadedThreads([rowA, rowB], [updatedA], composite)

		expect(result[0]).toBe(updatedA)
		expect(result[1]).toBe(rowB)
	})
})
