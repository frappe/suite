import { describe, expect, it } from 'vitest'

import { registration } from './policy'

// The effects a mail mutation has on cached reads, as the shared client applies them.
const effectsOf = (publicName: string) => {
  const policy = registration.policy({
    id: 'clear_list',
    kind: 'mutation',
    publicName,
  } as never)
  return (policy as { effects: { matches: (input: unknown, queryInput: unknown) => boolean } })
    .effects
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

  it('keeps a one-account clear to that account', () => {
    const { matches } = effectsOf('messages.clearList')
    const oneAccount = { action: 'read', account: 'a', mailbox: 'inbox' }
    expect(matches(oneAccount, { account: 'a', mailbox: 'inbox' })).toBe(true)
    expect(matches(oneAccount, { account: 'b', mailbox: 'inbox' })).toBe(false)
  })
})
