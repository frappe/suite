import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'

import { recentFiles } from './recent'

const row = (name: string, kind: string) => fromPartial<DriveNode>({ name, kind })
const listing = (rows: DriveNode[]): InfiniteQueryState<DriveNode> => ({
  rows,
  hasNext: true,
  status: 'success',
  isFetching: false,
  total: undefined,
  isFetchingNext: false,
  error: null,
  async refetch() {},
  async fetchNext() {},
  cancel() {},
})

describe('Recent', () => {
  it('keeps inherited getters and query actions on the filtered listing receiver', async () => {
    const receivedRows: string[][] = []
    const source = {
      ...listing([row('Projects', 'folder'), row('report', 'file')]),
      get total(): number {
        return this.rows.length
      },
      async refetch() {
        receivedRows.push(this.rows.map((node) => node.name))
      },
    }
    const recent = recentFiles(source, () => true)

    expect(recent.total).toBe(1)
    await recent.refetch()
    expect(receivedRows).toEqual([['report']])
    expect(source.total).toBe(2)
  })

  it('tracks live source rows and filter changes without copying query state', () => {
    const rows = ref([row('Projects', 'folder'), row('report', 'file')])
    const source = {
      ...listing([]),
      get rows() {
        return rows.value
      },
    }
    const applies = ref(true)
    const recent = recentFiles(source, () => applies.value)
    const shown = computed(() => recent.rows.map((node) => node.name))

    expect(shown.value).toEqual(['report'])
    applies.value = false
    expect(shown.value).toEqual(['Projects', 'report'])
    rows.value = [row('deck', 'document')]
    expect(shown.value).toEqual(['deck'])
    rows.value = [row('Next', 'folder'), row('next', 'file')]
    applies.value = true
    expect(shown.value).toEqual(['next'])
  })

  it('shows opened files but not the folders the user passed through', () => {
    const source = listing([
      row('report', 'file'),
      row('Projects', 'folder'),
      row('deck', 'document'),
    ])

    const recent = recentFiles(source, () => true)

    expect(recent.rows.map((node) => node.name)).toEqual(['report', 'deck'])
    expect(recent.hasNext).toBe(true)
    expect(recentFiles(source, () => false).rows).toHaveLength(3)
  })
})
