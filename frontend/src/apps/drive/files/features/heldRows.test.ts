import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import type { InfiniteQueryState } from '@/platform/server-state'

import { heldWhileRearranging, withCreatedRows, type ListingOrder } from './heldRows'

interface ListingState extends Omit<InfiniteQueryState<string>, 'status' | 'rows'> {
  status: InfiniteQueryState<string>['status']
  rows: string[]
}

/** A listing as the page sees it: a read that starts empty and pending each time its input changes. */
function listing() {
  const state = reactive<ListingState>({
    status: 'pending',
    rows: [],
    isFetching: false,
    total: undefined,
    hasNext: false,
    isFetchingNext: false,
    error: null,
    async refetch() {},
    async fetchNext() {},
    cancel() {},
  })
  const place = ref('folder-a')
  const shown = heldWhileRearranging(state, () => place.value)
  return {
    shown,
    place,
    async read(nextPlace = place.value) {
      place.value = nextPlace
      state.status = 'pending'
      state.rows = []
      await nextTick()
    },
    async settle(rows: string[]) {
      state.status = 'success'
      state.rows = rows
      await nextTick()
    },
  }
}
describe('rows held while a listing is rearranged', () => {
  it('keeps the old rows on screen while the same folder is read in a new order', async () => {
    const view = listing()
    await view.settle(['a', 'b'])
    await view.read()
    expect(view.shown.rows).toEqual(['a', 'b'])
    expect(view.shown.status).toBe('pending')
    await view.settle(['b', 'a'])
    expect(view.shown.rows).toEqual(['b', 'a'])
  })
  it('starts empty when another folder opens', async () => {
    const view = listing()
    await view.settle(['a', 'b'])
    await view.read('folder-b')
    expect(view.shown.rows).toEqual([])
  })
  it('shows an empty result once the new read settles empty', async () => {
    const view = listing()
    await view.settle(['a'])
    await view.read()
    await view.settle([])
    expect(view.shown.rows).toEqual([])
  })
  it('says new rows are coming once the old ones have shown for a moment', async () => {
    vi.useFakeTimers()
    const view = listing()
    await view.settle(['a', 'b'])
    await view.read()
    expect(view.shown.isHeld).toBe(false)
    await vi.advanceTimersByTimeAsync(150)
    expect(view.shown.isHeld).toBe(true)
    await view.settle(['b', 'a'])
    expect(view.shown.isHeld).toBe(false)
    vi.useRealTimers()
  })
})

describe('rows this tab created', () => {
  const owner = { id: 'me@example.com', full_name: 'Me', user_image: null }
  function row(name: string, title: string, extra: Partial<DriveNode> = {}): DriveNode {
    return {
      name,
      title,
      kind: 'folder',
      parent_node: 'folder-a',
      root: 'root',
      state: 'Active',
      trash_root: null,
      size: 0,
      mime: null,
      url: null,
      content_doctype: null,
      content_docname: null,
      is_template: 0,
      owner,
      creation: null,
      modified: '2026-01-01 10:00:00',
      content_modified: null,
      ...extra,
    }
  }
  function listing(rows: DriveNode[], hasNext = false) {
    const state = reactive({ status: 'success' as const, rows, hasNext })
    const order = ref<ListingOrder | null>({ place: 'folder-a', sort: 'title', ascending: true })
    const created = withCreatedRows(
      fromPartial<InfiniteQueryState<DriveNode>>(state),
      () => order.value,
    )
    const titles = () => created.listing.rows.map((each) => each.title)
    return { state, order, created, titles }
  }
  const loaded = () => [
    row('f1', 'Archive'),
    row('f2', 'drafts'),
    row('x1', 'notes.txt', { kind: 'file', mime: 'text/plain' }),
  ]

  it('shows a new folder where the server sorts it: folders first, by name without case', () => {
    const view = listing(loaded())
    view.created.add(row('new', 'Budget'))
    expect(view.titles()).toEqual(['Archive', 'Budget', 'drafts', 'notes.txt'])
  })

  it('follows the direction and the sort, and a link sorts among files', () => {
    const view = listing(loaded())
    view.order.value = { place: 'folder-a', sort: 'modified', ascending: false }
    view.created.add(row('new', 'Zebra', { modified: '2026-06-01 09:00:00' }))
    view.created.add(row('link', 'Aardvark', { kind: 'link', modified: '2026-06-01 09:00:00' }))
    expect(view.titles()).toEqual(['Zebra', 'Archive', 'drafts', 'Aardvark', 'notes.txt'])
  })

  it('waits for its page when it sorts after the last loaded row', () => {
    const view = listing(loaded(), true)
    view.created.add(row('new', 'Zulu', { kind: 'link' }))
    expect(view.titles()).toEqual(['Archive', 'drafts', 'notes.txt'])
  })

  it('shows the read’s copy once a read has it, and nothing in another place', async () => {
    const view = listing(loaded())
    view.created.add(row('new', 'Budget'))
    view.state.rows = [...loaded(), row('new', 'Budget (renamed)')]
    await nextTick()
    expect(view.titles()).toEqual(['Archive', 'drafts', 'notes.txt', 'Budget (renamed)'])
    view.state.rows = loaded()
    await nextTick()
    expect(view.titles()).toEqual(['Archive', 'drafts', 'notes.txt'])

    view.created.add(row('other', 'Budget'))
    view.order.value = { place: 'folder-b', sort: 'title', ascending: true }
    expect(view.titles()).toEqual(['Archive', 'drafts', 'notes.txt'])
  })
})
