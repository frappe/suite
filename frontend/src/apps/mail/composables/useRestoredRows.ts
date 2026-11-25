import { shallowRef, watch, type WatchSource } from 'vue'

import type { Thread } from '@/apps/mail/types'

import { insertByDate } from './useKeptRead'

/**
 * Conversations an Undo put back on the list, held there until the server lists them again. Undo
 * puts the rows back on the click, but its inverse is sent only once the action has landed (see
 * `undoOnClick`), and every read of the list until then (the action's own, a poll, a push) answers
 * without them.
 *
 * A row goes back where it stood: after the row it followed when it left, or by date where that one
 * is gone too.
 */
export function useRestoredRows({
  key,
  scope,
  reread,
}: {
  /** A row's identity in this list. */
  key: (thread: Thread) => string
  /** What the list is: a change of folder, filter or tab lets every row go. */
  scope: WatchSource
  /** Reads the list again; settles once the answer is on it. */
  reread: () => Promise<unknown>
}) {
  // Each row with the hold that put it there: a row undone twice is held by the second Undo alone.
  const held = shallowRef(new Map<string, { row: Thread; hold: symbol }>())
  // The row each one followed as it left: null for the first on the list.
  const places = new WeakMap<Thread, string | null>()
  watch(
    scope,
    () => {
      if (held.value.size) held.value = new Map()
    },
    { deep: true },
  )

  const release = (keys: string[], hold?: symbol) => {
    const going = keys.filter(
      (k) => held.value.has(k) && (!hold || held.value.get(k)!.hold === hold),
    )
    if (!going.length) return
    const next = new Map(held.value)
    for (const k of going) next.delete(k)
    held.value = next
  }

  /** Notes where `rows` stand on `list` as they leave it, and lets go of any held: taken off again. */
  const leaving = (rows: Thread[], list: Thread[]) => {
    for (const row of rows) {
      const at = list.findIndex((other) => key(other) === key(row))
      if (at !== -1) places.set(row, at ? key(list[at - 1]) : null)
    }
    release(rows.map(key))
  }

  /**
   * Holds `rows` on the list until `inverted` settles and the list has been read again after it. A
   * refused inverse lets them go at once: the server lists them nowhere here.
   */
  const hold = (rows: Thread[], inverted: Promise<unknown>) => {
    if (!rows.length) return
    const hold = Symbol('hold')
    const next = new Map(held.value)
    for (const row of rows) next.set(key(row), { row, hold })
    held.value = next
    void inverted
      .then(reread, () => {})
      .catch(() => {})
      .finally(() => release(rows.map(key), hold))
  }

  /** The list's rows, with every held row the server's answer leaves out back in its place. */
  const withRestored = (rows: Thread[]): Thread[] => {
    if (!held.value.size) return rows
    const present = new Set(rows.map(key))
    const missing = [...held.value.values()].flatMap(({ row }) =>
      present.has(key(row)) ? [] : [row],
    )
    if (!missing.length) return rows
    const merged = [...rows]
    // In the order they stood, so a run taken off together goes back as it was, each after the last.
    for (const row of missing) {
      const after = places.get(row)
      const follows = after ? merged.findIndex((other) => key(other) === after) : -1
      if (after === null) merged.unshift(row)
      else if (follows !== -1) merged.splice(follows + 1, 0, row)
      else insertByDate(merged, row)
    }
    return merged
  }

  return { leaving, hold, withRestored }
}
