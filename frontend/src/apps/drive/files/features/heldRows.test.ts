import { describe, expect, it } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

import type { QueryResult, QueryStatus } from '@/platform/server-state'
import { heldWhileRearranging } from './heldRows'

type Page = { rows: string[] }

/** A listing as the page sees it: a read that starts empty and pending each time its input changes. */
function listing() {
  const state = reactive({ status: 'pending' as QueryStatus, rows: [] as string[] })
  const place = ref('folder-a')
  const shown = heldWhileRearranging(state as unknown as QueryResult<Page>, () => place.value)
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
})
