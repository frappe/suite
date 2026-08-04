import { computed, nextTick, ref, watch, type Ref } from 'vue'

import dayjs from '@/apps/mail/utils/dayjs'
import { buildListRows, type ListRow, type StackRow } from '@/apps/mail/utils/threadStacks'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'

import type { Thread } from '@/apps/mail/types'

/**
 * A date header — the one navigable row a list draws itself rather than getting from buildListRows,
 * which is deliberately date-agnostic.
 */
export type GroupRow = { type: 'group'; key: string; dateKey: string }

/** Anything the keyboard cursor can land on: a thread row, a stack row, or a date header. */
export type NavRow = ListRow | GroupRow

export interface ListRowsOptions {
	/** The loaded threads, newest first. */
	threads: () => Thread[]
	/** A thread row's key. The all-accounts views prefix it with the account. */
	rowKey: (thread: Thread) => string
	/** Whether runs of look-alike threads collapse into stack rows. On everywhere by default. */
	stackingEnabled?: () => boolean
	/** The open thread, if any — folding a row that hides it has to move the reading pane. */
	openThreadID: () => string | undefined
	/** Called when a fold is about to hide the open thread: leave the pane. */
	onOpenThreadHidden: () => void
	/** The scroll container, so the cursor can bring its row into view. */
	container: Ref<HTMLElement | null>
}

/**
 * The rows a thread list renders, and the keyboard cursor that walks them.
 *
 * Between the loaded threads and the rendered list sit three display layers, each of which can hide a
 * thread: date groups (collapsible), stacks (a run of look-alike threads from one sender, collapsed
 * into one row), and the mobile/desktop difference in whether headers exist at all. The cursor must
 * only ever land on something actually on screen, and a fold must never leave the reading pane
 * pointing at a row that is no longer rendered — which is why the rows, the folds and the cursor are
 * one thing rather than three.
 *
 * All of it existed twice, near-verbatim, in the mailbox list and the merged All Inboxes list. The one
 * piece that did NOT — rowForThread, which maps a thread to whatever row stands for it on screen — was
 * re-solved in the merged view with an inline scan that could only find a thread's own row, so a step
 * into a collapsed stack or a folded day lost the marker.
 */
