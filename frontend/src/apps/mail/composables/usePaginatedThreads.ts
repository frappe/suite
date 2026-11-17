import { useIntersectionObserver } from '@vueuse/core'
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { Thread } from '@/apps/mail/types'

/** Rows per window; the server reports whether another window exists. */
export const PAGE_LENGTH = 25

// Windows one fill episode may pull before it gives up (see topUpIfShort). Far more than any viewport
// needs — the cap only catches the case where the fill can never succeed: every window absorbed into
// the trailing stack row, which adds no height, so the sentinel stays in view and the list would walk
// the whole mailbox 25 threads at a time.
const MAX_FILL_WINDOWS = 20

/**
 * What stands in the list's place: a spinner, the refusal with a way to ask again, the empty
 * message, or the rows.
 */
export type ThreadListState = 'loading' | 'error' | 'empty' | 'list'

/** Keyboard navigation, viewport filling and the list's state over engine-owned pages. */
interface Options {
  query: () => InfiniteQueryState<unknown>
  rows: () => Thread[]
  openThreadID: () => string | undefined
  onEdgeThread: (id: string, action: 'open' | 'focus') => void
  threadKey?: (thread: Thread) => string
  fillProgress?: () => number
  /**
   * Whether the list's frame (toolbar, Inbox tabs, filter chips, search header) stays up around an
   * empty or reloading list, so the reader can leave it by them: a split Inbox, a filtered list.
   */
  framed?: () => boolean
  /** Whether it stays up through the list's first load too: the reader just switched tab or filter. */
  switching?: () => boolean
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
  switching = () => false,
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
  // loaded list keeps its rows. Asking again shows the spinner, not the stale refusal.
  const listState = computed<ThreadListState>(() => {
    const state = query()
    if (busy()) return 'loading'
    if (rows().length) return 'list'
    if (!asked()) return 'empty'
    if (state.status === 'pending' || state.isFetching) return 'loading'
    return state.status === 'error' ? 'error' : 'empty'
  })
  // A first load fills the whole view unless the reader's own switch asked for it.
  const listFramed = computed(
    () =>
      switching() ||
      listState.value === 'list' ||
      (framed() && !busy() && query().status !== 'pending'),
  )
  return {
    listState,
    listFramed,
    container,
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
