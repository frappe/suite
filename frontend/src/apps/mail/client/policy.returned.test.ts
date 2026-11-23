import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it } from 'vitest'

import type { Operation } from '@/platform/transport'

import { registration } from './policy'

// How clearing a returned mark changes a cached list before the server answers: the row is no longer
// back, so it falls to its date, and nothing else moves.
type Row = { thread_id: string; account?: string; returned: number; no_reply: number }

const updateOf = () => {
  const policy = registration.policy(
    fromPartial<Operation>({
      id: 'dismiss_returned_mail',
      kind: 'mutation',
      publicName: 'messages.dismissReturned',
    }),
  )
  if (!policy.effects || policy.effects === 'none' || !policy.effects.optimisticReads)
    throw new Error('Expected mutation cache effects')
  // SAFETY: the cache update hands back the data it was given, in the same shape.
  return policy.effects.optimisticReads.update as (
    input: unknown,
    query: unknown,
    data: unknown,
  ) => { rows: Row[] }
}

const row = (thread_id: string, extra: Partial<Row> = {}): Row => ({
  thread_id,
  returned: 1,
  no_reply: 1,
  ...extra,
})

it('takes the mark off the cleared rows on the click', () => {
  const { rows } = updateOf()(
    { account: 'a', thread_ids: ['t1'] },
    { account: 'a', mailbox: 'inbox' },
    { rows: [row('t1'), row('t2')] },
  )
  expect(rows.map((r) => [r.returned, r.no_reply])).toEqual([
    [0, 0],
    [1, 1],
  ])
})

it("leaves another account's row with the same thread id alone in a merged list", () => {
  const { rows } = updateOf()(
    { account: 'a', thread_ids: ['t1'] },
    { folder: 'inbox' },
    { rows: [row('t1', { account: 'a' }), row('t1', { account: 'b' })] },
  )
  expect(rows.map((r) => r.returned)).toEqual([0, 1])
})
