import { describe, expect, it } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { PAGE_LENGTH, mergeByReceivedAt, refreshLoadedThreads, refreshWindowSize } from './usePaginatedThreads'

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

	// Deleted (or moved out) on another device: the window covers the row's date and doesn't hold it.
	it('drops a row the window should have held', () => {
		const loaded = [
			thread('a', '2026-07-30 10:00:00'),
			thread('b', '2026-07-29 10:00:00'),
			thread('c', '2026-07-28 10:00:00'),
		]
		const freshWindow = [thread('a', '2026-07-30 10:00:00'), thread('c', '2026-07-28 10:00:00')]

		expect(ids(refreshLoadedThreads(loaded, freshWindow, key))).toEqual(['a', 'c'])
	})

	// Same timestamp as the window's last row: the page boundary may have cut it off, so it can't be
	// called gone.
	it('keeps a missing row tied with the end of the window', () => {
		const loaded = [thread('a', '2026-07-30 10:00:00'), thread('b', '2026-07-30 10:00:00')]

		expect(ids(refreshLoadedThreads(loaded, [loaded[0]], key))).toEqual(['a', 'b'])
	})

	it('drops every missing row when the window is the whole list', () => {
		const loaded = [thread('a', '2026-07-30 10:00:00'), thread('old', '2026-06-01 10:00:00')]

		expect(ids(refreshLoadedThreads(loaded, [loaded[0]], key, true))).toEqual(['a'])
		expect(refreshLoadedThreads(loaded, [], key, true)).toEqual([])
	})

	// An empty window that isn't known to be complete says nothing about the loaded rows.
	it('keeps everything on an empty window', () => {
		const loaded = [thread('a', '2026-07-30 10:00:00')]

		expect(ids(refreshLoadedThreads(loaded, [], key))).toEqual(['a'])
	})

	// An undo puts the row back before the server has it, so the window legitimately lacks it.
	it('spares a missing row the caller vouches for', () => {
		const loaded = [thread('a', '2026-07-30 10:00:00'), thread('b', '2026-07-29 10:00:00')]

		const result = refreshLoadedThreads(loaded, [loaded[1]], key, true, (k) => k === 'a')

		expect(ids(result)).toEqual(['a', 'b'])
	})
})

describe('refreshWindowSize', () => {
	it('covers the loaded list, so a refresh reaches rows below the first page', () => {
		expect(refreshWindowSize(PAGE_LENGTH * 2 + 7)).toBe(PAGE_LENGTH * 2 + 7)
	})

	it('never asks for less than a page', () => {
		expect(refreshWindowSize(0)).toBe(PAGE_LENGTH)
		expect(refreshWindowSize(PAGE_LENGTH - 1)).toBe(PAGE_LENGTH)
	})

	// The 30s poll uses this window too, so a reader who has scrolled a long way must not turn every
	// poll into a walk of the whole mailbox.
	it('stops growing at a bounded depth', () => {
		const deep = refreshWindowSize(100_000)
		expect(deep).toBeLessThan(100_000)
		expect(refreshWindowSize(100_000)).toBe(refreshWindowSize(200_000))
	})
})

// The pairing the fix rests on: sizing the window to the loaded list is what lets the merge see a
// deletion the reader had already scrolled past. Sized to one page, that row is beyond the window's
// reach and survives — which is the bug.
describe('a deletion below the first page', () => {
	// 60 rows, newest first, one minute apart.
	const loaded = Array.from({ length: 60 }, (_, i) =>
		thread(`t${i}`, `2026-07-30 12:${String(59 - i).padStart(2, '0')}:00`),
	)
	const deleted = 't40'
	const server = loaded.filter((t) => t.thread_id !== deleted)

	it('leaves the list when the window spans the loaded rows', () => {
		const window = server.slice(0, refreshWindowSize(loaded.length))

		expect(ids(refreshLoadedThreads(loaded, window, key))).not.toContain(deleted)
	})

	it('survives a window of only the first page', () => {
		const window = server.slice(0, PAGE_LENGTH)

		expect(ids(refreshLoadedThreads(loaded, window, key))).toContain(deleted)
	})

	it('keeps every row that is still there', () => {
		const window = server.slice(0, refreshWindowSize(loaded.length))

		expect(ids(refreshLoadedThreads(loaded, window, key))).toEqual(ids(server))
	})
})