export const useListRows = ({
	threads,
	rowKey,
	stackingEnabled = () => true,
	openThreadID,
	onOpenThreadHidden,
	container,
}: ListRowsOptions) => {
	const { isMobile } = useScreenSize()
	const { userResource } = userStore()

	const groupMessagesBy = computed(() => userResource.data?.group_messages_by)

	// Date headers are a desktop affordance: on mobile both lists render one continuous run, so there
	// is no header to click, nothing can be collapsed, and the cursor has no headers to walk. The
	// collapse state is gated on the same thing, because only a header's own click can fill it.
	const headersVisible = computed(() => groupMessagesBy.value !== 'None' && !isMobile.value)

	// ── Date groups ─────────────────────────────────────────────────────────────────────────────────

	const groupedThreads = computed<Record<string, Thread[]>>(() =>
		threads().reduce((groups: Record<string, Thread[]>, thread: Thread) => {
			const date = dayjs(thread.received_at).format(
				groupMessagesBy.value === 'Day' ? 'YYYY-MM-DD' : 'YYYY-MM',
			)
			if (!groups[date]) groups[date] = []
			groups[date].push(thread)
			return groups
		}, {}),
	)

	const getGroupThreads = (group: string) => groupedThreads.value[group]?.map((t) => t.thread_id)

	// The last group never collapses — it's where infinite scroll appends, so hiding it would swallow
	// newly loaded rows.
	const isLastGroup = (key: string) => Object.keys(groupedThreads.value).at(-1) === key

	const collapsedGroups = ref<string[]>([])

	watch(groupMessagesBy, () => (collapsedGroups.value = []))

	// ── Stacks ──────────────────────────────────────────────────────────────────────────────────────
	//
	// A run of adjacent look-alike threads from one sender collapses into a single row, so a chatty
	// notification sender can't bury the rest of the list. This is a display layer over groupedThreads:
	// runs are detected within a date group and never span one.

	// The thread_ids of every member of every expanded stack. In-memory only — stacks re-collapse on a
	// mailbox switch. Keyed by member id rather than by stack key so a run keeps its expanded state as
	// it grows in either direction (appended by infinite scroll, prepended by a refresh), and so
	// routing to a thread can expand its stack without having to locate the run first.
	const expandedStacks = ref(new Set<string>())

	const isRunExpanded = (run: Thread[]) => run.some((t) => expandedStacks.value.has(t.thread_id))

	const groupedRows = computed<Record<string, ListRow[]>>(() =>
		Object.fromEntries(
			Object.entries(groupedThreads.value).map(([key, group]) => [
				key,
				buildListRows(group, {
					rowKey,
					isExpanded: isRunExpanded,
					enabled: stackingEnabled(),
				}),
			]),
		),
	)

	/**
	 * How many loaded threads the rendered rows stand for. A collapsed stack row still stands for its
	 * members (that's its count badge), so they count; threads inside a collapsed date group have no
	 * row at all and don't. This is infinite scroll's fill-progress metric (see usePaginatedThreads):
	 * a fetched window that doesn't advance it landed entirely inside collapsed groups.
	 */
	const visibleThreadCount = computed(() => {
		let count = 0
		for (const [dateKey, rows] of Object.entries(groupedRows.value)) {
			if (headersVisible.value && collapsedGroups.value.includes(dateKey)) continue
			for (const row of rows) {
				// An expanded stack emits its members again as inStack thread rows — skip the dupes.
				if (row.type === 'stack') count += row.threads.length
				else if (!row.inStack) count++
			}
		}
		return count
	})

	// ── The cursor ──────────────────────────────────────────────────────────────────────────────────

	/**
	 * The rows the list actually renders, in visual order. The cursor walks these rather than the flat
	 * list of loaded threads, so it can never land on a row that isn't on screen: a collapsed stack is
	 * a single stop (its members aren't rendered), and a collapsed date group contributes only its
	 * header.
	 */
	const navigableRows = computed<NavRow[]>(() => {
		const rows: NavRow[] = []
		for (const [dateKey, groupRows] of Object.entries(groupedRows.value)) {
			if (headersVisible.value) rows.push({ type: 'group', key: `group:${dateKey}`, dateKey })
			if (headersVisible.value && collapsedGroups.value.includes(dateKey)) continue
			rows.push(...groupRows)
		}
		return rows
	})

	/**
	 * The keyboard cursor, as a row key. A row key rather than a thread id because the cursor can sit
	 * on a stack row or a date header, neither of which is a thread — and one ref rather than two so
	 * the cursor can never be in two places at once.
	 */
	const focusedRowKey = ref<string>()

	const focusedRow = computed(() =>
		navigableRows.value.find((row) => row.key === focusedRowKey.value),
	)

	/**
	 * Scrolls the row marked `data-row-key` into the centre of the list. Skipped on mobile, where the
	 * thread pane slides over the list and the jump would only show behind it. Waits a tick because
	 * the row may have only just been revealed (a stack or day group expanding, a route change
	 * landing); a no-op when nothing changed.
	 */
	const scrollRowIntoView = (key: string) => {
		if (isMobile.value) return
		nextTick(() => {
			container.value
				?.querySelector(`[data-row-key="${key}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' })
		})
	}

	const focusRowKey = (key: string) => {
		focusedRowKey.value = key
		scrollRowIntoView(key)
	}

	const focusRow = (row?: NavRow) => {
		if (row) focusRowKey(row.key)
	}

	/**
	 * The row that stands for a thread on screen: its own row when rendered, the collapsed stack that
	 * hides it, or — when its whole day is folded away — that day's header. Callers name a thread ("go
	 * to the first mail", "open the thread that just loaded"); this is how that lands somewhere visible.
	 */
	const rowForThread = (threadID?: string): NavRow | undefined => {
		if (!threadID) return

		const row = navigableRows.value.find(
			(row) =>
				(row.type === 'thread' && row.thread.thread_id === threadID) ||
				// Only a collapsed stack stands in for its members. An expanded one precedes its member
				// rows, so without this guard every member would resolve to the stack row above it.
				(row.type === 'stack' &&
					!row.expanded &&
					row.threads.some((t) => t.thread_id === threadID)),
		)
		if (row) return row

		const dateKey = collapsedGroups.value.find((key) => getGroupThreads(key)?.includes(threadID))
		return navigableRows.value.find((row) => row.key === `group:${dateKey}`)
	}

	const focusOnThread = (threadID?: string) => focusRow(rowForThread(threadID))

	/**
	 * What a rendered row looks like in its list, as opposed to in itself: the cursor's left marker,
	 * the tint on the row whose thread is open beside it, and the indent on a member of an expanded
	 * stack. Four copies of these three rules — one per row type per list — is three too many.
	 *
	 * The open-row tint is desktop-only: on mobile the pane covers the list, so it would only ever be
	 * seen once the reader had already left the thread it points at.
	 */
	const rowClasses = (row: ListRow) => ({
		'border-l-transparent sm:border-l': true,
		'!border-l-outline-blue-5': row.key === focusedRowKey.value,
		'!bg-surface-blue-1':
			row.type === 'thread' && row.thread.thread_id === openThreadID() && !isMobile.value,
		'!pl-10 sm:!pl-12': row.type === 'thread' && !!row.inStack,
	})

	// ── Folding ─────────────────────────────────────────────────────────────────────────────────────

	const toggleStack = (row: StackRow) => {
		const ids = row.threads.map((t) => t.thread_id)
		// The cursor follows the click, as it does when you open a mail. This also covers the fold: the
		// members are about to be hidden, so the stack row that now stands for them is where the cursor
		// belongs, and Enter-fold-Enter-unfold stays a round trip rather than a way to lose your place.
		focusedRowKey.value = row.key
		if (!row.expanded) return ids.forEach((id) => expandedStacks.value.add(id))

		ids.forEach((id) => expandedStacks.value.delete(id))
		// Don't leave the reading pane pointing at a row we just hid — the same reason
		// toggleGroupCollapse leaves the thread when its group collapses.
		const open = openThreadID()
		if (open && ids.includes(open)) onOpenThreadHidden()
	}

	const toggleGroupCollapse = (key: string) => {
		// The cursor follows the click, as it does when you open a mail: Enter and a click are the same
		// gesture on the same row, and Enter can only mean that if the cursor is already there. Above the
		// last-group guard, so clicking a header that can't fold still takes the cursor.
		focusedRowKey.value = `group:${key}`
		if (isLastGroup(key)) return

		if (collapsedGroups.value.includes(key))
			return (collapsedGroups.value = collapsedGroups.value.filter((d) => d !== key))

		collapsedGroups.value.push(key)
		// Collapsing keeps the group's selection where the list has one: "collapse a day, tick it,
		// archive it" is a bulk move worth having, and the header's own checkbox goes on showing that the
		// day is selected. Only the reading pane has to move, since it would otherwise point at a row
		// that is no longer rendered.
		const open = openThreadID()
		if (open && getGroupThreads(key)?.includes(open)) onOpenThreadHidden()
	}

	/**
	 * Bring a thread into view in the list, and put the cursor on it. A deep link or a step to the next
	 * thread can land inside a collapsed stack or a folded day — surface it either way: an opened thread
	 * is always visible in the list, and the cursor is left where keyboard navigation should resume.
	 *
	 * The focus is deferred a tick because the row may only just have been revealed by the two lines
	 * above it, and because callers run this from a watcher whose immediate run fires mid-setup.
	 */
	const revealThread = (threadID: string) => {
		expandedStacks.value.add(threadID)

		setTimeout(() => focusOnThread(threadID))

		for (const group of collapsedGroups.value) {
			if (getGroupThreads(group)?.includes(threadID))
				return (collapsedGroups.value = collapsedGroups.value.filter((d) => d !== group))
		}
	}

	return {
		groupMessagesBy,
		groupedThreads,
		getGroupThreads,
		isLastGroup,
		collapsedGroups,
		expandedStacks,
		groupedRows,
		visibleThreadCount,
		navigableRows,
		focusedRowKey,
		focusedRow,
		focusRow,
		focusRowKey,
		rowClasses,
		rowForThread,
		focusOnThread,
		toggleStack,
		toggleGroupCollapse,
		revealThread,
	}
}
