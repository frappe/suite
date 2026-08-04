import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

import type { Thread } from '@/apps/mail/types'

/**
 * Infinite scroll over a thread list, shared by the per-account mailbox list and the merged All
 * Inboxes one.
 *
 * The accumulated list lives in the reset resource's `data` and is the single source of truth every
 * consumer reads. Two fetch paths write it: the reset resource replaces it (always `start: 0`), the
 * append resource pushes the next window onto it. They stay separate resources so createResource's
 * replace-on-reload can never fight the append — which is why this owns the bookkeeping BETWEEN them
 * (the epochs, the refresh merge, the removal suppression) rather than the resources themselves,
 * whose urls, params and payload shapes differ per view.
 *
 * Both views had a line-for-line copy of all of it, comments included, and the copies had already
 * drifted: the merged list was missing the removal suppression (a thread archived mid-refresh
 * reappeared) and the edge crossing (prev/next in the reading pane stopped dead at the last loaded
 * thread instead of paging).
 *
 * The caller must render `ref="mailList"` on the scroll container and `ref="loadMoreSentinel"` on a
 * zero-height element after the last row, and must call `topUpIfShort` from a watcher on its rendered
 * rows (see that function — the watcher has to sit below the rows it reads).
 */

/** Rows per window. Fetches ask for one more, to detect whether further rows exist without a total. */
export const PAGE_LENGTH = 25

// Windows one fill episode may pull before it gives up (see topUpIfShort). Far more than any viewport
// needs — the cap only catches the case where the fill can never succeed: every window absorbed into
// the trailing stack row, which adds no height, so the sentinel stays in view and the list would walk
// the whole mailbox 25 threads at a time.
const MAX_FILL_WINDOWS = 20

// How long a row optimistically removed by an action stays suppressed. The server keeps returning it
// until the mutation lands, so a refresh or append in that window would put it back.
const REMOVAL_SUPPRESSION_MS = 15000

/**
 * Merges two newest-first runs of threads into one, keeping newest-first order. Both inputs are
 * already sorted (the server returns them that way), so this is a plain two-pointer merge; ties keep
 * the fresh row first, matching the prepend this replaced.
 */
export const mergeByReceivedAt = (fresh: Thread[], loaded: Thread[]): Thread[] => {
	const merged: Thread[] = []
	let f = 0
	let l = 0
	while (f < fresh.length && l < loaded.length)
		merged.push(fresh[f].received_at >= loaded[l].received_at ? fresh[f++] : loaded[l++])
	return [...merged, ...fresh.slice(f), ...loaded.slice(l)]
}

/** The shape of a reset resource this reads and writes — createResource satisfies it. */
export interface ThreadListResource {
	data?: Thread[]
	loading: boolean
}

export interface PaginatedThreadsOptions {
	/** The active reset resource. A getter, since the search view swaps which one is active. */
	resource: () => ThreadListResource
	/** Triggers the append fetch. Its onSuccess must hand the rows to `appendThreads`. */
	fetchMore: () => void
	/** The open thread, if any — the anchor when the reading pane steps past the last loaded row. */
	openThreadID: () => string | undefined
	/**
	 * Where to send a thread that only arrived because the cursor stepped off the loaded edge:
	 * 'open' for the reading pane, 'focus' for the list cursor.
	 */
	onEdgeThread: (threadID: string, action: 'open' | 'focus') => void
	/**
	 * A row's identity, for the dedupe and the removal suppression. Defaults to the thread id; the
	 * merged view keys by account + thread id, since one thread id can recur across accounts.
	 */
	threadKey?: (thread: Thread) => string
	/**
	 * How far the viewport fill has gotten, in units the reader can see — the views pass the count of
	 * threads their rendered rows stand for (see useListRows' visibleThreadCount). Pixel height (the
	 * fallback) cannot tell progress from a dead end: a window absorbed into existing stack rows adds
	 * no height but is progress, while one landing in a collapsed date group adds none and is not.
	 */
	fillProgress?: () => number
}

