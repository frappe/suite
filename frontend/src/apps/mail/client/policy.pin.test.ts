import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it } from 'vitest'

import type { Operation } from '@/platform/transport'

import { registration } from './policy'

// How pinning changes a cached list before the server answers: the row reads pinned straight away,
// whichever of the conversation's messages it stands for, in the folder it was pinned in alone.
type Listed = { rows: { pinned: number; messages: { id: string; pinned_in?: string[] }[] }[] }

const updateOf = () => {
  const policy = registration.policy(
    fromPartial<Operation>({ id: 'pin_mails', kind: 'mutation', publicName: 'messages.pin' }),
  )
  if (!policy.effects || policy.effects === 'none' || !policy.effects.optimisticReads)
    throw new Error('Expected mutation cache effects')
  // SAFETY: the cache update hands back the data it was given, in the same shape.
  return policy.effects.optimisticReads.update as (
    input: unknown,
    query: unknown,
    data: unknown,
  ) => Listed
}

const list = {
  rows: [
    { id: 'latest', pinned: 0, messages: [{ id: 'older', pinned_in: [] }, { id: 'latest' }] },
    { id: 'other', pinned: 0, messages: [{ id: 'other' }] },
  ],
}

it('marks the row pinned when pinned by any message of the conversation', () => {
  const update = updateOf()
  const { rows } = update(
    { account: 'a', ids: ['older'], pinned: true, mailbox: 'inbox' },
    { account: 'a', mailbox: 'inbox' },
    list,
  )
  expect(rows[0].pinned).toBe(1)
  expect(rows[0].messages.find((m) => m.id === 'older')?.pinned_in).toEqual(['inbox'])
})

it("leaves a list of another folder as it was: a pin is its own folder's", () => {
  const update = updateOf()
  const { rows } = update(
    { account: 'a', ids: ['older'], pinned: true, mailbox: 'receipts' },
    { account: 'a', mailbox: 'inbox' },
    list,
  )
  expect(rows[0].pinned).toBe(0)
})

it('leaves other conversations alone, and unpins by the same rule', () => {
  const update = updateOf()
  const pinned = { rows: [{ ...list.rows[0], pinned: 1 }, list.rows[1]] }
  const { rows } = update(
    { account: 'a', ids: ['older'], pinned: false, mailbox: 'inbox' },
    { account: 'a', mailbox: 'inbox' },
    pinned,
  )
  expect(rows[0].pinned).toBe(0)
  expect(rows[1].pinned).toBe(0)
})
