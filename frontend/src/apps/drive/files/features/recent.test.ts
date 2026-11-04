import { describe, expect, it } from 'vitest'

import type { InfiniteQueryState } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'

import { recentFiles } from './recent'

const row = (name: string, kind: string) => ({ name, kind }) as DriveNode
const listing = (rows: DriveNode[]) =>
  ({ rows, hasNext: true }) as unknown as InfiniteQueryState<DriveNode>

describe('Recent', () => {
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
