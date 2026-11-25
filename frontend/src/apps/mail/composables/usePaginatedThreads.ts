import { useIntersectionObserver } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { Thread } from '@/apps/mail/types'
import { beginListRead } from '@/apps/mail/utils/draftsInList'

/** Rows per window; the server reports whether another window exists. */
export const PAGE_LENGTH = 25

// Windows one fill episode may pull before it gives up (see topUpIfShort). Far more than any viewport
// needs — the cap only catches the case where the fill can never succeed: every window absorbed into
// the trailing stack row, which adds no height, so the sentinel stays in view and the list would walk
// the whole mailbox 25 threads at a time.
const MAX_FILL_WINDOWS = 20

/**
 * What stands in the list's place: its rows in outline, the refusal with a way to ask again, the
 * empty message, or the rows.
 */
export type ThreadListState = 'loading' | 'error' | 'empty' | 'list'

/**
 * Reading the list again, keyboard navigation, viewport filling and the list's state over
 * engine-owned pages.
 */
interface Options {
  query: () => InfiniteQueryState<unknown>
  rows: () => Thread[]
  openThreadID: () => string | undefined
  onEdgeThread: (id: string, action: 'open' | 'focus') => void
  threadKey?: (thread: Thread) => string
  fillProgress?: () => number
  /**
   * Whether the list's frame (toolbar, Inbox tabs, filter chips, search header) stays up around an
   * empty or refused list, so the reader can leave it by them: a split Inbox, a filtered list.
   */
  framed?: () => boolean
  /** Work under way that will change the whole list (emptying the folder): the list waits for it. */
  busy?: () => boolean
  /** Whether there is a list to ask for at all; a search waits for its query, and is empty till then. */
  asked?: () => boolean
}
export function usePaginatedThreads({
  query,
  rows,
  openThreadID,
  onEdgeThread,
  threadKey = (row) => row.thread_id,
  fillProgress,
  framed = () => false,
  busy = () => false,
  asked = () => true,
}: Options) {
  const container = useTemplateRef<HTMLElement>('mailList')
  const sentinel = useTemplateRef<HTMLElement>('loadMoreSentinel')
  const hasMore = computed(() => query().hasNext)
  const loadingMore = computed(() => query().isFetchingNext)
  const isFetching = computed(() => query().isFetching)
  const threadIDs = computed(() => rows().map(threadKey))
  const threadByOffset = (offset: number, from = openThreadID()) =>
    threadIDs.value[threadIDs.value.indexOf(from ?? '') + offset]
  let pendingEdge = false
  async function loadMore() {
    if (!hasMore.value || isFetching.value) return
    try {
      await query().fetchNext()
    } catch {
      /* Query state holds the refusal. */
    }
  }
  async function loadMoreThenOpenEdge(offset: number, action: 'open' | 'focus') {
    if (pendingEdge || offset < 0 || !hasMore.value) return
    const anchor = action === 'open' ? openThreadID() : threadIDs.value.at(-1)
    pendingEdge = true
    try {
      await loadMore()
      const next = threadByOffset(1, anchor)
      if (next) onEdgeThread(next, action)
    } finally {
      pendingEdge = false
    }
  }
  // A thread open at the end of what is loaded brings in the next window, so the one after it is
  // there to step or swipe to (see useThreadSwipe) before it is asked for. Once mounted: the caller
  // may declare its rows further down.
  onMounted(() =>
    watch(
      () => !!openThreadID() && threadIDs.value.at(-1) === openThreadID(),
      (atEnd) => atEnd && void loadMore(),
      { immediate: true },
    ),
  )
  /**
   * Read the list again from its first window. Every such read goes through here: its rows settle
   * the drafts shown on them (see beginListRead).
   */
  function refetch() {
    const settleDrafts = beginListRead()
    return query()
      .refetch()
      .then(() => settleDrafts(rows()))
      .catch(() => {
        /* Query state holds the refusal. */
      })
  }
  // A refresh asked while the list is being read waits for that read rather than being dropped: the
  // change that asked for it may have reached the server after the read went out.
  const refreshOwed = ref(false)
  /** Read the list again, now or once the read under way is in. */
  function refresh() {
    if (isFetching.value) refreshOwed.value = true
    else void refetch()
  }
  // Reads nothing of the query until a refresh is owed: the source runs at setup, and a caller may
  // declare its query further down.
  watch(
    () => refreshOwed.value && !isFetching.value,
    (due) => {
      if (!due) return
      refreshOwed.value = false
      void refetch()
    },
  )
  let fillWindows = 0
  let lastProgress = 0
  const visible = ref(false)
  useIntersectionObserver(
    sentinel,
    ([entry]) => {
      if (entry?.isIntersecting && !visible.value) {
        fillWindows = 0
        lastProgress = 0
      }
      visible.value = !!entry?.isIntersecting
      if (visible.value) void loadMore()
    },
    {
      root: container,
    },
  )
  function topUpIfShort() {
    if (!visible.value || !hasMore.value || fillWindows >= MAX_FILL_WINDOWS) return
    void nextTick(() => {
      const el = container.value,
        marker = sentinel.value
      if (!el || !marker) return
      const bounds = el.getBoundingClientRect(),
        end = marker.getBoundingClientRect()
      if (end.top >= bounds.bottom || end.bottom <= bounds.top) return
      const progress = fillProgress?.() ?? rows().length
      if (progress <= lastProgress) return
      lastProgress = progress
      fillWindows += 1
      void loadMore()
    })
  }
  // A refusal stands in for the list only while there is nothing to show: a failed refresh of a
  // loaded list keeps its rows. Asking again shows the outline, not the stale refusal.
  const listState = computed<ThreadListState>(() => {
    const state = query()
    if (busy()) return 'loading'
    if (rows().length) return 'list'
    if (!asked()) return 'empty'
    if (state.status === 'pending' || state.isFetching) return 'loading'
    return state.status === 'error' ? 'error' : 'empty'
  })
  // The frame stands around rows, and around rows on their way: it is there before them, so nothing
  // moves when they land. An empty or refused list fills the whole view unless it is `framed`.
  const listFramed = computed(
    () => listState.value === 'list' || listState.value === 'loading' || framed(),
  )
  return {
    listState,
    listFramed,
    container,
    refetch,
    refresh,
    hasMore,
    loadingMore,
    isFetching,
    canGoNext: hasMore,
    threadIDs,
    threadByOffset,
    loadMoreThenOpenEdge,
    topUpIfShort,
    scrollListToTop: () =>
      container.value?.scrollTo({
        top: 0,
      }),
  }
}
