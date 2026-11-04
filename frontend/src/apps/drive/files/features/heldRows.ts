import { computed, shallowRef, watch } from 'vue'

import type { InfiniteQueryState } from '@/api'

/**
 * Keeps a listing's last rows on screen while the same place is read again in
 * a new arrangement: another sort, order or view, or another search
 * term. Without it the listing empties to a skeleton and back, and the user
 * loses their place. Opening a different place still starts empty, so one
 * folder's rows never show under another folder's name.
 *
 * Only `rows` changes, and only until the new read brings its first rows or
 * settles empty.
 */
export function heldWhileRearranging<Row>(
  source: InfiniteQueryState<Row>,
  place: () => string,
): InfiniteQueryState<Row> {
  const held = shallowRef<{ place: string; rows: readonly Row[] } | null>(null)
  watch(
    () => [source.status, source.rows] as const,
    ([status, rows]) => {
      if (status !== 'pending' || rows.length) held.value = { place: place(), rows }
    },
    { immediate: true },
  )
  const rows = computed(() => {
    const waiting = source.status === 'pending' && !source.rows.length
    return waiting && held.value?.place === place() ? held.value.rows : source.rows
  })
  return new Proxy(source, {
    get(target, key, receiver) {
      return key === 'rows' ? rows.value : Reflect.get(target, key, receiver)
    },
  })
}
