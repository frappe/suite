import { shallowRef, watch, type WatchSource } from 'vue'

import type { Thread } from '@/apps/mail/types'

/**
 * In a list filtered to unread mail, a conversation read there — opened, or marked read — stays on it,
 * shown as read, until the list, its filter or its tab changes, as Gmail keeps it. The list asks the
 * server for unread mail, so its next answer no longer holds the conversation: opening it took it off
 * the list under the reader, the tab's title with it, and left U (mark unread) nothing to act on.
 *
 * The list holds it on top of the server's answer, in its place by date. An action that takes a
 * conversation off the list — archive, move, junk, trash, delete — lets it go (`release`), and so does
 * starting the list over (`clear`).
 */
export function useKeptRead({
  filtering,
  scope,
  key,
}: {
  /** Whether the list is filtered to unread mail. */
  filtering: () => boolean
  /** What the list is: a change of folder, filter or tab starts it afresh. */
  scope: WatchSource
  /** A row's identity in this list. */
  key: (thread: Thread) => string
}) {
  const kept = shallowRef(new Map<string, Thread>())
  const clear = () => {
    if (kept.value.size) kept.value = new Map()
  }
  watch(scope, clear, { deep: true })

  /** Holds the read rows of `rows`, as they are now. */
  const keep = (rows: Thread[]) => {
    if (!filtering()) return
    const read = rows.filter((row) => row.seen === 1 && !kept.value.has(key(row)))
    if (!read.length) return
    const next = new Map(kept.value)
    for (const row of read) next.set(key(row), row)
    kept.value = next
  }

  /** Lets go of the conversations an action took off the list. */
  const release = (keys: string[]) => {
    if (!keys.some((k) => kept.value.has(k))) return
    const next = new Map(kept.value)
    for (const k of keys) next.delete(k)
    kept.value = next
  }

  /** The list's rows, with every conversation read here that the server's answer has left out. */
  const withKept = (rows: Thread[]): Thread[] => {
    if (!filtering() || !kept.value.size) return rows
    const present = new Set(rows.map(key))
    const missing = [...kept.value.values()].filter((row) => !present.has(key(row)))
    if (!missing.length) return rows
    // Newest first, as the list is: each kept row goes back before the first row older than it.
    const merged = [...rows]
    for (const row of missing) {
      const at = merged.findIndex((other) => other.received_at < row.received_at)
      merged.splice(at === -1 ? merged.length : at, 0, row)
    }
    return merged
  }

  return { keep, release, clear, withKept }
}
