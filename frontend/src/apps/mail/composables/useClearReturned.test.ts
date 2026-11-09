import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { useClearReturned } from './useClearReturned'

// SAFETY: starts empty; the mock below is all that fills it.
const calls = vi.hoisted(() => [] as { op: string; input: Record<string, unknown> }[])
// SAFETY: starts unset; the toast mock below sets it.
const toasted = vi.hoisted(() => ({ undo: undefined as undefined | (() => void) }))
vi.stubGlobal('__', (text: string) => text)
vi.mock('@/apps/mail/utils', () => ({
  raiseOptimisticToast: (_forward: Promise<unknown>, _said: string, undo?: () => void) => {
    toasted.undo = undo
  },
}))
vi.mock('@/api', () => ({
  api: { mail: { messages: { dismissReturned: 'dismiss', restoreReturned: 'restore' } } },
  client: {
    mutation: vi.fn((op: string, input: Record<string, unknown>) => {
      calls.push({ op, input })
      return Promise.resolve(
        op === 'dismiss'
          ? { ids: [`${input.account}-m`], no_reply_ids: [`${input.account}-m`] }
          : null,
      )
    }),
  },
}))

const back = (thread_id: string, account?: string) =>
  fromPartial<Thread>({ thread_id, account, returned: 1 })

beforeEach(() => {
  calls.length = 0
  toasted.undo = undefined
})

describe('clearing rows back from waiting', () => {
  it('asks each account once, for its own rows', () => {
    useClearReturned().clearReturned([back('t1', 'a'), back('t2', 'b'), back('t3', 'a')])
    expect(calls).toEqual([
      { op: 'dismiss', input: { account: 'a', thread_ids: ['t1', 't3'] } },
      { op: 'dismiss', input: { account: 'b', thread_ids: ['t2'] } },
    ])
  })

  it("takes the list's account for rows that don't name one, and skips rows not back", () => {
    useClearReturned().clearReturned(
      [back('t1'), fromPartial<Thread>({ thread_id: 't2', returned: 0 })],
      'mine',
    )
    expect(calls).toEqual([{ op: 'dismiss', input: { account: 'mine', thread_ids: ['t1'] } }])
  })

  it('undone, puts back the marks the server took off', async () => {
    useClearReturned().clearReturned([back('t1', 'a')])
    toasted.undo?.()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toEqual({
      op: 'restore',
      input: { account: 'a', ids: ['a-m'], no_reply_ids: ['a-m'] },
    })
  })

  it('with nothing back, asks nothing', () => {
    useClearReturned().clearReturned([fromPartial<Thread>({ thread_id: 't1' })], 'mine')
    expect(calls).toEqual([])
  })
})
