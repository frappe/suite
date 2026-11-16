import { beforeEach, describe, expect, it, vi } from 'vitest'

import { searchesAllAccountsFrom, useSearchWith } from './composables'
import { withoutFilters } from './searchFilters'

const pushed = vi.hoisted((): unknown[] => [])
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ push: (location: unknown) => pushed.push(location) }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'work', mailboxIds: { inbox: 'inbox-id' } }),
}))
vi.mock('@/apps/mail/router', () => ({ default: {} }))

describe('editing a search on its results page', () => {
  beforeEach(() => (pushed.length = 0))

  it('runs the search as edited while something is left to search', () => {
    useSearchWith()(withoutFilters({ text: 'budget', from: 'ana@x.test' }))
    expect(pushed).toEqual([
      {
        name: 'mail-mailbox',
        params: { accountId: 'work', mailbox: 'search' },
        query: { text: 'budget' },
      },
    ])
  })

  it("leaves a search of one account for that account's Inbox", () => {
    useSearchWith()(withoutFilters({ from: 'ana@x.test' }))
    expect(pushed).toEqual([
      { name: 'mail-mailbox', params: { accountId: 'work', mailbox: 'inbox-id' } },
    ])
  })

  it('leaves a search of every account for the All Inboxes Inbox', () => {
    useSearchWith()(withoutFilters({ from: 'ana@x.test', all_accounts: '1' }))
    expect(pushed).toEqual([{ name: 'mail-unified', params: { folder: 'inbox' } }])
  })
})

describe('where a search looks', () => {
  const searchRoute = (query: Record<string, string>) => ({
    name: 'mail-mailbox',
    params: { accountId: 'work', mailbox: 'search' },
    query,
  })

  it('looks in every account from All Inboxes, a folder or a mail open in it', () => {
    expect(
      searchesAllAccountsFrom({ name: 'mail-unified', params: { folder: 'inbox' }, query: {} }),
    ).toBe(true)
    expect(
      searchesAllAccountsFrom({
        name: 'mail-unified-mail',
        params: { folder: 'archive', accountId: 'personal', threadID: 't1' },
        query: {},
      }),
    ).toBe(true)
  })

  it('looks in the one account from its folders and its mail', () => {
    expect(
      searchesAllAccountsFrom({
        name: 'mail-mailbox',
        params: { accountId: 'work', mailbox: 'inbox-id' },
        query: {},
      }),
    ).toBe(false)
    expect(
      searchesAllAccountsFrom({
        name: 'mail-mail',
        params: { accountId: 'work', mailbox: 'archive', threadID: 't1' },
        query: {},
      }),
    ).toBe(false)
  })

  it('keeps the scope of the search being edited', () => {
    expect(searchesAllAccountsFrom(searchRoute({ text: 'budget', all_accounts: '1' }))).toBe(true)
    expect(searchesAllAccountsFrom(searchRoute({ text: 'budget' }))).toBe(false)
    // With a result open beside the list.
    expect(
      searchesAllAccountsFrom({
        ...searchRoute({ text: 'budget', all_accounts: '1' }),
        name: 'mail-mail',
        params: { accountId: 'work', mailbox: 'search', threadID: 't1' },
      }),
    ).toBe(true)
  })
})