export const usePaginatedThreads = ({
	resource,
	fetchMore,
	openThreadID,
	onEdgeThread,
	threadKey = (thread: Thread) => thread.thread_id,
	fillProgress,
}: PaginatedThreadsOptions) => {
	const container = useTemplateRef<HTMLElement>('mailList')
	const sentinel = useTemplateRef<HTMLElement>('loadMoreSentinel')

	const hasMore = ref(false) // lookahead: the last fetched window returned an extra row, so more exist
	const loadingMore = ref(false) // an append fetch is in flight (drives the bottom spinner)
	// Bumped on every reset/refresh; an in-flight append captures it and discards its result if it
	// changed meanwhile, so a stale window can't land on a freshly reset list.
	const epoch = ref(0)
	let loadEpoch = 0 // epoch captured when the current append was triggered
	// Refresh ("check for new mail") state: merges the newest window into the loaded list, preserving
	// scroll — set while such a reload is in flight so its onSuccess prepends instead of replacing.
	const refreshMode = ref(false)
	let refreshEpoch = 0 // epoch captured when the refresh was triggered (dropped if a reset intervenes)
	// The loaded list to merge the fresh window into. Captured at *response* time (in the resource
	// transform, via takeResetWindow), not refresh-start, so it reflects any optimistic removals or
	// undo-inserts made while the refresh was in flight.
	let refreshSnapshot: Thread[] = []
	// Rows optimistically removed by an action whose request is still in flight (see
	// REMOVAL_SUPPRESSION_MS). The merges below skip them.
	const recentlyRemoved = new Set<string>()

	const list = () => resource().data ?? []

	/** The loaded threads' ids, in list order — what the reading pane pages through. */
	const threadIDs = computed(() => list().map((thread: Thread) => thread.thread_id))

	/** Whether any fetch is in flight. Gates the Refresh affordance and a new refresh. */
	const isFetching = computed(() => resource().loading || loadingMore.value)

	// The reading pane's Next arrow can always advance while more threads remain to load (crossing the
	// last loaded thread triggers an append). The Prev arrow is disabled at the first loaded thread,
	// which is the first thread overall — we always start from the top.
	const canGoNext = computed(() => hasMore.value)

	const scrollListToTop = () => container.value?.scrollTo({ top: 0 })

	/**
	 * The thread `offset` steps from `from` (the open one by default), within what is loaded.
	 * Undefined at either end, which is how a caller knows to load the next window instead — and for
	 * a `from` that is no longer loaded, which reads as "the cursor is lost, do nothing" going up and
	 * as the first thread going down.
	 */
	const threadByOffset = (offset: number, from: string | undefined = openThreadID()) =>
		threadIDs.value[threadIDs.value.indexOf(from as string) + offset]

	/**
	 * For a reset resource's `transform`: snapshots the merge base (before this window replaces the
	 * loaded list), reads the lookahead row, and trims it off.
	 */
	const takeResetWindow = (rows: Thread[]): Thread[] => {
		if (refreshMode.value) refreshSnapshot = list()
		hasMore.value = rows.length > PAGE_LENGTH
		return rows.slice(0, PAGE_LENGTH)
	}

	/**
	 * Reset-to-top: the caller is about to refetch the first window, replacing the loaded list.
	 * Bumping the epoch discards any append or refresh still in flight.
	 */
	const beginReset = () => {
		refreshMode.value = false
		epoch.value++
	}

	/**
	 * Check for new mail without losing the reader's place: the caller is about to refetch the newest
	 * window, which onResetSuccess will merge into the loaded list instead of replacing it.
	 *
	 * Returns false when a fetch is already in flight, which is the caller's cue to do nothing.
	 * Bumping the epoch discards an append still in flight (appendThreads checks it) instead of
	 * letting it land after the merge and clobber it. A new append can't start mid-refresh (loadMore
	 * bails while the resource is loading), so this fully closes the refresh/append race.
	 */
	const beginRefresh = () => {
		if (isFetching.value) return false
		refreshMode.value = true
		epoch.value++
		refreshEpoch = epoch.value
		return true
	}

	/**
	 * Called when a first-window fetch resolves. Two modes:
	 * - refresh: keep the loaded rows, prepend only threads not already loaded (new mail), and hold
	 *   the reader's scroll position (re-anchored by the height the prepended rows added).
	 * - reset: reveal the fresh first window and scroll to top (mailbox switch, filter, undo, …).
	 * Either way, cancel any pending edge navigation.
	 */
	const onResetSuccess = () => {
		pendingEdgeThread = null

		if (refreshMode.value) {
			refreshMode.value = false
			// A reset (mailbox switch, filter, undo) raced in and bumped the epoch — drop this stale merge.
			if (refreshEpoch !== epoch.value) return
			// Anchor to the current scroll before merging. The window replaced `data` a beat ago but the
			// DOM hasn't re-rendered yet, so these still reflect the list the reader is looking at.
			const el = container.value
			const prevTop = el?.scrollTop ?? 0
			// Anchor on the row that was at the top of the loaded list. Measuring how far *it* moves
			// counts only what the merge inserted above the reader; a total-height delta would also
			// count rows merged in below them and scroll the list out from under them.
			const anchorKey = refreshSnapshot[0]?.thread_id
			const anchorTop = () =>
				anchorKey
					? ((el?.querySelector(`[data-row-key="${anchorKey}"]`) as HTMLElement | null)
							?.offsetTop ?? 0)
					: 0
			const prevAnchorTop = anchorTop()
			const freshWindow = list()
			const existing = new Set(refreshSnapshot.map(threadKey))
			const fresh = freshWindow.filter(
				(thread: Thread) =>
					!existing.has(threadKey(thread)) && !recentlyRemoved.has(threadKey(thread)),
			)
			// Date-merge rather than blind prepend. A prepend assumes everything in the newest window
			// that isn't loaded yet is newer than everything that is — true for one account, false for
			// the merged list, where a second account's newest mail can be older than the first's oldest
			// loaded row and would otherwise open a stale date group above today's.
			resource().data = mergeByReceivedAt(fresh, refreshSnapshot)
			// Keep the reader where they were: shift scroll by the height the merge added above them. If
			// they were already at the top, leave them there so the new mail is visible.
			nextTick(() => {
				if (el && prevTop > 0) el.scrollTop = prevTop + (anchorTop() - prevAnchorTop)
			})
			return
		}

		scrollListToTop()
	}

	/**
	 * Appends the next window onto the loaded list, deduped by row key. `start = data.length` stays
	 * correct across optimistic removals (the server list shifts left by the same rows we dropped); the
	 * only skew is new mail inserted at the front, which the dedupe absorbs and the next reset reconciles.
	 */
	const appendThreads = (rows: Thread[]) => {
		loadingMore.value = false
		// Discard a stale window that resolved after a reset began (mailbox switch, refresh, undo, …).
		if (loadEpoch !== epoch.value) return
		const seen = new Set(list().map(threadKey))
		const fresh = rows
			.slice(0, PAGE_LENGTH)
			.filter(
				(thread) => !seen.has(threadKey(thread)) && !recentlyRemoved.has(threadKey(thread)),
			)
		// Stop auto-loading if the window added nothing new (offset stuck behind heavy front-inserted
		// mail, or the server's fetch depth cap reached); the next reset reconciles. Guards against a
		// tight reload loop while the sentinel stays in view.
		hasMore.value = rows.length > PAGE_LENGTH && fresh.length > 0
		resource().data = [...list(), ...fresh]
		openPendingEdgeThread()
	}

	const loadMore = () => {
		if (!hasMore.value || isFetching.value) return
		loadingMore.value = true
		loadEpoch = epoch.value
		fetchMore()
	}

	// True while the sentinel is in view.
	const sentinelVisible = ref(false)

	// How far the fill had gotten (see fillProgress) the last time we topped it up, so a fill that
	// adds nothing visible can be detected, and how many windows this episode has pulled. Both reset
	// at the start of each fill episode.
	let lastFillProgress = 0
	let fillWindows = 0

	useIntersectionObserver(
		sentinel,
		([entry]) => {
			const entering = !!entry?.isIntersecting && !sentinelVisible.value
			sentinelVisible.value = !!entry?.isIntersecting
			if (entering) {
				lastFillProgress = 0
				fillWindows = 0
			}
			if (sentinelVisible.value) loadMore()
		},
		{ root: container },
	)

	/**
	 * Rescues the case the observer cannot: the sentinel is already in view and stays there, so it
	 * never leaves and re-enters to fire again — infinite scroll would die with the viewport unfilled.
	 * A window of 25 threads can collapse to a single stack row (or vanish into an existing one), so
	 * filling the viewport can take several of them.
	 *
	 * What normally ends an episode is the sentinel leaving the viewport — the fill worked. Two guards
	 * cover the fills that can't:
	 *
	 * Progress, the caller's fillProgress metric and NOT pixel height: a window absorbed into existing
	 * stack rows adds no height yet is real progress, and height-based stopping stranded exactly the
	 * incident-heavy inboxes that stack hardest, with the sentinel in view but nothing left to re-fire
	 * it. A window that advances nothing landed somewhere unrenderable (a collapsed date group), so
	 * further windows would be too. Appends normally extend the last date group, which can't be
	 * collapsed, so this mostly guards rows arriving out of order.
	 *
	 * And the episode's window budget, for the fill that makes progress forever without ever filling:
	 * every window absorbed into the trailing stack row is invisible height-wise, so absent a cap an
	 * alerting inbox would walk itself end to end. The reader can still scroll and re-arm the observer.
	 *
	 * Call it from a watcher on the RENDERED rows, not on the loaded threads: rows come and go as
	 * stacks and date groups fold, and each change can move the sentinel. That watcher must be
	 * declared below the rows it watches — `watch` evaluates its source at setup, and reading a
	 * `<script setup>` computed from above its declaration is a temporal-dead-zone crash.
	 */
	// Whether the sentinel is inside the container's viewport RIGHT NOW, measured — not the observer
	// flag, which is stale at nextTick (observer callbacks land after render): a fill that pushed the
	// sentinel below the fold would read as still-visible and chain an unwanted extra window onto
	// every ordinary scroll-to-bottom load.
	const sentinelInView = () => {
		const el = container.value
		const s = sentinel.value
		if (!el || !s) return false
		const c = el.getBoundingClientRect()
		const r = s.getBoundingClientRect()
		return r.top < c.bottom && r.bottom > c.top
	}

	const topUpIfShort = () => {
		if (!sentinelVisible.value || !hasMore.value || fillWindows >= MAX_FILL_WINDOWS) return

		nextTick(() => {
			if (!sentinelInView()) return

			const progress = fillProgress ? fillProgress() : (container.value?.scrollHeight ?? 0)
			const grew = progress > lastFillProgress
			lastFillProgress = progress
			if (!grew) return
			fillWindows++
			loadMore()
		})
	}

	// Stepping past the last loaded thread loads the next window, then opens/focuses the newly appended
	// thread once it arrives (openPendingEdgeThread, called from appendThreads). `anchor` is the thread
	// we stepped off (the previously-last loaded), captured so we can resolve its successor after the
	// append. There's no backward case — the first loaded thread is the first thread overall.
	let pendingEdgeThread: { action: 'open' | 'focus'; anchor: string | undefined } | null = null

	const loadMoreThenOpenEdge = (offset: number, action: 'open' | 'focus') => {
		// One crossing at a time: ignore further edge steps until the append resolves, so key
		// auto-repeat at the bottom of the list can't fire a burst of loads.
		if (pendingEdgeThread || offset < 0 || !hasMore.value) return
		// A focus crossing can only happen from the last navigable row, whose last thread is the last
		// loaded one — so the tail anchors the successor without needing to map a row back to a thread.
		pendingEdgeThread = {
			action,
			anchor: action === 'open' ? openThreadID() : threadIDs.value.at(-1),
		}
		loadMore()
	}

	function openPendingEdgeThread() {
		if (!pendingEdgeThread) return
		const { action, anchor } = pendingEdgeThread
		// The successor of the anchor is now loaded (undefined only if nothing new arrived — then stop).
		const id = threadByOffset(1, anchor)
		pendingEdgeThread = null
		if (!id) return
		onEdgeThread(id, action)
	}

	/**
	 * Suppress re-insertion of optimistically removed rows by an in-flight refresh/append, until the
	 * server-side removal lands. Keys are in `threadKey` space.
	 */
	const suppressRemoved = (keys: string[]) =>
		keys.forEach((key) => {
			recentlyRemoved.add(key)
			setTimeout(() => recentlyRemoved.delete(key), REMOVAL_SUPPRESSION_MS)
		})

	/** Lift the suppression: the rows are back (a removal failed, or was undone), so they must show. */
	const unsuppressRemoved = (keys: string[]) => keys.forEach((key) => recentlyRemoved.delete(key))

	return {
		container,
		hasMore,
		loadingMore,
		isFetching,
		canGoNext,
		threadIDs,
		threadByOffset,
		scrollListToTop,
		takeResetWindow,
		beginReset,
		beginRefresh,
		onResetSuccess,
		appendThreads,
		loadMore,
		loadMoreThenOpenEdge,
		topUpIfShort,
		suppressRemoved,
		unsuppressRemoved,
	}
}
