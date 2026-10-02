import { computed, shallowRef, watch } from 'vue'

import type { QueryResult } from '@/platform/server-state'

/**
 * Keeps a listing's last rows on screen while the same place is read again in
 * a new arrangement: another sort, order, grouping or view, or another search
 * term. Without it the listing empties to a skeleton and back, and the user
 * loses their place. Opening a different place still starts empty, so one
 * folder's rows never show under another folder's name.
 *
 * Only `rows` changes, and only until the new read brings its first rows or
 * settles empty.
 */
export function heldWhileRearranging<Page extends { rows: unknown[] }>(
  source: QueryResult<Page>,
  place: () => string,
): QueryResult<Page> {
  const held = shallowRef<{ place: string; rows: Page['rows'] } | null>(null)
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
