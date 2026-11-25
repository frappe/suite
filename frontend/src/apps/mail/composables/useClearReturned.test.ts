import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { useClearReturned } from './useClearReturned'

// SAFETY: starts empty; the mock below is all that fills it.
const calls = vi.hoisted(() => [] as { op: string; input: Record<string, unknown> }[])
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }))
// The restore held until a test lets it land.
const held = vi.hoisted(() => {
  const release: (() => void)[] = []
  return { on: false, release }
})
vi.stubGlobal('__', (text: string) => text)
vi.mock('frappe-ui', () => ({ toast }))
vi.mock('@/api', () => ({
  api: { mail: { messages: { dismissReturned: 'dismiss', restoreReturned: 'restore' } } },
  client: {
    mutation: vi.fn((op: string, input: Record<string, unknown>) => {
      calls.push({ op, input })
      if (op === 'restore' && held.on)
        return new Promise((resolve) => held.release.push(() => resolve(null)))
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

// The Undo the latest success toast offers.
const offeredUndo = (): (() => void) | undefined =>
  toast.success.mock.calls.at(-1)?.[1]?.action?.onClick

beforeEach(() => {
  calls.length = 0
  held.on = false
  held.release = []
  vi.clearAllMocks()
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
    offeredUndo()?.()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toEqual({
      op: 'restore',
      input: { account: 'a', ids: ['a-m'], no_reply_ids: ['a-m'] },
    })
  })

  // The marks come off the rows on the click; they come back only once the server has put them back.
  it('says the rows left Reminders on the click, and that they are back once they are', async () => {
    held.on = true
    useClearReturned().clearReturned([back('t1', 'a')])
    expect(toast.success).toHaveBeenCalledWith('Conversation removed from Reminders', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    })

    offeredUndo()?.()
    await vi.waitFor(() => expect(held.release).toHaveLength(1))
    expect(toast.success).not.toHaveBeenCalledWith('Conversation moved back', undefined)

    held.release[0]()
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Conversation moved back', undefined),
    )
  })

  it('with nothing back, asks nothing', () => {
    useClearReturned().clearReturned([fromPartial<Thread>({ thread_id: 't1' })], 'mine')
    expect(calls).toEqual([])
  })
})
