import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch } from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'

import type { FilesSort } from './presentation'

/** How long old rows show before the listing says new ones are coming. */
const HELD_SIGN_MS = 150

/**
 * `source` with its `rows`, and any `extras`, read from getters. Inherited
 * getters and methods keep `source` as their receiver, so every other read
 * still reaches the live source instead of a copied snapshot.
 */
export function withRows<Row, Extras extends object = object>(
  source: InfiniteQueryState<Row>,
  rows: () => readonly Row[],
  extras?: { [Key in keyof Extras]: TypedPropertyDescriptor<Extras[Key]> },
): InfiniteQueryState<Row> & Readonly<Extras> {
  return Object.create(source, { rows: { enumerable: true, get: rows }, ...extras })
}

/**
 * Keeps a listing's last rows on screen while the same place is read again in
 * a new arrangement: another sort, order or view, or another search
 * term. Without it the listing empties to a skeleton and back, and the user
 * loses their place. Opening a different place still starts empty, so one
 * folder's rows never show under another folder's name.
 *
 * Only `rows` changes, and only until the new read brings its first rows or
 * settles empty. `isHeld` turns on once the old rows have shown for a moment.
 */
export function heldWhileRearranging<Row>(
  source: InfiniteQueryState<Row>,
  place: () => string,
): InfiniteQueryState<Row> & { readonly isHeld: boolean } {
  const held = shallowRef<{ place: string; rows: readonly Row[] } | null>(null)
  watch(
    () => [source.status, source.rows] as const,
    ([status, rows]) => {
      if (status !== 'pending' || rows.length) held.value = { place: place(), rows }
    },
    { immediate: true },
  )
  const holding = computed(
    () => source.status === 'pending' && !source.rows.length && held.value?.place === place(),
  )
  const rows = computed(() => (holding.value && held.value ? held.value.rows : source.rows))
  const isHeld = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(holding, (now) => {
    clearTimeout(timer)
    isHeld.value = false
    if (now) timer = setTimeout(() => (isHeld.value = true), HELD_SIGN_MS)
  })
  if (getCurrentScope()) onScopeDispose(() => clearTimeout(timer))
  return withRows(source, () => rows.value, {
    isHeld: { enumerable: true, get: () => isHeld.value },
  })
}

/** The order a folder listing is read in, as `?order_by=` and `?ascending=` ask the server. */
export interface ListingOrder {
  /** The folder and any filter: rows created in one place never show in another. */
  place: string
  sort: FilesSort
  ascending: boolean
}

interface ListingWithCreatedRows<Row> {
  listing: InfiniteQueryState<Row>
  add(row: Row): void
}

/**
 * Shows the folders and links this tab created in the open folder at once,
 * where the server will list them, until a read of the listing has them.
 * A row that sorts after the last loaded row waits for its page. `order`
 * answers `null` where a created row does not belong, such as a search.
 */
export function withCreatedRows<Row extends DriveNode>(
  source: InfiniteQueryState<Row>,
  order: () => ListingOrder | null,
): ListingWithCreatedRows<Row> {
  const created = shallowRef<{ place: string; rows: readonly Row[] }>({ place: '', rows: [] })
  // Once a read has a created row, the read's copy shows.
  watch(
    () => source.rows,
    (rows) => {
      const listed = new Set(rows.map((row) => row.name))
      if (created.value.rows.some((row) => listed.has(row.name)))
        created.value = {
          ...created.value,
          rows: created.value.rows.filter((row) => !listed.has(row.name)),
        }
    },
  )
  const rows = computed(() => {
    const current = order()
    if (!current || created.value.place !== current.place) return source.rows
    const shown = [...source.rows]
    const listed = new Set(shown.map((row) => row.name))
    for (const row of created.value.rows) {
      if (listed.has(row.name)) continue
      const at = shown.findIndex((other) => compareInListing(row, other, current) < 0)
      if (at >= 0) shown.splice(at, 0, row)
      else if (!source.hasNext) shown.push(row)
    }
    return shown
  })
  return {
    listing: withRows(source, () => rows.value),
    add(row) {
      const current = order()
      if (!current) return
      const kept = created.value.place === current.place ? created.value.rows : []
      created.value = { place: current.place, rows: [...kept, row] }
    },
  }
}

type Sortable = Pick<
  DriveNode,
  'name' | 'title' | 'kind' | 'modified' | 'size' | 'owner' | 'content_doctype' | 'mime'
>

/**
 * The server's listing order (`_listing_order` in `suite/drive/_core/nodes.py`):
 * folders first, then the sort key in its direction, then the title and the
 * name, both ascending. Titles compare without case, as the database does.
 */
function compareInListing(
  left: Sortable,
  right: Sortable,
  { sort, ascending }: Pick<ListingOrder, 'sort' | 'ascending'>,
): number {
  const folders = Number(left.kind !== 'folder') - Number(right.kind !== 'folder')
  if (folders) return folders
  const key = compareValues(sortKey(left, sort), sortKey(right, sort))
  if (key) return ascending ? key : -key
  const title = sort === 'title' ? 0 : compareValues(left.title, right.title)
  if (title) return title
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

function sortKey(row: Sortable, sort: FilesSort): string | number | null {
  switch (sort) {
    case 'title':
      return row.title
    case 'modified':
      return row.modified
    case 'size':
      return row.size
    case 'owner':
      return row.owner?.id ?? ''
    case 'kind':
      return `${row.kind === 'document' ? 1 : 2}${row.content_doctype ?? ''}${row.mime ?? ''}`
  }
}

/** An empty value sorts first going up, as SQL puts NULL. */
function compareValues(left: string | number | null, right: string | number | null): number {
  if (left === right) return 0
  if (left === null) return -1
  if (right === null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' })
}
