import { useDocumentVisibility, useEventListener } from '@vueuse/core'
import { ref, watch } from 'vue'

import type { DocumentThread } from '@/apps/drive'

/**
 * Which comment threads changed since this person last opened them, kept on
 * this device per person and document. Blocked storage keeps nothing and never
 * throws, so what was opened lasts only as long as the tab.
 */
interface SeenMarks {
  [thread: string]: SeenMark
}

interface SeenMark {
  /** The thread as it was seen, from `threadMark`. */
  mark: string
  /** When the read of its threads was sent, so a tab with older threads never wins. */
  at: number
}

interface SeenOptions {
  user: string
  node: string
  threads: () => DocumentThread[]
  /** When the shown threads' read was sent; until one answers, nothing shows as changed. */
  readAt: () => number | null
  openThread: () => string | null
}

const PREFIX = 'suite:writer-seen-threads:'

/** What a thread held when last opened, by thread; null when this document was never opened here. */
export function readSeen(user: string, node: string): SeenMarks | null {
  try {
    return parseSeen(localStorage.getItem(keyOf(user, node)))
  } catch {
    return null
  }
}

function parseSeen(value: string | null): SeenMarks | null {
  let stored: unknown
  try {
    stored = JSON.parse(value ?? 'null')
  } catch {
    return null
  }

  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return null
  }

  const marks = Object.entries(stored).filter(([, mark]) => isSeenMark(mark))
  return Object.fromEntries(marks)
}

function isSeenMark(value: unknown): value is SeenMark {
  if (!value || typeof value !== 'object') {
    return false
  }

  const { mark, at } = value as Partial<SeenMark>
  return typeof mark === 'string' && typeof at === 'number'
}

export function keepSeen(user: string, node: string, marks: SeenMarks) {
  try {
    localStorage.setItem(keyOf(user, node), JSON.stringify(marks))
  } catch {
    // Blocked or full storage: what was opened lives only in this tab
  }
}

function keyOf(user: string, node: string) {
  return `${PREFIX}${user}:${node}`
}

/** Changes with a new or deleted comment, an edit, and a resolve or reopen. */
export function threadMark(thread: DocumentThread) {
  const [latest = ''] = thread.comments
    .map((comment) => comment.modified ?? '')
    .sort()
    .reverse()
  return `${thread.comments.length}:${latest}:${thread.resolved}`
}

function marksOf(threads: DocumentThread[], at: number): SeenMarks {
  return Object.fromEntries(
    threads.map((thread) => [thread.name, { mark: threadMark(thread), at }]),
  )
}

// A document first opened on this device starts with every thread seen, once they load
function startingMarks(user: string, node: string, threads: DocumentThread[], at: number | null) {
  const kept = readSeen(user, node)
  if (kept || at === null) {
    return kept
  }

  const marks = marksOf(threads, at)
  keepSeen(user, node, marks)
  return marks
}

// The mark seen in later threads; the first wins a tie
function later(mark: SeenMark, other: SeenMark | undefined) {
  if (other && other.at > mark.at) {
    return other
  }

  return mark
}

// Both tabs' marks, the later of the two kept for each thread
function merged(marks: SeenMarks, incoming: SeenMarks) {
  const kept = { ...marks }
  for (const [name, mark] of Object.entries(incoming)) {
    kept[name] = later(mark, kept[name])
  }

  return kept
}

// The marks with the named thread seen as it is now, when it is listed
function withSeen(marks: SeenMarks, threads: DocumentThread[], name: string | null, at: number) {
  const thread = threads.find((listed) => listed.name === name)
  if (!thread) {
    return marks
  }

  return { ...marks, [thread.name]: later({ mark: threadMark(thread), at }, marks[thread.name]) }
}

// Another tab on this device opening a thread clears it here too
function followOtherTabs(key: string, follow: (marks: SeenMarks) => void) {
  useEventListener(window, 'storage', (event) => {
    if (event.key !== key) {
      return
    }

    const incoming = parseSeen(event.newValue)
    if (incoming) {
      follow(incoming)
    }
  })
}

function isUnreadIn(
  marks: SeenMarks | null,
  openThread: () => string | null,
  thread: DocumentThread,
) {
  if (!marks || thread.name === openThread()) {
    return false
  }

  return marks[thread.name]?.mark !== threadMark(thread)
}

/** The threads changed since last opened here; the open thread stays seen as it changes. */
export function useSeenThreads({ user, node, threads, readAt, openThread }: SeenOptions) {
  const marks = ref<SeenMarks | null>(null)
  const visibility = useDocumentVisibility()

  function markSeen(name: string | null) {
    const at = readAt()
    marks.value ??= startingMarks(user, node, threads(), at)
    if (!marks.value || at === null) {
      return
    }

    // Read again, since another tab may have marked threads since
    marks.value = withSeen(merged(marks.value, readSeen(user, node) ?? {}), threads(), name, at)
    keepSeen(user, node, marks.value)
  }

  // A reply counts as seen only while the page is on screen, and is marked once it comes back
  watch(
    [threads, readAt, openThread, visibility],
    ([, , open]) => markSeen(visibility.value === 'visible' ? open : null),
    { immediate: true },
  )
  // Not written back: this tab writes the later marks the next time it marks a thread
  followOtherTabs(keyOf(user, node), (incoming) => {
    marks.value = merged(marks.value ?? {}, incoming)
  })

  // The thread open here stays seen, though a tab with later threads saw it as changed
  function isUnread(thread: DocumentThread) {
    return isUnreadIn(marks.value, openThread, thread)
  }

  return { isUnread, markSeen }
}
