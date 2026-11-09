import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it } from 'vitest'

import type { Operation } from '@/platform/transport'

import { registration } from './policy'

// How pinning changes a cached list before the server answers: the row reads pinned straight away,
// whichever of the conversation's messages it stands for.
const updateOf = () => {
  const policy = registration.policy(
    fromPartial<Operation>({
      id: 'pin_mails',
      kind: 'mutation',
      publicName: 'messages.pin',
    }),
  )
  if (!policy.effects || policy.effects === 'none' || !policy.effects.optimisticReads)
    throw new Error('Expected mutation cache effects')
  return policy.effects.optimisticReads.update
}

const list = {
  rows: [
    { id: 'latest', pinned: 0, messages: [{ id: 'older' }, { id: 'latest' }] },
    { id: 'other', pinned: 0, messages: [{ id: 'other' }] },
  ],
}

it('marks the row pinned when pinned by any message of the conversation', () => {
  const update = updateOf()
  expect(
    update({ account: 'a', ids: ['older'], pinned: true }, { account: 'a' }, list),
  ).toMatchObject({
    rows: [
      { id: 'latest', pinned: 1, messages: [{ id: 'older', pinned: 1 }, { id: 'latest' }] },
      { id: 'other', pinned: 0 },
    ],
  })
})

it('leaves other conversations alone, and unpins by the same rule', () => {
  const update = updateOf()
  const pinned = { rows: [{ ...list.rows[0], pinned: 1 }, list.rows[1]] }
  expect(
    update({ account: 'a', ids: ['older'], pinned: false }, { account: 'a' }, pinned),
  ).toMatchObject({ rows: [{ pinned: 0 }, { pinned: 0 }] })
})
