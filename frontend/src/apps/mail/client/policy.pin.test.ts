import { expect, it } from 'vitest'

import { registration } from './policy'

// How pinning changes a cached list before the server answers: the row reads pinned straight away,
// whichever of the conversation's messages it stands for.
type Listed = { rows: { pinned: number; messages: { id: string; pinned?: number }[] }[] }

const updateOf = () => {
  const policy = registration.policy({
    id: 'pin_mails',
    kind: 'mutation',
    publicName: 'messages.pin',
  } as never) as {
    effects: {
      optimisticReads: { update: (input: unknown, query: unknown, data: unknown) => Listed }
    }
  }
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
  const { rows } = update({ account: 'a', ids: ['older'], pinned: true }, { account: 'a' }, list)
  expect(rows[0].pinned).toBe(1)
  expect(rows[0].messages.find((m) => m.id === 'older')?.pinned).toBe(1)
})

it('leaves other conversations alone, and unpins by the same rule', () => {
  const update = updateOf()
  const pinned = { rows: [{ ...list.rows[0], pinned: 1 }, list.rows[1]] }
  const { rows } = update({ account: 'a', ids: ['older'], pinned: false }, { account: 'a' }, pinned)
  expect(rows[0].pinned).toBe(0)
  expect(rows[1].pinned).toBe(0)
})
