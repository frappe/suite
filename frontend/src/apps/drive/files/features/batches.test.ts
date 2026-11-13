import { describe, expect, it } from 'vitest'

import type { DriveBatchResult } from '@/apps/drive/client/types'

import { inBatches } from './batches'

const names = (count: number) => Array.from({ length: count }, (_, index) => `n${index}`)

describe('inBatches', () => {
  it('sends 450 nodes as 200, 200 and 50, and merges what each request refused', async () => {
    const sent: number[] = []
    const result = await inBatches(names(450), async (nodes): Promise<DriveBatchResult> => {
      sent.push(nodes.length)
      const [refused, ...ok] = nodes
      return { ok, failed: [{ node: refused!, type: 'DriveConflict', message: 'No' }] }
    })

    expect(sent).toEqual([200, 200, 50])
    expect(result.ok).toHaveLength(447)
    expect(result.failed.map((failure) => failure.node)).toEqual(['n0', 'n200', 'n400'])
  })

  it('stops at a failed request and reports the rest as not changed', async () => {
    let calls = 0
    const result = await inBatches(names(450), async (nodes) => {
      if (++calls === 2) throw new Error('Network down')
      return { ok: nodes, failed: [] }
    })

    expect(calls).toBe(2)
    expect(result.ok).toEqual(names(200))
    expect(result.failed).toHaveLength(250)
    expect(result.failed[0]).toEqual({ node: 'n200', type: 'Error', message: 'Network down' })
  })

  it('throws when the first request fails, since nothing changed', async () => {
    await expect(
      inBatches(names(3), async () => {
        throw new Error('Network down')
      }),
    ).rejects.toThrow('Network down')
  })
})
