import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'

import type { Operation } from '@/platform/transport'

import { registration } from './policy'

// The effects a mail mutation has on cached reads, as the shared client applies them.
const effectsOf = (publicName: string) => {
  const policy = registration.policy(
    fromPartial<Operation>({
      id: 'clear_list',
      kind: 'mutation',
      publicName,
    }),
  )
  if (!policy.effects || policy.effects === 'none' || typeof policy.effects.matches !== 'function')
    throw new Error('Expected cache matching effects')
  return { matches: policy.effects.matches }
}

describe('mail cache policy', () => {
  it('refreshes every account when a clear spans all accounts', () => {
    const { matches } = effectsOf('messages.clearList')
    const allAccounts = { action: 'read', folder: 'inbox', category: 'updates' }
    expect(matches(allAccounts, { account: 'a', mailbox: 'inbox' })).toBe(true)
    expect(matches(allAccounts, { account: 'b', mailbox: 'inbox' })).toBe(true)
  })

  it("keeps a delete by names away from another account's lists", () => {
    const { matches } = effectsOf('messages.delete')
    const byNames = { names: ['a|m1'] }
    expect(matches(byNames, { account: 'b', mailbox: 'inbox' })).toBe(false)
  })

  // Deleted forever from Trash, a conversation stayed on the list until the next poll read it again.
  it("takes a conversation deleted by names off its own account's list at once", () => {
    const policy = registration.policy(
      fromPartial<Operation>({
        id: 'delete_messages',
        kind: 'mutation',
        publicName: 'messages.delete',
      }),
    )
    if (!policy.effects || policy.effects === 'none' || !policy.effects.optimisticReads)
      throw new Error('Expected mutation cache effects')
    const { matches, optimisticReads } = policy.effects
    const trash = { account: 'a', mailbox: 'trash' }
    const byNames = { names: ['a|q'] }
    expect(typeof matches === 'function' && matches(byNames, trash)).toBe(true)
    expect(
      optimisticReads.update(byNames, trash, {
        rows: [{ id: 'q', messages: [{ id: 'q' }] }, { id: 'other' }],
      }),
    ).toEqual({ rows: [{ id: 'other' }] })
  })

  it('keeps a one-account clear to that account', () => {
    const { matches } = effectsOf('messages.clearList')
    const oneAccount = { action: 'read', account: 'a', mailbox: 'inbox' }
    expect(matches(oneAccount, { account: 'a', mailbox: 'inbox' })).toBe(true)
    expect(matches(oneAccount, { account: 'b', mailbox: 'inbox' })).toBe(false)
  })
})
